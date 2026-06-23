import type { Publisher, PublishParams, PublishResult } from './base'
import type { PlatformAccount } from '@prisma/client'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { getModuleDir } from '../../utils/paths'

/**
 * PostmypostPublisher — generic-паблишер через сервис Postmypost (postmypost.io).
 *
 * Один класс обслуживает ЛЮБУЮ сеть, подключённую в Postmypost-проекте:
 *  - Instagram (всегда через Postmypost — официальный IG API из РФ требует Business+FB+App Review);
 *  - VK-стена/фото (обход застрявшего scope `photos` в VK-поддержке; VK-сторис остаются на прямом VK API).
 *
 * Поведение ветвится по `platformAccount.platform`:
 *  - account_id: `config.postmypostAccountId ?? accountId`. У IG `accountId` уже = PMP account_id;
 *    у VK `accountId` = VK group_id, поэтому PMP account_id берётся из `config.postmypostAccountId`.
 *  - media-required: IG нельзя без медиа; VK-стену можно текстом или с медиа.
 *
 * API base: https://api.postmypost.io/v4.1 (НЕ /v4 — там нет upload!), Bearer.
 * Загрузка медиа — через файл (byUrl у Postmypost сломан, отдаёт 422):
 *   1. POST /upload/init {project_id, name, size} → {id, action(S3), fields[]}
 *   2. POST на action (Yandex S3) multipart: fields + file
 *   3. POST /upload/complete?id={id}
 *   4. GET  /upload/status?id={id} → file_id (когда status=1)
 * Затем:
 *   POST /publications {project_id, post_at, account_ids, publication_status, details:[{...file_ids}]}
 *
 * Доступы в PlatformAccount: accessToken=токен, config.postmypostProjectId=project_id,
 * accountId/config.postmypostAccountId=postmypost account_id. Fallback .env (POSTMYPOST_API_TOKEN/PROJECT_ID).
 */

const UPLOAD_DIR = join(getModuleDir(import.meta), '../../../uploads')

const PUB_TYPE = { POST: 1, STORY: 2, REELS: 4 } as const
const PUB_STATUS_PENDING = 5
const UPLOAD_OK = 1
const UPLOAD_ERROR = 2

// Instagram-лента: допустимое соотношение сторон (w/h) — 4:5 (0.8) … 1.91:1 (1.91).
// Вне диапазона IG/Postmypost вписывает фото, добавляя белые поля. Кропаем к ближайшей границе.
const IG_MIN_RATIO = 0.8       // 4:5 — самое высокое вертикальное
const IG_MAX_RATIO = 1.91      // 1.91:1 — самое широкое горизонтальное
const IG_CROP_POSITION = 'attention' as const // sharp smart-crop: тянет к смысловой области (люди/контраст)

/**
 * Чистая логика кропа фото под IG-ленту. Возвращает целевые размеры (px) или null (не трогать).
 * forceRatio задан (карусель) → всегда приводим к нему; иначе кроп только если фото вне 0.8…1.91.
 * Без апскейла: держим лимитирующую сторону, режем вторую.
 */
export function igFeedTargetSize(
  w: number,
  h: number,
  forceRatio?: number,
): { outW: number; outH: number } | null {
  if (!w || !h) return null
  const ratio = w / h
  let target = forceRatio
  if (target == null) {
    if (ratio < IG_MIN_RATIO) target = IG_MIN_RATIO       // слишком высокое → 4:5
    else if (ratio > IG_MAX_RATIO) target = IG_MAX_RATIO  // слишком широкое → 1.91:1
    else return null                                      // уже в норме
  }
  return ratio > target
    ? { outW: Math.round(h * target), outH: h }   // шире target → режем ширину
    : { outW: w, outH: Math.round(w / target) }   // у́же target → режем высоту
}

export class PostmypostPublisher implements Publisher {
  private readonly apiBase = 'https://api.postmypost.io/v4.1'
  private readonly uploadMaxAttempts = 20
  private readonly uploadDelayMs = 2000

  private getToken(pa: PlatformAccount): string | null {
    // IG: accessToken хранит PMP-токен.
    // VK (через PMP): accessToken = VK-токен (нужен прямому VK API для сторис), НЕ PMP —
    // поэтому PMP-токен (project-level credential) берём из env POSTMYPOST_API_TOKEN.
    // В config токен не кладём: GET /businesses/:id/platforms отдаёт config во фронт (утечка).
    if (pa.platform === 'INSTAGRAM' && pa.accessToken && pa.accessToken !== '') return pa.accessToken
    return process.env.POSTMYPOST_API_TOKEN || null
  }

  private getProjectId(pa: PlatformAccount): number | null {
    const cfg = (pa.config ?? {}) as Record<string, unknown>
    const raw = cfg.postmypostProjectId ?? process.env.POSTMYPOST_PROJECT_ID
    const num = Number(raw)
    return Number.isFinite(num) && num > 0 ? num : null
  }

  /**
   * PMP account_id: для VK берётся из config (accountId хранит VK group_id),
   * для IG accountId уже = PMP account_id. config.postmypostAccountId имеет приоритет.
   */
  private getAccountId(pa: PlatformAccount): number | null {
    const cfg = (pa.config ?? {}) as Record<string, unknown>
    const raw = cfg.postmypostAccountId ?? pa.accountId
    const num = Number(raw)
    return Number.isFinite(num) && num > 0 ? num : null
  }

  private resolvePublicationType(postType?: string): number {
    if (postType === 'STORIES') return PUB_TYPE.STORY
    if (postType === 'REELS' || postType === 'CLIPS') return PUB_TYPE.REELS // верт. видео = Reels
    return PUB_TYPE.POST
  }

  /** Тонкая обёртка над fetch к Postmypost REST (JSON) */
  private async api(
    token: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ ok: boolean; status: number; data: any }> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data }
  }

  async publish(params: PublishParams): Promise<PublishResult> {
    const { text, hashtags, mediaFiles, platformAccount, postType } = params
    const isInstagram = platformAccount.platform === 'INSTAGRAM'
    const label = isInstagram ? 'Instagram' : 'VK'

    const token = this.getToken(platformAccount)
    if (!token) return { success: false, error: 'Postmypost токен не настроен (PlatformAccount.accessToken / POSTMYPOST_API_TOKEN).' }
    const projectId = this.getProjectId(platformAccount)
    if (!projectId) return { success: false, error: 'Postmypost project_id не задан (config.postmypostProjectId / POSTMYPOST_PROJECT_ID).' }
    const accountId = this.getAccountId(platformAccount)
    if (!accountId) {
      return {
        success: false,
        error: isInstagram
          ? `Некорректный Postmypost account_id: "${platformAccount.accountId}"`
          : `Не задан Postmypost account_id для VK-канала (config.postmypostAccountId). accountId="${platformAccount.accountId}" — это VK group_id, не PMP id.`,
      }
    }
    // IG нельзя без медиа; VK-стену можно текстом
    if (isInstagram && !mediaFiles?.length) {
      return { success: false, error: 'Instagram-публикация требует хотя бы один медиафайл.' }
    }
    if (!mediaFiles?.length && !(text ?? '').trim()) {
      return { success: false, error: `${label}-публикация требует текст или медиа.` }
    }

    // IG-лента (POST) требует w/h 0.8…1.91, иначе IG добавит белые поля. Сторис/Reels — НЕ кропаем.
    // VK-via-PMP (isInstagram=false) — не трогаем.
    const normalizeFeedImages = isInstagram && this.resolvePublicationType(postType) === PUB_TYPE.POST
    // Карусель: IG требует ОДИНАКОВОЕ соотношение у всех фото → при >1 форсируем общий 4:5; при 1 — кроп по границам.
    const carouselRatio = normalizeFeedImages && (mediaFiles?.length ?? 0) > 1 ? IG_MIN_RATIO : undefined

    try {
      // 1. Загрузить все медиа → file_ids
      const fileIds: number[] = []
      for (const mf of (mediaFiles ?? [])) {
        const fileId = await this.uploadMedia(token, projectId, mf, normalizeFeedImages, carouselRatio)
        if (!fileId) return { success: false, error: `Postmypost не смог загрузить медиа: ${mf.filename}` }
        fileIds.push(fileId)
      }

      // 2. Текст + хештеги
      const content = hashtags?.length
        ? `${text ?? ''}\n\n${hashtags.map(h => '#' + h).join(' ')}`.trim()
        : (text ?? '')

      // 3. Создать публикацию (post_at = сейчас UTC → ближайшая публикация)
      const request = {
        project_id: projectId,
        post_at: new Date().toISOString(),
        account_ids: [accountId],
        publication_status: PUB_STATUS_PENDING,
        details: [{
          account_id: accountId,
          publication_type: this.resolvePublicationType(postType),
          content,
          file_ids: fileIds,
        }],
      }

      const pub = await this.api(token, 'POST', '/publications', request)
      if (!pub.ok || !pub.data?.id) {
        const msg = pub.data?.message || pub.data?.errors || JSON.stringify(pub.data)
        return { success: false, error: `Postmypost /publications failed (${pub.status}): ${msg}`, rawResponse: pub.data }
      }

      return {
        success: true,
        externalPostId: String(pub.data.id),
        externalUrl: `https://app.postmypost.io/ru/project/${projectId}/publication/${pub.data.id}`,
        rawResponse: pub.data,
      }
    } catch (err: any) {
      return { success: false, error: `Postmypost error: ${String(err?.message || err)}` }
    }
  }

  /** Загрузка одного файла: init → S3 → complete → poll. Возвращает file_id или null. */
  private async uploadMedia(
    token: string,
    projectId: number,
    mf: { url: string; mimeType: string; filename: string },
    normalizeFeed = false,
    forceRatio?: number,
  ): Promise<number | null> {
    const filePath = join(UPLOAD_DIR, mf.url.replace('/uploads/', ''))
    let buf = await readFile(filePath)

    // IG-лента: привести соотношение к 0.8…1.91, иначе IG/Postmypost добавит белые поля.
    if (normalizeFeed) {
      const norm = await this.normalizeForInstagramFeed(buf, mf.mimeType, forceRatio)
      buf = norm.buffer
      if (norm.changed) console.error(`[PMP] IG feed normalize: ${mf.filename} → кроп под соотношение`)
    }

    // Postmypost/S3 не принимают не-ASCII имена файлов (кириллица/«·»/пробелы ломают загрузку)
    const ext = (mf.url.split('?')[0].split('.').pop() || mf.mimeType.split('/')[1] || 'jpg').toLowerCase()
    let safeName = (mf.filename || '').replace(/[^\x20-\x7E]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 50)
    if (safeName.replace(/[.\-]/g, '').length < 2) safeName = 'media'
    if (!safeName.toLowerCase().endsWith('.' + ext)) safeName = safeName.replace(/\.[a-z0-9]+$/i, '') + '.' + ext

    // 1. init by file
    const init = await this.api(token, 'POST', '/upload/init', {
      project_id: projectId,
      name: safeName,
      size: buf.length,
    })
    if (!init.ok || !init.data?.id || !init.data?.action) {
      console.error('[PMP] upload/init failed:', init.status, JSON.stringify(init.data))
      return null
    }
    const { id, action, fields } = init.data

    // 2. POST файла в S3 (presigned)
    const form = new FormData()
    for (const f of (fields as Array<{ key: string; value: string }>)) {
      form.append(f.key, f.value)
    }
    form.append('file', new Blob([buf], { type: mf.mimeType }), safeName)
    const s3 = await fetch(action, { method: 'POST', body: form })
    if (!s3.ok) {
      console.error('[PMP] S3 upload failed:', s3.status, (await s3.text()).slice(0, 200))
      return null
    }

    // 3. complete
    const done = await this.api(token, 'POST', `/upload/complete?id=${id}`)
    if (!done.ok) {
      console.error('[PMP] upload/complete failed:', done.status, JSON.stringify(done.data))
      return null
    }

    // 4. poll status → file_id
    return await this.waitForUpload(token, id)
  }

  private async waitForUpload(token: string, uploadId: number): Promise<number | null> {
    for (let attempt = 0; attempt < this.uploadMaxAttempts; attempt++) {
      const res = await this.api(token, 'GET', `/upload/status?id=${uploadId}`)
      const status = res.data?.status
      if (status === UPLOAD_OK) return res.data?.file_id ?? null
      if (status === UPLOAD_ERROR) return null
      await new Promise(r => setTimeout(r, this.uploadDelayMs))
    }
    return null
  }

  /**
   * Приводит растровое фото к допустимому для IG-ленты соотношению (w/h 0.8…1.91).
   * targetRatio задан (карусель) → форсируем именно его; иначе кроп только если фото вне границ.
   * На любой ошибке sharp возвращает исходный буфер (changed=false) — публикацию не блокируем.
   */
  private async normalizeForInstagramFeed(
    buf: Buffer<ArrayBuffer>,
    mimeType: string,
    targetRatio?: number,
  ): Promise<{ buffer: Buffer<ArrayBuffer>; changed: boolean }> {
    // Только растровые картинки; видео и GIF (анимация) — без изменений.
    if (!mimeType.startsWith('image/') || mimeType === 'image/gif') return { buffer: buf, changed: false }
    try {
      const sharpLib = (await import('sharp')).default
      // .rotate() БЕЗ аргументов запекает EXIF-ориентацию в пиксели ДО чтения размеров:
      // телефонный портрет = landscape-пиксели + EXIF "rotate 90"; иначе w/h перепутаны → кроп уйдёт не туда.
      const base = sharpLib(buf).rotate()
      const meta = await base.metadata()
      const size = igFeedTargetSize(meta.width ?? 0, meta.height ?? 0, targetRatio)
      if (!size) return { buffer: buf, changed: false }

      const isPng = mimeType === 'image/png'
      let p = base.resize(size.outW, size.outH, { fit: 'cover', position: IG_CROP_POSITION })
      p = isPng ? p.png() : p.jpeg({ quality: 90 })
      // sharp типизирует toBuffer() как широкий Buffer<ArrayBufferLike>; физически это обычный non-shared буфер.
      return { buffer: (await p.toBuffer()) as Buffer<ArrayBuffer>, changed: true }
    } catch (err) {
      console.error('[PMP] normalizeForInstagramFeed failed, using original:', String(err))
      return { buffer: buf, changed: false }
    }
  }

  async testConnection(account: PlatformAccount): Promise<boolean> {
    const token = this.getToken(account)
    if (!token) return false
    try {
      const res = await this.api(token, 'GET', '/projects')
      return res.ok
    } catch {
      return false
    }
  }
}
