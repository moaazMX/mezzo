import { useMemo } from 'react';
import { BarChart3, Calendar, TrendingDown } from 'lucide-react';
import { useRateArchive } from '../../contexts/RateArchiveContext';
import {
  calcOrderRateStats,
  formatMonthLabel,
  formatWeekLabel,
  getMonthKey,
  getWeekKey,
} from '../../lib/rateDiscount';

interface PeriodStats {
  key: string;
  label: string;
  orderCount: number;
  totalDiscountAmount: number;
}

export default function RateStats() {
  const { allOrders, loadingOrders } = useRateArchive();

  const statsOrders = useMemo(
    () =>
      allOrders
        .filter((order) => order.status === 'completed')
        .map((order) => ({
          id: order.id,
          date: order.updated_at || order.created_at,
          items: order.items,
        })),
    [allOrders]
  );

  const buildPeriodStats = (
    groupFn: (date: string) => string,
    labelFn: (key: string) => string
  ): PeriodStats[] => {
    const map = new Map<string, PeriodStats>();

    for (const order of statsOrders) {
      const stats = calcOrderRateStats(order.items, 0);
      if (stats.totalDiscountAmount <= 0) continue;

      const key = groupFn(order.date);
      const existing = map.get(key) || {
        key,
        label: labelFn(key),
        orderCount: 0,
        totalDiscountAmount: 0,
      };

      existing.orderCount += 1;
      existing.totalDiscountAmount += stats.totalDiscountAmount;
      map.set(key, existing);
    }

    return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
  };

  const weeklyStats = useMemo(
    () => buildPeriodStats(getWeekKey, formatWeekLabel),
    [statsOrders]
  );

  const monthlyStats = useMemo(
    () => buildPeriodStats(getMonthKey, formatMonthLabel),
    [statsOrders]
  );

  const totals = useMemo(() => {
    let orderCount = 0;
    let totalDiscountAmount = 0;

    for (const order of statsOrders) {
      const stats = calcOrderRateStats(order.items, 0);
      if (stats.totalDiscountAmount <= 0) continue;
      orderCount += 1;
      totalDiscountAmount += stats.totalDiscountAmount;
    }

    return { orderCount, totalDiscountAmount };
  }, [statsOrders]);

  const renderTable = (title: string, rows: PeriodStats[], icon: React.ReactNode) => (
    <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-4">
      <div className="flex items-center justify-end gap-2 mb-4">
        {icon}
        <h3 className="text-lg font-bold text-white">{title}</h3>
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-400 text-center py-6 text-sm">لا توجد بيانات بعد</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between bg-gray-800/50 rounded-lg p-3 text-sm"
            >
              <span className="text-emerald-300 font-black flex items-center gap-1">
                <TrendingDown className="w-4 h-4" />
                {row.totalDiscountAmount}ج-
              </span>
              <div className="text-right">
                <p className="text-white font-bold">{row.label}</p>
                <p className="text-gray-400 text-xs">{row.orderCount} طلب</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (loadingOrders && allOrders.length === 0) {
    return <div className="text-center text-gray-400 py-12">جاري التحميل...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-purple-900/30 border border-purple-500/30 rounded-xl p-4 text-right">
          <p className="text-gray-400 text-xs">طلبات مُسلَّمة بخصم</p>
          <p className="text-2xl font-black text-white">{totals.orderCount}</p>
        </div>
        <div className="bg-emerald-900/30 border border-emerald-500/30 rounded-xl p-4 text-right">
          <p className="text-gray-400 text-xs">إجمالي المبلغ المخصوم</p>
          <p className="text-2xl font-black text-emerald-300">{totals.totalDiscountAmount}ج-</p>
        </div>
      </div>

      {renderTable('أسبوعياً', weeklyStats, <Calendar className="w-5 h-5 text-purple-400" />)}
      {renderTable('شهرياً', monthlyStats, <BarChart3 className="w-5 h-5 text-purple-400" />)}
    </div>
  );
}
