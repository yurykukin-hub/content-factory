import { config } from '../../config'
import { db } from '../../db'
import { calculateCost, getApiKey } from './openrouter'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { getModuleDir } from '../../utils/paths'

const UPLOAD_DIR = join(getModuleDir(import.meta), '../../../uploads')

interface GenerateImageParams {
  prompt: string
  businessId: string
  postId?: string | null
  aspectRatio?: '1:1' | '16:9' | '9:16'
}

interface GenerateImageResult {
  mediaFile: {
    id: string
    url: string
    thumbUrl: string | null
    filename: string
    mimeType: string
    sizeBytes: number
  }
  usage: {
    tokensIn: number
    tokensOut: number
    model: string
  }
}

/**
 * Generate image using OpenRouter API (Gemini Flash Image or Flux).
 * Saves result as MediaFile in database and filesystem.
 */
export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const { prompt, businessId, postId, aspectRatio = '1:1' } = params
  const model = config.models.imageGen

  const aspectDesc: Record<string, string> = {
    '1:1': 'square format (1:1)',
    '16:9': 'wide landscape format (16:9)',
    '9:16': 'tall vertical portrait format (9:16, Instagram Stories)',
  }

  // 1. Call OpenRouter with image generation
  const apiKey = await getApiKey()
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://content.yurykukin.ru',
      'X-Title': 'Content Factory',
    },
    body: JSON.stringify({
      model,
      modalities: ['text', 'image'],
      messages: [
        {
          role: 'user',
          content: `Generate a high-quality image: ${prompt}\n\nTechnical requirements:\n- Aspect ratio: ${aspectDesc[aspectRatio] || aspectRatio}\n- Photorealistic, professional photography quality\n- Suitable for social media marketing\n- No text, watermarks, or logos in the image\n- Vibrant colors, good lighting, sharp focus`,
        },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter image generation error ${response.status}: ${err}`)
  }

  const data = await response.json() as any
  const usage = data.usage || {}

  // 2. Extract image from response
  // OpenRouter returns image as inline data URL or in content parts
  const content = data.choices?.[0]?.message?.content
  let imageBuffer: Buffer | null = null

  if (typeof content === 'string' && content.includes('data:image')) {
    // Extract base64 from data URL
    const match = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/)
    if (match) {
      imageBuffer = Buffer.from(match[1], 'base64')
    }
  }

  // Check content parts (array format)
  if (!imageBuffer && Array.isArray(data.choices?.[0]?.message?.content)) {
    for (const part of data.choices[0].message.content) {
      if (part.type === 'image_url' && part.image_url?.url) {
        const match = part.image_url.url.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/)
        if (match) {
          imageBuffer = Buffer.from(match[1], 'base64')
          break
        }
      }
    }
  }

  if (!imageBuffer) {
    // If no image generated, throw meaningful error
    throw new Error('AI не вернул изображение. Попробуйте другой промпт или модель.')
  }

  // 3. Save image to filesystem
  const fileId = nanoid(12)
  const filename = `ai_${fileId}.png`
  const thumbFilename = `ai_${fileId}_thumb.webp`

  const bizDir = join(UPLOAD_DIR, businessId)
  await mkdir(bizDir, { recursive: true })

  // Convert to PNG and save
  const pngBuffer = await sharp(imageBuffer).png().toBuffer()
  await Bun.write(join(bizDir, filename), pngBuffer)

  // Generate thumbnail
  await sharp(pngBuffer)
    .resize(200, 200, { fit: 'cover' })
    .webp({ quality: 80 })
    .toFile(join(bizDir, thumbFilename))

  // 4. Create MediaFile in DB
  const mediaFile = await db.mediaFile.create({
    data: {
      businessId,
      postId: postId || null,
      filename: `AI: ${prompt.slice(0, 50).replace(/[\r\n\t]/g, ' ')}`,
      url: `/uploads/${businessId}/${filename}`,
      thumbUrl: `/uploads/${businessId}/${thumbFilename}`,
      mimeType: 'image/png',
      sizeBytes: pngBuffer.length,
      altText: prompt,
    },
  })

  // 5. Log AI usage
  await db.aiUsageLog.create({
    data: {
      businessId,
      action: 'generate_image',
      model,
      tokensIn: usage.prompt_tokens || 0,
      tokensOut: usage.completion_tokens || 0,
      cachedTokens: 0,
      costUsd: calculateCost(model, usage.prompt_tokens || 0, usage.completion_tokens || 0),
    },
  })

  return {
    mediaFile: {
      id: mediaFile.id,
      url: mediaFile.url,
      thumbUrl: mediaFile.thumbUrl,
      filename: mediaFile.filename,
      mimeType: mediaFile.mimeType,
      sizeBytes: mediaFile.sizeBytes,
    },
    usage: {
      tokensIn: usage.prompt_tokens || 0,
      tokensOut: usage.completion_tokens || 0,
      model,
    },
  }
}
