import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { useTicketEvents } from '../../hooks/useTicketEvents.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { MessageThread } from '../../components/MessageThread.jsx';
import { ErrorBanner, LiveIndicator, Loading, PriorityBadge, StatusBadge, sourceLabel } from '../../components/ui.jsx';
import { CATEGORIES, PRIORITIES, STATUSES, formatDate, formatDateTime, formatInr, formatNumber, timeAgo } from '../../utils/format.js';

// ---------------------------------------------------------------------------
// Reply composer with AI draft
// ---------------------------------------------------------------------------

function ReplyComposer({ ticket, onSent }) {
  const [text, setText] = useState('');
  const [fromDraft, setFromDraft] = useState(false);
  const [draft, setDraft] = useState(null);
  const [draftState, setDraftState] = useState('loading'); // loading | ready | error
  const [draftError, setDraftError] = useState(null);
  const [sendStatus, setSendStatus] = useState(ticket.status === 'Open' ? 'In Progress' : ticket.status);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const touched = useRef(false);

  async function loadDraft(regenerate = false) {
    setDraftState('loading');
    setDraftError(null);
    try {
      const res = await api(`/tickets/${ticket.id}/draft`, { method: regenerate ? 'POST' : 'GET' });
      setDraft(res.data);
      setDraftState('ready');
      // Pre-fill the composer unless the agent has already started typing.
      if (!touched.current || regenerate) {
        setText(res.data.body);
        setFromDraft(true);
        touched.current = false;
      }
    } catch (err) {
      setDraftError(err);
      setDraftState('error');
    }
  }

  // Generate (or fetch the cached) draft when the ticket is opened, and again when the conversation changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadDraft(); }, [ticket.id, ticket.messages.length]);

  async function send(e) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api(`/tickets/${ticket.id}/messages`, {
        method: 'POST',
        body: { body: text, status: sendStatus, aiAssisted: fromDraft },
      });
      setText('');
      setFromDraft(false);
      touched.current = false;
      onSent();
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="card composer" onSubmit={send}>
      <div className="row between">
        <h3>Reply to author</h3>
        <div className="row gap small">
          {draftState === 'loading' && <span className="muted"><span className="spinner" aria-hidden /> Drafting reply…</span>}
          {draftState === 'ready' && draft.source === 'ai' && (
            <span className="tag ai" title={`Model: ${draft.model}`}>✨ AI draft{draft.cached ? ' (saved)' : ''}</span>
          )}
          {draftState === 'ready' && draft.source === 'template' && (
            <span className="tag warn" title="AI was unavailable, so this is a policy template">Template (AI unavailable)</span>
          )}
          <button type="button" className="link" disabled={draftState === 'loading'} onClick={() => loadDraft(true)}>Regenerate</button>
          <button type="button" className="link" onClick={() => { setText(''); setFromDraft(false); touched.current = true; }}>Clear</button>
        </div>
      </div>
      {draftError && <div className="banner warn">Couldn't load a draft ({draftError.message}). You can write the reply manually.</div>}
      <textarea rows={11} value={text} placeholder="Write your reply…"
        onChange={(e) => { setText(e.target.value); touched.current = true; }} />
      {fromDraft && <p className="hint">Review the draft before sending: check every figure and replace any [Agent: …] notes.</p>}
      <ErrorBanner error={error} />
      <div className="actions">
        <label className="inline">
          Then set status
          <select value={sendStatus} onChange={(e) => setSendStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <button className="primary" disabled={sending || !text.trim() || /\[Agent:/.test(text)}
          title={/\[Agent:/.test(text) ? 'Replace the [Agent: …] notes first' : undefined}>
          {sending ? 'Sending…' : 'Send to author'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sidebar panels
// ---------------------------------------------------------------------------

function TriagePanel({ ticket, onPatch, onRetriage, busy }) {
  return (
    <section className="card panel">
      <h3>Triage</h3>
      {ticket.triageStatus === 'pending' && <p className="muted small"><span className="spinner" aria-hidden /> AI is classifying this ticket…</p>}
      <label>
        Category <span className="muted tiny">({sourceLabel(ticket.categorySource) ?? '—'})</span>
        <select value={ticket.category ?? ''} disabled={busy} onChange={(e) => onPatch({ category: e.target.value })}>
          {!ticket.category && <option value="">—</option>}
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label>
        Priority <span className="muted tiny">({sourceLabel(ticket.prioritySource) ?? '—'})</span>
        <select value={ticket.priority ?? ''} disabled={busy} onChange={(e) => onPatch({ priority: e.target.value })}>
          {!ticket.priority && <option value="">—</option>}
          {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      {ticket.aiReasoning && (
        <div className="ai-reasoning">
          <div className="tiny muted">
            {ticket.triageStatus === 'fallback' ? 'Rule-based triage' : 'AI reasoning'}
            {ticket.aiConfidence != null && ` · ${Math.round(ticket.aiConfidence * 100)}% confident`}
          </div>
          <p className="small">{ticket.aiReasoning}</p>
          {ticket.aiConfidence != null && ticket.aiConfidence < 0.6 && <p className="tiny warn">Low confidence: please verify the category.</p>}
        </div>
      )}
      {ticket.triageStatus === 'fallback' && (
        <button className="link small" disabled={busy} onClick={onRetriage}>Re-run AI triage</button>
      )}
    </section>
  );
}

function ManagePanel({ ticket, admins, me, onPatch, busy }) {
  return (
    <section className="card panel">
      <h3>Manage</h3>
      <label>
        Status
        <select value={ticket.status} disabled={busy} onChange={(e) => onPatch({ status: e.target.value })}>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <label>
        Assignee
        <select value={ticket.assignee?.id ?? ''} disabled={busy}
          onChange={(e) => onPatch({ assigneeId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Unassigned</option>
          {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      {ticket.assignee?.id !== me.id && (
        <button className="secondary" disabled={busy} onClick={() => onPatch({ assigneeId: me.id })}>Assign to me</button>
      )}
      <dl className="mini-facts">
        <div><dt>Opened</dt><dd>{formatDateTime(ticket.createdAt)} ({timeAgo(ticket.createdAt)})</dd></div>
        <div><dt>First response</dt><dd>{ticket.firstResponseAt ? formatDateTime(ticket.firstResponseAt) : <span className={ticket.sla.breached ? 'danger' : ''}>Not yet{ticket.sla.targetHours ? ` (target ${ticket.sla.targetHours}h)` : ''}</span>}</dd></div>
      </dl>
    </section>
  );
}

function BookPanel({ bookId }) {
  const book = useApi(() => (bookId ? api(`/books/${bookId}`) : Promise.resolve(null)), [bookId]);
  if (!bookId) return <section className="card panel"><h3>Book</h3><p className="muted small">General / account-level query.</p></section>;
  if (book.loading) return <section className="card panel"><Loading /></section>;
  if (book.error) return <section className="card panel"><ErrorBanner error={book.error} /></section>;
  const b = book.data.data;
  return (
    <section className="card panel">
      <h3>{b.title}</h3>
      <dl className="mini-facts">
        <div><dt>Status</dt><dd>{b.status}</dd></div>
        <div><dt>ISBN</dt><dd>{b.isbn}</dd></div>
        {b.isPublished && (
          <>
            <div><dt>Published</dt><dd>{formatDate(b.publicationDate)}</dd></div>
            <div><dt>Copies sold</dt><dd>{formatNumber(b.totalCopiesSold)}</dd></div>
            <div><dt>Royalty earned</dt><dd>{formatInr(b.totalRoyaltyEarned)}</dd></div>
            <div><dt>Paid / pending</dt><dd>{formatInr(b.royaltyPaid)} / {formatInr(b.royaltyPending)}</dd></div>
            <div><dt>Last payout</dt><dd>{b.lastRoyaltyPayoutDate ? formatDate(b.lastRoyaltyPayoutDate) : 'Never'}</dd></div>
            <div><dt>Print partner</dt><dd>{b.printPartner}</dd></div>
            <div><dt>Listed on</dt><dd>{b.availableOn.join(', ')}</dd></div>
          </>
        )}
      </dl>
    </section>
  );
}

function NotesPanel({ ticket, onAdded }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function add(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/tickets/${ticket.id}/notes`, { method: 'POST', body: { body } });
      setBody('');
      onAdded();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card panel notes">
      <h3>Internal notes <span className="tiny muted">(never shown to the author)</span></h3>
      {ticket.internalNotes.length === 0 && <p className="muted small">No notes yet.</p>}
      <ul>
        {ticket.internalNotes.map((n) => (
          <li key={n.id}>
            <div className="tiny muted">{n.authorName} · {formatDateTime(n.createdAt)}</div>
            <div className="small">{n.body}</div>
          </li>
        ))}
      </ul>
      <form onSubmit={add}>
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Asked finance to check the Q3 payout batch" />
        <ErrorBanner error={error} />
        <button className="secondary" disabled={saving || !body.trim()}>Add note</button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AdminTicketPage() {
  const { id } = useParams();
  const ticketId = Number(id);
  const { user } = useAuth();
  const ticket = useApi(() => api(`/tickets/${ticketId}`), [ticketId]);
  const admins = useApi(() => api('/admin/users'));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const connected = useTicketEvents((event) => {
    if (event.ticketId === ticketId) ticket.reload({ silent: true });
  });

  async function patch(body) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api(`/tickets/${ticketId}`, { method: 'PATCH', body });
      ticket.setData(res);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function retriage() {
    setBusy(true);
    try {
      ticket.setData(await api(`/tickets/${ticketId}/triage`, { method: 'POST' }));
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  if (ticket.loading && !ticket.data) return <Loading />;
  if (ticket.error) return <ErrorBanner error={ticket.error} onRetry={ticket.reload} />;
  const t = ticket.data.data;

  return (
    <>
      <div className="page-head row">
        <div>
          <Link to="/admin/tickets" className="link small">← Back to queue</Link>
          <h1>{t.subject}</h1>
          <div className="muted small">
            #{t.id} · {t.author.name} ({t.author.id}) · {t.book?.title ?? 'General / Account'}
            {t.attachmentName && <> · 📎 {t.attachmentName}</>}
          </div>
        </div>
        <div className="row gap">
          <LiveIndicator connected={connected} />
          <PriorityBadge priority={t.priority} source={t.prioritySource} />
          <StatusBadge status={t.status} />
        </div>
      </div>
      <ErrorBanner error={actionError} />

      <div className="ticket-layout">
        <div className="main-col">
          <section className="card">
            <h3>Conversation</h3>
            <MessageThread ticket={t} viewer="admin" />
          </section>
          <ReplyComposer ticket={t} onSent={() => ticket.reload({ silent: true })} />
        </div>
        <aside className="side-col">
          <TriagePanel ticket={t} onPatch={patch} onRetriage={retriage} busy={busy} />
          <ManagePanel ticket={t} admins={admins.data?.data ?? []} me={user} onPatch={patch} busy={busy} />
          <BookPanel bookId={t.book?.id} />
          <NotesPanel ticket={t} onAdded={() => ticket.reload({ silent: true })} />
        </aside>
      </div>
    </>
  );
}
