import { describe, it, expect } from 'vitest'
import { getPublisher } from '../base'
import { VkPublisher } from '../vk'
import { TelegramPublisher } from '../telegram'
import { PostmypostPublisher } from '../postmypost'
import { InstagramPublisher } from '../instagram'

describe('getPublisher routing', () => {
  it('VK без opts → прямой VkPublisher (backward-compat)', () => {
    expect(getPublisher('VK')).toBeInstanceOf(VkPublisher)
  })

  it('VK без флага viaPostmypost → прямой VkPublisher', () => {
    expect(getPublisher('VK', { postType: 'PHOTO', config: {} })).toBeInstanceOf(VkPublisher)
    expect(getPublisher('VK', { postType: 'PHOTO', config: { viaPostmypost: false } })).toBeInstanceOf(VkPublisher)
  })

  it('VK + viaPostmypost + НЕ сторис → Postmypost (обход scope photos)', () => {
    expect(getPublisher('VK', { postType: 'PHOTO', config: { viaPostmypost: true } })).toBeInstanceOf(PostmypostPublisher)
    expect(getPublisher('VK', { postType: 'TEXT', config: { viaPostmypost: true } })).toBeInstanceOf(PostmypostPublisher)
  })

  it('VK + viaPostmypost + СТОРИС → прямой VkPublisher (нативная кнопка/оверлей)', () => {
    expect(getPublisher('VK', { postType: 'STORIES', config: { viaPostmypost: true } })).toBeInstanceOf(VkPublisher)
  })

  it('INSTAGRAM → Postmypost', () => {
    const p = getPublisher('INSTAGRAM')
    expect(p).toBeInstanceOf(PostmypostPublisher)
  })

  it('InstagramPublisher — подкласс PostmypostPublisher (обёртка)', () => {
    expect(new InstagramPublisher()).toBeInstanceOf(PostmypostPublisher)
  })

  it('TELEGRAM → TelegramPublisher', () => {
    expect(getPublisher('TELEGRAM')).toBeInstanceOf(TelegramPublisher)
  })

  it('неизвестная платформа → ошибка', () => {
    expect(() => getPublisher('FACEBOOK')).toThrow(/Unknown platform/)
  })
})
