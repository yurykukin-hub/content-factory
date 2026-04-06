import type { Publisher, PublishParams, PublishResult } from './base'
import type { PlatformAccount } from '@prisma/client'
import { join } from 'path'
import { readFile } from 'fs/promises'

const UPLOAD_DIR = join(import.meta.dir, '../../../uploads')

/**
 * VK Publisher — публикация через VK API.
 * Поддерживает: текст, фото, видео.
 * API version: 5.199
 */
export class VkPublisher implements Publisher {
  private readonly apiVersion = '5.199'
  private readonly baseUrl = 'https://api.vk.com/method'

  async publish(params: PublishParams): Promise<PublishResult> {
    const { text, hashtags, mediaFiles, platformAccount } = params
    const accountId = platformAccount.accountId
    const token = platformAccount.accessToken
    const accountType = (platformAccount as any).accountType || 'GROUP'

    // Собираем текст + хештеги
    const fullText = hashtags?.length
      ? `${text}\n\n${hashtags.map(h => '#' + h).join(' ')}`
      : text

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
