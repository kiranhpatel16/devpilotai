import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { isAdminRole } from '@cpwork/shared';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-600 text-white'
      : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700',
  ].join(' ');
}

function SunIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export function AppLayout() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const admin = session ? isAdminRole(session.user.globalRole) : false;
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const navLinks = (
    <>
      {admin && (
        <>
          <NavLink to="/admin" end className={navClass} onClick={() => setMobileOpen(false)}>
            Dashboard
          </NavLink>
          <NavLink to="/admin/users" className={navClass} onClick={() => setMobileOpen(false)}>
            Users
          </NavLink>
          <NavLink to="/admin/projects" className={navClass} onClick={() => setMobileOpen(false)}>
            Projects
          </NavLink>
          <NavLink to="/admin/ai-providers" className={navClass} onClick={() => setMobileOpen(false)}>
            AI Providers
          </NavLink>
        </>
      )}
      <NavLink to="/agent" className={navClass} onClick={() => setMobileOpen(false)}>
        My Work
      </NavLink>
      <NavLink to="/my-environments" className={navClass} onClick={() => setMobileOpen(false)}>
        My Environments
      </NavLink>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 transition-colors">
      <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 sticky top-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          {/* Logo + desktop nav */}
          <div className="flex items-center gap-4 md:gap-6">
            <span className="text-lg font-bold text-brand-700 dark:text-brand-400 shrink-0">
              CPWork
            </span>
            <nav className="hidden md:flex items-center gap-1 flex-wrap">
              {navLinks}
            </nav>
          </div>

          {/* Right-side controls */}
          <div className="flex items-center gap-2 md:gap-3">
            {/* User info — hidden on very small screens */}
            <span className="hidden sm:flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
              <span>{session?.user.displayName}</span>
              <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {session?.user.globalRole}
              </span>
            </span>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="btn-ghost rounded-full p-2"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>

            {/* Logout — hidden on small screens (shown in mobile menu) */}
            <button className="btn-secondary hidden sm:inline-flex" onClick={handleLogout}>
              Logout
            </button>

            {/* Mobile hamburger */}
            <button
              className="btn-ghost md:hidden rounded-full p-2"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <XIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>

        {/* Mobile nav drawer */}
        {mobileOpen && (
          <div className="md:hidden border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 flex flex-col gap-1">
            {navLinks}
            <div className="pt-2 mt-1 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {session?.user.displayName}{' '}
                <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {session?.user.globalRole}
                </span>
              </span>
              <button className="btn-secondary" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
