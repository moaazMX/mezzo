import { useEffect, useState, useCallback, useRef } from 'react';
import { Save, Loader2, Plus, Trash2, CreditCard } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useOperatorPreferences } from '../../contexts/OperatorPreferencesContext';
import { useRealtimeRefetch } from '../../hooks/useRealtimeSubscription';

export type PaymentMethod = {
  id: string;
  label: string;
  number: string;
  type: string;
};

const DEFAULT_METHODS: PaymentMethod[] = [
  { id: 'instant-default', label: 'تحويل فوري', number: '', type: 'fawry' },
];

function parseMethods(raw: string | undefined, fallbackNumber: string): PaymentMethod[] {
  if (!raw?.trim()) {
    return [{ ...DEFAULT_METHODS[0], number: fallbackNumber }];
  }
  try {
    const parsed = JSON.parse(raw) as PaymentMethod[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    /* ignore */
  }
  return [{ ...DEFAULT_METHODS[0], number: fallbackNumber }];
}

export default function PaymentMethodsPanel() {
  const { t } = useOperatorPreferences();
  const [methods, setMethods] = useState<PaymentMethod[]>(DEFAULT_METHODS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const savingRef = useRef(false);

  const loadMethods = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('settings').select('key, value').in('key', ['payment_methods', 'instant_transfer_number']);
    const map = new Map((data || []).map((r) => [r.key, r.value]));
    setMethods(parseMethods(map.get('payment_methods'), map.get('instant_transfer_number') || ''));
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadMethods();
  }, [loadMethods]);

  useRealtimeRefetch('op-payment-methods', ['settings'], () => {
    if (savingRef.current) return;
    void loadMethods();
  });

  const updateMethod = (id: string, patch: Partial<PaymentMethod>) => {
    setMethods((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const addMethod = () => {
    setMethods((prev) => [
      ...prev,
      { id: `pm-${Date.now()}`, label: t('طريقة جديدة', 'New method'), number: '', type: 'other' },
    ]);
  };

  const removeMethod = (id: string) => {
    setMethods((prev) => (prev.length <= 1 ? prev : prev.filter((m) => m.id !== id)));
  };

  const handleSave = async () => {
    setSaving(true);
    savingRef.current = true;
    setMessage(null);
    try {
      const json = JSON.stringify(methods);
      await supabase.from('settings').upsert({ key: 'payment_methods', value: json }, { onConflict: 'key' });
      const primary = methods[0];
      if (primary?.number) {
        await supabase.from('settings').upsert({ key: 'instant_transfer_number', value: primary.number }, { onConflict: 'key' });
      }
      setMessage(t('تم حفظ طرق الدفع', 'Payment methods saved'));
    } catch {
      setMessage(t('تعذر الحفظ', 'Could not save'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-[var(--op-text)] text-start flex items-center gap-2">
          <CreditCard className="h-6 w-6 text-[var(--op-accent)]" />
          {t('طرق الدفع', 'Payment Methods')}
        </h2>
        <p className="mt-1 text-sm text-[var(--op-muted)] text-start">
          {t('أضف طرق دفع متعددة: فوري، فودافون كاش، إنستا باي، فيزا، وغيرها', 'Add Fawry, Vodafone Cash, InstaPay, Visa, and more')}
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm font-bold text-green-200 text-center">{message}</div>
      )}

      <div className="op-panel space-y-4">
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[var(--op-muted)]" /></div>
        ) : (
          methods.map((method) => (
            <div key={method.id} className="rounded-xl border border-[var(--op-border)] bg-[var(--op-surface)] p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <input
                  type="text"
                  value={method.label}
                  onChange={(e) => updateMethod(method.id, { label: e.target.value })}
                  className="op-input flex-1"
                  placeholder={t('اسم الطريقة', 'Method name')}
                />
                {methods.length > 1 && (
                  <button type="button" onClick={() => removeMethod(method.id)} className="rounded-lg p-2 text-red-400 hover:bg-red-500/10">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <input
                type="text"
                value={method.number}
                onChange={(e) => updateMethod(method.id, { number: e.target.value })}
                className="op-input w-full"
                placeholder={t('الرقم أو المعرف', 'Number or ID')}
                dir="ltr"
              />
              <select
                value={method.type}
                onChange={(e) => updateMethod(method.id, { type: e.target.value })}
                className="op-input w-full"
              >
                <option value="fawry">{t('محفظة فوري', 'Fawry wallet')}</option>
                <option value="vodafone">{t('فودافون كاش', 'Vodafone Cash')}</option>
                <option value="instapay">{t('إنستا باي', 'InstaPay')}</option>
                <option value="visa">{t('فيزا / بطاقة', 'Visa / Card')}</option>
                <option value="other">{t('أخرى', 'Other')}</option>
              </select>
            </div>
          ))
        )}

        <button type="button" onClick={addMethod} className="op-btn-secondary flex w-full items-center justify-center gap-2 py-2.5">
          <Plus className="h-4 w-4" />
          {t('إضافة طريقة دفع', 'Add payment method')}
        </button>

        <button type="button" onClick={() => void handleSave()} disabled={saving || loading} className="op-btn-primary flex w-full items-center justify-center gap-2 py-3">
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
          {t('حفظ', 'Save')}
        </button>
      </div>
    </div>
  );
}
