/**
 * Seed script: создаёт admin-пользователя и демо-бизнесы.
 * Запуск: bun src/seed.ts
 */
import { db } from './db'

async function main() {
  console.log('Seeding database...')

  // Пароли сид-юзеров — ТОЛЬКО из env (не хардкод), чтобы дефолты не утекли в прод.
  const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD
  const DEFAULT_PW = process.env.SEED_DEFAULT_PASSWORD
  if (!ADMIN_PW || !DEFAULT_PW) {
    console.error('❌ Заданы не все пароли. Пример: SEED_ADMIN_PASSWORD=... SEED_DEFAULT_PASSWORD=... bun src/seed.ts')
    process.exit(1)
  }
  if (ADMIN_PW.length < 8 || DEFAULT_PW.length < 8) {
    console.error('❌ SEED_ADMIN_PASSWORD/SEED_DEFAULT_PASSWORD слишком короткие (минимум 8 символов).')
    process.exit(1)
  }

  // Admin user
  const adminPassword = await Bun.password.hash(ADMIN_PW, { algorithm: 'bcrypt' })
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
      description: 'SUP Club в Выборге. 6-й сезон. 35 досок Gladiator, 3 авторских тура (Монрепо, Беличьи скалы, Место силы), 5 инструкторов. Прокат, туры, уроки, корпоративы. Сезон: май-сентябрь.',
      erpType: 'nawode',
      brandProfile: {
        tone: 'Дружелюбный, живой, от людей (не от бренда). Без официоза. Продаём впечатление, не доску. Эмоциональный, вдохновляющий, близкий к природе.',
        targetAudience: 'Основной: туристы из СПб, 25-45 лет, на машине/электричке на выходной. Семьи с детьми от 7 лет. Корпоративы (HR-менеджеры, тимбилдинг). Молодёжь 20-30 (SUP как тренд, контент для соцсетей). Подарочные сертификаты к праздникам.',
        brandVoice: 'Зовём на воду! Показываем красоту, вайб, эмоции. Без формальностей. Главный месседж: "Выборг с воды — впечатления, которых не увидишь с берега". УТП: единственный системный SUP-клуб в Выборге (6-й сезон), 3 авторских тура, 35 досок Gladiator, 5 сертифицированных инструкторов. Безопасность: страховка, жилеты, инструктаж, от 7 до 67 лет.',
        hashtags: ['НаWоде', 'SUPВыборг', 'ВыборгСSUP', 'сапВыборг', 'сапборд', 'supboard', 'прокатSUP', 'активныйотдых', 'отдыхнаводе', 'выборгтуризм'],
        keyTopics: ['Выборг с воды', 'Первый раз на доске', 'Команда НаWоде', 'Готовимся к сезону', 'Маршруты НаWоде', 'SUP и польза', 'Подари впечатление', 'Погода и вода', 'Корпоратив на воде', 'Пиратская гавань 2026'],
        doNotMention: ['конкуренты', 'цены конкурентов', 'негативные отзывы', 'плохая погода без контекста безопасности'],
        postsPerWeek: 5,
        examplePosts: [
          {
            topic: 'Выборг с воды — открытие сезона',
            text: 'Скучали?\n\nМы тоже. Каждую зиму считаем дни до момента, когда снова выйдем на воду.\n\nВ этом году НаWоде открывает 6-й сезон. Шесть лет мы показываем Выборг с ракурса, который не увидишь ни с одной набережной. Замок, залив, Монрепо, скалы — всё это совсем другое, когда ты стоишь на доске.\n\nСкоро. Уже совсем скоро.\n\nА пока — готовимся. Следите за нами, будем показывать как это происходит.',
          },
          {
            topic: 'Первый раз на доске — страх упасть',
            text: '"А если я упаду?"\n\nСамый частый вопрос от тех, кто ни разу не стоял на SUP-борде. Отвечаем честно.\n\nSUP-доска — это не сёрфинг и не вейкборд. Она широкая, устойчивая и рассчитана на то, чтобы на ней стоял обычный человек. Не спортсмен, не экстремал — обычный человек.\n\nЗа 5 сезонов через нас прошли сотни людей от 7 до 67 лет. Дети, бабушки, те, кто впервые в жизни вышел на воду. И знаете что? Падают единицы.\n\nЕсли вы давно хотели попробовать, но боялись — не бойтесь.',
          },
          {
            topic: 'Маршруты — тур Монрепо',
            text: 'Тур "Монрепо" — 3.5 часа, которые меняют представление о Выборге.\n\nПарк Монрепо знают все. Но мало кто видел его с воды. А с воды он — совсем другой.\n\nЧто вас ждёт:\n— Вход в парк по воде, мимо скал, которые не видны с берега\n— Тихие бухты, куда не добраться пешком\n— Сосны, нависающие над водой\n— Место для привала на камнях с видом на залив\n\nЭто наш самый популярный тур. И мы понимаем почему.',
          },
        ],
        links: [
          { label: 'Бронирование', url: 'https://nawode.ru' },
          { label: 'VK', url: 'https://vk.com/nawode_sup' },
        ],
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
  const svetaPassword = await Bun.password.hash(DEFAULT_PW, { algorithm: 'bcrypt' })
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
  const antonPassword = await Bun.password.hash(DEFAULT_PW, { algorithm: 'bcrypt' })
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
