/**
 * Telegram Approval Bot — sends post proposals with inline buttons,
 * receives approval/rejection via webhook callback queries.
 *
 * Uses direct HTTP calls to Telegram Bot API (same pattern as publishers/telegram.ts).
 * No grammy/telegraf dependency.
 */

import { db } from '../db'
import { log } from '../utils/logger'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { getPublisher } from './publishers/base'
import { join } from 'path'
import { getModuleDir } from '../utils/paths'

const TG_API = 'https://api.telegram.org'
const UPLOAD_DIR = join(getModuleDir(import.meta), '../../uploads')

// --- Config helpers ---
async function getConfig(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } })
  return row?.value ?? null
}

async function getBotToken(): Promise<string | null> {
  return getConfig('telegram_approval_bot_token')
}

async function getChatId(): Promise<string | null> {
  return getConfig('telegram_approval_chat_id')
}

// --- Telegram API helpers ---

async function callTg(token: string, method: string, body: any): Promise<any> {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as any
  if (!data.ok) {
    log.error('[TgApproval] API error', { method, error: data.description })
  }
  return data
}

async function callTgForm(token: string, method: string, form: FormData): Promise<any> {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: 'POST',
    body: form,
  })
  return res.json()
}

// --- Public API ---

/** Send approval message with photo + inline keyboard to admin */
export async function sendApprovalToTelegram(
  task: any,
  photo: any,
  business: any,
): Promise<void> {
  const token = await getBotToken()
  const chatId = await getChatId()
  if (!token || !chatId) {
    log.warn('[TgApproval] not configured (token or chatId missing)')
    return
  }

  const caption = formatCaption(task, photo, business)
  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Опубликовать', callback_data: `approve:${task.id}` },
        { text: 'Отклонить', callback_data: `reject:${task.id}` },
      ],
      [
        { text: 'Редактировать', callback_data: `edit:${task.id}` },
      ],
    ],
  }

  let result: any

  // Try to send photo if file exists
  if (photo.filePath && existsSync(photo.filePath)) {
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('caption', caption)
    form.append('parse_mode', 'HTML')
    form.append('reply_markup', JSON.stringify(keyboard))

    const fileBuffer = await readFile(photo.filePath)
    const blob = new Blob([fileBuffer], { type: photo.mimeType || 'image/jpeg' })
    form.append('photo', blob, 'photo.jpg')

    result = await callTgForm(token, 'sendPhoto', form)
  } else {
    // Fallback: text-only message
    result = await callTg(token, 'sendMessage', {
      chat_id: chatId,
      text: caption,
      parse_mode: 'HTML',
      reply_markup: keyboard,
    })
  }

  // Save message ID for later editing
  if (result?.ok && result?.result?.message_id) {
    await db.autoPostTask.update({
      where: { id: task.id },
      data: { tgMessageId: String(result.result.message_id) },
    })
  }
}

/** Handle callback_query from Telegram webhook */
export async function handleCallbackQuery(callbackQuery: any): Promise<void> {
  const { data, message, id: callbackId } = callbackQuery
  const token = await getBotToken()
  if (!token) return

  const [action, taskId] = (data || '').split(':')
  if (!taskId) return

  const task = await db.autoPostTask.findUnique({ where: { id: taskId } })
  if (!task) {
    await answerCallback(token, callbackId, 'Задача не найдена')
    return
  }

  switch (action) {
    case 'approve':
      if (task.source === 'digest') {
        // Digest: одобрение создаёт черновик в CF (без авто-публикации)
        await answerCallback(token, callbackId, 'Создаю черновик...')
        try {
          const { approveDigestTask } = await import('./daily-digest')
          await approveDigestTask(task)
          await editMessageStatus(token, message, 'Одобрено — черновик создан в Content Factory')
        } catch (e: any) {
          await editMessageStatus(token, message, 'Ошибка: ' + (e.message?.slice(0, 100)))
        }
      } else {
        await handleApprove(token, task, message, callbackId)
      }
      break
    case 'reject':
      await handleReject(token, task, message, callbackId)
      break
    case 'edit':
      await handleEdit(token, task, message, callbackId)
      break
    default:
      await answerCallback(token, callbackId, 'Неизвестное действие')
  }
}

/** Handle text message (for editing flow) */
export async function handleTextMessage(message: any): Promise<void> {
  const token = await getBotToken()
  const chatId = await getChatId()
  if (!token || !chatId) return

  // Check if we're expecting edited text from this user
  const editingTask = await db.autoPostTask.findFirst({
    where: { status: 'editing' },
    orderBy: { proposedAt: 'desc' },
  })

  if (!editingTask) return  // No task in editing state

  const newText = message.text?.trim()
  if (!newText) return

  // Update task with new text and re-propose
  await db.autoPostTask.update({
    where: { id: editingTask.id },
    data: {
      proposedText: newText,
      status: 'proposed',
    },
  })

  // Digest-задачи без фото — текст-редактирование через бота тут не применимо
  if (!editingTask.catalogId) {
    await answerCallback(token, '', 'Текст обновлён')
    return
  }

  // Send updated preview
  const photo = await db.photoCatalog.findUnique({ where: { id: editingTask.catalogId } })
  const business = await db.business.findUnique({ where: { id: editingTask.businessId } })

  if (photo && business) {
    await sendApprovalToTelegram(
      { ...editingTask, proposedText: newText, status: 'proposed' },
      photo,
      business,
    )
  }

  await answerCallback(token, '', 'Текст обновлён')
  await callTg(token, 'sendMessage', {
    chat_id: chatId,
    text: 'Текст обновлён. Проверьте новое превью выше.',
  })
}

/** Handle /cleanup command */
export async function handleCleanupCommand(): Promise<void> {
  const token = await getBotToken()
  const chatId = await getChatId()
  if (!token || !chatId) return

  // Find files that are safely downloaded (exist on VPS)
  const catalogItems = await db.photoCatalog.findMany({
    where: {
      fileDate: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },  // older than 30 days
    },
    orderBy: { fileDate: 'asc' },
  })

  // Group by month
  const byMonth: Record<string, { photos: number; videos: number; size: number }> = {}

  for (const item of catalogItems) {
    // Verify file actually exists on VPS
    if (!existsSync(item.filePath)) continue

    const date = item.fileDate || item.createdAt
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

    if (!byMonth[key]) byMonth[key] = { photos: 0, videos: 0, size: 0 }
    byMonth[key].size += item.fileSize

    if (item.mimeType.startsWith('image/')) byMonth[key].photos++
    else byMonth[key].videos++
  }

  if (Object.keys(byMonth).length === 0) {
    await callTg(token, 'sendMessage', {
      chat_id: chatId,
      text: 'Нет файлов старше 30 дней для очистки.',
    })
    return
  }

  const totalSize = Object.values(byMonth).reduce((sum, m) => sum + m.size, 0)
  const totalSizeGB = (totalSize / (1024 * 1024 * 1024)).toFixed(1)

  let text = '<b>Безопасно к удалению из Google Photos</b>\n'
  text += '(файлы уже скачаны на VPS + ноутбук)\n\n'

  for (const [month, data] of Object.entries(byMonth).sort()) {
    const sizeStr = (data.size / (1024 * 1024)).toFixed(0)
    text += `${month}: ${data.photos} фото, ${data.videos} видео (${sizeStr} МБ)\n`
  }

  text += `\n<b>Итого: ${totalSizeGB} ГБ можно освободить</b>`
  text += '\n\nУдалите вручную в Google Photos приложении.'

  await callTg(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  })
}

// --- Private helpers ---

async function handleApprove(token: string, task: any, message: any, callbackId: string): Promise<void> {
  await answerCallback(token, callbackId, 'Публикую...')

  try {
    // 1. Get photo from catalog
    const photo = await db.photoCatalog.findUnique({ where: { id: task.catalogId } })
    if (!photo || !existsSync(photo.filePath)) {
      await editMessageStatus(token, message, 'Ошибка: файл не найден')
      return
    }

    // 2. Copy photo to CF uploads and create MediaFile
    const business = await db.business.findUnique({ where: { id: task.businessId } })
    if (!business) return

    const { nanoid } = await import('nanoid')
    const ext = photo.filePath.split('.').pop() || 'jpg'
    const fileId = nanoid(12)
    const fileName = `${fileId}.${ext}`
    const destPath = join(UPLOAD_DIR, business.id, fileName)

    // Ensure business upload dir exists
    const bizDir = join(UPLOAD_DIR, business.id)
    const { mkdirSync } = await import('fs')
    mkdirSync(bizDir, { recursive: true })

    // Copy file
    const srcBuffer = await readFile(photo.filePath)
    await Bun.write(destPath, srcBuffer)

    // Generate thumbnail
    let thumbUrl: string | null = null
    try {
      const sharp = (await import('sharp')).default
      const thumbName = `${fileId}_thumb.webp`
      const thumbPath = join(bizDir, thumbName)
      await sharp(destPath).resize(200, 200, { fit: 'cover' }).webp({ quality: 70 }).toFile(thumbPath)
      thumbUrl = `/uploads/${business.id}/${thumbName}`
    } catch {}

    // Create MediaFile
    const mediaFile = await db.mediaFile.create({
      data: {
        businessId: business.id,
        filename: photo.filePath.split('/').pop() || fileName,
        url: `/uploads/${business.id}/${fileName}`,
        thumbUrl,
        mimeType: photo.mimeType,
        sizeBytes: photo.fileSize,
        altText: photo.aiDescription,
        tags: photo.aiTags || [],
      },
    })

    // 3. Create Post + PostVersions
    const post = await db.post.create({
      data: {
        businessId: business.id,
        body: task.proposedText,
        postType: 'PHOTO',
        status: 'APPROVED',
      },
    })

    // Attach media to post
    await db.mediaFile.update({
      where: { id: mediaFile.id },
      data: { postId: post.id },
    })

    // 4. Publish to all platforms
    const accounts = await db.platformAccount.findMany({
      where: {
        businessId: business.id,
        platform: { in: task.platforms },
        isActive: true,
      },
    })

    const publishResults: string[] = []

    for (const account of accounts) {
      try {
        const publisher = getPublisher(account.platform, { postType: 'PHOTO', config: account.config })
        const result = await publisher.publish({
          text: task.proposedText,
          hashtags: task.proposedTags,
          mediaFiles: [{
            url: `/uploads/${business.id}/${fileName}`,
            mimeType: photo.mimeType,
            filename: fileName,
          }],
          platformAccount: account,
          postType: 'PHOTO',
        })

        // Create PostVersion
        await db.postVersion.create({
          data: {
            postId: post.id,
            platformAccountId: account.id,
            body: task.proposedText,
            hashtags: task.proposedTags,
            status: result.success ? 'PUBLISHED' : 'FAILED',
            publishedAt: result.success ? new Date() : null,
            externalPostId: result.externalPostId || null,
            externalUrl: result.externalUrl || null,
          },
        })

        // Log
        const version = await db.postVersion.findFirst({
          where: { postId: post.id, platformAccountId: account.id },
          orderBy: { createdAt: 'desc' },
        })
        if (version) {
          await db.publishLog.create({
            data: {
              postVersionId: version.id,
              status: result.success ? 'SUCCESS' : 'FAILED',
              response: result.rawResponse as any,
              errorMessage: result.error || null,
            },
          })
        }

        publishResults.push(`${account.platform}: ${result.success ? 'OK' : 'Ошибка'}`)
      } catch (err: any) {
        publishResults.push(`${account.platform}: Ошибка (${err.message?.slice(0, 50)})`)
      }
    }

    // 5. Update task and catalog
    await db.autoPostTask.update({
      where: { id: task.id },
      data: {
        status: 'published',
        postId: post.id,
        mediaFileId: mediaFile.id,
        decidedAt: new Date(),
      },
    })

    await db.photoCatalog.update({
      where: { id: task.catalogId },
      data: {
        status: 'posted',
        mediaFileId: mediaFile.id,
        postedAt: new Date(),
      },
    })

    // 6. Update Telegram message
    const statusText = publishResults.join('\n')
    await editMessageStatus(token, message, `Опубликовано!\n${statusText}`)

    log.info('[TgApproval] approved and published', { taskId: task.id, results: publishResults })

  } catch (err: any) {
    log.error('[TgApproval] approve error', { taskId: task.id, error: err.message })
    await editMessageStatus(token, message, `Ошибка: ${err.message?.slice(0, 100)}`)
  }
}

async function handleReject(token: string, task: any, message: any, callbackId: string): Promise<void> {
  await answerCallback(token, callbackId, 'Отклонено')

  await db.autoPostTask.update({
    where: { id: task.id },
    data: { status: 'rejected', decidedAt: new Date() },
  })

  // Photo stays analyzed (can be proposed again later)
  await editMessageStatus(token, message, 'Отклонено')
  log.info('[TgApproval] rejected', { taskId: task.id })
}

async function handleEdit(token: string, task: any, message: any, callbackId: string): Promise<void> {
  await answerCallback(token, callbackId, 'Отправьте новый текст')

  await db.autoPostTask.update({
    where: { id: task.id },
    data: { status: 'editing' },
  })

  const chatId = await getChatId()
  if (chatId) {
    await callTg(token, 'sendMessage', {
      chat_id: chatId,
      text: 'Отправьте новый текст поста (следующее сообщение будет использовано как текст):',
    })
  }
}

function formatCaption(task: any, photo: any, business: any): string {
  const lines: string[] = []
  lines.push(`<b>Пост для ${business.name}</b>`)
  lines.push('')
  lines.push(task.proposedText)

  if (task.proposedTags?.length) {
    lines.push('')
    lines.push(task.proposedTags.map((t: string) => '#' + t).join(' '))
  }

  lines.push('')
  lines.push(`<i>Платформы: ${task.platforms?.join(', ') || 'не указаны'}</i>`)

  if (task.aiReasoning) {
    lines.push(`<i>Почему: ${task.aiReasoning}</i>`)
  }

  return lines.join('\n')
}

async function answerCallback(token: string, callbackId: string, text: string): Promise<void> {
  if (!callbackId) return
  await callTg(token, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    text,
  })
}

async function editMessageStatus(token: string, message: any, statusText: string): Promise<void> {
  if (!message?.chat?.id || !message?.message_id) return

  // Edit caption (for photo messages) or text (for text messages)
  const originalText = message.caption || message.text || ''
  const newText = `${originalText}\n\n<b>${statusText}</b>`

  if (message.photo) {
    await callTg(token, 'editMessageCaption', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      caption: newText,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] },  // remove buttons
    })
  } else {
    await callTg(token, 'editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: newText,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] },
    })
  }
}

/** Set Telegram webhook URL (called on server startup) */
export async function setupTelegramWebhook(): Promise<void> {
  const token = await getBotToken()
  if (!token) {
    log.info('[TgApproval] webhook setup skipped (no token configured)')
    return
  }

  const webhookSecret = await getConfig('telegram_approval_webhook_secret')
  const webhookUrl = 'https://content.yurykukin.ru/api/webhooks/telegram-bot'

  const body: any = { url: webhookUrl }
  if (webhookSecret) {
    body.secret_token = webhookSecret
  }

  const result = await callTg(token, 'setWebhook', body)
  log.info('[TgApproval] webhook setup', { ok: result?.ok, url: webhookUrl })
}
