import type { PlatformAccount } from '@prisma/client'
import { VkPublisher } from './vk'
import { TelegramPublisher } from './telegram'
import { InstagramPublisher } from './instagram'

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

/**
 * Фабрика publishers по платформе.
 */
export function getPublisher(platform: string): Publisher {
  switch (platform) {
    case 'VK':
      return new VkPublisher()
    case 'TELEGRAM':
      return new TelegramPublisher()
    case 'INSTAGRAM':
      return new InstagramPublisher()
    default:
      throw new Error(`Unknown platform: ${platform}`)
  }
}
