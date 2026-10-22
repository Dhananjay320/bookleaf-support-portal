import { getDb } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';

export function toBookDto(row) {
  return {
    id: row.id,
    authorId: row.author_id,
    title: row.title,
    isbn: row.isbn,
    genre: row.genre,
    publicationDate: row.publication_date,
    status: row.status,
    isPublished: row.status === 'Published & Live',
    mrp: row.mrp,
    authorRoyaltyPerCopy: row.author_royalty_per_copy,
    totalCopiesSold: row.total_copies_sold,
    totalRoyaltyEarned: row.total_royalty_earned,
    royaltyPaid: row.royalty_paid,
    royaltyPending: row.royalty_pending,
    lastRoyaltyPayoutDate: row.last_royalty_payout_date,
    printPartner: row.print_partner,
    availableOn: JSON.parse(row.available_on),
    ...(row.author_name && { authorName: row.author_name }),
  };
}

const BOOK_SELECT = `
  SELECT b.*, a.name AS author_name
  FROM books b JOIN authors a ON a.id = b.author_id`;

/** Authors only ever see their own books; admins may optionally filter by author. */
export function listBooks(user, { authorId } = {}) {
  const scopeAuthorId = user.role === 'author' ? user.authorId : authorId;
  const rows = scopeAuthorId
    ? getDb().prepare(`${BOOK_SELECT} WHERE b.author_id = ? ORDER BY b.publication_date IS NULL DESC, b.publication_date DESC`).all(scopeAuthorId)
    : getDb().prepare(`${BOOK_SELECT} ORDER BY a.name, b.title`).all();
  return rows.map(toBookDto);
}

export function getBook(user, bookId) {
  const row = getDb().prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(bookId);
  // Return 404 (not 403) for other authors' books so IDs can't be probed.
  if (!row || (user.role === 'author' && row.author_id !== user.authorId)) {
    throw ApiError.notFound('Book');
  }
  return toBookDto(row);
}

/** Account-level totals shown above the "My Books" table. */
export function summarizeBooks(books) {
  return books.reduce(
    (acc, b) => ({
      totalBooks: acc.totalBooks + 1,
      publishedBooks: acc.publishedBooks + (b.isPublished ? 1 : 0),
      inProductionBooks: acc.inProductionBooks + (b.isPublished ? 0 : 1),
      totalCopiesSold: acc.totalCopiesSold + b.totalCopiesSold,
      totalRoyaltyEarned: acc.totalRoyaltyEarned + b.totalRoyaltyEarned,
      royaltyPaid: acc.royaltyPaid + b.royaltyPaid,
      royaltyPending: acc.royaltyPending + b.royaltyPending,
    }),
    { totalBooks: 0, publishedBooks: 0, inProductionBooks: 0, totalCopiesSold: 0, totalRoyaltyEarned: 0, royaltyPaid: 0, royaltyPending: 0 },
  );
}
