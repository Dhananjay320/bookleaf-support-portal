/**
 * Non-AI fallbacks, used when the model is unavailable (no key, outage, rate limit,
 * refusal). They are deliberately simple and conservative. Their job is to keep the
 * queue usable, not to match model quality. Anything triaged here is marked
 * source = 'rules' so admins know to double-check it.
 */
import { royaltyCalendar, MIN_PAYOUT_THRESHOLD } from './royaltyCalendar.js';

const CATEGORY_KEYWORDS = {
  'Royalty & Payments': ['royalt', 'payout', 'payment', 'paid', 'bank', 'earning', 'money', '₹', 'rs.', 'inr', 'statement'],
  'ISBN & Metadata Issues': ['isbn', 'metadata', 'barcode', 'imprint', 'wrong author', 'wrong title', 'description', 'bio'],
  'Printing & Quality': ['print', 'blurry', 'misprint', 'binding', 'pages', 'quality', 'defect', 'colour', 'color', 'damaged', 'author copies'],
  'Distribution & Availability': ['amazon', 'flipkart', 'unavailable', 'out of stock', 'listing', 'not available', 'buy', 'store', 'distribution'],
  'Book Status & Production Updates': ['status', 'typesetting', 'cover design', 'proofread', 'production', 'stage', 'delay', 'when will', 'editing', 'manuscript'],
};

// Ordered from most to least severe; first match wins.
const PRIORITY_RULES = [
  { priority: 'Critical', patterns: [/legal|lawyer|fraud|scam|police|consumer court/i, /(6|six|7|8|9|10|11|12)\s*months?.*(no|not|never|haven'?t).*(royalt|pay)/i, /(no|not|never|haven'?t).*(royalt|pay).*(6|six|7|8|9|10|11|12)\s*months?/i] },
  { priority: 'High', patterns: [/isbn.*(wrong|different|duplicate|incorrect|mismatch)|(wrong|different|duplicate|incorrect).*isbn/i, /(never|not|haven'?t).*(received|got).*(royalt|payment|payout)/i, /blurry|misprint|misaligned|defect|damaged|binding/i, /urgent|asap|immediately/i] },
  { priority: 'Low', patterns: [/\b(can i|how do i|is it possible|what is the process|update (my )?(bio|description))\b/i] },
];

export function classifyWithRules({ subject, description }) {
  const text = `${subject}\n${description}`.toLowerCase();

  let category = 'General Inquiry';
  let best = 0;
  for (const [candidate, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);
    if (score > best) {
      best = score;
      category = candidate;
    }
  }

  const rule = PRIORITY_RULES.find((r) => r.patterns.some((p) => p.test(text)));
  const priority = rule?.priority ?? 'Medium';

  return {
    category,
    priority,
    confidence: null,
    reasoning: 'Classified by keyword rules because AI triage was unavailable. Please verify.',
  };
}

const firstName = (name) => name?.split(' ')[0] ?? 'there';

/** A category-specific starting point for a manual reply when AI drafting is unavailable. */
export function templateReply({ ticket, author, book }) {
  const name = firstName(author.name);
  const title = book ? `"${book.title}"` : 'your book';
  const cal = royaltyCalendar();

  const bodies = {
    'Royalty & Payments':
      `Thank you for reaching out about your royalties for ${title}, and I understand how important this is. ` +
      `Royalties are calculated quarterly and paid within 45 days of each quarter ending; the payout for ${cal.nextPayout.quarter} is due by ${cal.nextPayout.payBy}. ` +
      (book ? `Our records show ₹${book.royaltyPending.toLocaleString('en-IN')} currently pending for ${title}. ` : '') +
      `Balances under ₹${MIN_PAYOUT_THRESHOLD.toLocaleString('en-IN')} roll over to the next quarter. ` +
      `[Agent: confirm bank details are linked and whether this payout is overdue.] ` +
      `I am checking your account now and will get back to you within 48 hours with a full breakdown.`,
    'ISBN & Metadata Issues':
      `Thank you for flagging this; an ISBN or metadata error is serious and I'm sorry for the trouble it has caused. ` +
      `I have escalated this to our production team as a high-priority issue, and we will get back to you with a resolution within 48 hours.`,
    'Printing & Quality':
      `I'm really sorry the copies of ${title} didn't meet the standard you expect. ` +
      `Could you please reply with a few photos of the affected pages? Once our team verifies the issue we will arrange a free reprint, which typically takes 5–7 business days.`,
    'Distribution & Availability':
      `Thank you for letting us know about ${title}'s availability. ` +
      `This is usually caused by a stock sync issue between our warehouse and the platform. I have asked our distribution team to trigger a re-sync, and the listing should be live again within 24–48 hours.`,
    'Book Status & Production Updates':
      `Thank you for checking in on ${title}. ` +
      (book ? `It is currently at the "${book.status}" stage. ` : '') +
      `[Agent: add the specific reason and the updated timeline.] We will keep you updated at each stage.`,
    'General Inquiry':
      `Thank you for reaching out. [Agent: answer the author's question.] Please let us know if there is anything else we can help with.`,
  };

  const body = bodies[ticket.category] ?? bodies['General Inquiry'];
  return `Hi ${name},\n\n${body}\n\nWarm regards,\nBookLeaf Author Support`;
}
