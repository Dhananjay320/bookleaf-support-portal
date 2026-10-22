// Small presentational building blocks shared by both portals.

const slug = (s) => s?.toLowerCase().replace(/[^a-z]+/g, '-');

export function StatusBadge({ status }) {
  return <span className={`badge status-${slug(status)}`}>{status}</span>;
}

export function PriorityBadge({ priority, source }) {
  if (!priority) return <span className="badge muted">Triaging…</span>;
  return (
    <span className={`badge priority-${slug(priority)}`} title={source ? `Set by: ${sourceLabel(source)}` : undefined}>
      {priority}
    </span>
  );
}

export function CategoryTag({ category }) {
  if (!category) return <span className="tag muted">Classifying…</span>;
  return <span className="tag">{category}</span>;
}

export function sourceLabel(source) {
  return { ai: 'AI', rules: 'Keyword rules (AI unavailable)', admin: 'Admin override', seed: 'Pre-set' }[source] ?? source;
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden /> {label}</div>;
}

export function ErrorBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="banner error" role="alert">
      {error.message}
      {onRetry && <button className="link" onClick={() => onRetry()}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function LiveIndicator({ connected }) {
  return (
    <span className={`live ${connected ? 'on' : 'off'}`} title={connected ? 'Updates appear automatically' : 'Reconnecting…'}>
      <span className="dot" aria-hidden /> {connected ? 'Live' : 'Reconnecting'}
    </span>
  );
}
