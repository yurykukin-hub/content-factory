import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'

// --- Routes scoped by business (mounted at /api/businesses) ---
const platformsByBiz = new Hono()

// GET /api/businesses/:bizId/platforms
platformsByBiz.get('/:bizId/platforms', async (c) => {
  const { bizId } = c.req.param()
  const accounts = await db.platformAccount.findMany({
    where: { businessId: bizId, isActive: true },
    orderBy: { platform: 'asc' },
  })
  return c.json(accounts)
})

const createSchema = z.object({
  platform: z.enum(['VK', 'TELEGRAM', 'INSTAGRAM']),
  accountType: z.enum(['GROUP', 'PERSONAL', 'CHANNEL', 'BOT', 'BUSINESS']).default('GROUP'),
  accountName: z.string().min(1),
  accountId: z.string().min(1),
  accessToken: z.string().min(1),
  config: z.record(z.unknown()).optional(),
})

// POST /api/businesses/:bizId/platforms
platformsByBiz.post('/:bizId/platforms', async (c) => {
  const { bizId } = c.req.param()
  const data = createSchema.parse(await c.req.json())

  // Auto-set accountType based on platform if not explicitly provided
  if (data.platform === 'TELEGRAM' && data.accountType === 'GROUP') {
    data.accountType = 'CHANNEL'
  }

  const account = await db.platformAccount.create({
    data: { businessId: bizId, ...data },
  })
  return c.json(account, 201)
})

// --- Routes by platform ID (mounted at /api/platforms) ---
const platformsById = new Hono()

// Zod schema for platform account updates (only allowed fields)
const updateSchema = z.object({
  accountName: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
  accountType: z.enum(['GROUP', 'PERSONAL', 'CHANNEL', 'BOT', 'BUSINESS']).optional(),
  config: z.record(z.unknown()).optional(),
})

// PUT /api/platforms/:id
platformsById.put('/:id', async (c) => {
  const { id } = c.req.param()
  const data = updateSchema.parse(await c.req.json())
  const account = await db.platformAccount.update({
    where: { id },
    data,
  })
  return c.json(account)
})

// DELETE /api/platforms/:id (soft delete)
platformsById.delete('/:id', async (c) => {
  const { id } = c.req.param()
  await db.platformAccount.update({
    where: { id },
    data: { isActive: false },
  })
  return c.json({ success: true })
})

// POST /api/platforms/:id/test — тест соединения
platformsById.post('/:id/test', async (c) => {
  const { id } = c.req.param()
  const account = await db.platformAccount.findUnique({ where: { id } })
  if (!account) return c.json({ error: 'Аккаунт не найден' }, 404)

  try {
    if (account.platform === 'VK') {
      return c.json(await testVk(account))
    } else if (account.platform === 'TELEGRAM') {
      return c.json(await testTelegram(account))
    } else {
      return c.json({ success: false, error: `Тест для ${account.platform} не реализован` })
    }
  } catch (err) {
    return c.json({ success: false, error: String(err) })
  }
})

// --- VK test ---
async function testVk(account: { accountId: string; accessToken: string; accountType: string }) {
  if (account.accountType === 'PERSONAL') {
    // Phase 2: test personal page
    const res = await fetch('https://api.vk.com/method/users.get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: account.accessToken,
        v: '5.199',
      }),
    })
    const data = await res.json() as any
    if (data.error) return { success: false, error: `VK: ${data.error.error_msg}` }
    const user = data.response?.[0]
    return {
      success: true,
      name: `${user?.first_name} ${user?.last_name}`,
      photo: user?.photo_100,
      type: 'personal',
    }
  }

  // GROUP (default)
  const res = await fetch('https://api.vk.com/method/groups.getById', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      group_id: account.accountId,
      access_token: account.accessToken,
      fields: 'members_count,photo_100,description',
      v: '5.199',
    }),
  })
  const data = await res.json() as any
  if (data.error) return { success: false, error: `VK: ${data.error.error_msg}` }

  const group = data.response?.groups?.[0]
  return {
    success: true,
    name: group?.name || account.accountId,
    photo: group?.photo_100,
    memberCount: group?.members_count,
    description: group?.description,
    type: 'group',
  }
}

// --- Telegram test ---
async function testTelegram(account: { accountId: string; accessToken: string }) {
  const res = await fetch(`https://api.telegram.org/bot${account.accessToken}/getChat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: account.accountId }),
  })
  const data = await res.json() as any
  if (!data.ok) return { success: false, error: `Telegram: ${data.description}` }

  const chat = data.result
  return {
    success: true,
    name: chat.title || chat.username || account.accountId,
    description: chat.description,
    memberCount: chat.member_count,
    type: chat.type,
  }
}

export { platformsByBiz, platformsById }
