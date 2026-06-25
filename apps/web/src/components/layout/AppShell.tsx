import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { ExecutionProvider } from '../../context/ExecutionContext';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ExecutionProvider>
      <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-black dark:text-slate-100">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="lg:pl-64">
          <TopBar onMenuClick={() => setMobileOpen(true)} />
          <main className="p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </ExecutionProvider>
  );
}
