# BookLeaf Author Support & Communication Portal

A support portal for BookLeaf Publishing with two interfaces:

- **Author Portal**: authors log in, see their books and royalties, raise support tickets and follow the conversation live.
- **Support Console (admin)**: the ops team works an urgency-sorted queue. Claude classifies and prioritises every ticket and drafts a reply grounded in BookLeaf's knowledge base and the author's real account data. A human reviews and edits every reply before it is sent.

| | |
|---|---|
| **Live demo** | Frontend: `<vercel URL>` · API: https://bookleaf-support-portal-8qko.onrender.com  (free tier: first request may take ~40s while the API wakes up) |
| **Stack** | React 18 + Vite · Node.js 22 + Express · SQLite (`node:sqlite`) · Anthropic Claude API · Server-Sent Events |
| **Write-up** | [docs/WRITEUP.md](docs/WRITEUP.md) |

### Test credentials

| Role | Email | Password |
|---|---|---|
| Admin (Support Lead) | `admin@bookleaf.com` | `admin123` |
| Admin (Operations) | `ops@bookleaf.com` | `admin123` |
| Author | any author email from the dataset, e.g. `priya.sharma@email.com` | `author123` |

Useful authors for edge cases: `sneha.kulkarni@email.com` (one book still in production), `kavita.deshmukh@email.com` (one book in production, one with no payout yet), `ananya.reddy@email.com` (₹0 paid so far).

The database is seeded from `bookleaf_sample_data.json` (10 authors, 18 books) on first start, plus six example tickets so the queue isn't empty.

---

## Contents
1. [Running locally](#1-running-locally)
2. [Architecture](#2-architecture)
3. [AI integration](#3-ai-integration)
4. [API reference](#4-api-reference)
5. [Testing](#5-testing)
6. [Deployment](#6-deployment)
7. [Known limitations & next steps](#7-known-limitations--next-steps)

---

## 1. Running locally

**Requirements:** Node.js **22.13+** (uses the built-in `node:sqlite`, so there is no database server to install and no native modules to compile).

```bash
# 1. install
npm ci --prefix server
npm ci --prefix client

# 2. configure (optional: the app runs without an API key, using rule-based fallbacks)
cp server/.env.example server/.env
#   then set ANTHROPIC_API_KEY=... and JWT_SECRET=... in server/.env

# 3. run API (http://localhost:4000) and UI (http://localhost:5173) in two terminals
npm run dev --prefix server
npm run dev --prefix client
```

Open http://localhost:5173. The Vite dev server proxies `/api` to Express, so the browser sees one origin, just like in production.

| Command | What it does |
|---|---|
| `npm test --prefix server` | Unit + API integration tests (no API key needed) |
| `npm run seed --prefix server` | Wipe and reseed the database |
| `npm run build && npm start` (repo root) | Production build: Express serves the API **and** the built React app on one port |

### Environment variables (`server/.env`)

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Server-side only. Without it, AI features degrade to rules/templates. |
| `AI_CLASSIFY_MODEL` | `claude-opus-5-5` | Model for triage. `claude-haiku-5-5` is a much cheaper drop-in at high volume. |
| `AI_DRAFT_MODEL` | `claude-opus-5-5` | Model for reply drafts. |
| `JWT_SECRET` | random per process in dev | **Required** in production. |
| `PORT` | `4000` | |
| `DATABASE_PATH` | `server/data/bookleaf.db` | `:memory:` is used by tests. |
| `CORS_ORIGIN` | — | Only needed if the UI is hosted on a different origin. |

---

## 2. Architecture

```
┌──────────────────────── Browser (React SPA) ─────────────────────────┐
│  Author Portal                     Support Console (admin)           │
│  books · new ticket · my tickets   queue · ticket view · AI draft    │
└───────────────┬───────────────────────────────────▲──────────────────┘
                │ REST /api/v1 (JSON, httpOnly cookie)│ SSE /api/v1/events
┌───────────────▼─────────────────────────────────────┴────────────────┐
│ Express                                                              │
│  middleware: helmet · json(100kb) · authenticate (JWT) · requireRole │
│              validate (zod) · rate limits · errorHandler             │
│  routes ──► services (ticket, book) ──► SQLite                       │
│                 │           └──► realtime bus ──► SSE fan-out        │
│                 └──► ai/ (classifier, drafter, fallbacks, KB)        │
│                         └──► llmClient: timeouts, retries, circuit   │
│                              breaker, usage logging ──► Claude API   │
└──────────────────────────────────────────────────────────────────────┘
```

```
server/src
├── index.js / app.js        bootstrap, middleware, route mounting, static SPA
├── config.js                all env parsing in one place
├── domain.js                statuses, categories, priorities, response targets
├── db/                      schema.sql, connection + transaction helper, seed
├── middleware/              auth (JWT + RBAC), zod validation, error handler
├── routes/                  thin HTTP layer: validate → call service → respond
├── services/                business logic (ticket lifecycle, books, realtime bus)
└── ai/
    ├── llmClient.js         the only file that talks to Anthropic
    ├── classifier.js        triage prompt + JSON schema
    ├── drafter.js           reply prompt builder
    ├── knowledgeBase.js     BookLeaf KB split into sections + playbook examples
    ├── royaltyCalendar.js   payout dates computed in code
    └── fallbacks.js         keyword triage + policy reply templates
client/src
├── api/client.js            fetch wrapper with structured errors
├── context/AuthContext      session state (cookie-based)
├── hooks/                   useApi (load/reload), useTicketEvents (SSE)
├── components/              badges, thread, layout
└── pages/author|admin       one file per screen
```

### Key decisions

| Decision | Why |
|---|---|
| **Express + plain modules, layered routes → services → db** | Small enough to read top to bottom; routes stay thin (validation + HTTP), so business rules live in one place and are testable without HTTP. |
| **SQLite via `node:sqlite`** | Zero setup for reviewers (`npm ci && npm run dev`) and no native build step. The schema is relational with FKs and `CHECK` constraints, so moving to Postgres means changing the driver, not the design. |
| **Internal notes in their own table** | Not a `visibility` flag on messages. An author-facing query physically can't return them, so a forgotten `WHERE` clause can't leak them. |
| **404 (not 403) for other authors' resources** | Doesn't reveal whether ticket/book IDs exist. |
| **JWT in an httpOnly, SameSite=Lax cookie** (Bearer header also accepted) | Not readable by JS (XSS can't steal it). It also lets `EventSource` authenticate, since EventSource can't send custom headers. Bearer support keeps the API usable from curl/Postman. The user is re-loaded from the DB on every request, so role changes apply immediately. |
| **SSE for real-time** | Updates flow one way (server → browser). SSE runs over plain HTTP, reconnects automatically and needs no extra library. Events carry **only IDs**; clients refetch through the normal REST endpoints, so access control lives in one place and no ticket content travels on the stream. |
| **Triage runs in the background** | `POST /tickets` returns immediately. Classification happens after the response, then an SSE event updates the queue. A slow or failed AI call never blocks or fails ticket creation. |
| **Admin overrides are sticky** | `category_source` / `priority_source` record who set each value (`ai`, `rules`, `admin`, `seed`). Re-running triage never overwrites an admin's decision. |
| **Queue is sorted by urgency by default** | Unresolved first → priority → oldest. Each priority has a first-response target (Critical 4h, High 24h, Medium 48h, Low 72h). Breaches get a red edge and count in the header, so "most urgent and oldest" is visible at a glance. |

### Data model

`authors` 1─* `books` · `authors` 1─* `tickets` · `tickets` 1─* `ticket_messages` (author-visible) · `tickets` 1─* `internal_notes` (admin-only) · `tickets` 1─1 `ai_drafts` (cached draft) · `ai_calls` (one row per LLM call: model, tokens, latency, error) · `users` (role `author` → linked `author_id`; role `admin` → none, enforced by a `CHECK`).

---

## 3. AI integration

Two AI touchpoints, each with a non-AI fallback:

| | When | Model call | Fallback |
|---|---|---|---|
| **Triage** (category + priority) | in the background, right after a ticket is created | 1 call, structured JSON output, `effort: low` | keyword rules (`ai/fallbacks.js`), marked *"Keyword rules (AI unavailable)"* in the UI |
| **Reply draft** | when an admin opens a ticket (lazily, then cached) | 1 call, `effort: medium` | a category-specific policy template with `[Agent: …]` placeholders |

### 3.1 Prompt strategy

**Triage** (`ai/classifier.js`)
- The system prompt defines the six categories with concrete examples, a tie-break rule ("choose the category that must be fixed first"), and a priority rubric based on BookLeaf's own policies (e.g. *ISBN errors are always at least High*, *money withheld for ~6 months is Critical*).
- The output is constrained with **structured outputs** (`output_config.format` with a JSON schema using enums). Then it is **re-validated with zod** before it touches the DB, as defence in depth.
- Returns `confidence` and a one-line `reasoning`, both shown to the admin. Below 60% confidence the UI asks the admin to verify.
- Gets a one-line summary of the book (status, pending royalty, last payout) so "I haven't been paid" can be judged against facts.

**Drafting** (`ai/drafter.js`)
- **System prompt**: identity ("a member of BookLeaf's author support team writing a draft a human will review"), BookLeaf's tone guidelines verbatim, and hard rules:
  - use only the facts provided;
  - never invent amounts, dates, tracking numbers or policies;
  - when a needed fact is missing, insert `[Agent: …]` instead of guessing;
  - no compensation promises;
  - plain-text email format with BookLeaf's sign-off.
- **User message**: XML-tagged blocks so the model can tell data from instructions:
  - `<knowledge_base>`: only the KB sections relevant to the category;
  - `<playbook>`: BookLeaf's own sample query → expected-response guidance for that category;
  - `<author_account>`: the actual book record (sales, earned/paid/pending, last payout, platforms, production stage);
  - `<royalty_calendar>`: royalty tickets only (see below);
  - `<conversation>`: the original query + latest messages.
- **Facts the model shouldn't compute are computed in code.** `royaltyCalendar.js` works out the last closed quarter, its 45-day payout deadline and the next expected payout date. LLMs are unreliable at date arithmetic, and a wrong payout date in a message to an author is the kind of error that erodes trust.
- **Prompt-injection hygiene:** both prompts tell the model that author text is data, never instructions. Author-provided text is wrapped in its own tag.
- **Human in the loop:** the draft pre-fills an editable composer. The **Send button is disabled while any `[Agent: …]` placeholder remains**, and messages record whether they started from an AI draft (`ai_assisted`). That gives us a metric for how often agents use the drafts.

### 3.2 Graceful degradation

All model calls go through `ai/llmClient.js`:

- **Timeouts and retries:** 20s / 2 retries for background triage; 45s / 1 retry for drafts (an agent is waiting). The SDK retries 429/5xx/connection errors with backoff.
- **Typed error mapping:** `RateLimitError`, `AuthenticationError`, `APIConnectionTimeoutError`, etc. map to a short reason that is logged in `ai_calls`.
- **`stop_reason` is checked before content is trusted** (`refusal`, `max_tokens`, empty output → fallback).
- **Circuit breaker:** after 3 consecutive provider failures, AI calls are skipped for 60s and fallbacks are used immediately. A provider outage therefore doesn't add 20–45s of latency to every action. The admin queue shows a banner while AI is degraded or disabled.
- **Draft refusal fallback:** draft calls opt into the API's server-side `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). If the model declines a request (e.g. a safety-classifier false positive on an angry ticket), the API retries on a fallback model within the same call.
- **What still works with the AI fully down:** tickets are created; triage falls back to keyword rules, flagged in the UI with a "Re-run AI triage" button; drafts fall back to a policy template; admins can always write and send replies manually. This path is exercised by the automated tests, which run without an API key.

### 3.3 Cost awareness

| Technique | Effect |
|---|---|
| **No KB in triage** | Classification needs definitions and a rubric, not policies. The prompt is ~700 input tokens per ticket. |
| **Category-scoped KB in drafts** | Each draft sends 1–3 relevant KB sections and that category's playbook examples instead of everything (a ~60–70% cut on KB tokens; there is a unit test for this). |
| **Book summary, not the whole account** | Only the book the ticket is about. |
| **Capped history** | The original query + the last 6 messages, each truncated at 1,500 chars, so a long thread doesn't grow the prompt without bound. |
| **Drafts are lazy and cached** | Generated only when an admin opens a ticket, then stored in `ai_drafts` keyed on the conversation length. Re-opening a ticket costs **0 tokens**; a new message (or "Regenerate") triggers a fresh draft. Concurrent opens of the same ticket share one in-flight request. |
| **Effort tuned per task** | `low` for classification, `medium` for drafting. |
| **Rate limit on ticket creation** | 20 per author per hour, which caps AI spend from abuse. |
| **Usage logging** | Every call records model, input/output tokens, latency and errors in `ai_calls`, surfaced in `GET /admin/stats`. Spend is measurable, not guessed. |

*Why not prompt caching?* The static parts of each prompt (~500–600 tokens) are below the minimum cacheable prefix, so caching would add nothing. Keeping the KB small and scoped is the bigger lever here. If the KB grew to several thousand tokens, it would move into a cached system block.

Rough cost per ticket on the default model (Claude Opus 5.5, $4 / $20 per M tokens): triage ≈ 0.7k in + ~0.2k out ≈ **$0.007**; draft ≈ 1.5k in + ~0.6k out ≈ **$0.018**. That is about **$0.025 per ticket**, or ~$30/month at 1,200 tickets. These are estimates; the `ai_calls` table holds the real numbers.

### 3.4 Model choice

I used **Anthropic Claude** through the official `@anthropic-ai/sdk`:
- **Quality of author-facing text is the product.** Replies must follow a specific tone guide, quote exact figures, own BookLeaf's mistakes, and avoid inventing facts. Claude Opus 5.5 follows long, specific instruction sets reliably, so it is the default for drafting.
- **Structured outputs** guarantee schema-valid triage JSON with enum-constrained categories, so there is no regex parsing of free text.
- **Effort control** lets one model run cheaply for classification (`low`) and more thoroughly for drafting.
- **Tunable per task:** `AI_CLASSIFY_MODEL` and `AI_DRAFT_MODEL` are separate. At BookLeaf's volume, moving triage to `claude-haiku-5-5` ($0.10 / $0.50 per M tokens) cuts triage cost by ~40× and is the first change I'd measure, against a labelled sample of real tickets.

### 3.5 API key security
- The key is read only from `process.env.ANTHROPIC_API_KEY` (`server/src/config.js`). It is never hardcoded, never logged, and never sent to the browser. All AI calls run server-side.
- `.env` is git-ignored; `server/.env.example` documents the variables with empty values.
- On Render the key is set in the dashboard (`sync: false` in `render.yaml`).

---

## 4. API reference

Base URL: `/api/v1`. All bodies are JSON.

**Authentication:** `POST /auth/login` sets an httpOnly session cookie **and** returns a token. API clients can send `Authorization: Bearer <token>` instead. Every route except `/health` and `/auth/login` requires authentication.

**Errors** always have this shape:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "The request contains invalid fields.",
             "details": [{ "field": "subject", "message": "Subject must be at least 5 characters." }] } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST`, `INVALID_JSON` | Malformed body, invalid reference (e.g. assignee isn't an admin) |
| 401 | `UNAUTHORIZED` | No/expired session, wrong credentials |
| 403 | `FORBIDDEN` | Authenticated but wrong role |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND` | Unknown resource **or another author's resource** |
| 409 | `CONFLICT` | Author replying to a Closed ticket |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 100 KB |
| 422 | `VALIDATION_ERROR` | Field-level validation failures (`details[]`) |
| 429 | `TOO_MANY_REQUESTS` | Login (20/15 min/IP) or ticket creation (20/h/author) limits |
| 500 | `INTERNAL_ERROR` | Unexpected; details are logged server-side, never leaked |

### Auth

| Method & path | Role | Description |
|---|---|---|
| `POST /auth/login` | public | Body `{ email, password }` → `{ token, user }` and sets cookie |
| `POST /auth/logout` | any | Clears the cookie → `204` |
| `GET /auth/me` | any | → `{ user: { id, email, name, role, authorId } }` |

### Books

| Method & path | Role | Description |
|---|---|---|
| `GET /books` | author, admin | Authors: own books. Admins: all books, optional `?authorId=AUTH001`. → `{ data: Book[], summary }`, where `summary` holds totals for books, copies sold, and royalty earned/paid/pending. |
| `GET /books/:id` | author (own), admin | → `{ data: Book }` |

`Book`: `id, title, isbn, genre, publicationDate, status, isPublished, mrp, authorRoyaltyPerCopy, totalCopiesSold, totalRoyaltyEarned, royaltyPaid, royaltyPending, lastRoyaltyPayoutDate, printPartner, availableOn[]`. In-production books have `null` for `publicationDate` and `mrp`, and zero sales.

### Tickets

| Method & path | Role | Description |
|---|---|---|
| `GET /tickets` | author (own), admin | List with filters (see below). → `{ data: Ticket[] }` |
| `POST /tickets` | author | Create. Body `{ bookId?: "BK001" \| null, subject (5–150), description (20–5000), attachmentName? }` → `201 { data: Ticket }`. Triage runs in the background. |
| `GET /tickets/:id` | author (own), admin | → `{ data: Ticket & { messages[], internalNotes[] (admin only) } }` |
| `PATCH /tickets/:id` | admin | Body: any of `{ status, category, priority, assigneeId \| null }`. Category/priority changes are recorded as admin overrides. |
| `POST /tickets/:id/messages` | author (own), admin | Body `{ body, status?, aiAssisted? }`. Admin reply: sets first-response time, auto-assigns if unassigned, moves Open → In Progress unless `status` is given. Author follow-up: reopens a Resolved ticket; `409` on Closed. |
| `POST /tickets/:id/notes` | admin | Body `{ body }`. Internal note, never visible to authors. |
| `GET /tickets/:id/draft` | admin | AI draft reply (cached, or generated on first open). → `{ data: { body, source: "ai" \| "template", model, cached, createdAt } }` |
| `POST /tickets/:id/draft` | admin | Force-regenerate the draft. |
| `POST /tickets/:id/triage` | admin | Re-run AI triage (e.g. after an outage). Admin overrides are preserved. |

**`GET /tickets` query parameters** (all optional, all validated):

| Param | Values |
|---|---|
| `status` | comma-separated: `Open,In Progress,Resolved,Closed` |
| `category` | one of the six categories |
| `priority` | `Critical` · `High` · `Medium` · `Low` |
| `assignee` | `me` · `unassigned` |
| `from`, `to` | `YYYY-MM-DD` (inclusive) |
| `q` | text search over subject, description, author name, book title |
| `sort` | `urgency` (default: unresolved → priority → oldest) · `newest` · `oldest` · `updated` |

`Ticket` (author view): `id, subject, description, attachmentName, status, category, book {id,title} | null, author {id,name}, messageCount, lastMessageAt, createdAt, updatedAt, resolvedAt`.
The admin view adds: `priority, categorySource, prioritySource, triageStatus (pending|done|fallback), aiConfidence, aiReasoning, assignee, firstResponseAt, awaitingReply, sla { targetHours, ageHours, breached }`.

### Admin

| Method & path | Role | Description |
|---|---|---|
| `GET /admin/users` | admin | Admin team, for assignment |
| `GET /admin/stats` | admin | Queue health (`openCount, criticalOpen, slaBreached, awaitingReply, unassignedOpen, byStatus`), AI usage per purpose (calls, successes, tokens, avg latency), and `aiStatus` (`ok` / `degraded` / `disabled`) |

### Real-time

| Method & path | Role | Description |
|---|---|---|
| `GET /events` | any | `text/event-stream`. Emits `event: ticket` with `{ type, ticketId, at }`, where `type` is one of `ticket.created`, `ticket.triaged`, `ticket.updated`, `ticket.message`, `ticket.note`. Authors only receive events for their own tickets and never `ticket.note`. 25s heartbeat. |

### Health

`GET /health` → `{ status: "ok" }` (public; used by the host's health check).

### Example

```bash
TOKEN=$(curl -s localhost:4000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"ananya.reddy@email.com","password":"author123"}' | jq -r .token)

curl -s localhost:4000/api/v1/tickets -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"bookId":"BK005","subject":"No royalty yet","description":"I have not received any royalty since my book was published in 2024."}'
```

---

## 5. Testing

```bash
npm test --prefix server
```

- **Unit:** royalty calendar (including the year boundary), keyword fallback triage, KB section scoping.
- **API integration** (real HTTP against an in-memory DB, no AI key):
  - auth failures;
  - authors isolated from each other's books and tickets (404);
  - validation details;
  - role checks;
  - the full lifecycle: create → background fallback triage → admin override → note → draft (template) → reply + resolve → author can't see notes → author follow-up reopens → Closed rejects author replies (409);
  - query validation.

I also ran a browser end-to-end pass of both portals side by side: the author's ticket appears in the admin queue and the admin's reply appears in the author's thread, both without a page refresh.

---

## 6. Deployment

**Live setup: frontend on Vercel, API on Render.**

```
browser ──► Vercel (React build)  ──/api/* rewrite──►  Render (Express API + SQLite)
```

Vercel **proxies `/api/*` to Render** (`client/vercel.json`). The browser only ever talks to the Vercel domain, so the session cookie stays first-party (SameSite=Lax, Secure) and SSE works with no CORS or cross-site cookie configuration.

1. **Render (API):** New → Blueprint → select the repo. `render.yaml` creates `bookleaf-support-api` with a health check and a generated `JWT_SECRET`. Add `ANTHROPIC_API_KEY` in the dashboard. If Render assigns a different URL than `https://bookleaf-support-portal-8qko.onrender.com`, update the destination in `client/vercel.json`.
2. **Vercel (UI):** New Project → import the repo → set **Root Directory** to `client` (Vite is auto-detected) → Deploy.

**Single service alternative:** `npm run build && npm start` at the repo root serves the API and UI from one Express process. A `Dockerfile` is included for Railway, Fly or any container host (`docker build -t bookleaf . && docker run -p 4000:4000 -e JWT_SECRET=… -e ANTHROPIC_API_KEY=… bookleaf`).

> Render's free tier sleeps after ~15 minutes idle, so the first request can take ~30–50s to wake it.

> On free tiers the filesystem is ephemeral, so the SQLite file resets on redeploy or restart and is reseeded from the sample data. That suits a demo; for production, see below.

---

## 7. Known limitations & next steps

- **Single instance.** The SSE bus and rate limits are in-memory. To scale out: Redis pub/sub (or Postgres `LISTEN/NOTIFY`) behind `services/realtime.js`, and a Redis rate-limit store.
- **SQLite → Postgres** for durability and concurrent writers. The schema already uses FKs, constraints and indexes that map 1:1.
- **Background jobs.** Triage runs in-process with `setImmediate`. A durable queue (BullMQ, pg-boss) would survive restarts and retry tickets left in `pending`.
- **Attachments are UI-only** (the filename is recorded). Next: S3 signed uploads, and passing images of misprints to Claude's vision input for printing tickets.
- **Evaluation.** Build a labelled set of real tickets to measure classification accuracy, compare `claude-haiku-5-5` vs `claude-opus-5-5` for triage, and track the admin edit distance between draft and sent reply as a quality metric.
- **Ops features:** canned macros, bulk actions, email notifications to authors on reply, SLA escalation alerts, full-text search (FTS5), audit log of status changes, password reset and invite flow.
- **Royalty data** is a snapshot from the dataset (per-book totals, no per-quarter ledger), so drafts reason from totals plus the computed calendar. A real integration would read the payout ledger and bank-linking status.
