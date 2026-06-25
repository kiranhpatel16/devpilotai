import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  FolderKanban,
  History,
  BookOpen,
  BarChart3,
  FileText,
  Scale,
  Users,
  Cpu,
  FolderGit2,
  Bot,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
  badge?: number | string;
  adminOnly?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export const MAIN_NAV: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
      { label: 'Workspaces', to: '/workspaces', icon: FolderKanban },
      { label: 'History', to: '/tasks/history', icon: History },
      { label: 'Reports', to: '/reports', icon: BarChart3 },
      { label: 'Users', to: '/settings/users', icon: Users, adminOnly: true },
      { label: 'AI Providers', to: '/settings/ai-providers', icon: Cpu, adminOnly: true },
      { label: 'AI Rules', to: '/settings/ai-rules', icon: Bot, adminOnly: true },
      { label: 'Projects', to: '/settings/projects', icon: FolderGit2, adminOnly: true },
    ],
  },
  {
    title: 'Knowledge',
    items: [
      { label: 'Project Docs', to: '/knowledge', icon: FileText, end: true },
      { label: 'Client Rules', to: '/knowledge/rules', icon: Scale },
      { label: 'Coding Standards', to: '/knowledge/standards', icon: BookOpen },
    ],
  },
];

export const AGENT_DEFINITIONS = [
  { id: 'planner', label: 'Planner Agent' },
  { id: 'developer', label: 'Developer Agent' },
  { id: 'reviewer', label: 'Reviewer Agent' },
  { id: 'qa', label: 'QA Agent' },
  { id: 'deployment', label: 'Deployment Agent' },
] as const;
