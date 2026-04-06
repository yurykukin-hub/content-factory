import { Hono } from 'hono'
import { eventBus, ContentEvent } from '../eventBus'

const sse = new Hono()

// GET /api/sse — Server-Sent Events
sse.get('/', async (c) => {
  const tabId = c.req.query('tabId') || ''

  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        const send = (data: string) => {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        }

        // Heartbeat
        const heartbeat = setInterval(() => send('ping'), 30_000)

        // Event listener
        const onEvent = (event: ContentEvent) => {
          if (event.tabId === tabId) return // skip own events
          send(JSON.stringify(event))
        }
        eventBus.on('change', onEvent)

        // Cleanup
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
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    }
  )
})

export { sse }
