/**
 * Дымовая проверка хранилища на ЖИВОМ бакете. Запуск:
 *
 *   cd backend && STORAGE_DRIVER=s3 bun src/s3-smoke.ts
 *
 * Зачем отдельно от юнит-тестов: те гоняют драйвер на замоканном клиенте и проверяют
 * нашу логику. Здесь проверяется то, что от нас не зависит и выясняется только опытом —
 * поведение конкретной сборки Ceph RGW: принимает ли она multipart с нашими настройками
 * контрольных сумм, отдаёт ли Range, как выглядят ошибки на отсутствующем объекте.
 *
 * Порядок проверок — от самого вероятного отказа к частностям, чтобы не ждать десять
 * шагов ради падения на первом.
 *
 * Предохранитель: по умолчанию требуется непустой S3_KEY_PREFIX. Без него скрипт писал бы
 * временные объекты в корень боевого бакета. Обойти — аргументом `--allow-root-prefix`.
 */

import { getStorage, isMissingObjectError, withTempDir } from './services/storage'
import { config } from './config'
import { writeStreamedFile } from './services/storage/fsio'
import { join } from 'path'

const BIG = 20 * 1024 * 1024 // выше порога multipart (16 МБ) — главный подозреваемый
const SMALL = 64 * 1024

let failed = 0
let passed = 0

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const note = await fn()
    passed++
    console.log(`  ✅ ${name}${note ? ` — ${note}` : ''}`)
  } catch (e) {
    failed++
    console.log(`  ❌ ${name}\n     ${String((e as Error)?.message || e).slice(0, 300)}`)
  }
}

function bytes(n: number): Buffer {
  const buf = Buffer.allocUnsafe(n)
  for (let i = 0; i < n; i++) buf[i] = i % 251 // не нули: поймает «записалось пусто»
  return buf
}

async function main() {
  if (config.STORAGE_DRIVER !== 's3') {
    console.error('Нужен STORAGE_DRIVER=s3. Запуск: STORAGE_DRIVER=s3 bun src/s3-smoke.ts')
    process.exit(1)
  }
  if (!config.S3_KEY_PREFIX.trim() && !process.argv.includes('--allow-root-prefix')) {
    console.error(
      'S3_KEY_PREFIX пуст — скрипт писал бы временные объекты в корень боевого бакета.\n' +
        'Задайте префикс (на тестовой машине это dev/) или запустите с --allow-root-prefix.',
    )
    process.exit(1)
  }

  const storage = getStorage()
  console.log('Хранилище:', JSON.stringify(storage.describe()))

  const run = crypto.randomUUID().slice(0, 8)
  const biz = `_smoke-${run}`
  const smallKey = `${biz}/small.bin`
  const bigKey = `${biz}/big.mp4`
  const fromFileKey = `${biz}/fromfile.mp4`
  const created: string[] = []

  console.log('\n1. Доступность бакета')
  await check('ping (бакет отвечает, ключи и регион приняты)', () => storage.ping())

  console.log('\n2. Запись')
  await check('мелкий объект одним запросом', async () => {
    const res = await storage.put(smallKey, bytes(SMALL), { contentType: 'application/octet-stream' })
    created.push(smallKey)
    if (res.size !== SMALL) throw new Error(`размер ${res.size}, ожидался ${SMALL}`)
    return `${res.size} байт, url ${res.url}`
  })

  await check('КРУПНЫЙ объект через multipart (20 МБ)', async () => {
    const res = await storage.put(bigKey, bytes(BIG), { contentType: 'video/mp4' })
    created.push(bigKey)
    if (res.size !== BIG) throw new Error(`размер ${res.size}, ожидался ${BIG}`)
    return `${(res.size / 1e6).toFixed(1)} МБ`
  })

  await check('загрузка из локального файла (путь ffmpeg)', async () => {
    return await withTempDir(async (dir) => {
      const p = join(dir, 'src.mp4')
      await writeStreamedFile(p, bytes(BIG))
      const res = await storage.putFromLocalFile(fromFileKey, p, { contentType: 'video/mp4' })
      created.push(fromFileKey)
      if (res.size !== BIG) throw new Error(`размер ${res.size}, ожидался ${BIG}`)
      return `${(res.size / 1e6).toFixed(1)} МБ`
    })
  })

  console.log('\n3. Чтение')
  await check('байты вернулись без искажений', async () => {
    const buf = await storage.get(smallKey)
    if (!buf.equals(bytes(SMALL))) throw new Error('содержимое не совпало с записанным')
    return `${buf.length} байт`
  })

  await check('размер крупного объекта совпадает', async () => {
    const size = await storage.size(bigKey)
    if (size !== BIG) throw new Error(`size() вернул ${size}`)
    return `${size} байт`
  })

  console.log('\n4. Раздача (это и есть перемотка видео в браузере)')
  await check('обычный запрос → 200 и нужные заголовки', async () => {
    const res = await storage.serve(bigKey, new Request('http://x/uploads/' + bigKey))
    if (!res) throw new Error('объект не найден')
    if (res.status !== 200) throw new Error(`статус ${res.status}`)
    const ct = res.headers.get('Content-Type')
    const cc = res.headers.get('Cache-Control')
    if (ct !== 'video/mp4') throw new Error(`Content-Type = ${ct}`)
    if (!cc?.includes('max-age')) throw new Error(`Cache-Control = ${cc}`)
    await res.arrayBuffer()
    return `Content-Type ${ct}, Cache-Control ${cc}`
  })

  await check('запрос куска → 206 + Content-Range + верные байты', async () => {
    const req = new Request('http://x/uploads/' + bigKey, { headers: { Range: 'bytes=100-199' } })
    const res = await storage.serve(bigKey, req)
    if (!res) throw new Error('объект не найден')
    if (res.status !== 206) throw new Error(`статус ${res.status}, ожидался 206`)
    const cr = res.headers.get('Content-Range')
    const body = Buffer.from(await res.arrayBuffer())
    if (body.length !== 100) throw new Error(`пришло ${body.length} байт вместо 100`)
    if (!body.equals(bytes(BIG).subarray(100, 200))) throw new Error('кусок не тот')
    return cr ?? ''
  })

  await check('несуществующий объект → null (роут отдаст 404)', async () => {
    const res = await storage.serve(`${biz}/нет-такого.png`, new Request('http://x/uploads/x'))
    if (res !== null) throw new Error(`вернулось ${res.status} вместо null`)
  })

  console.log('\n5. Материализация для ffmpeg')
  await check('объект скачивается во временный файл и убирается за собой', async () => {
    const handle = await storage.localFile(bigKey)
    if (!handle) throw new Error('объект не найден')
    const { stat } = await import('fs/promises')
    const st = await stat(handle.path)
    if (st.size !== BIG) throw new Error(`во временном файле ${st.size} байт`)
    await handle.dispose()
    const stillThere = await stat(handle.path).then(
      () => true,
      () => false,
    )
    if (stillThere) throw new Error('временный файл остался на диске')
    return `${(st.size / 1e6).toFixed(1)} МБ, файл удалён`
  })

  console.log('\n6. Различение «нет объекта» и «хранилище не ответило»')
  await check('чтение отсутствующего даёт опознаваемую ошибку', async () => {
    try {
      await storage.get(`${biz}/нет-такого.bin`)
      throw new Error('чтение не упало, хотя объекта нет')
    } catch (e) {
      if (!isMissingObjectError(e)) {
        throw new Error(`ошибка не опознана как «нет объекта»: ${(e as Error).name}`)
      }
      return `распознано как отсутствие (${(e as Error).name})`
    }
  })

  console.log('\n7. Уборка')
  for (const key of created) {
    await check(`удалён ${key}`, async () => {
      await storage.delete(key)
      if (await storage.exists(key)) throw new Error('объект всё ещё на месте')
    })
  }

  console.log(`\nИтог: ${passed} успешно, ${failed} с ошибкой`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('Скрипт упал:', e)
  process.exit(1)
})
