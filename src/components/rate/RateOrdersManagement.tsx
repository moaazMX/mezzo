import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Archive, CheckCircle, User, Phone, MapPin, X, ArrowDown
} from 'lucide-react';
import { useRateArchive } from '../../contexts/RateArchiveContext';
import {
  calcItemDiscountAmount,
  calcOrderRateStats,
  fetchRateSettings,
  getEffectiveItemPercent,
  type RateSettings,
} from '../../lib/rateDiscount';
import type { RateOrderView } from '../../lib/rateArchiveJson';

export default function RateOrdersManagement() {
  const { allOrders, loadingOrders } = useRateArchive();
  const [rateSettings, setRateSettings] = useState<RateSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<RateOrderView | null>(null);
  const [searchOrderNumber, setSearchOrderNumber] = useState('');
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const modalPositionRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const load = async () => {
      setSettingsLoading(true);
      const s = await fetchRateSettings();
      setRateSettings(s);
      setSettingsLoading(false);
    };
    void load();
  }, []);

  const filteredOrders = useMemo(() => {
    const q = searchOrderNumber.trim();
    if (!q) return allOrders;
    return allOrders.filter((o) => o.order_number.includes(q));
  }, [allOrders, searchOrderNumber]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.modal-drag-handle')) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - modalPositionRef.current.x,
      y: e.clientY - modalPositionRef.current.y,
    };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const next = {
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      };
      modalPositionRef.current = next;
      setModalPosition(next);
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (selectedOrder) {
      const reset = { x: 0, y: 0 };
      modalPositionRef.current = reset;
      setModalPosition(reset);
    }
  }, [selectedOrder]);

  const renderDiscountBadge = (order: RateOrderView) => {
    const stats = calcOrderRateStats(order.items, rateSettings?.percent || 0);
    if (stats.totalDiscountAmount <= 0) return null;

    return (
      <span className="bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full text-xs font-black flex items-center gap-1">
        <ArrowDown className="w-3 h-3" />
        {stats.totalDiscountAmount}ج-
      </span>
    );
  };

  const renderSourceBadge = (order: RateOrderView) => {
    if (order.source === 'archive-import') {
      return (
        <span className="bg-amber-600/20 text-amber-200 border border-amber-500/40 px-2 py-0.5 rounded-full text-[10px] font-bold">
          JSON
        </span>
      );
    }
    if (order.isArchived) {
      return (
        <span className="bg-blue-600/20 text-blue-200 border border-blue-500/40 px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1">
          <Archive className="w-3 h-3" />
          أرشيف
        </span>
      );
    }
    return null;
  };

  const renderOrderBar = (order: RateOrderView) => {
    const customerName = order.customer_name || 'عميل';
    const customerPhone = order.customer_phone || '';
    const address = `${order.customer_street || ''}, ${order.customer_area || ''}, ${order.customer_city || ''}`;

    return (
      <div
        key={order.id}
        onClick={() => setSelectedOrder(order)}
        className="bg-gray-900/45 border border-purple-500/30 rounded-lg px-3 py-2.5 hover:border-purple-400 transition-all cursor-pointer"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="px-3 py-1 rounded-full border flex items-center gap-1.5 shrink-0 bg-green-500/10 border-green-500/30 text-green-400">
              <span className="font-bold text-xs">مكتمل</span>
              <CheckCircle className="w-4 h-4" />
            </div>

            <div className="flex-1 text-right min-w-0">
              <div className="flex items-center justify-end gap-2 flex-wrap">
                {renderSourceBadge(order)}
                {renderDiscountBadge(order)}
                <h3 className="text-base font-bold text-white">#{order.order_number}</h3>
              </div>
              <p className="text-gray-400 text-[10px] mt-1">
                {new Date(order.updated_at || order.created_at).toLocaleDateString('ar-EG', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-right shrink-0">
            <div>
              <div className="flex items-center justify-start gap-2 text-green-400 font-bold text-sm">
                <User className="w-3.5 h-3.5" />
                <span className="leading-tight">{customerName}</span>
              </div>
              {customerPhone && (
                <div className="flex items-center justify-start gap-2 text-green-400/80 text-[11px] font-bold mt-0.5">
                  <Phone className="w-3.5 h-3.5" />
                  <span dir="ltr">{customerPhone}</span>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-start gap-2 text-green-400/80 text-[11px]">
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="max-w-[170px] truncate font-bold">{address}</span>
              </div>
              <div className="text-white font-black text-lg mt-0.5">
                {order.total_amount} <span className="text-xs">ج</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderOrderModal = () => {
    if (!selectedOrder) return null;

    const order = selectedOrder;
    const stats = calcOrderRateStats(order.items, rateSettings?.percent || 0);

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedOrder(null);
        }}
      >
        <div
          className="bg-gray-900 border-2 border-purple-500/30 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          style={{
            transform: `translate(${modalPosition.x}px, ${modalPosition.y}px)`,
            transition: isDragging ? 'none' : 'transform 0.2s',
          }}
          onMouseDown={handleMouseDown}
        >
          <div className="modal-drag-handle cursor-move bg-purple-600/30 hover:bg-purple-600/50 rounded-t-lg p-2 flex items-center justify-between sticky top-0 z-10">
            <button
              onClick={() => setSelectedOrder(null)}
              className="text-white hover:text-red-400 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <span className="text-sm text-white">اسحب للتحريك</span>
          </div>

          <div className="overflow-y-auto flex-1 p-6 custom-scrollbar">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 text-right">
                <h3 className="text-xl font-bold text-white">{order.order_number}</h3>
                <p className="text-gray-400 text-sm">
                  {new Date(order.updated_at || order.created_at).toLocaleDateString('ar-EG', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                {order.importFileName && (
                  <p className="text-amber-300 text-xs mt-1">من ملف: {order.importFileName}</p>
                )}
              </div>
              <div className="bg-green-500/10 border-green-500/30 text-green-400 px-4 py-2 rounded-full border flex items-center gap-2">
                <span className="font-bold text-lg">مكتمل</span>
                <CheckCircle className="w-6 h-6" />
              </div>
            </div>

            {stats.totalDiscountAmount > 0 && (
              <div className="bg-emerald-900/20 border border-emerald-500/40 rounded-lg p-3 mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-300 font-black text-lg">
                  <ArrowDown className="w-5 h-5" />
                  {stats.totalDiscountAmount}ج-
                </div>
                <p className="text-emerald-200 font-bold text-right">إجمالي المبلغ المخصوم</p>
              </div>
            )}

            {(order.customer_name || order.customer_phone) && (
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4 mb-4 text-right">
                <div className="flex items-center justify-start gap-2 text-green-400 font-black text-lg mb-1">
                  <User className="w-5 h-5" />
                  {order.customer_name}
                </div>
                {order.customer_phone && (
                  <div className="flex items-center justify-start gap-2 text-green-400 font-bold">
                    <Phone className="w-5 h-5" />
                    <span dir="ltr">{order.customer_phone}</span>
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-purple-500/30 pt-4 mb-4">
              <h4 className="text-white font-bold mb-2 text-right">الأصناف:</h4>
              <div className="space-y-2">
                {order.items.map((item) => {
                  const pct = getEffectiveItemPercent(item, rateSettings?.percent || 0);
                  const discountAmount = calcItemDiscountAmount(item, rateSettings?.percent || 0);
                  return (
                    <div key={item.id} className="flex items-center justify-between text-sm bg-gray-800/50 p-2 rounded">
                      <div className="flex items-center gap-2">
                        <span className="text-purple-400 font-bold">{item.subtotal} ج</span>
                        {pct > 0 && (
                          <>
                            <span className="text-emerald-400 font-black text-xs bg-emerald-900/30 border border-emerald-500/30 px-2 py-0.5 rounded">
                              {pct}%-
                            </span>
                            <span className="text-emerald-300 font-bold text-xs">{discountAmount}ج-</span>
                          </>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-white">{item.item_name}</span>
                        <span className="text-gray-400 mr-2">x{item.quantity}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between mt-4 pt-4 border-t border-purple-500/30">
                <span className="text-2xl font-black text-white">{order.total_amount} ج</span>
                <span className="text-purple-300 font-bold">المجموع</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-end">
        <input
          type="text"
          value={searchOrderNumber}
          onChange={(e) => setSearchOrderNumber(e.target.value)}
          placeholder="بحث برقم الطلب..."
          className="bg-gray-800 border border-purple-500/30 rounded-lg px-4 py-2 text-white text-right w-full sm:w-64"
          dir="rtl"
        />
      </div>

      <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-lg p-3 text-right text-sm text-emerald-200">
        {settingsLoading || !rateSettings ? (
          <span className="text-gray-400">جاري تحميل نسبة الخصم...</span>
        ) : (
          <>
            نسبة الخصم الحالية: <span className="font-black text-white">{rateSettings.percent}%</span> من قيمة كل صنف
            <span className="text-gray-400 mx-2">|</span>
            <span className="text-gray-300">{allOrders.length} طلب</span>
          </>
        )}
      </div>

      {loadingOrders && allOrders.length === 0 ? (
        <div className="text-center text-gray-400 py-12">جاري تحميل الطلبات...</div>
      ) : filteredOrders.length === 0 ? (
        <div className="text-center text-gray-400 py-12">لا توجد طلبات</div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map(renderOrderBar)}
        </div>
      )}

      {renderOrderModal()}
    </div>
  );
}
