import { Hono } from 'hono'
import { db } from '../db'
import type { AuthUser } from '../middleware/auth'
import { assertBusinessAccess } from '../middleware/resource-access'

const mediaFolders = new Hono()

// GET /api/media/folders/:bizId — папки бизнеса (опционально по parentId)
mediaFolders.get('/folders/:bizId', async (c) => {
  const { bizId } = c.req.param()
  const parentId = c.req.query('parentId') // undefined = root folders

  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, bizId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const where: Record<string, unknown> = { businessId: bizId }
  if (parentId) {
    where.parentId = parentId
  } else {
    where.parentId = null // root level
  }

  const folders = await db.mediaFolder.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: {
          children: true,
          files: true,
        },
      },
    },
  })

  return c.json(folders)
})

// GET /api/media/folders/:bizId/path/:folderId — breadcrumb path
mediaFolders.get('/folders/:bizId/path/:folderId', async (c) => {
  const { bizId, folderId } = c.req.param()

  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, bizId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  // Build path from folder to root
  const path: { id: string; name: string }[] = []
  let currentId: string | null = folderId

  while (currentId) {
    const f: { id: string; name: string; parentId: string | null; businessId: string } | null =
      await db.mediaFolder.findUnique({
        where: { id: currentId },
        select: { id: true, name: true, parentId: true, businessId: true },
      })
    if (!f || f.businessId !== bizId) break
    path.unshift({ id: f.id, name: f.name })
    currentId = f.parentId
  }

  return c.json(path)
})

// POST /api/media/folders — создать папку
mediaFolders.post('/folders', async (c) => {
  const { businessId, name, parentId } = await c.req.json<{
    businessId: string
    name: string
    parentId?: string | null
  }>()

  if (!businessId || !name?.trim()) {
    return c.json({ error: 'businessId и name обязательны' }, 400)
  }

  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  // Validate parent belongs to same business
  if (parentId) {
    const parent = await db.mediaFolder.findUnique({ where: { id: parentId } })
    if (!parent || parent.businessId !== businessId) {
      return c.json({ error: 'Родительская папка не найдена' }, 404)
    }
  }

  const folder = await db.mediaFolder.create({
    data: {
      businessId,
      name: name.trim(),
      parentId: parentId || null,
    },
    include: {
      _count: { select: { children: true, files: true } },
    },
  })

  return c.json(folder, 201)
})

// PUT /api/media/folders/:id — переименовать папку
mediaFolders.put('/folders/:id', async (c) => {
  const { id } = c.req.param()
  const { name } = await c.req.json<{ name: string }>()

  if (!name?.trim()) {
    return c.json({ error: 'name обязателен' }, 400)
  }

  const folder = await db.mediaFolder.findUnique({ where: { id } })
  if (!folder) return c.json({ error: 'Папка не найдена' }, 404)

  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, folder.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  const updated = await db.mediaFolder.update({
    where: { id },
    data: { name: name.trim() },
  })

  return c.json(updated)
})

// DELETE /api/media/folders/:id — удалить папку (файлы перемещаются в родительскую)
mediaFolders.delete('/folders/:id', async (c) => {
  const { id } = c.req.param()

  const folder = await db.mediaFolder.findUnique({ where: { id } })
  if (!folder) return c.json({ error: 'Папка не найдена' }, 404)

  const user = c.get('user') as AuthUser
  try {
    await assertBusinessAccess(user, folder.businessId)
  } catch (e: any) {
    if (e.message === 'FORBIDDEN') return c.json({ error: 'Нет доступа' }, 403)
    throw e
  }

  // Move files to parent folder (or root)
  await db.mediaFile.updateMany({
    where: { folderId: id },
    data: { folderId: folder.parentId },
  })

  // Move subfolders to parent
  await db.mediaFolder.updateMany({
    where: { parentId: id },
    data: { parentId: folder.parentId },
  })

  await db.mediaFolder.delete({ where: { id } })

  return c.json({ success: true })
})

// POST /api/media/move — переместить файлы в папку
mediaFolders.post('/move', async (c) => {
  const { fileIds, folderId } = await c.req.json<{
    fileIds: string[]
    folderId: string | null
  }>()

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return c.json({ error: 'fileIds обязательны' }, 400)
  }

  // Validate folder exists if provided
  if (folderId) {
    const folder = await db.mediaFolder.findUnique({ where: { id: folderId } })
    if (!folder) return c.json({ error: 'Папка не найдена' }, 404)
  }

  await db.mediaFile.updateMany({
    where: { id: { in: fileIds } },
    data: { folderId: folderId },
  })

  return c.json({ success: true, moved: fileIds.length })
})

export { mediaFolders }
