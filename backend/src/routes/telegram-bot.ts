/**
 * Telegram Bot Webhook — receives callback queries and messages
 * for the auto-posting approval flow.
 *
 * No auth middleware (Telegram POSTs here directly).
 * Security: X-Telegram-Bot-Api-Secret-Token header validation.
 */

import { Hono } from 'hono'
import { db } from '../db'
import { handleCallbackQuery, handleTextMessage, handleCleanupCommand } from '../services/telegram-approval'
import { log } from '../utils/logger'

export const telegramBot = new Hono()

telegramBot.post('/', async (c) => {
  // Validate secret token
  const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token')
  const expectedSecret = (await db.appConfig.findUnique({ where: { key: 'telegram_approval_webhook_secret' } }))?.value

  if (expectedSecret && secretToken !== expectedSecret) {
    return c.json({}, 403)
  }

  try {
    const update = await c.req.json()

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query)
    } else if (update.message?.text) {
      const text = update.message.text.trim()

      // Handle commands
      if (text === '/cleanup') {
        await handleCleanupCommand()
      } else if (text === '/start') {
        // Send welcome + chat_id info
        const chatId = update.message.chat.id
        const token = (await db.appConfig.findUnique({ where: { key: 'telegram_approval_bot_token' } }))?.value
        if (token) {
          await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: `Content Factory Bot\n\nВаш chat_id: <code>${chatId}</code>\n\nСохраните его в Settings CF (telegram_approval_chat_id).`,
              parse_mode: 'HTML',
            }),
          })
        }
      } else {
        // Regular text message — could be edit response
        await handleTextMessage(update.message)
      }
    }
  } catch (err: any) {
    log.error('[TgBot] webhook error', { error: err.message })
  }

  // Telegram expects 200 OK even on errors
  return c.json({})
})
