import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Isolated in-memory DB and no AI key: exercises the graceful-degradation path.
process.env.DATABASE_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';
process.env.ANTHROPIC_API_KEY = ""; // empty (not deleted) so dotenv cannot refill it from .env
process.env.GEMINI_API_KEY = ""; // empty (not deleted) so dotenv cannot refill it from .env
process.env.AI_PROVIDER = ""; // empty (not deleted) so dotenv cannot refill it from .env

const { seedIfEmpty } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');

let server;
let base;

before(async () => {
  seedIfEmpty({ withSampleTickets: false });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(() => server.close());

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(email, password) {
  const res = await call('POST', '/auth/login', { body: { email, password } });
  assert.equal(res.status, 200);
  return res.body.token;
}

async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out');
}

test('rejects unauthenticated requests and bad credentials', async () => {
  assert.equal((await call('GET', '/books')).status, 401);
  const bad = await call('POST', '/auth/login', { body: { email: 'priya.sharma@email.com', password: 'nope' } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, 'UNAUTHORIZED');
});

test('authors only see their own books, including in-production edge cases', async () => {
  const token = await login('sneha.kulkarni@email.com', 'author123');
  const res = await call('GET', '/books', { token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.map((b) => b.id).sort(), ['BK011', 'BK012', 'BK013']);
  const inProduction = res.body.data.find((b) => b.id === 'BK013');
  assert.equal(inProduction.isPublished, false);
  assert.equal(inProduction.mrp, null);
  assert.equal(res.body.summary.inProductionBooks, 1);

  // another author's book is a 404, not a 403
  assert.equal((await call('GET', '/books/BK001', { token })).status, 404);
});

test('full ticket lifecycle with RBAC and internal-note isolation', async () => {
  const author = await login('ananya.reddy@email.com', 'author123');
  const otherAuthor = await login('rohit.kapoor@email.com', 'author123');
  const admin = await login('admin@bookleaf.com', 'admin123');

  const invalid = await call('POST', '/tickets', { token: author, body: { subject: 'x', description: 'y' } });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.error.details.map((d) => d.field).sort(), ['description', 'subject']);

  // only authors raise tickets
  assert.equal((await call('POST', '/tickets', { token: admin, body: { subject: 'Hello', description: 'x'.repeat(30) } })).status, 403);

  const created = await call('POST', '/tickets', {
    token: author,
    body: { bookId: 'BK005', subject: 'No royalty for 7 months', description: "I haven't received any royalty for 7 months." },
  });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  assert.equal(created.body.data.priority, undefined, 'authors do not see internal triage fields');

  // background triage falls back to rules when AI is unavailable
  const triaged = await waitFor(async () => {
    const t = (await call('GET', `/tickets/${id}`, { token: admin })).body.data;
    return t.triageStatus !== 'pending' && t;
  });
  assert.equal(triaged.triageStatus, 'fallback');
  assert.equal(triaged.category, 'Royalty & Payments');
  assert.equal(triaged.priority, 'Critical');

  assert.equal((await call('GET', `/tickets/${id}`, { token: otherAuthor })).status, 404);

  const patched = await call('PATCH', `/tickets/${id}`, { token: admin, body: { priority: 'High' } });
  assert.equal(patched.body.data.prioritySource, 'admin');
  assert.equal((await call('PATCH', `/tickets/${id}`, { token: admin, body: { status: 'Nope' } })).status, 422);

  await call('POST', `/tickets/${id}/notes`, { token: admin, body: { body: 'Check bank details' } });

  const draft = await call('GET', `/tickets/${id}/draft`, { token: admin });
  assert.equal(draft.status, 200);
  assert.equal(draft.body.data.source, 'template');
  assert.match(draft.body.data.body, /Hi Ananya/);
  assert.equal((await call('GET', `/tickets/${id}/draft`, { token: author })).status, 403);

  const replied = await call('POST', `/tickets/${id}/messages`, {
    token: admin, body: { body: 'We are looking into it.', status: 'Resolved' },
  });
  assert.equal(replied.body.data.status, 'Resolved');
  assert.ok(replied.body.data.firstResponseAt);

  // the author sees the reply but never internal notes
  const authorView = (await call('GET', `/tickets/${id}`, { token: author })).body.data;
  assert.equal(authorView.messages.length, 1);
  assert.equal(authorView.internalNotes, undefined);

  // an author follow-up reopens a resolved ticket
  const followUp = await call('POST', `/tickets/${id}/messages`, { token: author, body: { body: 'Still nothing.' } });
  assert.equal(followUp.body.data.status, 'Open');

  // closed is final for authors
  await call('PATCH', `/tickets/${id}`, { token: admin, body: { status: 'Closed' } });
  assert.equal((await call('POST', `/tickets/${id}/messages`, { token: author, body: { body: 'Hello?' } })).status, 409);
});

test('queue filters validate input', async () => {
  const admin = await login('admin@bookleaf.com', 'admin123');
  assert.equal((await call('GET', '/tickets?status=Open,Bogus', { token: admin })).status, 422);
  const res = await call('GET', '/tickets?status=Closed&priority=High', { token: admin });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.every((t) => t.status === 'Closed' && t.priority === 'High'));
});

test('unknown API routes return a JSON 404', async () => {
  const token = await login('admin@bookleaf.com', 'admin123');
  const res = await call('GET', '/nope', { token });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
});
