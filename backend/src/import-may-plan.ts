/**
 * One-time script: import May 2026 content plan for НаWоде from marketing docs.
 * Run: cd backend && bun src/import-may-plan.ts
 */
import { db } from './db'

const MAY_ITEMS = [
  { date: '2026-05-01', dayOfWeek: 'Четверг', topic: 'Анонс открытия сезона', postType: 'PHOTO' as const, description: '[Погода и вода] 1 мая — +16 в Выборге! Готовы? Мы — да. Анонсируем открытие сезона!' },
  { date: '2026-05-03', dayOfWeek: 'Суббота', topic: 'Сертификат на SUP-тур', postType: 'PHOTO' as const, description: '[Подари впечатление] Не знаешь что подарить? Сертификат на SUP-тур — впечатление, которое запомнится' },
  { date: '2026-05-05', dayOfWeek: 'Понедельник', topic: '3 маршрута, 3 разных Выборга', postType: 'PHOTO' as const, description: '[Маршруты НаWоде] 3 маршрута, 3 разных Выборга. Какой выберете вы? Сравниваем туры' },
  { date: '2026-05-07', dayOfWeek: 'Среда', topic: 'Вода в мае: гидрокостюмы', postType: 'PHOTO' as const, description: '[Первый раз на доске] Вода в мае: холодная? Рассказываем про гидрокостюмы и почему это не страшно' },
  { date: '2026-05-10', dayOfWeek: 'Суббота', topic: 'Весенний Выборг без листвы', postType: 'PHOTO' as const, description: '[Выборг с воды] Весенний Выборг с воды — когда деревья ещё без листвы и видно всё' },
  { date: '2026-05-12', dayOfWeek: 'Понедельник', topic: 'Первый тестовый выход на воду', postType: 'VIDEO' as const, description: '[Готовимся к сезону] Первый тестовый выход на воду! Проверяем маршруты после зимы' },
  { date: '2026-05-14', dayOfWeek: 'Среда', topic: 'Инструктор: работает с детьми', postType: 'PHOTO' as const, description: '[Команда НаWоде] Знакомьтесь — инструктор, который работает с детьми. Это его суперсила' },
  { date: '2026-05-15', dayOfWeek: 'Четверг', topic: 'Корпоративы: осталось 5 дат', postType: 'PHOTO' as const, description: '[Корпоратив на воде] Июнь-июль — пик корпоративов. Осталось 5 свободных дат. Бронируйте' },
  { date: '2026-05-17', dayOfWeek: 'Суббота', topic: 'Температура воды +14', postType: 'PHOTO' as const, description: '[Погода и вода] Температура воды +14. Мониторим каждый день — покажем когда можно без костюма' },
  { date: '2026-05-19', dayOfWeek: 'Понедельник', topic: 'Пиратская гавань — анонс', postType: 'PHOTO' as const, description: '[Пиратская гавань 2026] 22 августа — Пиратская гавань! Самый SUP-фестиваль Северо-Запада. Мы готовим к нему участников' },
  { date: '2026-05-21', dayOfWeek: 'Среда', topic: 'Секрет маршрута Монрепо', postType: 'PHOTO' as const, description: '[Маршруты НаWоде] Секрет маршрута Монрепо: место, где делают то самое фото. Рассказываем где это' },
  { date: '2026-05-24', dayOfWeek: 'Суббота', topic: 'SUP SPOT Дружба', postType: 'PHOTO' as const, description: '[Выборг с воды] SUP SPOT Дружба — наша вторая точка. Другой район, другая атмосфера, тот же кайф' },
  { date: '2026-05-26', dayOfWeek: 'Понедельник', topic: 'Выпускной — сертификат на SUP', postType: 'PHOTO' as const, description: '[Подари впечатление] Выпускной → сертификат на SUP. Идеальный подарок выпускнику (да, у нас от 7 лет)' },
  { date: '2026-05-28', dayOfWeek: 'Среда', topic: 'Погода на выходные — ваш шанс', postType: 'PHOTO' as const, description: '[Первый раз на доске] Погода на выходные — актуальная. Если вы давно хотели попробовать — это ваш шанс' },
  { date: '2026-05-31', dayOfWeek: 'Суббота', topic: 'ИЮНЬ! Сезон официально открыт', postType: 'PHOTO' as const, description: '[Готовимся к сезону] ИЮНЬ! Сезон официально открыт. Расписание, цены, как забронировать — всё здесь' },
]

async function main() {
  const nawode = await db.business.findUnique({ where: { slug: 'nawode' } })
  if (!nawode) {
    console.error('Business "nawode" not found')
    process.exit(1)
  }

  const today = new Date().toISOString().slice(0, 10)

  const plan = await db.contentPlan.create({
    data: {
      businessId: nawode.id,
      title: 'Май 2026 — Запуск',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-31'),
      generatedBy: 'import',
      items: {
        create: MAY_ITEMS.map((item) => ({
          date: new Date(item.date),
          dayOfWeek: item.dayOfWeek,
          topic: item.topic,
          postType: item.postType,
          description: item.description,
          status: item.date < today ? 'SKIPPED' : 'PLANNED',
        })),
      },
    },
    include: {
      items: { orderBy: { date: 'asc' } },
    },
  })

  const skipped = plan.items.filter(i => i.status === 'SKIPPED').length
  const planned = plan.items.filter(i => i.status === 'PLANNED').length

  console.log(`May plan imported: "${plan.title}"`)
  console.log(`  Total: ${plan.items.length} items`)
  console.log(`  Planned: ${planned}`)
  console.log(`  Skipped (past): ${skipped}`)
  console.log(`  Plan ID: ${plan.id}`)
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
