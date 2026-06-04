/**
 * Seed global story overlay design presets (idempotent).
 * Run: bun src/seed-story-presets.ts  (or inside container after deploy)
 */
import { db } from './db'

const PRESETS = [
  { name: 'Чистый низ',        emoji: '🌊', textPosition: 'bottom', textAlign: 'center', textColor: '#ffffff', fontSize: 'M', bgStyle: 'dark',  bgRadius: 'round',  linkType: '',     sortOrder: 1 },
  { name: 'Крупный заголовок', emoji: '🔆', textPosition: 'center', textAlign: 'center', textColor: '#ffffff', fontSize: 'L', bgStyle: 'dark',  bgRadius: 'round',  linkType: '',     sortOrder: 2 },
  { name: 'Минимал',           emoji: '✦',  textPosition: 'bottom', textAlign: 'left',   textColor: '#ffffff', fontSize: 'M', bgStyle: 'none',  bgRadius: 'square', linkType: '',     sortOrder: 3 },
  { name: 'Акция',             emoji: '🔥', textPosition: 'center', textAlign: 'center', textColor: '#ffffff', fontSize: 'L', bgStyle: 'dark',  bgRadius: 'round',  linkType: 'book', sortOrder: 4 },
  { name: 'Светлый верх',      emoji: '☀️', textPosition: 'top',    textAlign: 'center', textColor: '#000000', fontSize: 'M', bgStyle: 'light', bgRadius: 'round',  linkType: '',     sortOrder: 5 },
]

async function main() {
  await db.storyTemplate.deleteMany({ where: { isSystem: true, businessId: null } })
  for (const p of PRESETS) {
    await db.storyTemplate.create({ data: { ...p, isSystem: true, businessId: null, overlayText: '' } })
  }
  console.log(`Seeded ${PRESETS.length} global story presets`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
