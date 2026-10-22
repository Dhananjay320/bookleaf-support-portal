/**
 * Deterministic royalty-cycle dates.
 *
 * Policy: royalties are calculated per calendar quarter and paid within 45 days of
 * the quarter ending. We compute these dates in code and hand them to the model as
 * facts. LLMs are unreliable at date arithmetic, and a wrong payout date in a
 * reply to an author is exactly the kind of error we cannot afford.
 */

const PAYOUT_WINDOW_DAYS = 45;
export const MIN_PAYOUT_THRESHOLD = 1000;

const toIsoDate = (d) => d.toISOString().slice(0, 10);

function quarterOf(date) {
  const q = Math.floor(date.getUTCMonth() / 3); // 0..3
  const start = new Date(Date.UTC(date.getUTCFullYear(), q * 3, 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), q * 3 + 3, 0)); // last day of quarter
  return { label: `Q${q + 1} ${date.getUTCFullYear()}`, start, end };
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function royaltyCalendar(today = new Date()) {
  const current = quarterOf(today);
  const previous = quarterOf(addDays(current.start, -1));

  const previousPayoutDeadline = addDays(previous.end, PAYOUT_WINDOW_DAYS);
  const currentPayoutDeadline = addDays(current.end, PAYOUT_WINDOW_DAYS);

  // The next payout an author can expect: the previous quarter's, if its window is still open.
  const nextPayout =
    today <= previousPayoutDeadline
      ? { quarter: previous.label, payBy: toIsoDate(previousPayoutDeadline) }
      : { quarter: current.label, payBy: toIsoDate(currentPayoutDeadline) };

  return {
    today: toIsoDate(today),
    currentQuarter: { label: current.label, endsOn: toIsoDate(current.end) },
    lastClosedQuarter: { label: previous.label, endedOn: toIsoDate(previous.end), payoutDeadline: toIsoDate(previousPayoutDeadline) },
    nextPayout,
  };
}
