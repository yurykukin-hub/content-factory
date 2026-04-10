import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { ZodError } from 'zod'
import { join } from 'path'
import { config } from './config'
import { requireAuth } from './middleware/auth'
import { auth } from './routes/auth'
import { businesses } from './routes/businesses'
import { platformsByBiz, platformsById } from './routes/platforms'
import { posts } from './routes/posts'
import { contentPlans } from './routes/content-plans'
import { ai } from './routes/ai'
import { publish } from './routes/publish'
import { dashboard } from './routes/dashboard'
import { sse } from './routes/sse'
import { media } from './routes/media'
import { settings } from './routes/settings'
import { vkOauthRoutes } from './routes/vk-oauth'
import { startPublishScheduler } from './services/scheduler'

const app = new Hono()

// --- Middleware ---
app.use('*', logger())
app.use('/api/*', cors({
  origin: config.isProd
    ? ['https://content.yurykukin.ru']
    : ['http://localhost:5176'],
  credentials: true,
}))

// --- Public routes (no auth) ---
app.route('/api/auth', auth)
app.post('/api/webhooks/erp', async (c) => {
  const publishRoute = new Hono()
  publishRoute.route('/', publish)
  return publishRoute.fetch(c.req.raw)
})

// --- Protected routes (require auth) ---
app.use('/api/*', requireAuth)

app.route('/api/businesses', businesses)
app.route('/api/businesses', platformsByBiz) // GET/POST /api/businesses/:bizId/platforms
app.route('/api/platforms', platformsById)   // PUT/DELETE/test /api/platforms/:id
app.route('/api/businesses', contentPlans) // /api/businesses/:bizId/plans
app.route('/api/businesses', posts) // GET /api/businesses/:bizId/posts
app.route('/api/posts', posts)
app.route('/api/plans', contentPlans)
app.route('/api', contentPlans)       // /api/plan-items/:id/*
app.route('/api/ai', ai)
app.route('/api/media', media)
app.route('/api/settings', settings)
app.route('/api/vk-oauth', vkOauthRoutes)
app.route('/api', publish) // /api/post-versions/:id/publish|schedule
app.route('/api/dashboard', dashboard)
app.route('/api/sse', sse)

// --- Static file serving for uploads ---
app.get('/uploads/*', async (c) => {
  const filePath = join(import.meta.dir, '..', c.req.path)
  const file = Bun.file(filePath)
  if (await file.exists()) {
    return new Response(file)
  }
  return c.json({ error: 'File not found' }, 404)
})

// --- Global error handler ---
app.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: 'Ошибка валидации', details: err.flatten().fieldErrors }, 400)
  }
  console.error('[Error]', err)
  return c.json({ error: err.message || 'Internal Server Error' }, 500)
})

// --- Start scheduler ---
startPublishScheduler()

// --- Start server ---
console.log(`Content Factory backend starting on port ${config.PORT}`)
export default {
  port: config.PORT,
  fetch: app.fetch,
}
