import { config } from '../config'

type LogLevel = 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  [key: string]: unknown
}

function formatLog(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  }

  if (config.isProd || config.NODE_ENV === 'test') {
    return JSON.stringify(entry)
  }

  // Pretty format for development
  const prefix = { info: '\x1b[36mINFO\x1b[0m', warn: '\x1b[33mWARN\x1b[0m', error: '\x1b[31mERROR\x1b[0m' }[level]
  const ctx = context ? ` ${JSON.stringify(context)}` : ''
  return `${prefix} ${message}${ctx}`
}

export const log = {
  info(message: string, context?: Record<string, unknown>) {
    console.log(formatLog('info', message, context))
  },
  warn(message: string, context?: Record<string, unknown>) {
    console.warn(formatLog('warn', message, context))
  },
  error(message: string, context?: Record<string, unknown>) {
    console.error(formatLog('error', message, context))
  },
}
