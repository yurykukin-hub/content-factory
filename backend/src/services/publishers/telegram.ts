import type { Publisher, PublishParams, PublishResult } from './base'
import type { PlatformAccount } from '@prisma/client'
import { join } from 'path'
import { readFile } from 'fs/promises'

const UPLOAD_DIR = join(import.meta.dir, '../../../uploads')

/**
 * Telegram Publisher — публикация через Telegram Bot API.
 *
 * Поддерживает: текст, фото, видео, медиа-группы, аудио.
 * Бот должен быть админом канала.
 * Лимиты: 30 msg/sec, 20 msg/min в один чат, файлы до 50 MB.
 */
export class TelegramPublisher implements Publisher {
  private readonly baseUrl = 'https://api.telegram.org'

  async publish(params: PublishParams): Promise<PublishResult> {
    const { text, hashtags, mediaFiles, platformAccount } = params
    const botToken = platformAccount.accessToken
    const chatId = platformAccount.accountId

    // Собираем текст + хештеги
    const fullText = hashtags?.length
      ? `${text}\n\n${hashtags.map(h => '#' + h).join(' ')}`
      : text

    try {
      const photos = mediaFiles?.filter(f => f.mimeType.startsWith('image/')) || []
      const videos = mediaFiles?.filter(f => f.mimeType.startsWith('video/')) || []
      const audios = mediaFiles?.filter(f => f.mimeType.startsWith('audio/')) || []

      // Determine send method based on media
      if (photos.length === 1 && videos.length === 0) {
        // Single photo
        return await this.sendPhoto(botToken, chatId, photos[0], fullText)
      } else if (videos.length === 1 && photos.length === 0) {
        // Single video
        return await this.sendVideo(botToken, chatId, videos[0], fullText)
      } else if (photos.length + videos.length > 1) {
        // Media group (2+ items)
        const allMedia = [...photos, ...videos]
        return await this.sendMediaGroup(botToken, chatId, allMedia, fullText)
      } else if (audios.length === 1) {
        // Single audio
        return await this.sendAudio(botToken, chatId, audios[0], fullText)
      } else {
        // Text only
        return await this.sendText(botToken, chatId, fullText)
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }

  private async sendText(token: string, chatId: string, text: string): Promise<PublishResult> {
    const res = await fetch(`${this.baseUrl}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
    return this.parseResponse(await res.json())
  }

  private async sendPhoto(
    token: string, chatId: string,
    media: { url: string; mimeType: string; filename: string },
    caption: string
  ): Promise<PublishResult> {
    const filePath = join(UPLOAD_DIR, media.url.replace('/uploads/', ''))
    const buffer = await readFile(filePath)

    const formData = new FormData()
    formData.append('chat_id', chatId)
    formData.append('caption', caption)
    formData.append('parse_mode', 'HTML')
    formData.append('photo', new Blob([buffer], { type: media.mimeType }), media.filename)

    const res = await fetch(`${this.baseUrl}/bot${token}/sendPhoto`, {
      method: 'POST',
      body: formData,
    })
    return this.parseResponse(await res.json())
  }

  private async sendVideo(
    token: string, chatId: string,
    media: { url: string; mimeType: string; filename: string },
    caption: string
  ): Promise<PublishResult> {
    const filePath = join(UPLOAD_DIR, media.url.replace('/uploads/', ''))
    const buffer = await readFile(filePath)

    const formData = new FormData()
    formData.append('chat_id', chatId)
    formData.append('caption', caption)
    formData.append('parse_mode', 'HTML')
    formData.append('supports_streaming', 'true')
    formData.append('video', new Blob([buffer], { type: media.mimeType }), media.filename)

    const res = await fetch(`${this.baseUrl}/bot${token}/sendVideo`, {
      method: 'POST',
      body: formData,
    })
    return this.parseResponse(await res.json())
  }

  private async sendAudio(
    token: string, chatId: string,
    media: { url: string; mimeType: string; filename: string },
    caption: string
  ): Promise<PublishResult> {
    const filePath = join(UPLOAD_DIR, media.url.replace('/uploads/', ''))
    const buffer = await readFile(filePath)

    const formData = new FormData()
    formData.append('chat_id', chatId)
    formData.append('caption', caption)
    formData.append('parse_mode', 'HTML')
    formData.append('audio', new Blob([buffer], { type: media.mimeType }), media.filename)

    const res = await fetch(`${this.baseUrl}/bot${token}/sendAudio`, {
      method: 'POST',
      body: formData,
    })
    return this.parseResponse(await res.json())
  }

  private async sendMediaGroup(
    token: string, chatId: string,
    mediaItems: { url: string; mimeType: string; filename: string }[],
    caption: string
  ): Promise<PublishResult> {
    const formData = new FormData()
    formData.append('chat_id', chatId)

    const mediaArray: any[] = []

    for (let i = 0; i < Math.min(mediaItems.length, 10); i++) {
      const mf = mediaItems[i]
      const filePath = join(UPLOAD_DIR, mf.url.replace('/uploads/', ''))
      const buffer = await readFile(filePath)
      const fieldName = `file${i}`

      formData.append(fieldName, new Blob([buffer], { type: mf.mimeType }), mf.filename)

      mediaArray.push({
        type: mf.mimeType.startsWith('video/') ? 'video' : 'photo',
        media: `attach://${fieldName}`,
        ...(i === 0 ? { caption, parse_mode: 'HTML' } : {}), // Caption on first item only
      })
    }

    formData.append('media', JSON.stringify(mediaArray))

    const res = await fetch(`${this.baseUrl}/bot${token}/sendMediaGroup`, {
      method: 'POST',
      body: formData,
    })
    return this.parseResponse(await res.json())
  }

  private parseResponse(data: any): PublishResult {
    if (!data.ok) {
      return { success: false, error: `Telegram: ${data.description}`, rawResponse: data }
    }
    // sendMediaGroup returns array, others return single message
    const msg = Array.isArray(data.result) ? data.result[0] : data.result
    return {
      success: true,
      externalPostId: String(msg?.message_id),
      rawResponse: data,
    }
  }

  async testConnection(account: PlatformAccount): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.baseUrl}/bot${account.accessToken}/getChat?chat_id=${account.accountId}`
      )
      const data = await res.json() as any
      return data.ok === true
    } catch {
      return false
    }
  }
}
