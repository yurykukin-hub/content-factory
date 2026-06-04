/**
 * Доставка отчёта агента-аналитика в Telegram (graceful).
 * Переиспользует бот/чат одобрения (telegram_approval_*).
 */
import { db } from '../../db'

const TG_API = 'https://api.telegram.org'

async function getConfig(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function sendAnalyticsReportToTelegram(report: any, business: { name: string }): Promise<void> {
  const token = await getConfig('telegram_approval_bot_token')
  const chatId = await getConfig('telegram_approval_chat_id')
  if (!token || !chatId) return // не настроено — тихо

  const findings: any[] = Array.isArray(report.findings) ? report.findings : []
  const recs: any[] = Array.isArray(report.recommendations) ? report.recommendations : []
  const ic = (t: string) => (t === 'win' ? '✅' : t === 'loss' ? '⚠️' : '💡')

  const lines = [
    `📊 <b>SMM-аналитика: ${esc(business.name)}</b>`,
    '',
    esc(report.summary || ''),
  ]
  if (findings.length) {
    lines.push('', '<b>Наблюдения:</b>')
    findings.slice(0, 5).forEach(f => lines.push(`${ic(f.type)} ${esc(f.title || '')}${f.detail ? ' — ' + esc(f.detail) : ''}`))
  }
  if (recs.length) {
    lines.push('', '<b>Рекомендации:</b>')
    recs.slice(0, 5).forEach((r, i) => lines.push(`${i + 1}. ${esc(r.action || '')}${r.reason ? ` <i>(${esc(r.reason)})</i>` : ''}`))
  }
  lines.push('', 'Открыть: раздел «Аналитика» в Content Factory')

  await fetch(`${TG_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true }),
  }).catch(() => {})
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
