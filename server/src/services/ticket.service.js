import { getDb, transaction } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { OPEN_STATUSES, PRIORITY_RANK, RESPONSE_TARGET_HOURS } from '../domain.js';
import { publishTicketEvent } from './realtime.js';
import { getBook } from './book.service.js';
import { classifyTicket } from '../ai/classifier.js';
import { draftReply } from '../ai/drafter.js';
import { templateReply } from '../ai/fallbacks.js';
import { AiUnavailableError } from '../ai/llmClient.js';

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function toTicketDto(row, { forAdmin }) {
  const ageHours = (Date.now() - Date.parse(row.created_at)) / 3_600_000;
  const target = row.priority ? RESPONSE_TARGET_HOURS[row.priority] : null;
  const awaitingFirstResponse = !row.first_response_at && OPEN_STATUSES.includes(row.status);

  const dto = {
    id: row.id,
    subject: row.subject,
    description: row.description,
    attachmentName: row.attachment_name,
    status: row.status,
    category: row.category,
    book: row.book_id ? { id: row.book_id, title: row.book_title } : null,
    author: { id: row.author_id, name: row.author_name },
    messageCount: row.message_count ?? 0,
    lastMessageAt: row.last_message_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
  if (!forAdmin) return dto;

  return {
    ...dto,
    categorySource: row.category_source,
    priority: row.priority,
    prioritySource: row.priority_source,
    triageStatus: row.triage_status,
    aiConfidence: row.ai_confidence,
    aiReasoning: row.ai_reasoning,
    assignee: row.assigned_to ? { id: row.assigned_to, name: row.assignee_name } : null,
    firstResponseAt: row.first_response_at,
    awaitingReply: OPEN_STATUSES.includes(row.status) && row.last_sender_role !== 'admin',
    sla: {
      targetHours: target,
      ageHours: Math.round(ageHours * 10) / 10,
      breached: Boolean(awaitingFirstResponse && target && ageHours > target),
    },
  };
}

const toMessageDto = (m) => ({
  id: m.id,
  senderRole: m.sender_role,
  senderName: m.sender_name,
  body: m.body,
  aiAssisted: Boolean(m.ai_assisted),
  createdAt: m.created_at,
});

const TICKET_SELECT = `
  SELECT t.*,
         a.name  AS author_name,
         b.title AS book_title,
         u.name  AS assignee_name,
         (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS message_count,
         (SELECT MAX(created_at) FROM ticket_messages m WHERE m.ticket_id = t.id) AS last_message_at,
         (SELECT sender_role FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_sender_role
  FROM tickets t
  JOIN authors a ON a.id = t.author_id
  LEFT JOIN books b ON b.id = t.book_id
  LEFT JOIN users u ON u.id = t.assigned_to`;

const URGENCY_ORDER = `
  CASE WHEN t.status IN ('Open', 'In Progress') THEN 0 ELSE 1 END,
  CASE t.priority ${Object.entries(PRIORITY_RANK).map(([p, r]) => `WHEN '${p}' THEN ${r}`).join(' ')} ELSE 0 END DESC,
  t.created_at ASC`;

const SORTS = {
  urgency: URGENCY_ORDER,
  newest: 't.created_at DESC',
  oldest: 't.created_at ASC',
  updated: 't.updated_at DESC',
};

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

function loadTicketRow(ticketId) {
  return getDb().prepare(`${TICKET_SELECT} WHERE t.id = ?`).get(ticketId);
}

/** Loads a ticket the user may access. Authors get 404 for other authors' tickets. */
function loadAccessibleTicket(user, ticketId) {
  const row = loadTicketRow(ticketId);
  if (!row || (user.role === 'author' && row.author_id !== user.authorId)) {
    throw ApiError.notFound('Ticket');
  }
  return row;
}

function loadMessages(ticketId) {
  return getDb()
    .prepare(`SELECT m.*, u.name AS sender_name FROM ticket_messages m JOIN users u ON u.id = m.sender_id
              WHERE m.ticket_id = ? ORDER BY m.created_at, m.id`)
    .all(ticketId)
    .map(toMessageDto);
}

function emit(type, row) {
  publishTicketEvent({ type, ticketId: row.id, authorId: row.author_id });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function listTickets(user, filters = {}) {
  const where = [];
  const params = {};

  if (user.role === 'author') {
    where.push('t.author_id = :authorId');
    params.authorId = user.authorId;
  }
  if (filters.status?.length) {
    where.push(`t.status IN (${filters.status.map((_, i) => `:status${i}`).join(', ')})`);
    filters.status.forEach((s, i) => { params[`status${i}`] = s; });
  }
  if (filters.category) { where.push('t.category = :category'); params.category = filters.category; }
  if (filters.priority) { where.push('t.priority = :priority'); params.priority = filters.priority; }
  if (filters.from) { where.push('t.created_at >= :from'); params.from = filters.from; }
  if (filters.to) { where.push('t.created_at < :to'); params.to = filters.to; }
  if (filters.assignee === 'unassigned') where.push('t.assigned_to IS NULL');
  else if (filters.assignee === 'me') { where.push('t.assigned_to = :me'); params.me = user.id; }
  if (filters.q) {
    where.push('(t.subject LIKE :q OR t.description LIKE :q OR a.name LIKE :q OR b.title LIKE :q)');
    params.q = `%${filters.q}%`;
  }

  const sql = `${TICKET_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY ${SORTS[filters.sort] ?? SORTS.urgency}`;
  const forAdmin = user.role === 'admin';
  return getDb().prepare(sql).all(params).map((row) => toTicketDto(row, { forAdmin }));
}

export function getTicket(user, ticketId) {
  const row = loadAccessibleTicket(user, ticketId);
  const forAdmin = user.role === 'admin';
  const ticket = { ...toTicketDto(row, { forAdmin }), messages: loadMessages(ticketId) };
  if (!forAdmin) return ticket;

  const notes = getDb()
    .prepare(`SELECT n.id, n.body, n.created_at AS createdAt, u.name AS authorName
              FROM internal_notes n JOIN users u ON u.id = n.author_id
              WHERE n.ticket_id = ? ORDER BY n.created_at, n.id`)
    .all(ticketId);
  return { ...ticket, internalNotes: notes };
}

/** Queue health numbers for the admin dashboard header. */
export function getQueueStats() {
  const db = getDb();
  const open = listTickets({ role: 'admin' }, { status: OPEN_STATUSES });
  const byStatus = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS n FROM tickets GROUP BY status').all().map((r) => [r.status, r.n]),
  );
  const ai = db.prepare(`
    SELECT purpose, COUNT(*) AS calls, SUM(success) AS ok,
           COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
           CAST(AVG(CASE WHEN success = 1 THEN latency_ms END) AS INTEGER) AS avgLatencyMs
    FROM ai_calls GROUP BY purpose`).all();

  return {
    byStatus,
    openCount: open.length,
    unassignedOpen: open.filter((t) => !t.assignee).length,
    criticalOpen: open.filter((t) => t.priority === 'Critical').length,
    slaBreached: open.filter((t) => t.sla.breached).length,
    awaitingReply: open.filter((t) => t.awaitingReply).length,
    ai,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function createTicket(user, { bookId, subject, description, attachmentName }) {
  if (bookId) getBook(user, bookId); // throws 404 if the book isn't this author's

  const { lastInsertRowid } = getDb()
    .prepare(`INSERT INTO tickets (author_id, book_id, subject, description, attachment_name)
              VALUES (?, ?, ?, ?, ?)`)
    .run(user.authorId, bookId ?? null, subject, description, attachmentName ?? null);

  const ticketId = Number(lastInsertRowid);
  const row = loadTicketRow(ticketId);
  emit('ticket.created', row);

  // Triage runs in the background: the author gets an instant response and the
  // ticket exists even if the AI provider is slow or down.
  setImmediate(() => {
    triageTicket(ticketId).catch((err) => console.error(`[triage] ticket ${ticketId} failed`, err));
  });

  return toTicketDto(row, { forAdmin: false });
}

/**
 * Classifies a ticket (AI first, keyword rules as fallback) and stores the result.
 * Admin overrides are never clobbered: only fields still owned by ai/rules/seed are updated.
 */
// Transient failures worth retrying: free-tier rate limits and short outages.
const RETRYABLE_TRIAGE_FAILURES = new Set(['rate_limited', 'degraded', 'timeout', 'connection_error']);
const TRIAGE_RETRY_DELAY_MS = 65_000; // free-tier quotas reset per minute
const MAX_TRIAGE_RETRIES = 2;

export async function triageTicket(ticketId, attempt = 0) {
  const row = loadTicketRow(ticketId);
  if (!row) return;
  const book = row.book_id ? getBook({ role: 'admin' }, row.book_id) : null;

  const result = await classifyTicket({ ticketId, subject: row.subject, description: row.description, book });

  // Store the rule-based result now so the queue is usable immediately, and try AI again later.
  if (result.source === 'rules' && RETRYABLE_TRIAGE_FAILURES.has(result.fallbackReason) && attempt < MAX_TRIAGE_RETRIES) {
    setTimeout(() => {
      triageTicket(ticketId, attempt + 1).catch((err) => console.error(`[triage] retry for ticket ${ticketId} failed`, err));
    }, TRIAGE_RETRY_DELAY_MS).unref();
  }

  getDb()
    .prepare(`UPDATE tickets SET
                category        = CASE WHEN category_source = 'admin' THEN category ELSE :category END,
                category_source = CASE WHEN category_source = 'admin' THEN category_source ELSE :source END,
                priority        = CASE WHEN priority_source = 'admin' THEN priority ELSE :priority END,
                priority_source = CASE WHEN priority_source = 'admin' THEN priority_source ELSE :source END,
                ai_confidence   = :confidence,
                ai_reasoning    = :reasoning,
                triage_status   = :triageStatus
              WHERE id = :id`)
    .run({
      id: ticketId,
      category: result.category,
      priority: result.priority,
      source: result.source,
      confidence: result.confidence ?? null,
      reasoning: result.reasoning,
      triageStatus: result.source === 'ai' ? 'done' : 'fallback',
    });

  emit('ticket.triaged', row);
}

export function updateTicket(admin, ticketId, patch) {
  const row = loadAccessibleTicket(admin, ticketId);
  const sets = ['updated_at = :now'];
  const params = { id: ticketId, now: now() };

  if (patch.status && patch.status !== row.status) {
    sets.push('status = :status');
    params.status = patch.status;
    const closing = patch.status === 'Resolved' || patch.status === 'Closed';
    sets.push(closing ? 'resolved_at = COALESCE(resolved_at, :now)' : 'resolved_at = NULL');
  }
  if (patch.category) {
    sets.push("category = :category, category_source = 'admin'");
    params.category = patch.category;
  }
  if (patch.priority) {
    sets.push("priority = :priority, priority_source = 'admin'");
    params.priority = patch.priority;
  }
  if (patch.assigneeId !== undefined) {
    if (patch.assigneeId !== null) {
      const assignee = getDb().prepare("SELECT id FROM users WHERE id = ? AND role = 'admin'").get(patch.assigneeId);
      if (!assignee) throw ApiError.badRequest('assigneeId must refer to an admin user.');
    }
    sets.push('assigned_to = :assigneeId');
    params.assigneeId = patch.assigneeId;
  }

  getDb().prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = :id`).run(params);
  emit('ticket.updated', row);
  return getTicket(admin, ticketId);
}

/**
 * Adds an author-visible message.
 * - Admin reply: records first response, auto-assigns an unassigned ticket to the responder,
 *   and moves Open -> In Progress unless an explicit status is given.
 * - Author follow-up: reopens a Resolved ticket; Closed tickets are final.
 */
export function addMessage(user, ticketId, { body, status, aiAssisted }) {
  const row = loadAccessibleTicket(user, ticketId);
  const isAdmin = user.role === 'admin';

  if (!isAdmin && row.status === 'Closed') {
    throw ApiError.conflict('This ticket is closed. Please raise a new ticket for further help.');
  }

  transaction((db) => {
    const ts = now();
    db.prepare(`INSERT INTO ticket_messages (ticket_id, sender_role, sender_id, body, ai_assisted, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(ticketId, user.role, user.id, body, isAdmin && aiAssisted ? 1 : 0, ts);

    let nextStatus = row.status;
    if (isAdmin) {
      nextStatus = status ?? (row.status === 'Open' ? 'In Progress' : row.status);
    } else if (row.status === 'Resolved') {
      nextStatus = 'Open';
    }
    const closing = nextStatus === 'Resolved' || nextStatus === 'Closed';

    db.prepare(`UPDATE tickets SET
                  status = :status,
                  updated_at = :ts,
                  resolved_at = ${closing ? 'COALESCE(resolved_at, :ts)' : 'NULL'},
                  first_response_at = CASE WHEN :isAdmin = 1 THEN COALESCE(first_response_at, :ts) ELSE first_response_at END,
                  assigned_to = CASE WHEN :isAdmin = 1 THEN COALESCE(assigned_to, :userId) ELSE assigned_to END
                WHERE id = :id`)
      .run({ status: nextStatus, ts, isAdmin: isAdmin ? 1 : 0, userId: user.id, id: ticketId });
  });

  emit('ticket.message', row);
  return getTicket(user, ticketId);
}

export function addInternalNote(admin, ticketId, { body }) {
  const row = loadAccessibleTicket(admin, ticketId);
  getDb().prepare('INSERT INTO internal_notes (ticket_id, author_id, body) VALUES (?, ?, ?)').run(ticketId, admin.id, body);
  // Notes are admin-only, so only admins act on this event (clients refetch through RBAC anyway).
  emit('ticket.note', row);
  return getTicket(admin, ticketId);
}

/**
 * Returns the reply draft for a ticket.
 *
 * Drafts are cached per ticket and keyed on the conversation length: re-opening a
 * ticket reuses the stored draft (zero tokens); a new message, or an explicit
 * `regenerate`, produces a fresh one. If AI is unavailable we return a policy-based
 * template so the agent still has a starting point.
 */
const draftsInFlight = new Map();

export function getDraft(admin, ticketId, options = {}) {
  // Two agents opening the same ticket at once share one generation instead of paying twice.
  const key = `${ticketId}:${Boolean(options.regenerate)}`;
  if (!draftsInFlight.has(key)) {
    draftsInFlight.set(key, generateDraft(admin, ticketId, options).finally(() => draftsInFlight.delete(key)));
  }
  return draftsInFlight.get(key);
}

async function generateDraft(admin, ticketId, { regenerate = false }) {
  const row = loadAccessibleTicket(admin, ticketId);
  const db = getDb();
  const messages = loadMessages(ticketId);

  const cached = db.prepare('SELECT * FROM ai_drafts WHERE ticket_id = ?').get(ticketId);
  if (cached && !regenerate && cached.message_count === messages.length && cached.source === 'ai') {
    return { body: cached.body, source: cached.source, model: cached.model, cached: true, createdAt: cached.created_at };
  }

  const ticket = toTicketDto(row, { forAdmin: true });
  const author = db.prepare('SELECT name, city, joined_date AS joinedDate FROM authors WHERE id = ?').get(row.author_id);
  const book = row.book_id ? getBook(admin, row.book_id) : null;

  let draft;
  try {
    draft = { ...(await draftReply({ ticket, author, book, messages })), source: 'ai' };
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    draft = { body: templateReply({ ticket, author, book }), source: 'template', model: null, reason: err.message };
  }

  const createdAt = now();
  db.prepare(`INSERT INTO ai_drafts (ticket_id, body, source, model, message_count, created_at)
              VALUES (:ticketId, :body, :source, :model, :count, :createdAt)
              ON CONFLICT(ticket_id) DO UPDATE SET body = excluded.body, source = excluded.source,
                model = excluded.model, message_count = excluded.message_count, created_at = excluded.created_at`)
    .run({ ticketId, body: draft.body, source: draft.source, model: draft.model ?? null, count: messages.length, createdAt });

  return { ...draft, cached: false, createdAt };
}
