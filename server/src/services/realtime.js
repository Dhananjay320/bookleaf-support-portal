import { EventEmitter } from 'node:events';

/**
 * In-process pub/sub for ticket changes, fanned out to browsers over SSE.
 *
 * Events only carry IDs (never ticket content). Clients refetch through the normal
 * REST endpoints, so all access control stays in one place and internal notes can't
 * leak through the event stream.
 *
 * Note: an in-memory bus works for a single instance. Scaling horizontally would
 * swap this for Redis pub/sub or Postgres LISTEN/NOTIFY behind the same interface.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

const CHANNEL = 'ticket-event';

/** @param {{ type: string, ticketId: number, authorId: string }} event */
export function publishTicketEvent(event) {
  bus.emit(CHANNEL, { ...event, at: new Date().toISOString() });
}

/** Returns an unsubscribe function. */
export function subscribeToTicketEvents(listener) {
  bus.on(CHANNEL, listener);
  return () => bus.off(CHANNEL, listener);
}
