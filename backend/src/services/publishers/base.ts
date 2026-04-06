import type { PlatformAccount } from '@prisma/client'
import { VkPublisher } from './vk'
import { TelegramPublisher } from './telegram'

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
      throw new Error('Instagram publisher not implemented yet')
    default:
      throw new Error(`Unknown platform: ${platform}`)
  }
}
