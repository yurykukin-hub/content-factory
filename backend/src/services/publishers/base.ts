import type { PlatformAccount } from '@prisma/client'
import { VkPublisher } from './vk'
import { TelegramPublisher } from './telegram'
import { PostmypostPublisher } from './postmypost'

export interface MediaFileForPublish {
  url: string
  mimeType: string
  filename: string
}

export interface PublishParams {
  text: string
  hashtags?: string[]
  mediaFiles?: MediaFileForPublish[]
  platformAccount: PlatformAccount
  postType?: string  // TEXT | PHOTO | VIDEO | STORIES
  storiesOptions?: {
    linkText?: string     // VK link button: 'more' | 'book' | 'order' | 'buy' и др.
    linkUrl?: string      // URL для кнопки
    overlayText?: boolean // наложить текст на фото
    textPosition?: 'top' | 'center' | 'bottom'
    skipOverlay?: boolean // медиа уже отрендерено клиентом (фото-JPEG / видео с текстом) — не накладывать текст на бэке
    photoPosition?: string // позиция кропа фото при ресайзе в 9:16 (sharp position)
  }
}

export interface PublishResult {
  success: boolean
  externalPostId?: string
  externalUrl?: string
  error?: string
  rawResponse?: unknown
}

export interface Publisher {
  publish(params: PublishParams): Promise<PublishResult>
  testConnection(account: PlatformAccount): Promise<boolean>
}

export interface GetPublisherOpts {
  /** Тип поста (PostType). Для VK решает: STORIES → прямой VK, остальное → Postmypost (если флаг). */
  postType?: string
  /** PlatformAccount.config — читаем флаг `viaPostmypost` для VK. */
  config?: unknown
}

/**
 * Фабрика publishers по платформе.
 *
 * VK — гибрид (решение сессии): VK-сторис идут через ПРЯМОЙ VK API (нативная кнопка/оверлей),
 * а стена/фото — через Postmypost (обход застрявшего scope `photos`), если у аккаунта стоит
 * флаг `config.viaPostmypost`. Обратимо: VK выдаст scope `photos` → флаг выключаем, всё VK
 * снова идёт напрямую. Без флага поведение VK не меняется (по умолчанию прямой API).
 */
export function getPublisher(platform: string, opts: GetPublisherOpts = {}): Publisher {
  const cfg = (opts.config ?? {}) as Record<string, unknown>
  const viaPostmypost = cfg.viaPostmypost === true
  switch (platform) {
    case 'VK':
      // Сторис VK — только прямой VK API (Postmypost не даёт нативную кнопку/оверлей сторис).
      if (viaPostmypost && opts.postType !== 'STORIES') return new PostmypostPublisher()
      return new VkPublisher()
    case 'TELEGRAM':
      return new TelegramPublisher()
    case 'INSTAGRAM':
      return new PostmypostPublisher()
    default:
      throw new Error(`Unknown platform: ${platform}`)
  }
}
