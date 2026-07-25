/**
 * S3-драйвер хранилища медиа (Beget S3, под капотом Ceph RADOS Gateway).
 *
 * Ставится в тот же шов, что и `LocalStorageDriver`: наружу отдаются только ключи и байты,
 * файловый путь — исключительно через `localFile()`/`putFromLocalFile()` (шлюз для ffmpeg).
 * Поэтому переключение драйвера не требует правок в вызывающем коде.
 *
 * Особенности провайдера, установленные эмпирически (25.07):
 *  - адресация **path-style** → `forcePathStyle: true`;
 *  - `Range` поддерживается штатно (206 + `Content-Range`) — на этом держится перемотка видео;
 *  - объекты **не отдают `Cache-Control`** (у RGW его нет, если не положить в метаданные),
 *    поэтому заголовок ставим сами в `serve()` и дублируем в метаданных при записи;
 *  - прод-нода живёт в той же сети (AS198610), RTT до эндпоинта ≈ 2.5 мс — отсюда решение
 *    раздавать прокси-стримом, а не 302-редиректом на presigned URL.
 */

import { createReadStream, createWriteStream } from 'fs'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { config } from '../../config'
import { log } from '../../utils/logger'
import { isMissingObjectError as isNotFound } from './errors'
import { urlFromKey, type StorageKey } from './keys'
import { tmpRoot } from './tmp'
import type {
  LocalFileHandle,
  PutOpts,
  PutResult,
  StorageDriver,
  StorageKind,
  StorageWritable,
} from './base'

/** Дефолт кэша для объектов. Совпадает с тем, что раздача ставила при локальном драйвере. */
const DEFAULT_CACHE_CONTROL = 'public, max-age=300'

/**
 * Порог перехода на multipart. Ниже — один `PutObject` из буфера: он идемпотентно
 * ретраится SDK при сетевом сбое. Выше — `lib-storage` `Upload`, который режет поток
 * на части (500-МБ видео в память поднимать нельзя при лимите контейнера 2 ГБ).
 */
const MULTIPART_THRESHOLD = 16 * 1024 * 1024
const PART_SIZE = 16 * 1024 * 1024
/** Пиковая память загрузки ≈ PART_SIZE × QUEUE_SIZE + часть в полёте. */
const QUEUE_SIZE = 2

// ─────────────────────────── классификация ошибок ───────────────────────────

function errName(err: unknown): string {
  return (err as { name?: string })?.name ?? ''
}

function httpStatus(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
}

// ─────────────────────────── размер источника ───────────────────────────

/**
 * Размер записываемого объекта. Считаем из источника, а НЕ спрашиваем у S3 после записи:
 * `Upload` возвращает `CompleteMultipartUploadOutput` без размера, а `size` уходит прямо
 * в `MediaFile.sizeBytes`. `HeadObject` ради этого — лишний round-trip на каждую запись.
 */
function sizeOf(data: StorageWritable): number {
  if (typeof data === 'string') return Buffer.byteLength(data)
  if (data instanceof Blob) return data.size
  if (data instanceof ArrayBuffer) return data.byteLength
  return (data as Uint8Array).byteLength
}

/** Приведение к тому, что понимает `PutObjectCommand.Body` (Blob он НЕ сериализует). */
function toBuffer(data: Exclude<StorageWritable, Blob>): Buffer {
  if (typeof data === 'string') return Buffer.from(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  return Buffer.from(data as Uint8Array)
}

export interface S3DriverConfig {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  keyPrefix: string
}

/** Конфиг из env с явной проверкой обязательных полей — падать лучше на старте. */
export function s3ConfigFromEnv(): S3DriverConfig {
  const cfg: S3DriverConfig = {
    endpoint: config.S3_ENDPOINT.trim(),
    bucket: config.S3_BUCKET.trim(),
    region: config.S3_REGION.trim() || 'ru1',
    accessKeyId: config.S3_ACCESS_KEY.trim(),
    secretAccessKey: config.S3_SECRET_KEY.trim(),
    keyPrefix: config.S3_KEY_PREFIX.trim(),
  }
  const missing = (['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey'] as const).filter(
    (k) => !cfg[k],
  )
  if (missing.length > 0) {
    const names = missing.map((k) => `S3_${k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}`)
    throw new Error(
      `STORAGE_DRIVER=s3, но не заданы обязательные переменные: ${names.join(', ')}`,
    )
  }
  return cfg
}

export function createS3Client(cfg: S3DriverConfig): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // SDK ≥3.729 по умолчанию досылает CRC32 в трейлере (`aws-chunked`) и требует
    // валидации контрольных сумм на чтении. Часть сборок Ceph RGW на этом отвечает
    // 400 / XAmzContentSHA256Mismatch, причём выборочно — чаще всего именно
    // на multipart, то есть ровно на видео. Возвращаем поведение «только когда
    // протокол реально требует».
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: {
      // Без явных таймаутов зависшее соединение до RGW вешает Hono-запрос навсегда:
      // у NodeHttpHandler оба значения по умолчанию — 0 (без ограничения).
      connectionTimeout: 5_000,
      // Таймаут по НЕАКТИВНОСТИ сокета, а не по общей длительности, поэтому
      // безопасен для отдачи больших объектов.
      requestTimeout: 60_000,
      httpsAgent: { maxSockets: 64 },
    },
  })
}

export class S3StorageDriver implements StorageDriver {
  readonly kind: StorageKind = 's3'

  private readonly client: S3Client
  private readonly bucket: string
  private readonly prefix: string
  private readonly cfg: S3DriverConfig

  /** Клиент инжектируется ради тестов; в проде создаётся из того же конфига. */
  constructor(cfg: S3DriverConfig = s3ConfigFromEnv(), client?: S3Client) {
    this.cfg = cfg
    this.bucket = cfg.bucket
    // Нормализация здесь, а не в чтении env: конфиг приходит и программно (тесты,
    // будущие вызывающие), а `dev` без слэша склеился бы в `devbiz/...`.
    this.prefix = cfg.keyPrefix && !cfg.keyPrefix.endsWith('/') ? cfg.keyPrefix + '/' : cfg.keyPrefix
    this.client = client ?? createS3Client(cfg)
  }

  describe(): Record<string, unknown> {
    return {
      driver: 's3',
      endpoint: this.cfg.endpoint,
      bucket: this.bucket,
      region: this.cfg.region,
      prefix: this.prefix || '(нет)',
    }
  }

  /**
   * Ключ приложения → ключ в бакете. Префикс живёт ТОЛЬКО здесь: в БД, в `keys.ts`
   * и в публичных URL его нет. Это то единственное, что изолирует dev от прод-объектов —
   * `makeKey` порождает одинаковые ключи, а `/rotate` пишет по тому же ключу.
   */
  private objectKey(key: StorageKey): string {
    return this.prefix + key
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
  }

  async put(key: StorageKey, data: StorageWritable, opts?: PutOpts): Promise<PutResult> {
    const size = sizeOf(data)
    const common = {
      Bucket: this.bucket,
      Key: this.objectKey(key),
      ContentType: opts?.contentType,
      CacheControl: opts?.cacheControl ?? DEFAULT_CACHE_CONTROL,
    }

    if (size <= MULTIPART_THRESHOLD) {
      // Мелочь (картинки, превью, слои) — одним запросом из буфера: он ретраится.
      const body = data instanceof Blob ? Buffer.from(await data.arrayBuffer()) : toBuffer(data)
      await this.client.send(new PutObjectCommand({ ...common, Body: body }))
      return { key, url: urlFromKey(key), size }
    }

    // Крупное (видео) — multipart. Сырой одноразовый поток в `PutObject` передавать
    // нельзя: при ретрае SDK повторит запрос по уже вычитанному стриму и запишет пустой
    // объект. `Upload` режет источник на части и ретраит части независимо.
    const body = data instanceof Blob ? Readable.fromWeb(data.stream() as never) : toBuffer(data)
    await this.multipart({ ...common, Body: body })
    return { key, url: urlFromKey(key), size }
  }

  async putFromLocalFile(
    key: StorageKey,
    sourcePath: string,
    opts?: PutOpts,
  ): Promise<PutResult> {
    const { size } = await stat(sourcePath)
    const common = {
      Bucket: this.bucket,
      Key: this.objectKey(key),
      ContentType: opts?.contentType,
      CacheControl: opts?.cacheControl ?? DEFAULT_CACHE_CONTROL,
    }

    if (size <= MULTIPART_THRESHOLD) {
      await this.client.send(new PutObjectCommand({ ...common, Body: await readFile(sourcePath) }))
    } else {
      await this.multipart({ ...common, Body: createReadStream(sourcePath) })
    }
    return { key, url: urlFromKey(key), size }
  }

  /** Multipart с гарантированным `abort()`: брошенные части копятся и тарифицируются. */
  private async multipart(params: Record<string, unknown>): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: params as never,
      partSize: PART_SIZE,
      queueSize: QUEUE_SIZE,
      leavePartsOnError: false,
    })
    try {
      await upload.done()
    } catch (e) {
      await upload.abort().catch(() => {})
      throw e
    }
  }

  async get(key: StorageKey): Promise<Buffer<ArrayBuffer>> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    )
    if (!out.Body) throw new Error(`Пустой ответ хранилища: ${key}`)
    const bytes = await out.Body.transformToByteArray()
    return Buffer.from(bytes) as Buffer<ArrayBuffer>
  }

  async getStream(key: StorageKey): Promise<ReadableStream<Uint8Array>> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    )
    if (!out.Body) throw new Error(`Пустой ответ хранилища: ${key}`)
    return out.Body.transformToWebStream()
  }

  async exists(key: StorageKey): Promise<boolean> {
    return (await this.size(key)) !== null
  }

  async size(key: StorageKey): Promise<number | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      )
      return out.ContentLength ?? null
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  /**
   * Best-effort удаление. ⚠️ У S3 `DeleteObject` по несуществующему ключу отвечает 204,
   * то есть успехом — поэтому `true` здесь означает «запрос удаления принят»,
   * а не «объект существовал» (у локального драйвера семантика была именно второй).
   * На включённом versioning удаление к тому же кладёт delete-marker, а не стирает данные.
   */
  async delete(key: StorageKey): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      )
      return true
    } catch (err) {
      log.warn('[storage] не удалось удалить объект', { key, error: String(errName(err) || err) })
      return false
    }
  }

  /**
   * Ответ для `GET /uploads/*` — прокси-стрим, а не редирект.
   *
   * Так сохраняются ровно те же URL, `Cache-Control`, CORS и `?v=`, что были при локальном
   * драйвере (дельта поведения нулевая), а Range остаётся нашей ответственностью и
   * работает одинаково независимо от того, есть ли перед приложением Caddy.
   */
  async serve(key: StorageKey, req: Request): Promise<Response | null> {
    const range = req.headers.get('range') ?? undefined
    const ifNoneMatch = req.headers.get('if-none-match') ?? undefined

    let out
    try {
      out = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.objectKey(key),
          Range: range,
          IfNoneMatch: ifNoneMatch,
        }),
        // Обрыв клиента (перемотка видео = серия брошенных Range-запросов) должен
        // закрывать и соединение к S3, иначе сокеты копятся на каждый скраббинг.
        { abortSignal: req.signal as never },
      )
    } catch (err) {
      const status = httpStatus(err)
      // SDK считает 304 ошибкой — при наивной обработке это стало бы 500.
      if (status === 304) {
        return new Response(null, {
          status: 304,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': DEFAULT_CACHE_CONTROL,
            ...(ifNoneMatch ? { ETag: ifNoneMatch } : {}),
          },
        })
      }
      if (status === 412) return new Response(null, { status: 412 })
      if (status === 416 || errName(err) === 'InvalidRange') {
        return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes' } })
      }
      if (isNotFound(err)) return null
      throw err
    }

    if (!out.Body) return null

    const headers: Record<string, string> = {
      // CORS: сохраняем прежнее поведение раздачи (медиа де-факто публична).
      'Access-Control-Allow-Origin': '*',
      // Cache-Control ставим сами: RGW своих значений не отдаёт.
      'Cache-Control': DEFAULT_CACHE_CONTROL,
      'Accept-Ranges': 'bytes',
    }
    if (out.ContentType) headers['Content-Type'] = out.ContentType
    if (out.ContentLength !== undefined) headers['Content-Length'] = String(out.ContentLength)
    if (out.ETag) headers['ETag'] = out.ETag
    if (out.LastModified) headers['Last-Modified'] = out.LastModified.toUTCString()
    if (out.ContentRange) headers['Content-Range'] = out.ContentRange

    return new Response(out.Body.transformToWebStream() as BodyInit, {
      status: out.ContentRange ? 206 : 200,
      headers,
    })
  }

  /**
   * Материализация объекта во временный файл — единственный способ отдать данные ffmpeg.
   * Ровно один `GetObject`: проверять существование отдельным `HeadObject` значило бы
   * платить два round-trip на каждый вход ffmpeg-пайплайна.
   */
  async localFile(key: StorageKey): Promise<LocalFileHandle | null> {
    let out
    try {
      out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      )
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
    if (!out.Body) return null

    const dir = await mkdtemp(join(tmpRoot(), 'obj-'))
    // Имя файла сохраняем: ffmpeg выбирает демуксер в том числе по расширению.
    const path = join(dir, key.split('/').pop() || 'object')
    try {
      await pipeline(Readable.fromWeb(out.Body.transformToWebStream() as never), createWriteStream(path))
    } catch (e) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
      throw e
    }

    let disposed = false
    return {
      path,
      dispose: async () => {
        if (disposed) return
        disposed = true
        await rm(dir, { recursive: true, force: true }).catch(() => {})
      },
    }
  }

  async withLocalFile<T>(key: StorageKey, fn: (localPath: string) => Promise<T>): Promise<T> {
    const handle = await this.localFile(key)
    if (!handle) throw new Error(`Storage object not found: ${key}`)
    try {
      return await fn(handle.path)
    } finally {
      await handle.dispose()
    }
  }
}
