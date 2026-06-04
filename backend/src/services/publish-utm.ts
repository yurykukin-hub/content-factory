/**
 * UTM-подготовка текста/ссылок перед публикацией.
 * Общий слой для HTTP-публикации (routes/publish.ts) и планировщика (scheduler.ts),
 * чтобы метки ставились одинаково в обоих путях.
 */
import { db } from '../db'
import { hostsFromLinks, platformUtmSource, utmCampaign, tagBusinessLinks, tagBusinessUrl } from '../utils/utm'

/** UTM включён? AppConfig.utm_enabled (default true) */
export async function isUtmEnabled(): Promise<boolean> {
  const row = await db.appConfig.findUnique({ where: { key: 'utm_enabled' } })
  return row ? row.value !== 'false' : true
}

interface StoriesOpts { linkUrl?: string; [k: string]: any }
interface ApplyUtmInput {
  businessId: string
  platform: string
  postType: string
  postId: string
  text: string
  storiesOptions?: StoriesOpts
}
interface ApplyUtmOutput {
  text: string
  storiesOptions?: StoriesOpts
}

/**
 * Пометить ссылки бренда UTM-метками по каналу.
 * Лента → ссылки в тексте; сторис → кнопка-ссылка (текст накладывается на фото, не кликабелен).
 * Идемпотентно, чужие домены не трогаются.
 */
export async function applyUtmForPublish(input: ApplyUtmInput): Promise<ApplyUtmOutput> {
  const out: ApplyUtmOutput = { text: input.text, storiesOptions: input.storiesOptions }
  if (!(await isUtmEnabled())) return out

  const biz = await db.business.findUnique({
    where: { id: input.businessId },
    include: { brandProfile: { select: { links: true } } },
  })
  const hosts = hostsFromLinks(biz?.brandProfile?.links)
  if (!hosts.length) return out

  const utm = {
    hosts,
    source: platformUtmSource(input.platform),
    medium: 'social',
    campaign: utmCampaign(new Date()),
    content: input.postId,
  }

  if (input.postType === 'STORIES') {
    if (input.storiesOptions?.linkUrl) {
      out.storiesOptions = { ...input.storiesOptions, linkUrl: tagBusinessUrl(input.storiesOptions.linkUrl, utm) }
    }
  } else {
    out.text = tagBusinessLinks(input.text, utm)
  }
  return out
}
