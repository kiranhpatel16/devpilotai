import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { isAdminRole } from '@cpwork/shared';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../lib/api';
import { FOOTER_NAV, MAIN_NAV } from './navConfig';

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-indigo-600/20 text-indigo-300'
      : 'text-slate-300 hover:bg-neutral-900/50 hover:text-white',
  ].join(' ');
}

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const { session } = useAuth();
  const admin = session ? isAdminRole(session.user.globalRole) : false;

  const creditsQ = useQuery({
    queryKey: ['usage', 'credits'],
    queryFn: async () =>
      (await api.get<{ used: number; limit: number; percent: number }>('/usage/credits')).data,
    refetchInterval: 120_000,
  });

  const credits = creditsQ.data;
  const footerItems = FOOTER_NAV.filter((item) => !item.adminOnly || admin);

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-4">
        <div>
          <span className="text-lg font-bold text-white">DevPilot AI</span>
          <p className="text-xs text-slate-400">Engineering Platform</p>
        </div>
        <button
          type="button"
          className="rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-neutral-900/50 hover:text-white lg:hidden"
          onClick={onClose}
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {MAIN_NAV.map((section, i) => (
          <div key={section.title ?? `main-${i}`}>
            {section.title && (
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {section.title}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={navClass}
                  onClick={onClose}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}

        <div className="border-t border-neutral-800 pt-4">
          <div className="space-y-0.5">
            {footerItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={navClass}
                onClick={onClose}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      <div className="border-t border-neutral-800 p-4">
        <div className="mb-1 flex justify-between text-xs text-slate-400">
          <span>AI Credits</span>
          <span>
            {credits
              ? `${credits.used.toLocaleString()} / ${credits.limit.toLocaleString()}`
              : '—'}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${credits?.percent ?? 0}%` }}
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-slate-800 dark:bg-black lg:flex">
        {content}
      </aside>

      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={onClose}
            aria-hidden
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-slate-800 dark:bg-black lg:hidden">
            {content}
          </aside>
        </>
      )}
    </>
  );
}
