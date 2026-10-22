/**
 * The BookLeaf Knowledge Base, split into sections.
 *
 * Splitting it lets the drafter send only the sections relevant to a ticket's
 * category (see SECTIONS_BY_CATEGORY) instead of the whole KB on every call.
 */

export const KB_SECTIONS = {
  company: `Company overview
- BookLeaf Publishing is a self-publishing company operating in India and the US.
- Packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid package with marketing and distribution add-ons).
- BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution and royalty management.
- In-house printing facility and warehouse in Delhi. Print partners: Repro India and Epitome Books.`,

  royalty: `Royalty policy
- 80/20 split: 80% of the net profit per book goes to the author, 20% to BookLeaf.
- Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart) and shipping charges.
- Royalties are calculated quarterly and paid within 45 days of the quarter ending.
- Minimum payout threshold: ₹1,000. Accumulated royalties below this roll over to the next quarter.
- Payouts are made by bank transfer to the account linked in the author's dashboard.
- Authors can see a detailed royalty breakdown in their dashboard, with sales figures per platform.`,

  isbn: `ISBN policy
- Every book published through BookLeaf receives a unique ISBN assigned by BookLeaf.
- ISBNs are registered under BookLeaf's publisher imprint. Authors who want an ISBN under their own imprint must obtain it independently.
- A reported ISBN error (duplicate, wrong book linked) is a high-priority issue and is escalated to the production team.`,

  printing: `Printing & quality
- In-house printing handles most orders. Overflow or special format requirements go to Repro India or Epitome Books.
- Standard print turnaround: 5–7 business days from order confirmation.
- For a quality issue (misprints, binding defects, colour inconsistency) BookLeaf arranges a free reprint after verification. The author may need to share photos of the defective copy.`,

  distribution: `Distribution & availability
- Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK and the BookLeaf Store.
- New listings typically go live within 7–10 business days after publication is complete.
- A book showing as unavailable on a platform usually indicates a stock sync issue; BookLeaf's team can trigger a re-sync, which takes 24–48 hours.
- Metadata updates (description, author bio, etc.) can be submitted through the dashboard or by emailing the BookLeaf team; changes typically reflect on platforms within 3–5 business days.`,

  production: `Production stages
- Stages: Manuscript Received → Editing (if opted) → Cover Design → Typesetting → Proofreading → ISBN Assignment → Printing → Distribution Setup → Published & Live.
- Authors are updated by email at each stage. Delays typically happen at Cover Design (waiting for author approval) and Proofreading (revision rounds).`,
};

/** Which KB sections are relevant to each ticket category. */
export const SECTIONS_BY_CATEGORY = {
  'Royalty & Payments': ['royalty'],
  'ISBN & Metadata Issues': ['isbn', 'distribution'],
  'Printing & Quality': ['printing'],
  'Distribution & Availability': ['distribution'],
  'Book Status & Production Updates': ['production', 'distribution'],
  'General Inquiry': ['company', 'distribution', 'royalty'],
};

export const TONE_GUIDELINES = `- Always empathetic and professional. Authors are our partners, not customers to be managed.
- Acknowledge the author's concern before moving to solutions.
- Be specific: use the actual numbers, dates and statuses provided rather than vague reassurances.
- If something is BookLeaf's fault (delayed royalties, ISBN error), own it directly. No corporate deflection.
- If the issue needs escalation or investigation, give a clear timeline (e.g. "our team will get back to you within 48 hours"), never an open-ended promise.
- Always end with a clear next step for the author and/or the BookLeaf team.`;

/**
 * Calibration examples from BookLeaf's support playbook: how a reply in each
 * category should be framed. Only the matching category's examples are sent.
 */
export const RESPONSE_PLAYBOOK = {
  'Royalty & Payments': [
    {
      query: "I published my book 4 months ago and still haven't received any royalty. What's going on?",
      guidance: 'Acknowledge the frustration. Explain the quarterly royalty cycle and 45-day payout window. Check whether their bank details are linked. Give the specific next payout date. If the payment is genuinely overdue, escalate with a 48-hour resolution timeline.',
    },
    {
      query: 'My royalty amount seems too low. I sold 200 copies but only received ₹3,000.',
      guidance: "Explain the net profit calculation: MRP minus printing, platform commission and shipping. Offer a detailed line-by-line royalty breakdown. Don't be defensive; offer transparency.",
    },
  ],
  'ISBN & Metadata Issues': [
    {
      query: "My book is showing a different ISBN on Amazon than what's on the physical copy.",
      guidance: 'Treat as high priority. Acknowledge this is a serious data issue. Confirm it is being escalated to the production team immediately. Give a 48-hour resolution timeline.',
    },
  ],
  'Printing & Quality': [
    {
      query: 'I received my author copies and the print quality is terrible. The images are blurry and pages are misaligned.',
      guidance: 'Apologise sincerely. Ask the author to share photos of the defective copies. Confirm BookLeaf will arrange a free reprint once verified. Give a 5–7 business day timeline for the reprint.',
    },
  ],
  'Distribution & Availability': [
    {
      query: 'My book is published but it\'s showing as "Currently Unavailable" on Amazon.',
      guidance: "Explain this is typically a stock sync issue. Confirm you're triggering a re-sync with the distribution team. Set the expectation: 24–48 hours for it to go live again.",
    },
  ],
  'Book Status & Production Updates': [
    {
      query: "It's been 3 weeks and my book is still in typesetting. When will it be done?",
      guidance: "Check the actual production status. If delayed, be honest about why (e.g. waiting on author approval for proofs). Give a specific updated timeline. Don't blame the author even if the delay is on their side; frame it collaboratively.",
    },
  ],
  'General Inquiry': [
    {
      query: 'Can I update the description of my book on Amazon after it\'s already live?',
      guidance: 'Yes: metadata updates can be submitted through the dashboard or by emailing the BookLeaf team. Changes typically reflect on platforms within 3–5 business days.',
    },
  ],
};

export function knowledgeFor(category) {
  const keys = SECTIONS_BY_CATEGORY[category] ?? Object.keys(KB_SECTIONS);
  return keys.map((k) => KB_SECTIONS[k]).join('\n\n');
}
