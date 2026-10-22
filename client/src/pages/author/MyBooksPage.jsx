import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { EmptyState, ErrorBanner, Loading } from '../../components/ui.jsx';
import { formatDate, formatInr, formatNumber } from '../../utils/format.js';

function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function BookCard({ book }) {
  return (
    <article className="card book">
      <header>
        <div>
          <h3>{book.title}</h3>
          <div className="muted small">{book.genre} · ISBN {book.isbn ?? 'pending'}</div>
        </div>
        <span className={`badge ${book.isPublished ? 'status-resolved' : 'status-in-progress'}`}>{book.status}</span>
      </header>

      {book.isPublished ? (
        <dl className="facts">
          <div><dt>Published</dt><dd>{formatDate(book.publicationDate)}</dd></div>
          <div><dt>MRP</dt><dd>{formatInr(book.mrp)}</dd></div>
          <div><dt>Copies sold</dt><dd>{formatNumber(book.totalCopiesSold)}</dd></div>
          <div><dt>Royalty earned</dt><dd>{formatInr(book.totalRoyaltyEarned)}</dd></div>
          <div><dt>Royalty paid</dt><dd>{formatInr(book.royaltyPaid)}</dd></div>
          <div>
            <dt>Royalty pending</dt>
            <dd className={book.royaltyPending > 0 ? 'accent' : ''}>{formatInr(book.royaltyPending)}</dd>
          </div>
          <div className="wide">
            <dt>Last payout</dt>
            <dd>{book.lastRoyaltyPayoutDate ? formatDate(book.lastRoyaltyPayoutDate) : 'No payout yet'}</dd>
          </div>
          <div className="wide">
            <dt>Available on</dt>
            <dd>{book.availableOn.length ? book.availableOn.join(', ') : 'Not listed yet'}</dd>
          </div>
        </dl>
      ) : (
        <p className="muted">
          This book is still in production, so sales and royalties will appear here once it is published and live.
          We email you at every stage.
        </p>
      )}

      <footer>
        <Link to={`/tickets/new?book=${book.id}`} className="link">Question about this book?</Link>
      </footer>
    </article>
  );
}

export function MyBooksPage() {
  const { data, error, loading, reload } = useApi(() => api('/books'));

  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} onRetry={reload} />;

  const { data: books, summary } = data;
  if (!books.length) {
    return <EmptyState title="No books yet">Once your first book is in production it will show up here.</EmptyState>;
  }

  return (
    <>
      <div className="page-head">
        <h1>My Books</h1>
      </div>
      <section className="stats">
        <Stat label="Books" value={summary.totalBooks}
          hint={summary.inProductionBooks ? `${summary.inProductionBooks} in production` : 'all published'} />
        <Stat label="Copies sold" value={formatNumber(summary.totalCopiesSold)} />
        <Stat label="Royalty earned" value={formatInr(summary.totalRoyaltyEarned)} />
        <Stat label="Royalty paid" value={formatInr(summary.royaltyPaid)} />
        <Stat label="Royalty pending" value={formatInr(summary.royaltyPending)}
          hint="Paid quarterly, within 45 days of quarter end (min ₹1,000)" />
      </section>
      <section className="book-grid">
        {books.map((b) => <BookCard key={b.id} book={b} />)}
      </section>
    </>
  );
}
