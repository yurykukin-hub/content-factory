import { app } from './app'
import { config } from './config'
import { startPublishScheduler } from './services/scheduler'
import { startVideoPoller } from './services/video-poller'

// --- Start schedulers ---
startPublishScheduler()
startVideoPoller()

// --- Start server ---
console.log(`Content Factory backend starting on port ${config.PORT}`)
export default {
  port: config.PORT,
  fetch: app.fetch,
}
