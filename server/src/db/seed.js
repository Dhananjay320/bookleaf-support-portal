import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { getDb, transaction, closeDb } from './index.js';

// Demo credentials (documented in the README). Real deployments would invite users instead.
export const DEMO_AUTHOR_PASSWORD = 'author123';
export const DEMO_ADMINS = [
  { email: 'admin@bookleaf.com', name: 'Aisha Verma (Support Lead)', password: 'admin123' },
  { email: 'ops@bookleaf.com', name: 'Karan Mehta (Operations)', password: 'admin123' },
];

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

// A handful of realistic tickets so the admin queue isn't empty on first load.
// They are pre-triaged (source = 'seed') so the demo works even without an AI key.
const SEED_TICKETS = [
  {
    authorEmail: 'ananya.reddy@email.com', bookId: 'BK005', ageHours: 50, status: 'Open',
    category: 'Royalty & Payments', priority: 'High',
    subject: 'No royalty received since my book was published',
    description: 'My book "Between Two Temples" was published in July 2024 and the dashboard shows ₹2,546 earned, but I have not received a single payout. Is something wrong with my account?',
  },
  {
    authorEmail: 'rohit.kapoor@email.com', bookId: 'BK003', ageHours: 6, status: 'Open',
    category: 'ISBN & Metadata Issues', priority: 'High',
    subject: 'Different ISBN on Amazon vs printed copy',
    description: 'The Amazon India listing for "Code & Karma" shows a different ISBN than what is printed on the back cover of my author copies. Readers are asking me which one is correct.',
  },
  {
    authorEmail: 'vikram.joshi@email.com', bookId: 'BK007', ageHours: 75, status: 'Open',
    category: 'Distribution & Availability', priority: 'Medium',
    subject: '"The Last Monsoon" showing Currently Unavailable on Amazon',
    description: 'Since last week my poetry book shows "Currently Unavailable" on Amazon India. I have a reading event next month and want people to be able to buy it.',
  },
  {
    authorEmail: 'meera.nair@email.com', bookId: null, ageHours: 28, status: 'Open',
    category: 'General Inquiry', priority: 'Low',
    subject: 'Can I update my author bio?',
    description: 'I would like to update the author bio that appears on my book pages. What is the process?',
  },
  {
    authorEmail: 'sneha.kulkarni@email.com', bookId: 'BK013', ageHours: 120, status: 'In Progress',
    category: 'Book Status & Production Updates', priority: 'Medium',
    subject: 'Midnight in Mysore stuck in cover design',
    description: 'It has been almost three weeks and my thriller is still in the Cover Design stage. When can I expect it to move forward?',
    reply: 'Hi Sneha, thank you for checking in, and I understand how eager you are to see "Midnight in Mysore" move forward. The book is currently in the Cover Design stage; our design team shared two concepts on your dashboard and is waiting on your approval of one of them. As soon as you confirm, typesetting starts and we will share an updated schedule within 48 hours. Warm regards, BookLeaf Author Support',
  },
  {
    authorEmail: 'priya.sharma@email.com', bookId: 'BK001', ageHours: 200, status: 'Resolved',
    category: 'Printing & Quality', priority: 'High',
    subject: 'Blurry images in my author copies',
    description: 'I received 20 author copies of "Whispers of the Ganges" and the images on several pages are blurry, and a few pages are misaligned.',
    reply: 'Hi Priya, I am really sorry about this - that is not the quality we want your readers or you to see. Thank you for the photos you shared; our print team has verified the defect and a free reprint of all 20 copies is already scheduled. You should receive them within 5-7 business days, and we will email you the tracking details as soon as they ship. Warm regards, BookLeaf Author Support',
  },
];

function seedAuthorsAndBooks(db, data) {
  const insertAuthor = db.prepare(`
    INSERT INTO authors (id, name, email, phone, city, joined_date)
    VALUES (:id, :name, :email, :phone, :city, :joined_date)`);
  const insertUser = db.prepare(`
    INSERT INTO users (email, password_hash, name, role, author_id)
    VALUES (:email, :password_hash, :name, :role, :author_id)`);
  const insertBook = db.prepare(`
    INSERT INTO books (id, author_id, title, isbn, genre, publication_date, status, mrp,
      author_royalty_per_copy, total_copies_sold, total_royalty_earned, royalty_paid,
      royalty_pending, last_royalty_payout_date, print_partner, available_on)
    VALUES (:id, :author_id, :title, :isbn, :genre, :publication_date, :status, :mrp,
      :author_royalty_per_copy, :total_copies_sold, :total_royalty_earned, :royalty_paid,
      :royalty_pending, :last_royalty_payout_date, :print_partner, :available_on)`);

  // Hash once: bcrypt is deliberately slow and every demo author shares the password.
  const authorHash = bcrypt.hashSync(DEMO_AUTHOR_PASSWORD, 10);

  for (const author of data.authors) {
    insertAuthor.run({
      id: author.author_id,
      name: author.name,
      email: author.email,
      phone: author.phone ?? null,
      city: author.city ?? null,
      joined_date: author.joined_date ?? null,
    });
    insertUser.run({
      email: author.email,
      password_hash: authorHash,
      name: author.name,
      role: 'author',
      author_id: author.author_id,
    });
    for (const book of author.books ?? []) {
      insertBook.run({
        id: book.book_id,
        author_id: author.author_id,
        title: book.title,
        isbn: book.isbn ?? null,
        genre: book.genre ?? null,
        publication_date: book.publication_date ?? null,
        status: book.status,
        mrp: book.mrp ?? null,
        author_royalty_per_copy: book.author_royalty_per_copy ?? null,
        total_copies_sold: book.total_copies_sold ?? 0,
        total_royalty_earned: book.total_royalty_earned ?? 0,
        royalty_paid: book.royalty_paid ?? 0,
        royalty_pending: book.royalty_pending ?? 0,
        last_royalty_payout_date: book.last_royalty_payout_date ?? null,
        print_partner: book.print_partner ?? null,
        available_on: JSON.stringify(book.available_on ?? []),
      });
    }
  }

  for (const admin of DEMO_ADMINS) {
    insertUser.run({
      email: admin.email,
      password_hash: bcrypt.hashSync(admin.password, 10),
      name: admin.name,
      role: 'admin',
      author_id: null,
    });
  }
}

function seedTickets(db) {
  const userByEmail = db.prepare('SELECT id, author_id FROM users WHERE email = ?');
  const supportLead = userByEmail.get(DEMO_ADMINS[0].email);
  const insertTicket = db.prepare(`
    INSERT INTO tickets (author_id, book_id, subject, description, status, category, category_source,
      priority, priority_source, triage_status, assigned_to, created_at, updated_at, first_response_at, resolved_at)
    VALUES (:author_id, :book_id, :subject, :description, :status, :category, 'seed',
      :priority, 'seed', 'done', :assigned_to, :created_at, :updated_at, :first_response_at, :resolved_at)`);
  const insertMessage = db.prepare(`
    INSERT INTO ticket_messages (ticket_id, sender_role, sender_id, body, created_at)
    VALUES (?, 'admin', ?, ?, ?)`);

  for (const t of SEED_TICKETS) {
    const author = userByEmail.get(t.authorEmail);
    const createdAt = hoursAgo(t.ageHours);
    const repliedAt = t.reply ? hoursAgo(t.ageHours - 4) : null;
    const { lastInsertRowid } = insertTicket.run({
      author_id: author.author_id,
      book_id: t.bookId,
      subject: t.subject,
      description: t.description,
      status: t.status,
      category: t.category,
      priority: t.priority,
      assigned_to: t.reply ? supportLead.id : null,
      created_at: createdAt,
      updated_at: repliedAt ?? createdAt,
      first_response_at: repliedAt,
      resolved_at: t.status === 'Resolved' ? repliedAt : null,
    });
    if (t.reply) insertMessage.run(lastInsertRowid, supportLead.id, t.reply, repliedAt);
  }
}

/** Seeds the database from the provided sample dataset if it is empty. Idempotent. */
export function seedIfEmpty({ withSampleTickets = true } = {}) {
  const db = getDb();
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM authors').get();
  if (count > 0) return false;

  const data = JSON.parse(fs.readFileSync(config.sampleDataPath, 'utf8'));
  transaction((conn) => {
    seedAuthorsAndBooks(conn, data);
    if (withSampleTickets) seedTickets(conn);
  });
  console.log(`[seed] Loaded ${data.authors.length} authors and their books from the sample dataset.`);
  return true;
}

function resetDatabase() {
  // Children first so foreign keys are never violated mid-reset.
  const tables = ['ai_calls', 'ai_drafts', 'internal_notes', 'ticket_messages', 'tickets', 'books', 'users', 'authors'];
  transaction((conn) => {
    for (const table of tables) conn.exec(`DELETE FROM ${table}`);
  });
}

// `npm run seed` -> wipe and reseed.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--reset')) resetDatabase();
  seedIfEmpty();
  closeDb();
}
