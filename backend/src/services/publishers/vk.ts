import type { Publisher, PublishParams, PublishResult } from './base'
import type { PlatformAccount } from '@prisma/client'
import { join } from 'path'
import { readFile } from 'fs/promises'
import { getModuleDir } from '../../utils/paths'

const UPLOAD_DIR = join(getModuleDir(import.meta), '../../../uploads')

/**
 * VK Publisher — публикация через VK API.
 * Поддерживает: текст, фото, видео.
 * API version: 5.199
 */
export class VkPublisher implements Publisher {
  private readonly apiVersion = '5.199'
  private readonly baseUrl = 'https://api.vk.com/method'

  /**
   * Получить VK токен: per-channel → app-level OAuth → ошибка
   */
  private async resolveToken(platformAccount: any): Promise<string | null> {
    if (platformAccount.accessToken && platformAccount.accessToken !== '') {
      return platformAccount.accessToken
    }
    try {
      const { ensureValidToken } = await import('../services/vk-oauth')
      return await ensureValidToken()
    } catch {
      return null
    }
  }

  async publish(params: PublishParams): Promise<PublishResult> {
    const { text, hashtags, mediaFiles, platformAccount, postType } = params
    const accountId = platformAccount.accountId
    const accountType = (platformAccount as any).accountType || 'GROUP'

    const token = await this.resolveToken(platformAccount)
    if (!token) {
      return { success: false, error: 'VK токен не настроен. Подключите VK OAuth в Настройках.' }
    }

    // Собираем текст + хештеги
    const fullText = hashtags?.length
      ? `${text}\n\n${hashtags.map(h => '#' + h).join(' ')}`
      : text

    // Stories — отдельный flow
    if (postType === 'STORIES') {
      return this.publishStory({ text: fullText, mediaFiles, accountId, accountType, token, storiesOptions: params.storiesOptions })
    }

    try {
      // Upload media and collect attachment strings
      const attachments: string[] = []

      if (mediaFiles?.length) {
        for (const mf of mediaFiles) {
          if (mf.mimeType.startsWith('image/')) {
            const photoAttachment = await this.uploadPhoto(mf, accountId, token, accountType)
            if (photoAttachment) attachments.push(photoAttachment)
          } else if (mf.mimeType.startsWith('video/')) {
            const videoAttachment = await this.uploadVideo(mf, accountId, token, accountType)
            if (videoAttachment) attachments.push(videoAttachment)
          }
        }
      }

      const urlParams: Record<string, string> = {
        message: fullText,
        access_token: token,
        v: this.apiVersion,
      }

      if (accountType === 'GROUP') {
        urlParams.owner_id = `-${accountId}`
        urlParams.from_group = '1'
      }

      if (attachments.length) {
        urlParams.attachments = attachments.join(',')
      }

      const response = await fetch(`${this.baseUrl}/wall.post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(urlParams),
      })

      const data = await response.json() as any

      if (data.error) {
        return {
          success: false,
          error: `VK Error ${data.error.error_code}: ${data.error.error_msg}`,
          rawResponse: data,
        }
      }

      const postId = data.response?.post_id
      if (!postId) {
        return { success: false, error: 'VK wall.post не вернул post_id', rawResponse: data }
      }

      const wallPrefix = accountType === 'GROUP' ? `-${accountId}` : accountId
      return {
        success: true,
        externalPostId: String(postId),
        externalUrl: `https://vk.com/wall${wallPrefix}_${postId}`,
        rawResponse: data,
      }
    } catch (err) {
      return {
        success: false,
        error: String(err),
      }
    }
  }

  /**
   * Upload photo to VK and return attachment string "photo{oid}_{pid}"
   */
  private async uploadPhoto(
    mf: { url: string; mimeType: string; filename: string },
    groupId: string, token: string, accountType: string
  ): Promise<string | null> {
    try {
      // 1. Get upload server
      const serverParams: Record<string, string> = {
        access_token: token,
        v: this.apiVersion,
      }
      if (accountType === 'GROUP') {
        serverParams.group_id = groupId
      }

      const serverRes = await fetch(`${this.baseUrl}/photos.getWallUploadServer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(serverParams),
      })
      const serverData = await serverRes.json() as any
      if (serverData.error) {
        console.error('[VK] getWallUploadServer error:', serverData.error)
        return null
      }
      const uploadUrl = serverData.response.upload_url

      // 2. Read file and upload
      const filePath = join(UPLOAD_DIR, mf.url.replace('/uploads/', ''))
      const fileBuffer = await readFile(filePath)

      const formData = new FormData()
      formData.append('photo', new Blob([fileBuffer], { type: mf.mimeType }), mf.filename)

      const uploadRes = await fetch(uploadUrl, { method: 'POST', body: formData })
      const uploadData = await uploadRes.json() as any

      // 3. Save wall photo
      const saveParams: Record<string, string> = {
        server: String(uploadData.server),
        photo: uploadData.photo,
        hash: uploadData.hash,
        access_token: token,
        v: this.apiVersion,
      }
      if (accountType === 'GROUP') {
        saveParams.group_id = groupId
      }

      const saveRes = await fetch(`${this.baseUrl}/photos.saveWallPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(saveParams),
      })
      const saveData = await saveRes.json() as any
      if (saveData.error) {
        console.error('[VK] saveWallPhoto error:', saveData.error)
        return null
      }

      const photo = saveData.response[0]
      return `photo${photo.owner_id}_${photo.id}`
    } catch (err) {
      console.error('[VK] Photo upload error:', err)
      return null
    }
  }

  /**
   * Upload video to VK and return attachment string "video{oid}_{vid}"
   */
  private async uploadVideo(
    mf: { url: string; mimeType: string; filename: string },
    groupId: string, token: string, accountType: string
  ): Promise<string | null> {
    try {
      // 1. Get video save URL
      const saveParams: Record<string, string> = {
        name: mf.filename,
        access_token: token,
        v: this.apiVersion,
      }
      if (accountType === 'GROUP') {
        saveParams.group_id = groupId
      }

      const saveRes = await fetch(`${this.baseUrl}/video.save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(saveParams),
      })
      const saveData = await saveRes.json() as any
      if (saveData.error) {
        console.error('[VK] video.save error:', saveData.error)
        return null
      }

      const uploadUrl = saveData.response.upload_url
      const videoOwnerId = saveData.response.owner_id
      const videoId = saveData.response.video_id

      // 2. Upload video file
      const filePath = join(UPLOAD_DIR, mf.url.replace('/uploads/', ''))
      const fileBuffer = await readFile(filePath)

      const formData = new FormData()
      formData.append('video_file', new Blob([fileBuffer], { type: mf.mimeType }), mf.filename)

      await fetch(uploadUrl, { method: 'POST', body: formData })

      return `video${videoOwnerId}_${videoId}`
    } catch (err) {
      console.error('[VK] Video upload error:', err)
      return null
    }
  }

  /**
   * Publish VK Story (photo or video)
   */
  private async publishStory(params: {
    text: string
    mediaFiles?: { url: string; mimeType: string; filename: string }[]
    accountId: string; accountType: string; token: string
    storiesOptions?: { linkText?: string; linkUrl?: string; overlayText?: boolean; textPosition?: 'top' | 'center' | 'bottom' }
  }): Promise<PublishResult> {
    const { text, mediaFiles, accountId, accountType, token, storiesOptions } = params

    if (!mediaFiles?.length) {
      return { success: false, error: 'Stories требуют медиафайл (фото или видео)' }
    }

    const mf = mediaFiles[0] // Stories = 1 файл
    try {
      const isVideo = mf.mimeType.startsWith('video/')
      const method = isVideo ? 'stories.getVideoUploadServer' : 'stories.getPhotoUploadServer'

      // 1. Get upload server
      const serverParams: Record<string, string> = {
        access_token: token,
        v: this.apiVersion,
        add_to_news: '1',
      }
      if (accountType === 'GROUP') {
        serverParams.group_id = accountId
      }
      // Кнопка-ссылка
      if (storiesOptions?.linkText) {
        serverParams.link_text = storiesOptions.linkText
      }
      if (storiesOptions?.linkUrl) {
        serverParams.link_url = storiesOptions.linkUrl
      }

      const serverRes = await fetch(`${this.baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(serverParams),
      })
      const serverData = await serverRes.json() as any
      if (serverData.error) {
        return {
          success: false,
          error: `VK ${method} error ${serverData.error.error_code}: ${serverData.error.error_msg}`,
          rawResponse: serverData,
        }
      }

      const uploadUrl = serverData.response.upload_url

      // 2. Read file and optionally overlay text
      const filePath = join(UPLOAD_DIR, mf.url.replace('/uploads/', ''))
      let fileBuffer = await readFile(filePath)

      // Авто-resize фото под 1080x1920 (9:16) для Stories (skip if pre-rendered by client canvas)
      if (!isVideo && !storiesOptions?.skipOverlay) {
        try {
          const sharpLib = (await import('sharp')).default
          const meta = await sharpLib(fileBuffer).metadata()
          const w = meta.width || 1080
          const h = meta.height || 1920

          if (w / h > 0.6) {
            // Фото слишком широкое — кропнуть/ресайзить в 9:16
            const cropPosition = storiesOptions?.photoPosition || 'center'
            console.log(`[VK Stories] Resizing ${w}x${h} → 1080x1920 (9:16, ${cropPosition})`)
            fileBuffer = await sharpLib(fileBuffer)
              .resize(1080, 1920, { fit: 'cover', position: cropPosition as any })
              .jpeg({ quality: 90 })
              .toBuffer()
          }
        } catch (err) {
          console.error('[VK Stories] Resize error:', err)
        }
      }

      // Наложить текст на фото (если не pre-rendered и есть текст)
      if (!isVideo && text && text.trim() && !storiesOptions?.skipOverlay) {
        try {
          const { overlayTextOnImage } = await import('../image-overlay')
          fileBuffer = Buffer.from(await overlayTextOnImage(fileBuffer, text, {
            position: storiesOptions?.textPosition || 'bottom',
          }))
          console.log('[VK Stories] Text overlay applied (server-side)')
        } catch (err) {
          console.error('[VK Stories] Text overlay error:', err)
        }
      } else if (storiesOptions?.skipOverlay) {
        console.log('[VK Stories] Using pre-rendered image (client canvas)')
      }

      const formData = new FormData()
      const fieldName = isVideo ? 'video_file' : 'photo'
      formData.append(fieldName, new Blob([fileBuffer], { type: mf.mimeType }), mf.filename)

      console.log(`[VK Stories] Uploading ${fileBuffer.length} bytes to VK...`)
      const uploadRes = await fetch(uploadUrl, { method: 'POST', body: formData })
      const uploadData = await uploadRes.json() as any
      console.log('[VK Stories] Upload response keys:', Object.keys(uploadData))

      // Извлечь upload_result из ответа (VK возвращает {response: {upload_result: "..."}} )
      const uploadResult = uploadData?.response?.upload_result || uploadData?.upload_result
      if (!uploadResult) {
        console.error('[VK Stories] No upload_result! Full response:', JSON.stringify(uploadData).slice(0, 300))
        return { success: false, error: 'VK Stories: upload не вернул upload_result. Попробуйте позже.', rawResponse: uploadData }
      }
      console.log(`[VK Stories] Got upload_result (${uploadResult.length} chars)`)

      // 3. Save story
      const saveParams = new URLSearchParams({
        upload_results: uploadResult,
        access_token: token,
        v: this.apiVersion,
      })

      const saveRes = await fetch(`${this.baseUrl}/stories.save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: saveParams,
      })
      const saveData = await saveRes.json() as any

      if (saveData.error) {
        return {
          success: false,
          error: `VK stories.save: ${saveData.error.error_code} — ${saveData.error.error_msg}`,
          rawResponse: saveData,
        }
      }

      // Проверяем что история реально создалась (count > 0)
      const count = saveData.response?.count || 0
      const story = saveData.response?.items?.[0]

      if (count === 0 || !story) {
        return {
          success: false,
          error: 'VK Stories: история не была создана. Проверьте формат файла (1080x1920, 9:16).',
          rawResponse: saveData,
        }
      }

      const ownerId = story.owner_id || (accountType === 'GROUP' ? `-${accountId}` : accountId)
      const storyId = story.id

      return {
        success: true,
        externalPostId: String(storyId),
        externalUrl: `https://vk.com/story${ownerId}_${storyId}`,
        rawResponse: saveData,
      }
    } catch (err) {
      return { success: false, error: `Story upload error: ${String(err)}` }
    }
  }

  async testConnection(account: PlatformAccount): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/groups.getById`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          group_id: account.accountId,
          access_token: account.accessToken,
          v: this.apiVersion,
        }),
      })
      const data = await response.json() as any
      return !data.error
    } catch {
      return false
    }
  }
}
