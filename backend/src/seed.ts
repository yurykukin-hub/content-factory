/**
 * Seed script: создаёт admin-пользователя и демо-бизнесы.
 * Запуск: bun src/seed.ts
 */
import { db } from './db'

async function main() {
  console.log('Seeding database...')

  // Admin user
  const adminPassword = await Bun.password.hash('admin123', { algorithm: 'bcrypt' })
  const admin = await db.user.upsert({
    where: { login: 'admin' },
    update: {},
    create: {
      login: 'admin',
      passwordHash: adminPassword,
      name: 'Юрий',
      role: 'ADMIN',
    },
  })
  console.log(`  User: ${admin.login} (${admin.role})`)

  // Businesses
  const businessesData = [
    {
      slug: 'kukin-brothers',
      name: 'Kukin Brothers',
      description: 'Ивент-компания: аренда оборудования, видеопродакшн, AI-видео, саунд-дизайн',
      erpType: 'kukin',
      brandProfile: {
        tone: 'Профессиональный, но дружелюбный. Без канцеляризмов.',
        targetAudience: 'Организаторы мероприятий, свадеб, корпоративов. B2B + B2C. Выборг и ЛО.',
        brandVoice: 'Экспертный, уверенный, с чувством юмора. Показываем закулисье.',
        hashtags: ['kukinbrothers', 'звукосвет', 'аренда оборудования', 'выборг'],
        keyTopics: ['аренда звука и света', 'свадьбы', 'корпоративы', 'видеопродакшн', 'AI-видео'],
        postsPerWeek: 3,
      },
    },
    {
      slug: 'nawode',
      name: 'НаWоде SUP Club',
      description: 'Прокат SUP-досок и туры. Сезон: май-сентябрь. Выборг.',
      erpType: 'nawode',
      brandProfile: {
        tone: 'Вдохновляющий, активный, близкий к природе. Эмоциональный.',
        targetAudience: 'Активный отдых, туристы, семьи, молодёжь 20-40. Выборг и СПб.',
        brandVoice: 'Зовём на воду! Показываем красоту, вайб, эмоции. Без формальностей.',
        hashtags: ['nawode', 'sup', 'supвыборг', 'прокатсап', 'наводе'],
        keyTopics: ['SUP-прогулки', 'туры', 'закаты', 'маршруты', 'Выборг', 'активный отдых'],
        postsPerWeek: 5,
      },
    },
    {
      slug: 'inpulse',
      name: 'Inpulse Production',
      description: 'Многокамерная live-съёмка: DJ-сеты, фестивали, вечеринки',
      brandProfile: {
        tone: 'Стильный, современный, музыкальный. Профессиональный.',
        targetAudience: 'DJ, организаторы мероприятий, клубы, фестивали. B2B.',
        brandVoice: 'Показываем energy и атмосферу через видео. Технический и креативный.',
        hashtags: ['inpulseproduction', 'livevideo', 'djset', 'multicam'],
        keyTopics: ['live video', 'DJ-сеты', 'фестивали', 'многокамерная съёмка', 'музыка'],
        postsPerWeek: 2,
      },
    },
    {
      slug: 'personal',
      name: 'Личный бренд',
      description: 'IT, разработка, бизнес-мысли',
      brandProfile: {
        tone: 'Честный, рефлексивный, практичный. Делюсь опытом.',
        targetAudience: 'Разработчики, предприниматели, люди из IT.',
        brandVoice: 'Пишу как думаю. Без воды. Кейсы, мысли, инсайты.',
        hashtags: ['разработка', 'бизнес', 'it'],
        keyTopics: ['разработка', 'ERP', 'AI', 'бизнес', 'продуктивность'],
        postsPerWeek: 2,
      },
    },
  ]

  for (const bizData of businessesData) {
    const { brandProfile: bpData, ...bizFields } = bizData
    const biz = await db.business.upsert({
      where: { slug: bizFields.slug },
      update: { name: bizFields.name, description: bizFields.description },
      create: bizFields,
    })

    await db.brandProfile.upsert({
      where: { businessId: biz.id },
      update: bpData,
      create: { businessId: biz.id, ...bpData },
    })

    // Link admin to all businesses
    await db.userBusiness.upsert({
      where: { userId_businessId: { userId: admin.id, businessId: biz.id } },
      update: {},
      create: { userId: admin.id, businessId: biz.id, role: 'ADMIN' },
    })

    console.log(`  Business: ${biz.name} (${biz.slug})`)
  }

  // Create Sveta (EDITOR for НаWоде)
  const svetaPassword = await Bun.password.hash('sveta123', { algorithm: 'bcrypt' })
  const sveta = await db.user.upsert({
    where: { login: 'sveta' },
    update: {},
    create: { login: 'sveta', passwordHash: svetaPassword, name: 'Света', role: 'EDITOR' },
  })
  const nawode = await db.business.findUnique({ where: { slug: 'nawode' } })
  if (nawode) {
    await db.userBusiness.upsert({
      where: { userId_businessId: { userId: sveta.id, businessId: nawode.id } },
      update: {},
      create: { userId: sveta.id, businessId: nawode.id, role: 'EDITOR' },
    })
  }
  console.log(`  User: ${sveta.login} (EDITOR, НаWоде)`)

  // Create Anton (EDITOR for НаWоде)
  const antonPassword = await Bun.password.hash('anton123', { algorithm: 'bcrypt' })
  const anton = await db.user.upsert({
    where: { login: 'anton' },
    update: {},
    create: { login: 'anton', passwordHash: antonPassword, name: 'Антон', role: 'EDITOR' },
  })
  if (nawode) {
    await db.userBusiness.upsert({
      where: { userId_businessId: { userId: anton.id, businessId: nawode.id } },
      update: {},
      create: { userId: anton.id, businessId: nawode.id, role: 'EDITOR' },
    })
  }
  console.log(`  User: ${anton.login} (EDITOR, НаWоде)`)

  console.log('Seed complete!')
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect())
