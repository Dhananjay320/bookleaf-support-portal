import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { ErrorBanner, Loading } from '../../components/ui.jsx';

const MAX_DESCRIPTION = 5000;

export function NewTicketPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const books = useApi(() => api('/books'));

  const [form, setForm] = useState({ bookId: params.get('book') ?? '', subject: '', description: '' });
  const [attachment, setAttachment] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await api('/tickets', {
        method: 'POST',
        body: { ...form, bookId: form.bookId || null, attachmentName: attachment?.name ?? null },
      });
      navigate(`/tickets/${res.data.id}`, { state: { justCreated: true } });
    } catch (err) {
      if (err.code === 'VALIDATION_ERROR') setFieldErrors(err.fieldErrors());
      else setError(err);
      setSubmitting(false);
    }
  }

  if (books.loading) return <Loading />;

  return (
    <>
      <div className="page-head">
        <h1>Get help</h1>
        <p className="muted">Tell us what's going on. Our team typically replies within one business day, and urgent issues much sooner.</p>
      </div>

      <form className="card form" onSubmit={onSubmit} noValidate>
        <ErrorBanner error={books.error ?? error} />

        <label>
          Which book is this about?
          <select value={form.bookId} onChange={set('bookId')}>
            <option value="">General / Account level</option>
            {books.data?.data.map((b) => (
              <option key={b.id} value={b.id}>{b.title}{b.isPublished ? '' : ` (${b.status})`}</option>
            ))}
          </select>
        </label>

        <label>
          Subject
          <input value={form.subject} onChange={set('subject')} maxLength={150} placeholder="e.g. Royalty for last quarter not received" />
          {fieldErrors.subject && <span className="field-error">{fieldErrors.subject}</span>}
        </label>

        <label>
          Describe the issue
          <textarea rows={8} value={form.description} onChange={set('description')} maxLength={MAX_DESCRIPTION}
            placeholder="Include anything that helps us: dates, order numbers, which platform, what you expected to see…" />
          <span className="hint">{form.description.length}/{MAX_DESCRIPTION}</span>
          {fieldErrors.description && <span className="field-error">{fieldErrors.description}</span>}
        </label>

        <label>
          Attachment (optional)
          <input type="file" accept="image/*,.pdf" onChange={(e) => setAttachment(e.target.files[0] ?? null)} />
          <span className="hint">Photos of misprints or screenshots of listings help us resolve things faster. (Demo: file name only, no upload.)</span>
        </label>

        <div className="actions">
          <button type="button" className="ghost" onClick={() => navigate(-1)}>Cancel</button>
          <button className="primary" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit ticket'}</button>
        </div>
      </form>
    </>
  );
}
