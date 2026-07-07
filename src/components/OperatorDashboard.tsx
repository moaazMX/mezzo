import { useState, useEffect, useRef } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { OperatorPreferencesProvider, useOperatorPreferences } from '../contexts/OperatorPreferencesContext';
import { RealtimeProvider } from '../contexts/RealtimeContext';
import RealtimeIndicator from './RealtimeIndicator';
import OperatorSidebar from './operator/OperatorSidebar';
import OrdersManagement, { OrdersManagementHandle } from './operator/OrdersManagement';
import ItemsManagement from './operator/ItemsManagement';
import Analytics from './operator/Analytics';
import SettingsPanel from './operator/SettingsPanel';
import ContentDisplaySettings from './operator/ContentDisplaySettings';
import PaymentMethodsPanel from './operator/PaymentMethodsPanel';
import SiteInterfacePanel from './operator/SiteInterfacePanel';
import DeliveryLayersOverview from './operator/DeliveryLayersOverview';
import ArchiveCustomerPanel from './operator/ArchiveCustomerPanel';
import { navLabel, readStoredOperatorNav, storeOperatorNav, type OperatorNavId } from './operator/operatorNav';
import { supabase } from '../lib/supabase';
import '../operator.css';

function OperatorDashboardInner() {
  const { logout } = useAuth();
  const { language, theme, t } = useOperatorPreferences();
  const liveOrdersRef = useRef<OrdersManagementHandle>(null);
  const archiveOrdersRef = useRef<OrdersManagementHandle>(null);
  const [keepArchiveOrdersMounted, setKeepArchiveOrdersMounted] = useState(() => {
    const nav = readStoredOperatorNav();
    return nav.startsWith('archive.');
  });
  const [activeNav, setActiveNav] = useState<OperatorNavId>(() => readStoredOperatorNav());
  const [focusCustomerPhone, setFocusCustomerPhone] = useState<string | null>(null);
  const [focusCustomerNonce, setFocusCustomerNonce] = useState(0);
  const [customerDeletePassword, setCustomerDeletePassword] = useState('2007');
  const [showDeliveryEditor, setShowDeliveryEditor] = useState(false);

  useEffect(() => {
    storeOperatorNav(activeNav);
    if (activeNav.startsWith('archive.')) {
      setKeepArchiveOrdersMounted(true);
    }
  }, [activeNav]);

  const navigateTo = (id: OperatorNavId) => {
    if (id.startsWith('archive.')) setKeepArchiveOrdersMounted(true);
    setActiveNav(id);
  };

  useEffect(() => {
    void supabase.from('settings').select('value').eq('key', 'customer_delete_password').maybeSingle().then(({ data }) => {
      const val = data?.value?.trim();
      if (val) setCustomerDeletePassword(val);
    });
  }, []);

  useEffect(() => {
    const onFocusCustomer = (evt: Event) => {
      const custom = evt as CustomEvent<{ phone?: string }>;
      const phone = custom.detail?.phone?.trim();
      if (!phone) return;
      setFocusCustomerPhone(phone);
      setFocusCustomerNonce((n) => n + 1);
      navigateTo('archive.customers');
      window.setTimeout(() => setFocusCustomerPhone(null), 1200);
    };
    window.addEventListener('operator-focus-customer', onFocusCustomer as EventListener);
    return () => window.removeEventListener('operator-focus-customer', onFocusCustomer as EventListener);
  }, []);

  const goToOrder = (orderId: string, kind: 'live' | 'archive') => {
    if (kind === 'archive') setKeepArchiveOrdersMounted(true);
    navigateTo(kind === 'archive' ? 'archive.orders' : 'orders');
    window.setTimeout(() => {
      const ref = kind === 'archive' ? archiveOrdersRef : liveOrdersRef;
      ref.current?.revealOrder(orderId, kind);
    }, 80);
  };

  const renderOtherContent = () => {
    switch (activeNav) {
      case 'orders':
      case 'archive.orders':
        return null;
      case 'archive.customers':
        return (
          <ArchiveCustomerPanel
            onNavigateToOrder={goToOrder}
            onNavigateToCustomerOrders={(phone) => {
              setKeepArchiveOrdersMounted(true);
              navigateTo('archive.orders');
              window.setTimeout(() => archiveOrdersRef.current?.focusCustomerByPhone(phone), 80);
            }}
            focusCustomerPhone={focusCustomerPhone}
            focusCustomerToken={focusCustomerNonce}
            customerDeletePassword={customerDeletePassword}
          />
        );
      case 'content.items':
        return <ItemsManagement />;
      case 'content.settings':
        return <ContentDisplaySettings />;
      case 'analytics':
        return <Analytics />;
      case 'coupons':
        return <SettingsPanel section="coupons" hideTitle />;
      case 'delivery':
        return (
          <div className="space-y-4">
            <DeliveryLayersOverview />
            <button
              type="button"
              onClick={() => setShowDeliveryEditor(true)}
              className="op-btn-secondary px-4 py-2 text-sm font-bold"
            >
              {t('فتح محرر خدمات التوصيل', 'Open delivery services editor')}
            </button>
            {showDeliveryEditor && (
              <div className="op-panel">
                <SettingsPanel section="delivery" hideTitle />
              </div>
            )}
          </div>
        );
      case 'payment':
        return <PaymentMethodsPanel />;
      case 'site-interface':
        return <SiteInterfacePanel />;
      case 'security':
        return <SettingsPanel section="security" hideTitle />;
      case 'support.end-day':
        return <SettingsPanel section="end-day" hideTitle />;
      case 'support.site-data':
        return <SettingsPanel section="slot-data" hideTitle />;
      case 'support.reset':
        return <SettingsPanel section="reset" hideTitle />;
      default:
        return null;
    }
  };

  return (
    <div className={`op-shell flex h-[100dvh] min-h-[100dvh] ${theme === 'light' ? 'operator-light' : 'operator-dark'}`}>
      <OperatorSidebar active={activeNav} onNavigate={navigateTo} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="op-main-header flex items-center justify-between gap-4 px-5 py-3">
          <h2 className="text-lg font-black text-[var(--op-text)]">
            {navLabel(activeNav, language)}
          </h2>
          <div className="flex items-center gap-3">
            <RealtimeIndicator label={t('مباشر', 'Live')} className="shrink-0" />
            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-red-500"
            >
              <LogOut className="h-4 w-4" />
              {t('خروج', 'Logout')}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-6xl">
            <div className={activeNav === 'orders' ? 'block' : 'hidden'} aria-hidden={activeNav !== 'orders'}>
              <OrdersManagement ref={liveOrdersRef} mode="live-only" />
            </div>
            {keepArchiveOrdersMounted && (
              <div className={activeNav === 'archive.orders' ? 'block' : 'hidden'} aria-hidden={activeNav !== 'archive.orders'}>
                <OrdersManagement ref={archiveOrdersRef} mode="archive-only" />
              </div>
            )}
            {renderOtherContent()}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function OperatorDashboard() {
  return (
    <OperatorPreferencesProvider>
      <RealtimeProvider>
        <OperatorDashboardInner />
      </RealtimeProvider>
    </OperatorPreferencesProvider>
  );
}
