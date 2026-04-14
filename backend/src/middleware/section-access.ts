/**
 * Middleware для проверки доступа к разделу.
 * Использует resolveAccess из shared/section-access.ts.
 */

import type { Context, Next } from 'hono'
import type { AuthUser } from './auth'
import { resolveAccess, type Section } from '../shared/section-access'

/**
 * Проверяет доступ пользователя к разделу.
 * @param section — ключ раздела (posts, plans, scenarios и т.д.)
 * @param level — минимальный уровень: 'view' (видеть) или 'full' (редактировать)
 *
 * Использование:
 *   app.use('/api/scenarios/*', requireSection('scenarios'))          // любой доступ
 *   app.post('/api/scenarios', requireSection('scenarios', 'full'))   // только full
 */
export function requireSection(section: Section, level: 'view' | 'full' = 'view') {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser
    const access = resolveAccess(user.role, section, user.sectionAccess)

    if (level === 'view' && access === 'none') {
      return c.json({ error: 'FORBIDDEN' }, 403)
    }
    if (level === 'full' && access !== 'full') {
      return c.json({ error: 'FORBIDDEN' }, 403)
    }

    await next()
  }
}
