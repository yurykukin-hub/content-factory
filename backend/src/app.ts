import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { join, resolve } from 'path'
import { config } from './config'
import { getModuleDir } from './utils/paths'
import { db } from './db'
import { requireAuth, requireRole } from './middleware/auth'
import { requireSection } from './middleware/section-access'
import { auth } from './routes/auth'
import { users } from './routes/users'
import { businesses } from './routes/businesses'
import { platformsByBiz, platformsById } from './routes/platforms'
import { posts } from './routes/posts'
import { contentPlans } from './routes/content-plans'
import { ai } from './routes/ai'
import { publish } from './routes/publish'
import { dashboard } from './routes/dashboard'
import { sse } from './routes/sse'
import { media } from './routes/media'
import { mediaFolders } from './routes/media-folders'
import { settings } from './routes/settings'
import { vkOauthRoutes } from './routes/vk-oauth'
import { ideas } from './routes/ideas'
import { storyTemplates } from './routes/story-templates'
import { characters } from './routes/characters'
import { scenarios } from './routes/scenarios'
import { promptLibrary } from './routes/prompt-library'
import { promptTemplates } from './routes/prompt-templates'
import { sessions } from './routes/sessions'
import { music } from './routes/music'
import { aiLogs } from './routes/ai-logs'

const app = new Hono()

// --- Middleware ---
app.use('*', logger())
app.use('/api/*', cors({
  origin: config.isProd
    ? ['https://content.yurykukin.ru']
    : ['http://localhost:5176'],
  credentials: true,
}))

// --- Health endpoint (no auth) ---
app.get('/api/health', async (c) => {
  const full = c.req.query('full') === 'true'

  if (!full) {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() })
  }

  // Readiness check: DB ping
  try {
    await db.$queryRaw`SELECT 1`
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      db: 'connected',
      uptime: Math.floor(process.uptime()),
    })
  } catch (err) {
    return c.json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      db: 'disconnected',
      error: err instanceof Error ? err.message : 'Unknown DB error',
    }, 503)
  }
})

// --- Public routes (no auth) ---
app.route('/api/auth', auth)
app.post('/api/webhooks/erp', async (c) => {
  const publishRoute = new Hono()
  publishRoute.route('/', publish)
  return publishRoute.fetch(c.req.raw)
})

// --- Protected routes (require auth) ---
app.use('/api/*', requireAuth)

// --- CSRF protection: require X-Tab-ID header on mutating requests ---
// Browsers block custom headers in cross-origin form submissions.
// Auth routes excluded: login/refresh/logout are protected by SameSite=Lax cookies.
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  const isAuthRoute = path.startsWith('/api/auth/')
  const isWebhook = path.startsWith('/api/webhooks/')

  if (!isAuthRoute && !isWebhook && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.req.method)) {
    if (!c.req.header('X-Tab-ID')) {
      return c.json({ error: 'Missing required header' }, 403)
    }
  }
  await next()
})

// --- Admin-only routes ---
app.use('/api/users/*', requireRole('ADMIN'))
app.route('/api/users', users)

// --- Public settings (before section guards, available to all authenticated users) ---
app.get('/api/settings/public', async (c) => {
  const { getUsdRubRate, getMarkupPercent } = await import('./services/billing')
  const [usdRubRate, markupPercent] = await Promise.all([getUsdRubRate(), getMarkupPercent()])
  return c.json({ usdRubRate, markupPercent })
})

// --- Section-level access guards ---
app.use('/api/scenarios/*', requireSection('scenarios'))
app.use('/api/settings/*', requireSection('settings'))
app.use('/api/music/*', requireSection('soundStudio'))
app.use('/api/ai-logs/*', requireSection('aiLogs'))

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
app.route('/api/media', mediaFolders)
app.route('/api/settings', settings)
app.route('/api/vk-oauth', vkOauthRoutes)
app.route('/api', publish) // /api/post-versions/:id/publish|schedule
app.route('/api/ideas', ideas)
app.route('/api', storyTemplates) // /api/businesses/:bizId/story-templates + /api/story-templates/:id
app.route('/api', characters) // /api/businesses/:bizId/characters + /api/characters/:id
app.route('/api/scenarios', scenarios)
app.route('/api/prompt-library', promptLibrary)
app.route('/api/prompt-templates', promptTemplates)
app.route('/api', sessions)  // /api/sessions
app.route('/api/music', music)  // /api/music/*
app.route('/api/ai-logs', aiLogs)
app.route('/api/dashboard', dashboard)
app.route('/api/sse', sse)

// --- Static file serving for uploads ---
// Security: path traversal protection — resolve and verify path stays within uploads root
const uploadsRoot = resolve(getModuleDir(import.meta), '..', 'uploads')

app.get('/uploads/*', async (c) => {
  // Extract relative path after /uploads/ and resolve against uploads root
  const requestedPath = c.req.path.replace(/^\/uploads\/?/, '')
  const filePath = resolve(uploadsRoot, requestedPath)

  // Block path traversal: resolved path must start with uploads root
  if (!filePath.startsWith(uploadsRoot + '/') && filePath !== uploadsRoot) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const file = Bun.file(filePath)
  if (await file.exists()) {
    return new Response(file)
  }
  return c.json({ error: 'File not found' }, 404)
})

// --- Global error handler ---
app.onError((err, c) => {
  // Zod validation errors
  if (err instanceof ZodError) {
    return c.json({
      error: 'Validation error',
      details: err.flatten().fieldErrors,
    }, 400)
  }

  // Hono HTTP exceptions (thrown manually via throw new HTTPException)
  if (err instanceof HTTPException) {
    return c.json({
      error: err.message || 'HTTP Error',
    }, err.status)
  }

  // Prisma errors
  if (err.constructor?.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as { code: string; meta?: Record<string, unknown> }
    if (prismaErr.code === 'P2002') {
      return c.json({ error: 'Duplicate entry', details: prismaErr.meta }, 409)
    }
    if (prismaErr.code === 'P2025') {
      return c.json({ error: 'Record not found' }, 404)
    }
    return c.json({ error: 'Database error' }, 500)
  }

  if (err.constructor?.name === 'PrismaClientInitializationError') {
    console.error('[DB Connection Error]', err.message)
    return c.json({ error: 'Database connection error' }, 503)
  }

  // Generic error
  console.error(`[Error] ${err.message}`, config.isProd ? '' : err.stack)
  return c.json({ error: err.message || 'Internal Server Error' }, 500)
})

export { app }
