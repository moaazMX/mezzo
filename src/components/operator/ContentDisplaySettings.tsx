import { useEffect, useState, useCallback, useRef } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { useOperatorPreferences } from '../../contexts/OperatorPreferencesContext';
import { useRealtimeRefetch } from '../../hooks/useRealtimeSubscription';
import {
  DEFAULT_MENU_DISPLAY,
  fetchMenuDisplaySettings,
  saveMenuDisplaySettings,
  type MenuDisplaySettings,
} from '../../lib/menuDisplaySettings';

type ToggleKey = keyof MenuDisplaySettings;

const TOGGLE_DEFS: { key: ToggleKey; labelAr: string; labelEn: string }[] = [
  { key: 'hideDescription', labelAr: 'إخفاء وصف المحتوى', labelEn: 'Hide item description' },
  { key: 'hideImage', labelAr: 'إخفاء صورة المحتوى', labelEn: 'Hide item image' },
  { key: 'hidePrice', labelAr: 'إخفاء سعر المحتوى', labelEn: 'Hide item price' },
  { key: 'hideItemName', labelAr: 'إخفاء اسم المحتوى', labelEn: 'Hide item name' },
  { key: 'hideSectionName', labelAr: 'إخفاء اسم القسم', labelEn: 'Hide section name' },
  { key: 'hideSections', labelAr: 'إخفاء الأقسام', labelEn: 'Hide sections bar' },
  { key: 'squareImages', labelAr: 'صور مربعة (عريضة بدل طويلة)', labelEn: 'Square images (wide instead of tall)' },
];

export default function ContentDisplaySettings() {
  const { language, t } = useOperatorPreferences();
  const [settings, setSettings] = useState<MenuDisplaySettings>(DEFAULT_MENU_DISPLAY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const savingRef = useRef(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await fetchMenuDisplaySettings());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useRealtimeRefetch('op-content-display', ['settings'], () => {
    if (savingRef.current) return;
    void loadSettings();
  });

  const toggle = (key: ToggleKey) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    savingRef.current = true;
    setMessage(null);
    try {
      await saveMenuDisplaySettings(settings);
      setMessage(t('تم حفظ إعدادات العرض', 'Display settings saved'));
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
        <h2 className="text-2xl font-black text-[var(--op-text)] text-start">{t('إعدادات المحتوى', 'Content Settings')}</h2>
        <p className="mt-1 text-sm text-[var(--op-muted)] text-start">
          {t('تحكم في ما يظهر للعملاء في صفحة المنيو', 'Control what customers see on the menu page')}
        </p>
      </div>

      {message && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm font-bold text-green-200 text-center">
          {message}
        </div>
      )}

      <div className="op-panel space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-[var(--op-muted)]">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          TOGGLE_DEFS.map(({ key, labelAr, labelEn }) => (
            <label
              key={key}
              className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[var(--op-border)] bg-[var(--op-surface)] px-4 py-3"
            >
              <span className="text-sm font-bold text-[var(--op-text)]">
                {language === 'ar' ? labelAr : labelEn}
              </span>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={() => toggle(key)}
                className="h-5 w-5 rounded accent-[var(--op-accent)]"
              />
            </label>
          ))
        )}

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || loading}
          className="op-btn-primary mt-4 flex w-full items-center justify-center gap-2 py-3"
        >
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
          {t('حفظ الإعدادات', 'Save settings')}
        </button>
      </div>
    </div>
  );
}
