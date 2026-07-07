import {
  Package, Archive, ShoppingBag, BarChart3, TicketPercent, MapPinned,
  CreditCard, Layout, Lock, Settings, ChevronRight, ChevronDown, Sun, Moon, Globe,
} from 'lucide-react';
import { useState } from 'react';
import { useOperatorPreferences } from '../../contexts/OperatorPreferencesContext';
import { OPERATOR_NAV, type OperatorNavId } from './operatorNav';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Package, Archive, ShoppingBag, BarChart3, TicketPercent, MapPinned,
  CreditCard, Layout, Lock, Settings,
};

interface OperatorSidebarProps {
  active: OperatorNavId;
  onNavigate: (id: OperatorNavId) => void;
}

export default function OperatorSidebar({ active, onNavigate }: OperatorSidebarProps) {
  const { language, theme, toggleTheme, setLanguage, t } = useOperatorPreferences();
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    if (active.startsWith('archive.')) init.archive = true;
    if (active.startsWith('content.')) init.content = true;
    if (active.startsWith('support.')) init.support = true;
    return init;
  });

  const toggleGroup = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const isChildActive = (groupId: string, children?: { id: OperatorNavId }[]) =>
    children?.some((c) => c.id === active) ?? false;

  return (
    <aside className="op-sidebar flex h-full min-h-0 w-[min(100%,17.5rem)] shrink-0 flex-col border-e border-[var(--op-border)] bg-[var(--op-sidebar-bg)]">
      <div className="border-b border-[var(--op-border)] px-4 py-4">
        <h1 className="text-lg font-black text-[var(--op-text)]">{t('لوحة التحكم', 'Control Panel')}</h1>
        <p className="mt-0.5 text-xs text-[var(--op-muted)]">MX Operator</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {OPERATOR_NAV.map((group) => {
          const Icon = ICONS[group.icon] || Settings;
          const hasChildren = Boolean(group.children?.length);
          const isOpen = expanded[group.id] ?? isChildActive(group.id, group.children);
          const isLeafActive = group.leaf === active;

          if (!hasChildren && group.leaf) {
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onNavigate(group.leaf!)}
                className={`op-nav-btn w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors ${isLeafActive ? 'op-nav-btn-active' : ''}`}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-80" />
                <span className="flex-1 text-start">{language === 'ar' ? group.labelAr : group.labelEn}</span>
              </button>
            );
          }

          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={`op-nav-btn w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors ${isChildActive(group.id, group.children) ? 'op-nav-btn-active' : ''}`}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-80" />
                <span className="flex-1 text-start">{language === 'ar' ? group.labelAr : group.labelEn}</span>
                {isOpen ? <ChevronDown className="h-4 w-4 opacity-60" /> : <ChevronRight className="h-4 w-4 opacity-60" />}
              </button>
              {isOpen && group.children && (
                <div className="ms-3 mt-0.5 space-y-0.5 border-s border-[var(--op-border)] ps-2">
                  {group.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => onNavigate(child.id)}
                      className={`op-nav-btn w-full rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors text-start ${active === child.id ? 'op-nav-btn-active' : ''}`}
                    >
                      {language === 'ar' ? child.labelAr : child.labelEn}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-[var(--op-border)] p-3 space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="op-nav-btn flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold"
            title={t('الوضع', 'Theme')}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === 'dark' ? t('فاتح', 'Light') : t('داكن', 'Dark')}
          </button>
          <button
            type="button"
            onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
            className="op-nav-btn flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-bold"
            title={t('اللغة', 'Language')}
          >
            <Globe className="h-4 w-4" />
            {language === 'ar' ? 'EN' : 'AR'}
          </button>
        </div>
      </div>
    </aside>
  );
}
