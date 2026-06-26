import { useState } from 'react';
import { LogOut, Package, BarChart3, Settings, Percent } from 'lucide-react';
import { useRateAuth } from '../contexts/RateAuthContext';
import { RateArchiveProvider } from '../contexts/RateArchiveContext';
import { RealtimeProvider } from '../contexts/RealtimeContext';
import RealtimeIndicator from './RealtimeIndicator';
import RateLogin from './RateLogin';
import RateOrdersManagement from './rate/RateOrdersManagement';
import RateStats from './rate/RateStats';
import RateSettings from './rate/RateSettings';

type Tab = 'orders' | 'stats' | 'settings';

export default function RateDashboard() {
  const { logout } = useRateAuth();
  const [activeTab, setActiveTab] = useState<Tab>('orders');

  const tabs = [
    { id: 'orders' as Tab, label: 'الطلبات', icon: Package },
    { id: 'stats' as Tab, label: 'الإحصائيات', icon: BarChart3 },
    { id: 'settings' as Tab, label: 'الإعدادات', icon: Settings },
  ];

  return (
    <RealtimeProvider>
    <RateArchiveProvider>
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
                <Percent className="w-8 h-8 shrink-0 text-emerald-400" />
                نظام النسب
              </h1>

              <RealtimeIndicator label="مباشر" className="shrink-0" />
            </div>
          </div>
        </header>

        <div className="container mx-auto px-4 py-6">
          <div className="bg-dark/50 rounded-xl border-2 border-primary/50 p-2 mb-6 flex gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 py-3 px-4 rounded-lg transition-all flex items-center justify-center gap-2 font-bold ${
                    activeTab === tab.id
                      ? 'bg-primary text-white shadow-lg'
                      : 'bg-gray-700/50 text-muted hover:bg-gray-700'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="bg-dark/30 rounded-xl border-2 border-primary/30 p-6">
            {activeTab === 'orders' && <RateOrdersManagement />}
            {activeTab === 'stats' && <RateStats />}
            {activeTab === 'settings' && <RateSettings />}
          </div>
        </div>
      </div>
    </RateArchiveProvider>
    </RealtimeProvider>
  );
}

export function RatePage() {
  const { isRateAdmin } = useRateAuth();

  if (isRateAdmin) {
    return <RateDashboard />;
  }

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center">
      <RateLogin />
    </div>
  );
}
