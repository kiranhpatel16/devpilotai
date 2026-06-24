/** Slate + Indigo design tokens — high-contrast, dev-platform friendly. */

export const app = {
  bgLight: '#F8FAFC',
  cardLight: '#FFFFFF',
  textLight: '#0F172A',
  mutedLight: '#64748B',
  borderLight: '#E2E8F0',
  trackLight: '#F1F5F9',
  bgDark: '#0F172A',
  cardDark: '#1E293B',
  textDark: '#F1F5F9',
  mutedDark: '#94A3B8',
  borderDark: '#334155',
  trackDark: '#334155',
  accent: '#4F46E5',
  accentLight: '#818CF8',
  sidebarLight: '#1E293B',
  sidebarDark: '#0F172A',
  sidebarIcon: '#CBD5E1',
  sidebarIconDark: '#94A3B8',
  activeNav: '#312E81',
} as const;

/** Chart palette — indigo, cyan, emerald, amber, red. */
export const chartPalette = [
  '#4F46E5',
  '#06B6D4',
  '#10B981',
  '#F59E0B',
  '#818CF8',
  '#34D399',
  '#EF4444',
];

export function getChartTheme(isDark: boolean) {
  return {
    primary: app.accent,
    secondary: isDark ? app.accentLight : '#06B6D4',
    tooltipBg: isDark ? app.cardDark : app.cardLight,
    tooltipBorder: isDark ? app.borderDark : app.borderLight,
    tooltipText: isDark ? app.textDark : app.textLight,
    grid: isDark ? app.borderDark : app.borderLight,
    axis: isDark ? app.mutedDark : app.mutedLight,
    track: isDark ? app.trackDark : app.trackLight,
  };
}
