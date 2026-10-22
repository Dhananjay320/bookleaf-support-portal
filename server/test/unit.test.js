import { test } from 'node:test';
import assert from 'node:assert/strict';
import { royaltyCalendar } from '../src/ai/royaltyCalendar.js';
import { classifyWithRules } from '../src/ai/fallbacks.js';
import { knowledgeFor, KB_SECTIONS } from '../src/ai/knowledgeBase.js';

test('royalty calendar: inside the previous quarter payout window', () => {
  const cal = royaltyCalendar(new Date('2026-10-22T10:00:00Z'));
  assert.equal(cal.lastClosedQuarter.label, 'Q3 2026');
  assert.equal(cal.lastClosedQuarter.payoutDeadline, '2026-11-14');
  assert.deepEqual(cal.nextPayout, { quarter: 'Q3 2026', payBy: '2026-11-14' });
});

test('royalty calendar: after the window closes, next payout is the current quarter', () => {
  const cal = royaltyCalendar(new Date('2026-12-01T10:00:00Z'));
  assert.deepEqual(cal.nextPayout, { quarter: 'Q4 2026', payBy: '2027-02-14' });
});

test('royalty calendar: year boundary (Q4 -> Q1)', () => {
  const cal = royaltyCalendar(new Date('2027-01-10T00:00:00Z'));
  assert.equal(cal.lastClosedQuarter.label, 'Q4 2026');
  assert.equal(cal.nextPayout.payBy, '2027-02-14');
});

test('rule fallback: long-missing royalty is Critical', () => {
  const r = classifyWithRules({ subject: 'Royalty', description: "I haven't received any royalty for 6 months" });
  assert.equal(r.category, 'Royalty & Payments');
  assert.equal(r.priority, 'Critical');
});

test('rule fallback: ISBN mismatch is High', () => {
  const r = classifyWithRules({ subject: 'Wrong ISBN', description: 'Amazon shows a different ISBN than my printed copy' });
  assert.equal(r.category, 'ISBN & Metadata Issues');
  assert.equal(r.priority, 'High');
});

test('rule fallback: bio update is Low', () => {
  const r = classifyWithRules({ subject: 'Bio', description: 'Can I update my author bio on the site?' });
  assert.equal(r.priority, 'Low');
});

test('knowledge base: only relevant sections are selected', () => {
  const kb = knowledgeFor('Printing & Quality');
  assert.ok(kb.includes('free reprint'));
  assert.ok(!kb.includes('80/20'));
  assert.ok(kb.length < Object.values(KB_SECTIONS).join('').length / 3);
});
