import { dirname } from 'path'
import { fileURLToPath } from 'url'

/**
 * Get directory of the calling module.
 * Works in both Bun (import.meta.dir) and Node/Vitest (import.meta.url).
 *
 * Usage: getModuleDir(import.meta)
 */
export function getModuleDir(meta: { dir?: string; url: string }): string {
  return meta.dir ?? dirname(fileURLToPath(meta.url))
}
