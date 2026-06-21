import { app } from './app'
import { config } from './config'
import { db } from './db'
import { startPublishScheduler } from './services/scheduler'
import { startVideoPoller } from './services/video-poller'
import { startPhotoCataloger } from './services/photo-cataloger'
import { startImageDescriber } from './services/image-describer'
import { setupTelegramWebhook } from './services/telegram-approval'

// --- Start schedulers ---
const publishInterval = startPublishScheduler()
const videoPollerInterval = startVideoPoller()
const catalogerInterval = startPhotoCataloger()
const imageDescriberInterval = startImageDescriber()

// --- Setup Telegram webhook (non-blocking) ---
setupTelegramWebhook().catch(e =>
  console.error('[Startup] Telegram webhook setup failed:', e.message)
)

// --- Graceful shutdown ---
async function shutdown(signal: string) {
  console.log(`[Shutdown] ${signal} received — cleaning up...`)
  clearInterval(publishInterval)
  clearInterval(videoPollerInterval)
  clearInterval(catalogerInterval)
  clearInterval(imageDescriberInterval)
  await db.$disconnect()
  console.log('[Shutdown] Done')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// --- Start server ---
console.log(`Content Factory backend starting on port ${config.PORT}`)
export default {
  port: config.PORT,
  fetch: app.fetch,
  // Лимит тела запроса: дефолт Bun — 128 МБ, из-за чего рилз/видео туров с телефона
  // (часто 150–500 МБ) роняли загрузку. Поднимаем до 600 МБ (запас над MAX_FILE_SIZE=500 МБ).
  maxRequestBodySize: 600 * 1024 * 1024,
}
