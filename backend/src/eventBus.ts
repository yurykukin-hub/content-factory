import { EventEmitter } from 'events'

export type ContentEvent =
  | { type: 'post_created' | 'post_updated' | 'post_deleted'; tabId: string; postId: string }
  | { type: 'post_published'; tabId: string; postId: string; platform: string }
  | { type: 'plan_created' | 'plan_updated'; tabId: string; planId: string }
  | { type: 'business_updated'; tabId: string; businessId: string }
  | { type: 'settings_changed'; tabId: string; entity: string }

class ContentEventBus extends EventEmitter {}
export const eventBus = new ContentEventBus()
eventBus.setMaxListeners(100)

export const emitEvent = (event: ContentEvent) => eventBus.emit('change', event)
