/**
 * S3-драйвер на замоканном клиенте: без сети и без бакета.
 *
 * Проверяем ровно то, что нельзя увидеть в живом прогоне, но чем легко выстрелить себе
 * в ногу: выбор ветки записи (буфер против multipart), подсчёт размера, изоляцию по
 * префиксу, сборку заголовков раздачи и — главное — отделение «объекта нет» от
 * «хранилище не ответило».
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { S3StorageDriver, type S3DriverConfig } from '../s3'
import { isMissingObjectError } from '../errors'

const CFG: S3DriverConfig = {
  endpoint: 'https://s3.example.test',
  bucket: 'test-bucket',
  region: 'ru1',
  accessKeyId: 'ak',
  secretAccessKey: 'sk',
  keyPrefix: '',
}

/** Ошибка в форме, которую реально отдаёт SDK: имя + `$metadata.httpStatusCode`. */
function sdkError(name: string, status?: number): Error {
  const err = new Error(name)
  err.name = name
  ;(err as unknown as { $metadata: unknown }).$metadata = { httpStatusCode: status }
  return err
}

/** Тело ответа GetObject в том виде, в каком его отдаёт SDK (SdkStream). */
function body(bytes: Uint8Array) {
  return {
    transformToByteArray: async () => bytes,
    transformToWebStream: () =>
      new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(bytes)
          ctrl.close()
        },
      }),
  }
}

function makeDriver(send: ReturnType<typeof vi.fn>, cfg: Partial<S3DriverConfig> = {}) {
  // `config` обязателен: lib-storage читает из него настройки контрольных сумм, причём
  // в РАЗРЕШЁННОМ виде — это провайдер-функция, а не строка (строку нормализует SDK
  // при создании настоящего клиента).
  const client = {
    send,
    config: { requestChecksumCalculation: async () => 'WHEN_REQUIRED' },
  } as never
  return new S3StorageDriver({ ...CFG, ...cfg }, client)
}

describe('S3StorageDriver — запись', () => {
  let send: ReturnType<typeof vi.fn>
  beforeEach(() => {
    send = vi.fn().mockResolvedValue({})
  })

  it('мелкий объект идёт одним PutObject (он ретраится), а не multipart', async () => {
    const driver = makeDriver(send)
    const res = await driver.put('biz/a.png', Buffer.alloc(1024), { contentType: 'image/png' })

    expect(send).toHaveBeenCalledTimes(1)
    const cmd = send.mock.calls[0][0]
    expect(cmd).toBeInstanceOf(PutObjectCommand)
    expect(cmd.input.Key).toBe('biz/a.png')
    expect(cmd.input.ContentType).toBe('image/png')
    // RGW не отдаёт Cache-Control сам — кладём в метаданные при записи.
    expect(cmd.input.CacheControl).toContain('max-age')
    expect(res).toEqual({ key: 'biz/a.png', url: '/uploads/biz/a.png', size: 1024 })
  })

  it('размер берётся из ИСТОЧНИКА, а не из ответа S3', async () => {
    // Ответ намеренно пустой: `Upload` размера не возвращает, а значение уходит
    // прямо в MediaFile.sizeBytes — спрашивать его у хранилища нечем и незачем.
    const driver = makeDriver(send)
    expect((await driver.put('b/s.txt', 'привет')).size).toBe(Buffer.byteLength('привет'))
    expect((await driver.put('b/u.bin', new Uint8Array(7))).size).toBe(7)
    expect((await driver.put('b/bl.bin', new Blob([new Uint8Array(9)]))).size).toBe(9)
  })

  it('крупный объект уходит через multipart (CreateMultipartUpload), а не одним телом', async () => {
    send = vi.fn().mockImplementation(async (cmd: { constructor: { name: string } }) => {
      const n = cmd.constructor.name
      if (n === 'CreateMultipartUploadCommand') return { UploadId: 'u1' }
      if (n === 'UploadPartCommand') return { ETag: '"e"' }
      return {}
    })
    const driver = makeDriver(send)
    await driver.put('biz/big.mp4', Buffer.alloc(17 * 1024 * 1024), { contentType: 'video/mp4' })

    const names = send.mock.calls.map((c) => c[0].constructor.name)
    expect(names).toContain('CreateMultipartUploadCommand')
    expect(names).not.toContain('PutObjectCommand')
  })

  it('S3_KEY_PREFIX изолирует dev от прод-объектов и не протекает в url', async () => {
    // Ключи у dev и прода совпадают (одинаковые businessId), а /rotate перезаписывает
    // объект ПО ТОМУ ЖЕ ключу — без префикса обкатка затирала бы прод.
    const driver = makeDriver(send, { keyPrefix: 'dev/' })
    const res = await driver.put('biz/a.png', Buffer.alloc(4))

    expect(send.mock.calls[0][0].input.Key).toBe('dev/biz/a.png')
    // ...но в БД и во фронт уходит ключ БЕЗ префикса — колонки одинаковы для dev и прода.
    expect(res.url).toBe('/uploads/biz/a.png')
  })

  it('префикс без завершающего слэша нормализуется (иначе ключи склеятся)', async () => {
    const driver = makeDriver(send, { keyPrefix: 'dev' })
    await driver.get('biz/a.png').catch(() => {})
    expect(send.mock.calls[0][0].input.Key).toBe('dev/biz/a.png')
  })
})

describe('S3StorageDriver — «нет объекта» против «хранилище не ответило»', () => {
  it('классификатор различает формы отказа RGW', () => {
    expect(isMissingObjectError(sdkError('NoSuchKey', 404))).toBe(true)
    expect(isMissingObjectError(sdkError('NotFound', 404))).toBe(true)
    expect(isMissingObjectError({ code: 'ENOENT' })).toBe(true)
    // Опечатка в имени бакета — тоже 404, но это ошибка конфигурации: приняв её
    // за «нет файла», мы бы молча раздавали 404 на ВСЁ медиа.
    expect(isMissingObjectError(sdkError('NoSuchBucket', 404))).toBe(false)
    expect(isMissingObjectError(sdkError('AccessDenied', 403))).toBe(false)
    expect(isMissingObjectError({ code: 'ECONNRESET' })).toBe(false)
  })

  it('size(): отсутствующий объект → null, сетевая ошибка → бросок', async () => {
    const missing = makeDriver(vi.fn().mockRejectedValue(sdkError('NotFound', 404)))
    expect(await missing.size('biz/x.png')).toBeNull()

    const broken = makeDriver(vi.fn().mockRejectedValue({ code: 'ECONNRESET' }))
    await expect(broken.size('biz/x.png')).rejects.toBeTruthy()
  })

  it('serve(): NoSuchKey → null (404 роутом), а AccessDenied пробрасывается', async () => {
    const missing = makeDriver(vi.fn().mockRejectedValue(sdkError('NoSuchKey', 404)))
    expect(await missing.serve('biz/x.png', new Request('http://x/uploads/biz/x.png'))).toBeNull()

    const denied = makeDriver(vi.fn().mockRejectedValue(sdkError('AccessDenied', 403)))
    await expect(
      denied.serve('biz/x.png', new Request('http://x/uploads/biz/x.png')),
    ).rejects.toBeTruthy()
  })

  it('localFile(): отсутствующий объект → null, а не исключение', async () => {
    const driver = makeDriver(vi.fn().mockRejectedValue(sdkError('NoSuchKey', 404)))
    expect(await driver.localFile('biz/x.mp4')).toBeNull()
  })

  it('delete() не бросает и не притворяется, что объект существовал', async () => {
    // У S3 удаление несуществующего ключа — успех (204), поэтому true здесь означает
    // «запрос прошёл». А вот отказ хранилища должен давать false, а не исключение.
    const ok = makeDriver(vi.fn().mockResolvedValue({}))
    expect(await ok.delete('biz/x.png')).toBe(true)
    expect(vi.mocked(ok['client'].send).mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand)

    const broken = makeDriver(vi.fn().mockRejectedValue({ code: 'ECONNRESET' }))
    expect(await broken.delete('biz/x.png')).toBe(false)
  })
})

describe('S3StorageDriver — раздача', () => {
  const bytes = new Uint8Array([1, 2, 3, 4])

  it('обычный запрос → 200 с заголовками, которые раньше ставила локальная раздача', async () => {
    const send = vi.fn().mockResolvedValue({
      Body: body(bytes),
      ContentType: 'image/webp',
      ContentLength: 4,
      ETag: '"abc"',
      LastModified: new Date('2026-07-25T10:00:00Z'),
    })
    const res = await makeDriver(send).serve('biz/a.webp', new Request('http://x/uploads/biz/a.webp'))

    expect(res!.status).toBe(200)
    expect(res!.headers.get('Content-Type')).toBe('image/webp')
    expect(res!.headers.get('Accept-Ranges')).toBe('bytes')
    // Эти два заголовка — контракт с фронтом: CORS и ?v=-кэшбастинг.
    expect(res!.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res!.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect(res!.headers.get('ETag')).toBe('"abc"')
  })

  it('Range прокидывается в GetObject, ответ → 206 с Content-Range (перемотка видео)', async () => {
    const send = vi.fn().mockResolvedValue({
      Body: body(bytes),
      ContentType: 'video/mp4',
      ContentLength: 4,
      ContentRange: 'bytes 0-3/1000',
    })
    const req = new Request('http://x/uploads/biz/v.mp4', { headers: { Range: 'bytes=0-3' } })
    const res = await makeDriver(send).serve('biz/v.mp4', req)

    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand)
    expect(send.mock.calls[0][0].input.Range).toBe('bytes=0-3')
    expect(res!.status).toBe(206)
    expect(res!.headers.get('Content-Range')).toBe('bytes 0-3/1000')
  })

  it('совпавший If-None-Match → 304, а не 500 (SDK отдаёт 304 как ошибку)', async () => {
    const send = vi.fn().mockRejectedValue(sdkError('NotModified', 304))
    const req = new Request('http://x/uploads/biz/a.webp', {
      headers: { 'If-None-Match': '"abc"' },
    })
    const res = await makeDriver(send).serve('biz/a.webp', req)

    expect(res!.status).toBe(304)
    expect(res!.headers.get('ETag')).toBe('"abc"')
  })

  it('невалидный Range → 416, а не 404 и не 500', async () => {
    const send = vi.fn().mockRejectedValue(sdkError('InvalidRange', 416))
    const req = new Request('http://x/uploads/biz/v.mp4', { headers: { Range: 'bytes=999999-' } })
    const res = await makeDriver(send).serve('biz/v.mp4', req)

    expect(res!.status).toBe(416)
  })
})

describe('S3StorageDriver — конфигурация', () => {
  it('describe() показывает бакет и префикс — это содержимое boot-лога', () => {
    const info = makeDriver(vi.fn(), { keyPrefix: 'dev/' }).describe()
    expect(info).toMatchObject({ driver: 's3', bucket: 'test-bucket', prefix: 'dev/' })
  })

  it('get() материализует байты через transformToByteArray', async () => {
    const send = vi.fn().mockResolvedValue({ Body: body(new Uint8Array([9, 8])) })
    const buf = await makeDriver(send).get('biz/a.png')
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand)
    expect([...buf]).toEqual([9, 8])
  })

  it('exists() опирается на HeadObject', async () => {
    const send = vi.fn().mockResolvedValue({ ContentLength: 10 })
    expect(await makeDriver(send).exists('biz/a.png')).toBe(true)
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand)
  })
})
