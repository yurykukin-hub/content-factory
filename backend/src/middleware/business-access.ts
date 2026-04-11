import { Context, Next } from 'hono'
import type { AuthUser } from './auth'
import { db } from '../db'

/**
 * Middleware: check that current user has access to the business in :bizId param.
 * ADMIN users bypass the check.
 * EDITOR/VIEWER must have a UserBusiness record.
 */
export async function requireBusinessAccess(c: Context, next: Next) {
  const user = c.get('user') as AuthUser
  const bizId = c.req.param('bizId')

  if (!bizId) {
    return c.json({ error: 'Business ID required' }, 400)
  }

  // ADMIN can access any business
  if (user.role === 'ADMIN') {
    await next()
    return
  }

  // Check UserBusiness record
  const access = await db.userBusiness.findUnique({
    where: {
      userId_businessId: {
        userId: user.userId,
        businessId: bizId,
      },
    },
  })

  if (!access) {
    return c.json({ error: 'FORBIDDEN' }, 403)
  }

  await next()
}

/**
 * Get list of business IDs that user has access to.
 * ADMIN returns null (meaning "all businesses").
 * EDITOR/VIEWER returns array of accessible businessIds.
 */
export async function getUserBusinessIds(user: AuthUser): Promise<string[] | null> {
  if (user.role === 'ADMIN') return null // all access

  const records = await db.userBusiness.findMany({
    where: { userId: user.userId },
    select: { businessId: true },
  })

  return records.map((r) => r.businessId)
}
