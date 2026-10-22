-- BookLeaf Author Support Portal schema (SQLite).
-- Enumerations are enforced with CHECK constraints so bad data can't slip in via any code path.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS authors (
  id           TEXT PRIMARY KEY,               -- e.g. AUTH001 (from the sample dataset)
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  phone        TEXT,
  city         TEXT,
  joined_date  TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('author', 'admin')),
  author_id      TEXT REFERENCES authors(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- an author login must map to an author profile; an admin must not
  CHECK ((role = 'author' AND author_id IS NOT NULL) OR (role = 'admin' AND author_id IS NULL))
);

CREATE TABLE IF NOT EXISTS books (
  id                        TEXT PRIMARY KEY,  -- e.g. BK001
  author_id                 TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  title                     TEXT NOT NULL,
  isbn                      TEXT,
  genre                     TEXT,
  publication_date          TEXT,              -- NULL while in production
  status                    TEXT NOT NULL,
  mrp                       REAL,              -- NULL while in production
  author_royalty_per_copy   REAL,
  total_copies_sold         INTEGER NOT NULL DEFAULT 0,
  total_royalty_earned      REAL NOT NULL DEFAULT 0,
  royalty_paid              REAL NOT NULL DEFAULT 0,
  royalty_pending           REAL NOT NULL DEFAULT 0,
  last_royalty_payout_date  TEXT,
  print_partner             TEXT,
  available_on              TEXT NOT NULL DEFAULT '[]'  -- JSON array of platforms
);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_id);

CREATE TABLE IF NOT EXISTS tickets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id         TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  book_id           TEXT REFERENCES books(id) ON DELETE SET NULL,  -- NULL = General / Account level
  subject           TEXT NOT NULL,
  description       TEXT NOT NULL,
  attachment_name   TEXT,
  status            TEXT NOT NULL DEFAULT 'Open'
                    CHECK (status IN ('Open', 'In Progress', 'Resolved', 'Closed')),

  category          TEXT CHECK (category IN (
                      'Royalty & Payments', 'ISBN & Metadata Issues', 'Printing & Quality',
                      'Distribution & Availability', 'Book Status & Production Updates', 'General Inquiry')),
  category_source   TEXT CHECK (category_source IN ('ai', 'rules', 'admin', 'seed')),
  priority          TEXT CHECK (priority IN ('Critical', 'High', 'Medium', 'Low')),
  priority_source   TEXT CHECK (priority_source IN ('ai', 'rules', 'admin', 'seed')),
  ai_confidence     REAL,
  ai_reasoning      TEXT,
  -- lifecycle of the background triage job: pending -> done | fallback
  triage_status     TEXT NOT NULL DEFAULT 'pending' CHECK (triage_status IN ('pending', 'done', 'fallback')),

  assigned_to       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  first_response_at TEXT,
  resolved_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_author ON tickets(author_id);
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets(status, priority, created_at);

-- Author-visible conversation: the original query lives on the ticket, follow-ups and replies here.
CREATE TABLE IF NOT EXISTS ticket_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id    INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_role  TEXT NOT NULL CHECK (sender_role IN ('author', 'admin')),
  sender_id    INTEGER NOT NULL REFERENCES users(id),
  body         TEXT NOT NULL,
  ai_assisted  INTEGER NOT NULL DEFAULT 0,  -- 1 if the admin started from an AI draft
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON ticket_messages(ticket_id, created_at);

-- Internal notes are a separate table (not a flag on messages) so an author-facing query
-- can never accidentally leak them.
CREATE TABLE IF NOT EXISTS internal_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id   INTEGER NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_ticket ON internal_notes(ticket_id);

-- One cached draft per ticket. It is reused until the conversation changes
-- (tracked by message_count), so re-opening a ticket costs zero tokens.
CREATE TABLE IF NOT EXISTS ai_drafts (
  ticket_id      INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  body           TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('ai', 'template')),
  model          TEXT,
  message_count  INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Every LLM call is logged for cost tracking and debugging.
CREATE TABLE IF NOT EXISTS ai_calls (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose              TEXT NOT NULL CHECK (purpose IN ('classify', 'draft')),
  ticket_id            INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  model                TEXT NOT NULL,
  success              INTEGER NOT NULL,
  input_tokens         INTEGER,
  output_tokens        INTEGER,
  cache_read_tokens    INTEGER,
  latency_ms           INTEGER,
  error                TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
