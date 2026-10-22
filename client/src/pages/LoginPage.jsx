import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

// Demo accounts from the seeded dataset, for evaluators.
const DEMO_ACCOUNTS = [
  { label: 'Author: Priya Sharma', email: 'priya.sharma@email.com', password: 'author123' },
  { label: 'Author: Sneha Kulkarni (book in production)', email: 'sneha.kulkarni@email.com', password: 'author123' },
  { label: 'Admin: Support Lead', email: 'admin@bookleaf.com', password: 'admin123' },
];

export function LoginPage() {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(form.email, form.password);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={onSubmit}>
        <div className="brand big"><span className="logo" aria-hidden>❦</span> BookLeaf</div>
        <p className="muted">Sign in to the author portal or the support console.</p>

        <label>
          Email
          <input type="email" autoComplete="email" required value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        {error && <div className="banner error" role="alert">{error}</div>}
        <button className="primary" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>

        <div className="demo">
          <div className="muted small">Demo accounts (any author email from the dataset works with <code>author123</code>):</div>
          {DEMO_ACCOUNTS.map((a) => (
            <button type="button" key={a.email} className="link" onClick={() => setForm({ email: a.email, password: a.password })}>
              {a.label}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
