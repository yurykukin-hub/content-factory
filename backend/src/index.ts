import { app } from './app'
import { config } from './config'
import { db } from './db'
import { startPublishScheduler } from './services/scheduler'
import { startVideoPoller } from './services/video-poller'

// --- Start schedulers ---
const publishInterval = startPublishScheduler()
const videoPollerInterval = startVideoPoller()

// --- Graceful shutdown ---
async function shutdown(signal: string) {
  console.log(`[Shutdown] ${signal} received — cleaning up...`)
  clearInterval(publishInterval)
  clearInterval(videoPollerInterval)
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
}
