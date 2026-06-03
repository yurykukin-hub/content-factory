import { Hono } from 'hono'
import { eventBus, ContentEvent } from '../eventBus'

const sse = new Hono()

// GET /api/sse — Server-Sent Events
// Uses raw Response with ReadableStream for proper long-lived connection.
// X-Accel-Buffering: no tells Caddy/nginx to disable response buffering.
sse.get('/', async (c) => {
  const tabId = c.req.query('tabId') || ''

  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const send = (data: string) => {
          try { controller.enqueue(encoder.encode(`data: ${data}\n\n`)) } catch {}
        }

        // Heartbeat every 15s (shorter to keep HTTP/2 alive)
        const heartbeat = setInterval(() => send('ping'), 15_000)

        // Event listener
        const onEvent = (event: ContentEvent) => {
          if (event.tabId === tabId) return
          send(JSON.stringify(event))
        }
        eventBus.on('change', onEvent)

        // Cleanup on client disconnect
        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(heartbeat)
          eventBus.off('change', onEvent)
        })

        send('connected')
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    }
  )
})

export { sse }
