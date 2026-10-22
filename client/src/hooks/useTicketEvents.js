import { useEffect, useRef, useState } from 'react';

/**
 * Subscribes to the server's ticket event stream (SSE).
 * The server already filters events per user, and events only contain IDs:
 * handlers refetch through the REST API.
 *
 * Returns the connection state so the UI can show a "live" indicator.
 */
export function useTicketEvents(onEvent) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/v1/events');
    source.onopen = () => setConnected(true);
    // EventSource reconnects on its own; we only reflect the state.
    source.onerror = () => setConnected(false);
    source.addEventListener('ticket', (e) => {
      try {
        handlerRef.current(JSON.parse(e.data));
      } catch {
        /* ignore malformed events */
      }
    });
    return () => source.close();
  }, []);

  return connected;
}
