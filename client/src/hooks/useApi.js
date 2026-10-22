import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data with `fetcher` whenever `deps` change.
 * `reload({ silent: true })` refetches without flashing a loading state, which is
 * used for live updates so the page doesn't flicker when an event arrives.
 */
export function useApi(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestId = useRef(0);

  const reload = useCallback(async ({ silent = false } = {}) => {
    const id = ++requestId.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      // ignore stale responses if a newer request has started
      if (id === requestId.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === requestId.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);

  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}
