/**
 * Сквозная проверка ЧЕРЕЗ РЕАЛЬНЫЕ РУЧКИ приложения на живом бакете. Запуск:
 *
 *   cd backend && STORAGE_DRIVER=s3 bun src/s3-e2e.ts
 *
 * Чем отличается от `s3-smoke.ts`: там проверялся сам драйвер, здесь — маршруты, которые
 * я переписал под объектное хранилище. Именно в них сидит риск, которого не видно
 * ни в юнит-тестах, ни в дымовой проверке:
 *   - загрузка фото: нормализация EXIF-поворота и превью теперь идут из одного буфера,
 *     без повторного чтения объекта;
 *   - загрузка видео: порядок «временный файл → превью → объект» вместо прежнего
 *     «объект → скачать обратно → превью»;
 *   - поворот: перезапись объекта ПО ТОМУ ЖЕ ключу;
 *   - раздача: заголовки и куски (перемотка).
 *
 * Запросы идут через `app.request()` — тот же код, что и по HTTP, но без порта и сети.
 * Предохранитель на непустой S3_KEY_PREFIX, как и в дымовой проверке.
 */

import { app } from './app'
import { config } from './config'
import { db } from './db'
import { getStorage, keyFromUrl } from './services/storage'
import sharp from 'sharp'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { withTempDir } from './services/storage'
import { join } from 'path'
import { readFile } from 'fs/promises'

const execFileAsync = promisify(execFile)

const TEST_LOGIN = '_e2e_storage'
const TEST_PASSWORD = 'e2e-' + crypto.randomUUID()

let passed = 0
let failed = 0
const createdMediaIds: string[] = []

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const note = await fn()
    passed++
    console.log(`  ✅ ${name}${note ? ` — ${note}` : ''}`)
  } catch (e) {
    failed++
    console.log(`  ❌ ${name}\n     ${String((e as Error)?.message || e).slice(0, 400)}`)
  }
}

/**
 * Портретное JPEG с EXIF-поворотом: ровно тот случай, ради которого есть нормализация.
 *
 * Именно `withMetadata({orientation})`, а НЕ `withExifMerge({IFD0:{Orientation}})` —
 * второй вариант тег не проставляет (проверено: orientation остаётся 1), и проверка
 * нормализации прошла бы вхолостую, то есть зелено на сломанном коде.
 */
async function makeRotatedJpeg(): Promise<Buffer<ArrayBuffer>> {
  const buf = await sharp({
    create: { width: 400, height: 800, channels: 3, background: { r: 200, g: 60, b: 180 } },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()
  const meta = await sharp(buf).metadata()
  if (meta.orientation !== 6) {
    throw new Error(`фикстура без EXIF-поворота (orientation=${meta.orientation}) — проверка была бы пустой`)
  }
  return buf as Buffer<ArrayBuffer>
}

/** Короткое настоящее видео — превью снимает ffmpeg, подделкой не обойтись. */
async function makeMp4(): Promise<Buffer<ArrayBuffer>> {
  return await withTempDir(async (dir) => {
    const out = join(dir, 'v.mp4')
    await execFileAsync('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2',
      '-pix_fmt', 'yuv420p', '-y', out,
    ])
    return (await readFile(out)) as Buffer<ArrayBuffer>
  })
}

function form(
  fields: Record<string, string>,
  file?: { name: string; type: string; data: Buffer<ArrayBuffer> },
) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  if (file) fd.append('file', new Blob([file.data], { type: file.type }), file.name)
  return fd
}

async function main() {
  if (config.STORAGE_DRIVER !== 's3') {
    console.error('Нужен STORAGE_DRIVER=s3.')
    process.exit(1)
  }
  if (!config.S3_KEY_PREFIX.trim()) {
    console.error('S3_KEY_PREFIX пуст — отказ: проверка писала бы в корень боевого бакета.')
    process.exit(1)
  }

  const storage = getStorage()
  console.log('Хранилище:', JSON.stringify(storage.describe()))

  // --- временный админ (пароль знаем только мы, пользователь удаляется в конце) ---
  const passwordHash = await Bun.password.hash(TEST_PASSWORD)
  const user = await db.user.upsert({
    where: { login: TEST_LOGIN },
    create: { login: TEST_LOGIN, passwordHash, name: 'E2E storage', role: 'ADMIN' },
    update: { passwordHash, role: 'ADMIN', isActive: true },
  })
  const business = await db.business.findFirst({ select: { id: true, name: true } })
  if (!business) throw new Error('в тестовой БД нет ни одного проекта')
  console.log(`Проект: ${business.name}\n`)

  const loginRes = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: TEST_LOGIN, password: TEST_PASSWORD }),
  })
  if (!loginRes.ok) throw new Error(`логин не прошёл: ${loginRes.status} ${await loginRes.text()}`)
  const cookie = (loginRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ')
  const authHeaders = { Cookie: cookie, 'X-Tab-ID': 'e2e' }

  let photo: any = null
  let video: any = null

  console.log('1. Загрузка фото (EXIF-поворот + превью из одного буфера)')
  await check('фото загрузилось, превью создано', async () => {
    const res = await app.request('/api/media/upload', {
      method: 'POST',
      headers: authHeaders,
      body: form({ businessId: business.id }, {
        name: 'e2e-photo.jpg', type: 'image/jpeg', data: await makeRotatedJpeg(),
      }),
    })
    if (res.status !== 201) throw new Error(`статус ${res.status}: ${await res.text()}`)
    photo = await res.json()
    createdMediaIds.push(photo.id)
    if (!photo.thumbUrl) throw new Error('превью не создано')
    return `${photo.url}, превью ${photo.thumbUrl}`
  })

  await check('EXIF-поворот запечён в пиксели (фото не «на боку»)', async () => {
    const buf = await storage.get(keyFromUrl(photo.url)!)
    const meta = await sharp(buf).metadata()
    if (meta.orientation && meta.orientation > 1) {
      throw new Error(`orientation остался ${meta.orientation}`)
    }
    // Исходник 400×800 с orientation=6 → после запекания стороны меняются местами.
    // Без этой проверки тест был бы зелёным и в случае, когда нормализация не сработала.
    if (meta.width !== 800 || meta.height !== 400) {
      throw new Error(`поворот НЕ запечён: ${meta.width}×${meta.height}, ожидалось 800×400`)
    }
    return `${meta.width}×${meta.height}, orientation ${meta.orientation ?? 'нет'}`
  })

  console.log('\n2. Загрузка видео (временный файл → превью → объект)')
  await check('видео загрузилось и превью снято ffmpeg-ом', async () => {
    const res = await app.request('/api/media/upload', {
      method: 'POST',
      headers: authHeaders,
      body: form({ businessId: business.id }, {
        name: 'e2e-video.mp4', type: 'video/mp4', data: await makeMp4(),
      }),
    })
    if (res.status !== 201) throw new Error(`статус ${res.status}: ${await res.text()}`)
    video = await res.json()
    createdMediaIds.push(video.id)
    if (!video.thumbUrl) throw new Error('превью видео не создано')
    if (!video.sizeBytes) throw new Error('размер не записан')
    return `${video.sizeBytes} байт, превью ${video.thumbUrl}`
  })

  await check('превью видео реально лежит в хранилище и это картинка', async () => {
    const buf = await storage.get(keyFromUrl(video.thumbUrl)!)
    const meta = await sharp(buf).metadata()
    return `${meta.format} ${meta.width}×${meta.height}`
  })

  console.log('\n3. Поворот (перезапись объекта по тому же ключу)')
  await check('после поворота байты изменились, а адрес — нет', async () => {
    const key = keyFromUrl(photo.url)!
    const before = await storage.get(key)
    const res = await app.request(`/api/media/${photo.id}/rotate`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ angle: 90 }),
    })
    if (!res.ok) throw new Error(`статус ${res.status}: ${await res.text()}`)
    const after = await storage.get(key)
    if (before.equals(after)) throw new Error('содержимое не изменилось')
    const m = await sharp(after).metadata()
    return `${m.width}×${m.height}, адрес прежний`
  })

  console.log('\n4. Раздача')
  await check('картинка отдаётся с нужными заголовками', async () => {
    const res = await app.request(photo.url)
    if (res.status !== 200) throw new Error(`статус ${res.status}`)
    const ct = res.headers.get('Content-Type')
    await res.arrayBuffer()
    return `${ct}, Cache-Control ${res.headers.get('Cache-Control')}`
  })

  await check('перемотка видео: кусок → 206', async () => {
    const res = await app.request(video.url, { headers: { Range: 'bytes=0-99' } })
    if (res.status !== 206) throw new Error(`статус ${res.status}, ожидался 206`)
    const body = await res.arrayBuffer()
    if (body.byteLength !== 100) throw new Error(`пришло ${body.byteLength} байт`)
    return res.headers.get('Content-Range') ?? ''
  })

  await check('служебная папка времянок наружу не отдаётся', async () => {
    const res = await app.request('/uploads/.tmp/anything.mp4')
    if (res.status !== 403) throw new Error(`статус ${res.status}, ожидался 403`)
  })

  await check('несуществующий файл → 404', async () => {
    const res = await app.request('/uploads/' + business.id + '/нет-такого.jpg')
    if (res.status !== 404) throw new Error(`статус ${res.status}, ожидался 404`)
  })

  console.log('\n5. Здоровье сервиса')
  await check('health видит хранилище', async () => {
    const res = await app.request('/api/health?full=true')
    const json = (await res.json()) as Record<string, unknown>
    if (json.storage !== 's3') throw new Error(`storage = ${json.storage}`)
    return `status ${json.status}, storage ${json.storage}`
  })

  console.log('\n6. Уборка')
  for (const id of createdMediaIds) {
    await check(`удалена запись ${id}`, async () => {
      const res = await app.request(`/api/media/${id}`, { method: 'DELETE', headers: authHeaders })
      if (!res.ok) throw new Error(`статус ${res.status}`)
    })
  }
  await check('объекты действительно исчезли из хранилища', async () => {
    for (const mf of [photo, video]) {
      if (!mf) continue
      for (const url of [mf.url, mf.thumbUrl]) {
        if (!url) continue
        const key = keyFromUrl(url)
        if (key && (await storage.exists(key))) throw new Error(`объект остался: ${key}`)
      }
    }
  })
  await db.user.delete({ where: { id: user.id } }).catch(() => {})

  console.log(`\nИтог: ${passed} успешно, ${failed} с ошибкой`)
  await db.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error('Скрипт упал:', e)
  await db.user.deleteMany({ where: { login: TEST_LOGIN } }).catch(() => {})
  await db.$disconnect()
  process.exit(1)
})
