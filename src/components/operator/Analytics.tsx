import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useRealtimeRefetch } from '../../hooks/useRealtimeSubscription';
import { TrendingUp, Package, XCircle, DollarSign, ShoppingBag, MapPin } from 'lucide-react';

interface Analytics {
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalRevenue: number;
  losses: number;
  topItems: { name: string; count: number }[];
  topCategories: { name: string; count: number }[];
  topAreas: { name: string; count: number }[];
}

export default function Analytics() {
  const [analytics, setAnalytics] = useState<Analytics>({
    totalOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    totalRevenue: 0,
    losses: 0,
    topItems: [],
    topCategories: [],
    topAreas: []
  });
  const [loading, setLoading] = useState(true);
  const hasLoadedAnalyticsRef = useRef(false);

  useEffect(() => {
    void fetchAnalytics(false);
  }, []);

  useRealtimeRefetch(
    'op-analytics',
    ['orders', 'archive_orders', 'order_items', 'archive_order_items', 'categories', 'items'],
    () => {
      void fetchAnalytics(true);
    }
  );

  const fetchAnalytics = async (silent = false) => {
    if (!silent && !hasLoadedAnalyticsRef.current) {
      setLoading(true);
    }

    const [{ data: orders }, { data: archiveOrders }] = await Promise.all([
      supabase
        .from('orders')
        .select(`
          *,
          customers (id, area, city)
        `),
      supabase
        .from('archive_orders')
        .select('*')
    ]);

    const allOrders = [...(orders || []), ...(archiveOrders || [])];
    if (allOrders.length === 0) {
      hasLoadedAnalyticsRef.current = true;
      setLoading(false);
      return;
    }

    const totalOrders = allOrders.length;
    const completedOrders = allOrders.filter(o => o.status === 'completed').length;
    const cancelledOrders = allOrders.filter(o => o.status === 'cancelled').length;

    const totalRevenue = allOrders
      .filter(o => o.status === 'completed')
      .reduce((sum, o) => sum + parseFloat(o.total_amount.toString()), 0);

    const losses = allOrders
      .filter(o => {
        if (o.status !== 'cancelled') return false;
        const stage = String((o as any).cancellation_stage || '').toLowerCase().trim();
        // "بعد التحضير" includes cancelled from preparing and later delivery stages.
        return ['preparing', 'on_way', 'arrived'].includes(stage);
      })
      .reduce((sum, o) => sum + parseFloat(o.total_amount.toString()), 0);

    const areaCounts: { [key: string]: number } = {};
    allOrders.forEach(o => {
      // Try customers join first, then fall back to customer_info
      const areaFromCustomer = (o as any).customers?.area;
      const areaFromInfo = o.customer_info?.address?.area || o.customer_info?.area;
      const area = areaFromCustomer || areaFromInfo || o.customer_area; // Added extra fallback
      
      if (area && area.trim()) {
        const key = area.trim();
        areaCounts[key] = (areaCounts[key] || 0) + 1;
      }
    });

    const topAreas = Object.entries(areaCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10) // Show more top areas
      .map(([name, count]) => ({ name, count }));

    const [{ data: orderItems }, { data: archiveOrderItems }, { data: categories }, { data: items }] = await Promise.all([
      supabase.from('order_items').select('item_name, quantity, order_id'),
      supabase.from('archive_order_items').select('item_name, quantity, archive_order_id'),
      supabase.from('categories').select('id, name'),
      supabase.from('items').select('id, name, category_id')
    ]);

    const completedOrderIds = new Set((orders || []).filter(o => o.status === 'completed').map(o => o.id));
    const completedArchiveOrderIds = new Set((archiveOrders || []).filter(o => o.status === 'completed').map(o => o.id));

    const completedItems = [
      ...((orderItems || []).filter((item: any) => completedOrderIds.has(item.order_id))),
      ...((archiveOrderItems || []).filter((item: any) => completedArchiveOrderIds.has(item.archive_order_id)))
    ];

    const itemCounts: { [key: string]: number } = {};
    completedItems.forEach((item: any) => {
      itemCounts[item.item_name] = (itemCounts[item.item_name] || 0) + Number(item.quantity || 0);
    });

    const topItems = Object.entries(itemCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const categoryCounts: { [key: string]: number } = {};
    if (categories && items) {
      completedItems.forEach((orderItem: any) => {
        const item = items.find(i => i.name === orderItem.item_name);
        if (item) {
          const category = categories.find(c => c.id === item.category_id);
          if (category) {
            categoryCounts[category.name] = (categoryCounts[category.name] || 0) + Number(orderItem.quantity || 0);
          }
        }
      });
    }

    const topCategories = Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({ name, count }));

    setAnalytics({
      totalOrders,
      completedOrders,
      cancelledOrders,
      totalRevenue,
      losses,
      topItems,
      topCategories,
      topAreas
    });

    hasLoadedAnalyticsRef.current = true;
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-purple-300">جاري تحميل الإحصائيات...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-black text-white text-right mb-6">الإحصائيات والتحليلات</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-blue-700 rounded-xl p-6 border-2 border-blue-400">
          <div className="flex items-center justify-between mb-2">
            <Package className="w-8 h-8 text-blue-200" />
            <h3 className="text-blue-200 font-bold text-right">إجمالي الطلبات</h3>
          </div>
          <p className="text-4xl font-black text-white text-right">{analytics.totalOrders}</p>
        </div>

        <div className="bg-green-700 rounded-xl p-6 border-2 border-green-400">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-8 h-8 text-green-200" />
            <h3 className="text-green-200 font-bold text-right">طلبات مكتملة</h3>
          </div>
          <p className="text-4xl font-black text-white text-right">{analytics.completedOrders}</p>
        </div>

        <div className="bg-red-700 rounded-xl p-6 border-2 border-red-400">
          <div className="flex items-center justify-between mb-2">
            <XCircle className="w-8 h-8 text-red-200" />
            <h3 className="text-red-200 font-bold text-right">طلبات ملغاة</h3>
          </div>
          <p className="text-4xl font-black text-white text-right">{analytics.cancelledOrders}</p>
        </div>

        <div className="bg-primary rounded-xl p-6 border-2 border-primary">
          <div className="flex items-center justify-between mb-2">
            <DollarSign className="w-8 h-8 text-purple-200" />
            <h3 className="text-purple-200 font-bold text-right">إجمالي الإيرادات</h3>
          </div>
          <p className="text-3xl font-black text-white text-right">{analytics.totalRevenue.toFixed(2)} ج</p>
        </div>

        <div className="bg-orange-700 rounded-xl p-6 border-2 border-orange-400">
          <div className="flex items-center justify-between mb-2">
            <XCircle className="w-8 h-8 text-orange-200" />
            <h3 className="text-orange-200 font-bold text-right">الخسائر</h3>
          </div>
          <p className="text-3xl font-black text-white text-right">{analytics.losses.toFixed(2)} ج</p>
          <p className="text-xs text-orange-200 mt-1 text-right">الطلبات الملغاة بعد التحضير</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-6">
          <div className="flex items-center justify-end gap-2 mb-6">
            <h3 className="text-2xl font-bold text-white">أكثر الأصناف طلباً</h3>
            <ShoppingBag className="w-6 h-6 text-purple-400" />
          </div>

          {analytics.topItems.length === 0 ? (
            <p className="text-gray-400 text-center py-8">لا توجد بيانات بعد</p>
          ) : (
            <div className="space-y-3">
              {analytics.topItems.map((item, index) => (
                <div
                  key={item.name}
                  className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-purple-600 text-white w-10 h-10 rounded-full flex items-center justify-center font-bold">
                      {item.count}
                    </div>
                    <span className="text-purple-300 text-sm">طلب</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-white font-bold text-lg">{item.name}</span>
                    <div className="bg-purple-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">
                      {index + 1}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-6">
          <div className="flex items-center justify-end gap-2 mb-6">
            <h3 className="text-2xl font-bold text-white">أكثر الأقسام طلباً</h3>
            <Package className="w-6 h-6 text-purple-400" />
          </div>

          {analytics.topCategories.length === 0 ? (
            <p className="text-gray-400 text-center py-8">لا توجد بيانات بعد</p>
          ) : (
            <div className="space-y-3">
              {analytics.topCategories.map((category, index) => (
                <div
                  key={category.name}
                  className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-purple-600 text-white w-10 h-10 rounded-full flex items-center justify-center font-bold">
                      {category.count}
                    </div>
                    <span className="text-purple-300 text-sm">صنف</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-white font-bold text-lg">{category.name}</span>
                    <div className="bg-purple-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold">
                      {index + 1}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-6 lg:col-span-2">
          <div className="flex items-center justify-end gap-2 mb-6">
            <h3 className="text-2xl font-bold text-white">أكثر المناطق طلباً</h3>
            <MapPin className="w-6 h-6 text-purple-400" />
          </div>

          {analytics.topAreas.length === 0 ? (
            <p className="text-gray-400 text-center py-8">لا توجد بيانات بعد</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {analytics.topAreas.map((area, index) => (
                <div
                  key={area.name}
                  className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="bg-purple-600 text-white w-10 h-10 rounded-full flex items-center justify-center font-bold">
                      {area.count}
                    </div>
                    <span className="text-purple-300 text-sm">طلب</span>
                  </div>

                  <div className="flex items-center gap-3 text-right">
                    <span className="text-white font-bold text-sm truncate max-w-[120px]" title={area.name}>{area.name}</span>
                    <div className="bg-purple-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold flex-shrink-0">
                      {index + 1}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}