/**
 * Seed конкурентов НаWоде для модуля «Конкуренты» (VK-мониторинг).
 *
 * Идемпотентно: upsert по (businessId, platform, handle). Включает модуль
 * (competitor_monitor_enabled = true) и задаёт время сбора по умолчанию.
 *
 * Запуск: cd backend && bun src/seed-competitors.ts
 * Источник пабликов: разведка (SUP-прокаты/туры Выборг, Ленобласть, СПб, Карелия).
 * Перед боевым прогоном — проверить активность пабликов на vk.com (2026).
 */
import { db } from './db'

// handle: VK domain (часть после vk.com/) ЛИБО owner_id ("-12345678")
const COMPETITORS: { handle: string; displayName: string; category: string; notes?: string }[] = [
  { handle: 'supway', displayName: 'SUP Way SPB', category: 'competitor', notes: 'SUP-туры Ленобласть, маршруты частично пересекаются' },
  { handle: 'suplife_spb', displayName: 'Suplife SPB', category: 'competitor', notes: 'Прокат + групповые туры СПб, сильный SMM' },
  { handle: 'sup_bro_spb', displayName: 'SUP BRO SPB', category: 'competitor', notes: 'Прокат + корпоративы, мобильные станции' },
  { handle: 'supboard_supdoska_spb', displayName: 'SUPBOARD СПб', category: 'competitor', notes: 'Прокат, продажи оборудования' },
  { handle: 'wonderwake', displayName: 'WONDERWAKE', category: 'adjacent', notes: 'Вейк-парк Выборгский р-н — та же ЦА активного отдыха' },
  { handle: 'surfsuprocknroll', displayName: 'Surf SUP Rock Roll', category: 'inspiration', notes: 'Авторские туры Ладожские шхеры (Карелия)' },
  { handle: 'fontankasup', displayName: 'Fontanka SUP', category: 'adjacent', notes: 'Фестиваль SUP — большая аудитория, форматы постов' },
  { handle: 'supclubru', displayName: 'SUP Club', category: 'inspiration', notes: 'Методички, маршруты Ленобласти' },
]

async function setConfig(key: string, value: string) {
  await db.appConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
}

async function main() {
  const businesses = await db.business.findMany({ where: { erpType: 'nawode' } })
  if (!businesses.length) {
    console.log('[seed-competitors] нет бизнеса с erpType=nawode — нечего сидить')
    return
  }

  for (const biz of businesses) {
    let created = 0
    let updated = 0
    for (const c of COMPETITORS) {
      const existing = await db.competitorAccount.findFirst({
        where: { businessId: biz.id, platform: 'VK', handle: c.handle },
      })
      if (existing) {
        await db.competitorAccount.update({
          where: { id: existing.id },
          data: { displayName: c.displayName, category: c.category, notes: c.notes ?? null },
        })
        updated++
      } else {
        await db.competitorAccount.create({
          data: {
            businessId: biz.id,
            platform: 'VK',
            handle: c.handle,
            displayName: c.displayName,
            category: c.category,
            notes: c.notes ?? null,
          },
        })
        created++
      }
    }
    console.log(`[seed-competitors] ${biz.slug}: создано ${created}, обновлено ${updated}`)
  }

  // Включить модуль + время сбора по умолчанию (06:30 МСК = до утреннего дайджеста 07:00 МСК)
  await setConfig('competitor_monitor_enabled', 'true')
  // Время ставим только если ещё не задано — не затирать ручную настройку при ре-сидинге
  const timeExists = await db.appConfig.findUnique({ where: { key: 'competitor_monitor_time_utc' } })
  if (!timeExists) await setConfig('competitor_monitor_time_utc', '03:30')
  console.log('[seed-competitors] модуль включён (competitor_monitor_enabled=true, time=03:30 UTC)')
  console.log('[seed-competitors] готово')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[seed-competitors] ошибка:', e)
    process.exit(1)
  })
