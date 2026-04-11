import { db } from '../db'
import type { AuthUser } from './auth'

/**
 * Check if a user has access to a resource's business.
 * ADMIN always has access. EDITOR/VIEWER checked via UserBusiness.
 * Returns businessId if allowed, throws if not.
 */
export async function verifyPostAccess(user: AuthUser, postId: string): Promise<string> {
  const post = await db.post.findUnique({
    where: { id: postId },
    select: { businessId: true },
  })
  if (!post) throw new Error('NOT_FOUND')
  await assertBusinessAccess(user, post.businessId)
  return post.businessId
}

export async function verifyPlanAccess(user: AuthUser, planId: string): Promise<string> {
  const plan = await db.contentPlan.findUnique({
    where: { id: planId },
    select: { businessId: true },
  })
  if (!plan) throw new Error('NOT_FOUND')
  await assertBusinessAccess(user, plan.businessId)
  return plan.businessId
}

export async function verifyPlanItemAccess(user: AuthUser, itemId: string): Promise<string> {
  const item = await db.contentPlanItem.findUnique({
    where: { id: itemId },
    include: { contentPlan: { select: { businessId: true } } },
  })
  if (!item) throw new Error('NOT_FOUND')
  await assertBusinessAccess(user, item.contentPlan.businessId)
  return item.contentPlan.businessId
}

export async function verifyMediaAccess(user: AuthUser, mediaId: string): Promise<string> {
  const file = await db.mediaFile.findUnique({
    where: { id: mediaId },
    select: { businessId: true },
  })
  if (!file) throw new Error('NOT_FOUND')
  await assertBusinessAccess(user, file.businessId)
  return file.businessId
}

export async function verifyPostVersionAccess(user: AuthUser, versionId: string): Promise<string> {
  const version = await db.postVersion.findUnique({
    where: { id: versionId },
    include: { post: { select: { businessId: true } } },
  })
  if (!version) throw new Error('NOT_FOUND')
  await assertBusinessAccess(user, version.post.businessId)
  return version.post.businessId
}

/**
 * Check if user has access to a specific business.
 * ADMIN bypasses check.
 */
export async function assertBusinessAccess(user: AuthUser, businessId: string): Promise<void> {
  if (user.role === 'ADMIN') return

  const access = await db.userBusiness.findUnique({
    where: {
      userId_businessId: {
        userId: user.userId,
        businessId,
      },
    },
  })

  if (!access) {
    throw new Error('FORBIDDEN')
  }
}
