import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useTicketEvents } from '../../hooks/useTicketEvents.js';
import {
  CategoryTag, EmptyState, ErrorBanner, LiveIndicator, Loading, PriorityBadge, StatusBadge, sourceLabel,
} from '../../components/ui.jsx';
import { CATEGORIES, PRIORITIES, STATUSES, timeAgo } from '../../utils/format.js';

// Status presets: ops mostly care about what still needs work.
const STATUS_PRESETS = {
  unresolved: 'Open,In Progress',
  all: '',
  ...Object.fromEntries(STATUSES.map((s) => [s, s])),
};

function QueueStats({ stats }) {
  if (!stats) return null;
  const items = [
    { label: 'Open tickets', value: stats.openCount },
    { label: 'Critical', value: stats.criticalOpen, alert: stats.criticalOpen > 0 },
    { label: 'Past response target', value: stats.slaBreached, alert: stats.slaBreached > 0 },
    { label: 'Awaiting our reply', value: stats.awaitingReply },
    { label: 'Unassigned', value: stats.unassignedOpen },
  ];
  return (
    <section className="stats">
      {items.map((i) => (
        <div key={i.label} className={`stat ${i.alert ? 'alert' : ''}`}>
          <div className="stat-value">{i.value}</div>
          <div className="stat-label">{i.label}</div>
        </div>
      ))}
    </section>
  );
}

function AiStatusBanner({ status }) {
  if (!status || status.state === 'ok') return null;
  return <div className="banner warn">⚠ {status.message} Tickets are still created; please double-check categories and write replies manually where needed.</div>;
}

export function TicketQueuePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = {
    status: params.get('status') ?? 'unresolved',
    category: params.get('category') ?? '',
    priority: params.get('priority') ?? '',
    assignee: params.get('assignee') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    q: params.get('q') ?? '',
    sort: params.get('sort') ?? 'urgency',
  };
  const [search, setSearch] = useState(filters.q);
  const [freshIds, setFreshIds] = useState(new Set());

  const queryKey = params.toString();
  const tickets = useApi(
    () => api('/tickets', { query: { ...filters, status: STATUS_PRESETS[filters.status] ?? filters.status } }),
    [queryKey],
  );
  const stats = useApi(() => api('/admin/stats'));

  const connected = useTicketEvents((event) => {
    tickets.reload({ silent: true });
    stats.reload({ silent: true });
    if (event.type === 'ticket.created') setFreshIds((s) => new Set(s).add(event.ticketId));
  });

  function setFilter(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const hasFilters = ['category', 'priority', 'assignee', 'from', 'to', 'q'].some((k) => filters[k]) || filters.status !== 'unresolved';

  return (
    <>
      <div className="page-head row">
        <h1>Ticket Queue</h1>
        <LiveIndicator connected={connected} />
      </div>

      <AiStatusBanner status={stats.data?.data.aiStatus} />
      <QueueStats stats={stats.data?.data} />

      <div className="filters card">
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
          <option value="unresolved">Unresolved</option>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)} aria-label="Priority">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={filters.category} onChange={(e) => setFilter('category', e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={filters.assignee} onChange={(e) => setFilter('assignee', e.target.value)} aria-label="Assignee">
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </select>
        <label className="inline">From <input type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} /></label>
        <label className="inline">To <input type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} /></label>
        <form onSubmit={(e) => { e.preventDefault(); setFilter('q', search.trim()); }}>
          <input type="search" placeholder="Search subject, author, book…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </form>
        <select value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)} aria-label="Sort">
          <option value="urgency">Most urgent first</option>
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
          <option value="updated">Recently updated</option>
        </select>
        {hasFilters && <button className="link" onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Reset</button>}
      </div>

      {tickets.error && <ErrorBanner error={tickets.error} onRetry={tickets.reload} />}
      {tickets.loading && !tickets.data ? (
        <Loading />
      ) : tickets.data?.data.length === 0 ? (
        <EmptyState title={hasFilters ? 'No tickets match these filters' : 'Inbox zero 🎉'}>
          {hasFilters ? 'Try widening the filters.' : 'No unresolved tickets right now.'}
        </EmptyState>
      ) : (
        <div className="card table-wrap">
          <table className="queue">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Ticket</th>
                <th>Category</th>
                <th>Status</th>
                <th>Age</th>
                <th>Assignee</th>
              </tr>
            </thead>
            <tbody>
              {tickets.data?.data.map((t) => (
                <tr key={t.id} onClick={() => navigate(`/admin/tickets/${t.id}`)}
                  className={`${t.sla.breached ? 'breached' : ''} ${freshIds.has(t.id) ? 'fresh' : ''}`}>
                  <td><PriorityBadge priority={t.priority} source={t.prioritySource} /></td>
                  <td>
                    <div className="row gap">
                      <strong>{t.subject}</strong>
                      {t.awaitingReply && <span className="tag small warn">Needs reply</span>}
                    </div>
                    <div className="muted small">#{t.id} · {t.author.name} · {t.book?.title ?? 'General / Account'}</div>
                  </td>
                  <td>
                    <CategoryTag category={t.category} />
                    {t.categorySource && t.categorySource !== 'seed' && (
                      <div className="muted tiny">{sourceLabel(t.categorySource)}</div>
                    )}
                  </td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>
                    <span title={new Date(t.createdAt).toLocaleString()}>{timeAgo(t.createdAt)}</span>
                    {t.sla.breached && <div className="tiny danger">over {t.sla.targetHours}h target</div>}
                  </td>
                  <td>{t.assignee?.name.split(' (')[0] ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
