import { useState, useRef, useEffect } from 'react';
import { LogOut, Package, ShoppingBag, BarChart3, Settings, List } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import OrdersManagement, { OrdersManagementHandle } from './operator/OrdersManagement';
import ItemsManagement from './operator/ItemsManagement';
import Analytics from './operator/Analytics';
import SettingsPanel from './operator/SettingsPanel';

type Tab = 'orders' | 'items' | 'analytics' | 'settings';

export default function OperatorDashboard() {
  const { logout } = useAuth();
  const ordersRef = useRef<OrdersManagementHandle>(null);
  const [activeTab, setActiveTab] = useState<Tab>('orders');
  const [focusCustomerPhone, setFocusCustomerPhone] = useState<string | null>(null);
  const [focusCustomerNonce, setFocusCustomerNonce] = useState(0);

  useEffect(() => {
    const onFocusCustomer = (evt: Event) => {
      const custom = evt as CustomEvent<{ phone?: string }>;
      const phone = custom.detail?.phone?.trim();
      if (!phone) return;
      setFocusCustomerPhone(phone);
      setFocusCustomerNonce((n) => n + 1);
      setActiveTab('settings');
      window.setTimeout(() => setFocusCustomerPhone(null), 1200);
    };
    window.addEventListener('operator-focus-customer', onFocusCustomer as EventListener);
    return () => {
      window.removeEventListener('operator-focus-customer', onFocusCustomer as EventListener);
    };
  }, []);

  const goToOrder = (orderId: string, kind: 'live' | 'archive') => {
    setActiveTab('orders');
    window.setTimeout(() => {
      ordersRef.current?.revealOrder(orderId, kind);
    }, 80);
  };

  const tabs = [
    { id: 'orders' as Tab, label: 'الطلبات', icon: Package },
    { id: 'items' as Tab, label: 'الأصناف', icon: ShoppingBag },
    { id: 'analytics' as Tab, label: 'الإحصائيات', icon: BarChart3 },
    { id: 'settings' as Tab, label: 'الإعدادات', icon: Settings }
  ];

  return (
    <div className="min-h-screen bg-dark">
      <header className="bg-dark/80 backdrop-blur-sm border-b-2 border-primary sticky top-0 z-40 shadow-xl">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={logout}
              className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2 font-bold shrink-0"
            >
              <LogOut className="w-5 h-5" />
              <span>خروج</span>
            </button>

            <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-2">
              <List className="w-8 h-8 shrink-0" />
              لوحة التحكم
            </h1>

            <div className="w-24 shrink-0" aria-hidden />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        <div className="bg-dark/50 rounded-xl border-2 border-primary/50 p-2 mb-6 flex gap-2">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 font-bold ${activeTab === tab.id
                  ? 'bg-primary text-white shadow-lg'
                  : 'bg-gray-700/50 text-muted hover:bg-gray-700'
                  }`}
              >
                <Icon className="w-5 h-5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="bg-dark/30 rounded-xl border-2 border-primary/30 p-6">
          {activeTab === 'orders' && <OrdersManagement ref={ordersRef} />}
          {activeTab === 'items' && <ItemsManagement />}
          {activeTab === 'analytics' && <Analytics />}
          {activeTab === 'settings' && (
            <SettingsPanel
              focusCustomerPhone={focusCustomerPhone}
              focusCustomerToken={focusCustomerNonce}
              onNavigateToCustomerOrders={(phone) => {
                setActiveTab('orders');
                window.setTimeout(() => ordersRef.current?.focusCustomerByPhone(phone), 80);
              }}
              onNavigateToOrder={(orderId, kind) => goToOrder(orderId, kind)}
            />
          )}
        </div>
      </div>
    </div>
  );
}