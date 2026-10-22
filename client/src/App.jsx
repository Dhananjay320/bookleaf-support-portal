import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Layout } from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { MyBooksPage } from './pages/author/MyBooksPage.jsx';
import { NewTicketPage } from './pages/author/NewTicketPage.jsx';
import { MyTicketsPage } from './pages/author/MyTicketsPage.jsx';
import { TicketQueuePage } from './pages/admin/TicketQueuePage.jsx';
import { AdminTicketPage } from './pages/admin/AdminTicketPage.jsx';

/** Renders children only for the given role; otherwise sends the user to their home. */
function RequireRole({ role, children }) {
  const { user } = useAuth();
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return children;
}

const homeFor = (user) => (user.role === 'admin' ? '/admin/tickets' : '/books');

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <Loading label="Loading BookLeaf…" />;
  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/books" element={<RequireRole role="author"><MyBooksPage /></RequireRole>} />
        <Route path="/tickets" element={<RequireRole role="author"><MyTicketsPage /></RequireRole>} />
        <Route path="/tickets/new" element={<RequireRole role="author"><NewTicketPage /></RequireRole>} />
        <Route path="/tickets/:id" element={<RequireRole role="author"><MyTicketsPage /></RequireRole>} />
        <Route path="/admin/tickets" element={<RequireRole role="admin"><TicketQueuePage /></RequireRole>} />
        <Route path="/admin/tickets/:id" element={<RequireRole role="admin"><AdminTicketPage /></RequireRole>} />
        <Route path="*" element={<Navigate to={homeFor(user)} replace />} />
      </Route>
    </Routes>
  );
}
