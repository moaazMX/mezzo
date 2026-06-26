import { useState, useEffect, useMemo, useRef } from 'react';
import { CalendarDays, FolderUp, Loader2, Lock, Save, Search, Trash2 } from 'lucide-react';
import { fetchRateSettings, updateRateSettings, updateRateLoginPassword, updateRateSettingsPassword } from '../../lib/rateDiscount';
import { useRateArchive } from '../../contexts/RateArchiveContext';
import { useRealtimeRefetch } from '../../hooks/useRealtimeSubscription';

type AnalysisMode = 'month' | 'week' | 'range';

interface FilteredOrder {
  id: string;
  order_number: string;
  created_at: string;
  updated_at: string;
}

interface AnalysisResult {
  orderCount: number;
  itemCount: number;
  totalSubtotal: number;
  totalDiscountAmount: number;
  effectivePercent: number;
}

export default function RateSettings() {
  const {
    allOrders,
    imports,
    selectedImportName,
    importing,
    selectImport,
    importJsonFile,
    removeImport,
  } = useRateArchive();
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importDrag, setImportDrag] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [percent, setPercent] = useState('');
  const [savedPercent, setSavedPercent] = useState('');
  const [batchPercent, setBatchPercent] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('month');
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));
  const [weekDateValue, setWeekDateValue] = useState(() => new Date().toISOString().slice(0, 10));
  const [rangeStart, setRangeStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [rangeEnd, setRangeEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [filteredOrders, setFilteredOrders] = useState<FilteredOrder[]>([]);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [loginPwdCurrent, setLoginPwdCurrent] = useState('');
  const [loginPwdNew, setLoginPwdNew] = useState('');
  const [loginPwdConfirm, setLoginPwdConfirm] = useState('');
  const [settingsPwdCurrent, setSettingsPwdCurrent] = useState('');
  const [settingsPwdNew, setSettingsPwdNew] = useState('');
  const [settingsPwdConfirm, setSettingsPwdConfirm] = useState('');
  const [savingLoginPwd, setSavingLoginPwd] = useState(false);
  const [savingSettingsPwd, setSavingSettingsPwd] = useState(false);
  const [pwdMessage, setPwdMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const savedPercentRef = useRef(savedPercent);
  savedPercentRef.current = savedPercent;

  const percentChanged = percent.trim() !== savedPercent;

  const dateWindow = useMemo(() => {
    const toIso = (d: Date) => d.toISOString();
    const startOfDay = (value: string) => {
      const d = new Date(value);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    if (analysisMode === 'month') {
      const [year, month] = monthValue.split('-').map(Number);
      const start = new Date(year, (month || 1) - 1, 1);
      const end = new Date(year, month || 1, 1);
      return {
        startIso: toIso(start),
        endIso: toIso(end),
        label: `الشهر: ${monthValue}`,
      };
    }

    if (analysisMode === 'week') {
      const base = startOfDay(weekDateValue);
      const day = base.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(base);
      monday.setDate(base.getDate() + diffToMonday);
      const nextMonday = new Date(monday);
      nextMonday.setDate(monday.getDate() + 7);
      return {
        startIso: toIso(monday),
        endIso: toIso(nextMonday),
        label: `الأسبوع: ${monday.toLocaleDateString('ar-EG')} - ${new Date(nextMonday.getTime() - 1).toLocaleDateString('ar-EG')}`,
      };
    }

    const start = startOfDay(rangeStart);
    const end = startOfDay(rangeEnd);
    end.setDate(end.getDate() + 1);
    return {
      startIso: toIso(start),
      endIso: toIso(end),
      label: `الفترة: ${start.toLocaleDateString('ar-EG')} - ${new Date(end.getTime() - 1).toLocaleDateString('ar-EG')}`,
    };
  }, [analysisMode, monthValue, weekDateValue, rangeStart, rangeEnd]);

  const batchPreview = useMemo(() => {
    const parsed = parseInt(batchPercent, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) return null;

    const start = new Date(dateWindow.startIso).getTime();
    const end = new Date(dateWindow.endIso).getTime();
    let totalSubtotal = 0;

    for (const order of allOrders) {
      if (order.status !== 'completed') continue;
      const ts = new Date(order.updated_at || order.created_at).getTime();
      if (ts < start || ts >= end) continue;
      for (const item of order.items) {
        totalSubtotal += Number(item.subtotal) || 0;
      }
    }

    if (totalSubtotal <= 0) return null;
    const totalDiscountAmount = Math.round((totalSubtotal * parsed) / 100);
    return {
      percent: parsed,
      totalDiscountAmount,
      effectivePercent: Number(((totalDiscountAmount / totalSubtotal) * 100).toFixed(2)),
    };
  }, [allOrders, batchPercent, dateWindow.endIso, dateWindow.startIso]);

  const getOrdersInWindow = (): FilteredOrder[] => {
    const start = new Date(dateWindow.startIso).getTime();
    const end = new Date(dateWindow.endIso).getTime();

    return allOrders
      .filter((order) => order.status === 'completed')
      .filter((order) => {
        const ts = new Date(order.updated_at || order.created_at).getTime();
        return ts >= start && ts < end;
      })
      .map((order) => ({
        id: order.id,
        order_number: order.order_number,
        created_at: order.created_at,
        updated_at: order.updated_at,
      }));
  };

  const runAnalysis = async (silent = false) => {
    if (!silent) setAnalysisMessage(null);
    if (!silent) setLoadingAnalysis(true);
    try {
      const windowOrders = getOrdersInWindow();
      setFilteredOrders(windowOrders);

      if (windowOrders.length === 0) {
        setAnalysisResult({
          orderCount: 0,
          itemCount: 0,
          totalSubtotal: 0,
          totalDiscountAmount: 0,
          effectivePercent: 0,
        });
        setAnalysisMessage({ type: 'ok', text: 'لا توجد طلبات مكتملة في هذه الفترة' });
        return;
      }

      const orderMap = new Map(allOrders.map((order) => [order.id, order]));
      let totalSubtotal = 0;
      let totalDiscountAmount = 0;
      let itemCount = 0;

      for (const entry of windowOrders) {
        const order = orderMap.get(entry.id);
        if (!order) continue;
        for (const item of order.items) {
          const subtotal = Number(item.subtotal) || 0;
          const pct = Number(item.rate_discount_percent) || parseInt(savedPercentRef.current, 10) || 0;
          totalSubtotal += subtotal;
          totalDiscountAmount += Math.round((subtotal * pct) / 100);
          itemCount += 1;
        }
      }

      const effectivePercent = totalSubtotal > 0
        ? Number(((totalDiscountAmount / totalSubtotal) * 100).toFixed(2))
        : 0;

      setAnalysisResult({
        orderCount: windowOrders.length,
        itemCount,
        totalSubtotal,
        totalDiscountAmount,
        effectivePercent,
      });
      setAnalysisMessage({ type: 'ok', text: `تم تحليل ${windowOrders.length} طلب` });
    } catch (e: any) {
      setAnalysisMessage({ type: 'err', text: e?.message || 'تعذر تحليل الفترة' });
    } finally {
      setLoadingAnalysis(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      const s = await fetchRateSettings();
      const value = String(s.percent);
      setPercent(value);
      setSavedPercent(value);
      setBatchPercent(value);
      setLoading(false);
    };
    void load();
  }, []);

  useRealtimeRefetch('rate-settings-realtime', ['settings'], async () => {
    const s = await fetchRateSettings();
    const value = String(s.percent);
    setSavedPercent(value);
    setPercent((current) => (current === savedPercentRef.current ? value : current));
  });

  useEffect(() => {
    void runAnalysis(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateWindow.startIso, dateWindow.endIso, allOrders, savedPercent]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!percentChanged) return;

    setMessage(null);
    setSaving(true);

    const result = await updateRateSettings(
      { percent: parseInt(percent, 10) },
      password
    );

    if (result.ok) {
      setSavedPercent(percent);
      setBatchPercent(percent);
      setMessage({ type: 'ok', text: 'تم حفظ النسبة — ستُطبَّق على الطلبات الجديدة فقط' });
      setPassword('');
    } else {
      setMessage({ type: 'err', text: result.error || 'فشل الحفظ' });
    }

    setSaving(false);
  };

  const handleChangeLoginPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMessage(null);
    if (loginPwdNew !== loginPwdConfirm) {
      setPwdMessage({ type: 'err', text: 'كلمة المرور الجديدة غير متطابقة' });
      return;
    }
    setSavingLoginPwd(true);
    const result = await updateRateLoginPassword(loginPwdCurrent, loginPwdNew);
    if (result.ok) {
      setPwdMessage({ type: 'ok', text: 'تم تغيير كلمة مرور تسجيل الدخول' });
      setLoginPwdCurrent('');
      setLoginPwdNew('');
      setLoginPwdConfirm('');
    } else {
      setPwdMessage({ type: 'err', text: result.error || 'فشل تغيير كلمة المرور' });
    }
    setSavingLoginPwd(false);
  };

  const handleChangeSettingsPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMessage(null);
    if (settingsPwdNew !== settingsPwdConfirm) {
      setPwdMessage({ type: 'err', text: 'كلمة المرور الجديدة غير متطابقة' });
      return;
    }
    setSavingSettingsPwd(true);
    const result = await updateRateSettingsPassword(settingsPwdCurrent, settingsPwdNew);
    if (result.ok) {
      setPwdMessage({ type: 'ok', text: 'تم تغيير كلمة مرور تعديل النسب' });
      setSettingsPwdCurrent('');
      setSettingsPwdNew('');
      setSettingsPwdConfirm('');
    } else {
      setPwdMessage({ type: 'err', text: result.error || 'فشل تغيير كلمة المرور' });
    }
    setSavingSettingsPwd(false);
  };

  const handleImportFile = async (file: File) => {
    setImportMessage(null);
    const result = await importJsonFile(file);
    if (result.ok) {
      setImportMessage({ type: 'ok', text: `تم استيراد ${file.name} بنجاح` });
    } else {
      setImportMessage({ type: 'err', text: result.error || 'تعذر استيراد الملف' });
    }
  };

  if (loading) {
    return <div className="text-center text-gray-400 py-12">جاري التحميل...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <form onSubmit={handleSave} className="space-y-5">
        <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-5 space-y-4">
          <h3 className="text-white font-bold text-right text-lg">إعدادات الخصم</h3>

          <div>
            <label className="block text-muted mb-2 text-right text-sm">نسبة الخصم لكل صنف %</label>
            <input
              type="number"
              min={1}
              max={100}
              value={percent}
              onChange={(e) => {
                setPercent(e.target.value);
                setMessage(null);
              }}
              className="w-full bg-gray-800 border border-purple-500/30 rounded-lg px-4 py-3 text-white text-right text-lg font-bold"
              dir="rtl"
            />
            <p className="text-gray-500 text-xs mt-1 text-right">
              تُطبَّق على الطلبات الجديدة فقط. الطلبات السابقة تحتفظ بنسبتها المحفوظة ولا تتغير.
            </p>
          </div>
        </div>

        <div className="bg-gray-900/50 border-2 border-cyan-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-end gap-2">
            <CalendarDays className="w-5 h-5 text-cyan-300" />
            <h3 className="text-white font-bold text-right text-lg">فحص الخصم حسب الفترة</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setAnalysisMode('month')}
              className={`rounded-lg py-2 font-bold ${analysisMode === 'month' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-300'}`}
            >
              شهر
            </button>
            <button
              type="button"
              onClick={() => setAnalysisMode('week')}
              className={`rounded-lg py-2 font-bold ${analysisMode === 'week' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-300'}`}
            >
              أسبوع
            </button>
            <button
              type="button"
              onClick={() => setAnalysisMode('range')}
              className={`rounded-lg py-2 font-bold ${analysisMode === 'range' ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-300'}`}
            >
              من يوم إلى يوم
            </button>
          </div>

          {analysisMode === 'month' && (
            <input
              type="month"
              value={monthValue}
              onChange={(e) => setMonthValue(e.target.value)}
              className="w-full bg-gray-800 border border-cyan-500/30 rounded-lg px-4 py-2.5 text-white text-right"
              dir="rtl"
            />
          )}

          {analysisMode === 'week' && (
            <input
              type="date"
              value={weekDateValue}
              onChange={(e) => setWeekDateValue(e.target.value)}
              className="w-full bg-gray-800 border border-cyan-500/30 rounded-lg px-4 py-2.5 text-white text-right"
              dir="rtl"
            />
          )}

          {analysisMode === 'range' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="date"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                className="w-full bg-gray-800 border border-cyan-500/30 rounded-lg px-4 py-2.5 text-white text-right"
                dir="rtl"
              />
              <input
                type="date"
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
                className="w-full bg-gray-800 border border-cyan-500/30 rounded-lg px-4 py-2.5 text-white text-right"
                dir="rtl"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void runAnalysis(false)}
              disabled={loadingAnalysis}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-bold inline-flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              {loadingAnalysis ? 'جاري الفحص...' : 'فحص'}
            </button>
            <p className="text-cyan-200 text-xs text-right">{dateWindow.label}</p>
          </div>

          {analysisResult && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-gray-800/80 rounded-lg p-3 text-right">
                <p className="text-gray-400 text-xs">الطلبات</p>
                <p className="text-white font-black text-lg">{analysisResult.orderCount}</p>
              </div>
              <div className="bg-gray-800/80 rounded-lg p-3 text-right">
                <p className="text-gray-400 text-xs">الأصناف</p>
                <p className="text-white font-black text-lg">{analysisResult.itemCount}</p>
              </div>
              <div className="bg-gray-800/80 rounded-lg p-3 text-right">
                <p className="text-gray-400 text-xs">إجمالي الخصم</p>
                <p className="text-emerald-300 font-black text-lg">{analysisResult.totalDiscountAmount}ج-</p>
              </div>
              <div className="bg-gray-800/80 rounded-lg p-3 text-right">
                <p className="text-gray-400 text-xs">نسبة الخصم الفعلية</p>
                <p className="text-cyan-300 font-black text-lg">{analysisResult.effectivePercent}%</p>
              </div>
            </div>
          )}

          <div className="bg-gray-900/60 border border-amber-500/30 rounded-lg p-4 space-y-3">
            <label className="block text-muted text-sm text-right">محاكاة نسبة الخصم للفترة (للعرض فقط) %</label>
            <input
              type="number"
              min={1}
              max={100}
              value={batchPercent}
              onChange={(e) => setBatchPercent(e.target.value)}
              className="w-full bg-gray-800 border border-amber-500/30 rounded-lg px-4 py-2.5 text-white text-right font-bold"
              dir="rtl"
            />
            {batchPreview ? (
              <p className="text-amber-200/90 text-xs text-right">
                معاينة محاكاة: خصم <span className="font-black text-white">{batchPreview.totalDiscountAmount}ج-</span>
                {' '}({batchPreview.effectivePercent}%) — لا يغيّر الطلبات الفعلية
              </p>
            ) : (
              <p className="text-gray-500 text-xs text-right">أدخل نسبة لمحاكاة الخصم على طلبات هذه الفترة</p>
            )}
          </div>

          <div className="bg-gray-800/40 rounded-lg p-3 text-right">
            <p className="text-gray-400 text-xs mb-2">آخر الطلبات داخل الفحص</p>
            {filteredOrders.length === 0 ? (
              <p className="text-gray-500 text-xs">لا توجد طلبات لعرضها</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-auto pr-1">
                {filteredOrders.slice(0, 20).map((order) => (
                  <div key={order.id} className="text-xs text-gray-200 flex items-center justify-between gap-2">
                    <span className="text-cyan-300">{new Date(order.updated_at || order.created_at).toLocaleDateString('ar-EG')}</span>
                    <span className="font-bold">#{order.order_number}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {percentChanged && (
          <div className="bg-gray-900/50 border-2 border-emerald-500/30 rounded-xl p-5 animate-in fade-in">
            <label className="block text-muted mb-2 text-right text-sm">كلمة مرور تعديل النسب للتأكيد</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400 w-5 h-5" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-emerald-500/30 rounded-lg px-12 py-3 text-white text-right"
                placeholder="أدخل كلمة المرور"
                dir="rtl"
                required
                autoFocus
              />
            </div>
          </div>
        )}

        {message && (
          <div
            className={`px-4 py-3 rounded-lg text-right text-sm font-bold ${
              message.type === 'ok'
                ? 'bg-green-500/20 border border-green-500 text-green-300'
                : 'bg-red-500/20 border border-red-500 text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        {analysisMessage && (
          <div
            className={`px-4 py-3 rounded-lg text-right text-sm font-bold ${
              analysisMessage.type === 'ok'
                ? 'bg-cyan-500/15 border border-cyan-500 text-cyan-200'
                : 'bg-red-500/20 border border-red-500 text-red-300'
            }`}
          >
            {analysisMessage.text}
          </div>
        )}

        {percentChanged && (
          <button
            type="submit"
            disabled={saving || !password}
            className="w-full bg-primary hover:bg-primary/80 disabled:bg-purple-800 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5" />
            {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </button>
        )}
      </form>

      <div className="mt-6 bg-gray-900/50 border-2 border-indigo-500/30 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-end gap-2">
          <FolderUp className="w-5 h-5 text-indigo-300" />
          <h3 className="text-white font-bold text-right text-lg">استيراد أرشيف JSON</h3>
        </div>
        <p className="text-gray-400 text-xs text-right">
          اسحب ملف JSON مُصدَّر من الأوبراتور لعرض طلباته في صفحة النسب. يمكنك حفظ أكثر من ملف والتبديل بينها.
        </p>

        <input
          ref={importFileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = '';
          }}
        />

        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              importFileInputRef.current?.click();
            }
          }}
          onClick={() => !importing && importFileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setImportDrag(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setImportDrag(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setImportDrag(false);
            const file = e.dataTransfer.files?.[0];
            if (file && !importing) void handleImportFile(file);
          }}
          className={`w-full min-h-[120px] border-2 border-dashed rounded-xl px-4 py-6 text-center transition-colors flex flex-col items-center justify-center gap-2 font-bold text-sm cursor-pointer select-none ${
            importDrag
              ? 'border-indigo-400 bg-indigo-500/15 text-white'
              : 'border-indigo-500/40 bg-gray-900/40 text-indigo-200 hover:border-indigo-400/60'
          } ${importing ? 'opacity-50 pointer-events-none' : ''}`}
        >
          {importing ? <Loader2 className="w-8 h-8 animate-spin text-indigo-300" /> : <FolderUp className="w-8 h-8 text-indigo-300" />}
          <span>اسحب ملف JSON هنا أو انقر للاستيراد</span>
        </div>

        {importMessage && (
          <div
            className={`px-4 py-3 rounded-lg text-right text-sm font-bold ${
              importMessage.type === 'ok'
                ? 'bg-green-500/20 border border-green-500 text-green-300'
                : 'bg-red-500/20 border border-red-500 text-red-300'
            }`}
          >
            {importMessage.text}
          </div>
        )}

        {imports.length > 0 && (
          <div className="space-y-2">
            <p className="text-white font-bold text-right text-sm">ملفات JSON المحفوظة على هذا الجهاز</p>
            {imports.map((entry) => (
              <div
                key={entry.name}
                className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg p-3 border ${
                  selectedImportName === entry.name
                    ? 'bg-indigo-950/50 border-indigo-400/60'
                    : 'bg-gray-800/40 border-indigo-500/20'
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectImport(entry.name)}
                  className="flex-1 text-right min-w-0"
                >
                  <p className="text-white font-bold truncate" dir="ltr">{entry.name}</p>
                  <p className="text-xs text-gray-400">
                    {entry.orderCount} طلب • {new Date(entry.updatedAt).toLocaleString('ar-EG')}
                  </p>
                </button>
                <div className="flex items-center justify-end gap-2">
                  {selectedImportName === entry.name && (
                    <span className="text-xs font-black text-indigo-200 bg-indigo-700/60 px-2 py-0.5 rounded">
                      نشط
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void removeImport(entry.name)}
                    className="p-2 rounded-lg bg-red-900/40 hover:bg-red-800/60 border border-red-500/30 text-red-200"
                    aria-label="حذف الملف"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            {selectedImportName && (
              <button
                type="button"
                onClick={() => selectImport('')}
                className="w-full text-sm text-gray-300 hover:text-white py-2"
              >
                إلغاء تحديد ملف JSON (عرض قاعدة البيانات فقط)
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 space-y-5">
        {pwdMessage && (
          <div
            className={`px-4 py-3 rounded-lg text-right text-sm font-bold ${
              pwdMessage.type === 'ok'
                ? 'bg-green-500/20 border border-green-500 text-green-300'
                : 'bg-red-500/20 border border-red-500 text-red-300'
            }`}
          >
            {pwdMessage.text}
          </div>
        )}

        <form onSubmit={handleChangeLoginPassword} className="bg-gray-900/50 border-2 border-blue-500/30 rounded-xl p-5 space-y-4">
          <h3 className="text-white font-bold text-right text-lg">تغيير كلمة مرور تسجيل الدخول</h3>
          <div>
            <label className="block text-muted mb-2 text-right text-sm">كلمة المرور الحالية</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-400 w-5 h-5" />
              <input
                type="password"
                value={loginPwdCurrent}
                onChange={(e) => setLoginPwdCurrent(e.target.value)}
                className="w-full bg-gray-800 border border-blue-500/30 rounded-lg px-12 py-3 text-white text-right"
                dir="rtl"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-muted mb-2 text-right text-sm">كلمة المرور الجديدة</label>
            <input
              type="password"
              value={loginPwdNew}
              onChange={(e) => setLoginPwdNew(e.target.value)}
              className="w-full bg-gray-800 border border-blue-500/30 rounded-lg px-4 py-3 text-white text-right"
              dir="rtl"
              required
              minLength={4}
            />
          </div>
          <div>
            <label className="block text-muted mb-2 text-right text-sm">تأكيد كلمة المرور الجديدة</label>
            <input
              type="password"
              value={loginPwdConfirm}
              onChange={(e) => setLoginPwdConfirm(e.target.value)}
              className="w-full bg-gray-800 border border-blue-500/30 rounded-lg px-4 py-3 text-white text-right"
              dir="rtl"
              required
              minLength={4}
            />
          </div>
          <button
            type="submit"
            disabled={savingLoginPwd}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white py-3 rounded-lg font-bold"
          >
            {savingLoginPwd ? 'جاري الحفظ...' : 'حفظ كلمة مرور الدخول'}
          </button>
        </form>

        <form onSubmit={handleChangeSettingsPassword} className="bg-gray-900/50 border-2 border-emerald-500/30 rounded-xl p-5 space-y-4">
          <h3 className="text-white font-bold text-right text-lg">تغيير كلمة مرور تعديل النسب</h3>
          <p className="text-gray-500 text-xs text-right">تُستخدم لتأكيد حفظ نسبة الخصم الافتراضية</p>
          <div>
            <label className="block text-muted mb-2 text-right text-sm">كلمة المرور الحالية</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400 w-5 h-5" />
              <input
                type="password"
                value={settingsPwdCurrent}
                onChange={(e) => setSettingsPwdCurrent(e.target.value)}
                className="w-full bg-gray-800 border border-emerald-500/30 rounded-lg px-12 py-3 text-white text-right"
                dir="rtl"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-muted mb-2 text-right text-sm">كلمة المرور الجديدة</label>
            <input
              type="password"
              value={settingsPwdNew}
              onChange={(e) => setSettingsPwdNew(e.target.value)}
              className="w-full bg-gray-800 border border-emerald-500/30 rounded-lg px-4 py-3 text-white text-right"
              dir="rtl"
              required
              minLength={4}
            />
          </div>
          <div>
            <label className="block text-muted mb-2 text-right text-sm">تأكيد كلمة المرور الجديدة</label>
            <input
              type="password"
              value={settingsPwdConfirm}
              onChange={(e) => setSettingsPwdConfirm(e.target.value)}
              className="w-full bg-gray-800 border border-emerald-500/30 rounded-lg px-4 py-3 text-white text-right"
              dir="rtl"
              required
              minLength={4}
            />
          </div>
          <button
            type="submit"
            disabled={savingSettingsPwd}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white py-3 rounded-lg font-bold"
          >
            {savingSettingsPwd ? 'جاري الحفظ...' : 'حفظ كلمة مرور تعديل النسب'}
          </button>
        </form>
      </div>
    </div>
  );
}
