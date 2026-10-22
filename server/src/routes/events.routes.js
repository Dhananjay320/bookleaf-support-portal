import { Router } from 'express';
import { subscribeToTicketEvents } from '../services/realtime.js';

const router = Router();
const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events stream of ticket changes.
 * Admins receive every event; authors only events for their own tickets.
 * SSE was chosen over WebSockets because traffic is one-way (server -> browser),
 * it works over plain HTTP through proxies, and EventSource reconnects automatically.
 */
router.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (nginx / Render)
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const { role, authorId } = req.user;
  const unsubscribe = subscribeToTicketEvents((event) => {
    if (role === 'author' && (event.authorId !== authorId || event.type === 'ticket.note')) return;
    res.write(`event: ticket\ndata: ${JSON.stringify({ type: event.type, ticketId: event.ticketId, at: event.at })}\n\n`);
  });

  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
