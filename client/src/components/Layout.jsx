import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NAV = {
  author: [
    { to: '/books', label: 'My Books' },
    { to: '/tickets', label: 'My Tickets' },
    { to: '/tickets/new', label: 'Get Help' },
  ],
  admin: [{ to: '/admin/tickets', label: 'Ticket Queue' }],
};

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>❦</span> BookLeaf
          <span className="brand-sub">{user.role === 'admin' ? 'Support Console' : 'Author Portal'}</span>
        </div>
        <nav>
          {NAV[user.role].map((item) => (
            <NavLink key={item.to} to={item.to} end>{item.label}</NavLink>
          ))}
        </nav>
        <div className="user">
          <span>{user.name}</span>
          <button className="ghost" onClick={logout}>Log out</button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
