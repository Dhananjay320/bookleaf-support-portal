import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useTicketEvents } from '../../hooks/useTicketEvents.js';
import { MessageThread } from '../../components/MessageThread.jsx';
import { CategoryTag, EmptyState, ErrorBanner, LiveIndicator, Loading, StatusBadge } from '../../components/ui.jsx';
import { formatDateTime, timeAgo } from '../../utils/format.js';

const STATUS_HELP = {
  Open: "We've received your ticket and it's in our queue.",
  'In Progress': 'Our team is working on this.',
  Resolved: 'We believe this is sorted. Reply below if it isn\'t and we\'ll reopen it.',
  Closed: 'This ticket is closed. Please raise a new ticket if you need more help.',
};

function TicketDetail({ ticketId, justCreated, onChanged, detail }) {
  const { data, error, loading, reload, setData } = detail;
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;
  if (!data) return null;
  const ticket = data.data;

  async function sendReply(e) {
    e.preventDefault();
    setSending(true);
    setSendError(null);
    try {
      const res = await api(`/tickets/${ticketId}/messages`, { method: 'POST', body: { body: reply } });
      setData(res);
      setReply('');
      onChanged();
    } catch (err) {
      setSendError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card detail">
      {justCreated && (
        <div className="banner success">Thanks, your ticket has been submitted. You'll see our reply here as soon as it's sent; no need to refresh.</div>
      )}
      <header className="detail-head">
        <div>
          <h2>{ticket.subject}</h2>
          <div className="muted small">
            #{ticket.id} · {ticket.book ? ticket.book.title : 'General / Account'} · opened {formatDateTime(ticket.createdAt)}
          </div>
        </div>
        <StatusBadge status={ticket.status} />
      </header>
      <p className="status-help">{STATUS_HELP[ticket.status]}</p>
      {ticket.attachmentName && <p className="muted small">📎 {ticket.attachmentName}</p>}

      <MessageThread ticket={ticket} viewer="author" />
      {ticket.messages.length === 0 && (
        <p className="muted small">No reply yet. Our team will respond here.</p>
      )}

      {ticket.status !== 'Closed' && (
        <form className="reply" onSubmit={sendReply}>
          <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add more details or reply to our team…" />
          <ErrorBanner error={sendError} />
          <div className="actions">
            <button className="primary" disabled={sending || !reply.trim()}>{sending ? 'Sending…' : 'Send reply'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function MyTicketsPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const selectedId = id ? Number(id) : null;

  const list = useApi(() => api('/tickets', { query: { sort: 'updated' } }));
  const detail = useApi(() => (selectedId ? api(`/tickets/${selectedId}`) : Promise.resolve(null)), [selectedId]);
  const [updatedIds, setUpdatedIds] = useState(new Set());

  // Live updates: refetch silently when one of our tickets changes.
  const connected = useTicketEvents((event) => {
    list.reload({ silent: true });
    if (event.ticketId === selectedId) detail.reload({ silent: true });
    else setUpdatedIds((s) => new Set(s).add(event.ticketId));
  });

  const select = (ticketId) => {
    setUpdatedIds((s) => { const next = new Set(s); next.delete(ticketId); return next; });
    navigate(`/tickets/${ticketId}`);
  };

  if (list.loading && !list.data) return <Loading />;
  if (list.error) return <ErrorBanner error={list.error} onRetry={list.reload} />;
  const tickets = list.data.data;

  return (
    <>
      <div className="page-head row">
        <h1>My Tickets</h1>
        <div className="row gap">
          <LiveIndicator connected={connected} />
          <Link to="/tickets/new" className="button primary">New ticket</Link>
        </div>
      </div>

      {tickets.length === 0 ? (
        <EmptyState title="No tickets yet">
          Questions about royalties, your book's status, ISBNs or print quality? <Link to="/tickets/new">Raise a ticket</Link> and our team will get back to you.
        </EmptyState>
      ) : (
        <div className="split">
          <ul className="ticket-list">
            {tickets.map((t) => (
              <li key={t.id}>
                <button className={`ticket-item ${t.id === selectedId ? 'active' : ''}`} onClick={() => select(t.id)}>
                  <div className="row between">
                    <strong>{t.subject}</strong>
                    {updatedIds.has(t.id) && <span className="dot new" title="New update" />}
                  </div>
                  <div className="row between small">
                    <span className="muted">{t.book?.title ?? 'General / Account'}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="row between small muted">
                    <CategoryTag category={t.category} />
                    <span>updated {timeAgo(t.updatedAt)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <section>
            {selectedId ? (
              <TicketDetail key={selectedId} ticketId={selectedId} detail={detail}
                justCreated={location.state?.justCreated} onChanged={() => list.reload({ silent: true })} />
            ) : (
              <EmptyState title="Select a ticket">Pick a ticket on the left to see the conversation.</EmptyState>
            )}
          </section>
        </div>
      )}
    </>
  );
}
