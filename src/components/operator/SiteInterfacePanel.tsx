import { useEffect, useState, useRef, useCallback } from 'react';
import { Save, Loader2, Layout, Upload, X, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useOperatorPreferences } from '../../contexts/OperatorPreferencesContext';
import { useRealtimeRefetch } from '../../hooks/useRealtimeSubscription';

type HeaderMode = 'logo' | 'slideshow' | 'none';

function parseSlideshowImages(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

export default function SiteInterfacePanel() {
  const { t } = useOperatorPreferences();
  const [headerMode, setHeaderMode] = useState<HeaderMode>('logo');
  const [logoTapMenu, setLogoTapMenu] = useState(true);
  const [slideshowAuto, setSlideshowAuto] = useState(true);
  const [slideshowDirection, setSlideshowDirection] = useState<'horizontal' | 'vertical'>('horizontal');
  const [slideshowImages, setSlideshowImages] = useState<string[]>([]);
  const [headerHeightPx, setHeaderHeightPx] = useState(138);
  const [slideshowIntervalSeconds, setSlideshowIntervalSeconds] = useState(5);
  const [pendingSlideshowFiles, setPendingSlideshowFiles] = useState<File[]>([]);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const slideshowRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('settings').select('key, value').in('key', [
      'header_display_mode', 'logo_tap_menu_enabled',
      'slideshow_auto', 'slideshow_direction', 'slideshow_images', 'logo_image_url',
      'header_height_px', 'slideshow_interval_seconds',
    ]);
    const map = new Map((data || []).map((r) => [r.key, r.value]));
    const mode = map.get('header_display_mode') as HeaderMode;
    if (mode === 'slideshow' || mode === 'none') setHeaderMode(mode);
    else setHeaderMode('logo');
    setLogoTapMenu(map.get('logo_tap_menu_enabled') !== 'false');
    setSlideshowAuto(map.get('slideshow_auto') !== 'false');
    setSlideshowDirection(map.get('slideshow_direction') === 'vertical' ? 'vertical' : 'horizontal');
    setSlideshowImages(parseSlideshowImages(map.get('slideshow_images')));
    const heightRaw = parseInt(map.get('header_height_px') || '138', 10);
    setHeaderHeightPx(Number.isFinite(heightRaw) ? Math.min(320, Math.max(80, heightRaw)) : 138);
    const intervalRaw = parseFloat(map.get('slideshow_interval_seconds') || '5');
    setSlideshowIntervalSeconds(Number.isFinite(intervalRaw) ? Math.min(60, Math.max(2, intervalRaw)) : 5);
    const url = map.get('logo_image_url');
    if (url) setLogoPreview(url);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useRealtimeRefetch('op-site-interface', ['settings'], () => {
    if (savingRef.current) return;
    void loadSettings();
  });

  const uploadImage = async (file: File, prefix: string) => {
    const ext = file.name.split('.').pop() || 'png';
    const path = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from('item-images').upload(path, file, { upsert: true });
    if (error) throw error;
    const { data: pub } = supabase.storage.from('item-images').getPublicUrl(path);
    return pub.publicUrl;
  };

  const handleSave = async () => {
    setSaving(true);
    savingRef.current = true;
    setMessage(null);
    try {
      let nextSlideshow = [...slideshowImages];
      if (pendingSlideshowFiles.length > 0) {
        setIsUploading(true);
        const uploaded = await Promise.all(
          pendingSlideshowFiles.map((f) => uploadImage(f, 'slideshow'))
        );
        nextSlideshow = [...nextSlideshow, ...uploaded];
        setPendingSlideshowFiles([]);
        setSlideshowImages(nextSlideshow);
      }

      const rows = [
        { key: 'header_display_mode', value: headerMode },
        { key: 'logo_tap_menu_enabled', value: logoTapMenu ? 'true' : 'false' },
        { key: 'slideshow_auto', value: slideshowAuto ? 'true' : 'false' },
        { key: 'slideshow_direction', value: slideshowDirection },
        { key: 'slideshow_images', value: JSON.stringify(nextSlideshow) },
        { key: 'logo_enabled', value: headerMode === 'logo' ? 'true' : 'false' },
        { key: 'header_height_px', value: String(Math.min(320, Math.max(80, headerHeightPx))) },
        { key: 'slideshow_interval_seconds', value: String(Math.min(60, Math.max(2, slideshowIntervalSeconds))) },
      ];
      for (const row of rows) {
        await supabase.from('settings').upsert(row, { onConflict: 'key' });
      }
      if (logoFile) {
        setIsUploading(true);
        const url = await uploadImage(logoFile, 'logo');
        await supabase.from('settings').upsert({ key: 'logo_image_url', value: url }, { onConflict: 'key' });
        setLogoPreview(url);
        setLogoFile(null);
      }
      setMessage(t('تم حفظ إعدادات الواجهة', 'Interface settings saved'));
    } catch {
      setMessage(t('تعذر الحفظ', 'Could not save'));
    } finally {
      savingRef.current = false;
      setSaving(false);
      setIsUploading(false);
    }
  };

  const removeSlideshowImage = (index: number) => {
    setSlideshowImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-[var(--op-text)] flex items-center gap-2">
          <Layout className="h-6 w-6 text-[var(--op-accent)]" />
          {t('واجهة الموقع', 'Site Interface')}
        </h2>
      </div>

      {message && (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm font-bold text-green-200 text-center">{message}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : (
        <div className="op-panel space-y-5">
          <div>
            <p className="mb-2 text-sm font-bold text-[var(--op-text)]">{t('أعلى الصفحة', 'Page header')}</p>
            <div className="flex flex-wrap gap-2">
              {(['logo', 'slideshow', 'none'] as HeaderMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setHeaderMode(mode)}
                  className={`rounded-lg px-4 py-2 text-sm font-bold border ${headerMode === mode ? 'border-[var(--op-accent)] bg-[var(--op-accent)]/15 text-[var(--op-accent)]' : 'border-[var(--op-border)] text-[var(--op-muted)]'}`}
                >
                  {mode === 'logo' ? t('شعار', 'Logo') : mode === 'slideshow' ? t('Slideshow', 'Slideshow') : t('لا شيء', 'None')}
                </button>
              ))}
            </div>
          </div>

          {headerMode === 'logo' && (
            <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--op-border)] px-4 py-3">
              <span className="font-bold text-sm">{t('الضغط المتتالي على الشعار يفتح صورة المنيو', 'Rapid logo taps open menu image')}</span>
              <input type="checkbox" checked={logoTapMenu} onChange={(e) => setLogoTapMenu(e.target.checked)} className="h-5 w-5 accent-[var(--op-accent)]" />
            </label>
          )}

          {headerMode === 'slideshow' && (
            <>
              <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--op-border)] px-4 py-3">
                <span className="font-bold text-sm">{t('تحريك تلقائي', 'Auto play')}</span>
                <input type="checkbox" checked={slideshowAuto} onChange={(e) => setSlideshowAuto(e.target.checked)} className="h-5 w-5 accent-[var(--op-accent)]" />
              </label>

              <div className="space-y-2 rounded-xl border border-[var(--op-border)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-sm">{t('ارتفاع الهيدر', 'Header height')}</span>
                  <span className="text-sm font-black text-[var(--op-accent)]">{headerHeightPx}px</span>
                </div>
                <input
                  type="range"
                  min={80}
                  max={320}
                  step={4}
                  value={headerHeightPx}
                  onChange={(e) => setHeaderHeightPx(Number(e.target.value))}
                  className="w-full accent-[var(--op-accent)]"
                />
                <input
                  type="number"
                  min={80}
                  max={320}
                  step={4}
                  value={headerHeightPx}
                  onChange={(e) => {
                    const next = parseInt(e.target.value, 10);
                    if (Number.isFinite(next)) setHeaderHeightPx(Math.min(320, Math.max(80, next)));
                  }}
                  className="op-input w-full"
                />
              </div>

              <div className="space-y-2 rounded-xl border border-[var(--op-border)] px-4 py-3">
                <label className="font-bold text-sm" htmlFor="slideshow-interval">{t('مدة كل صورة (ثوانٍ)', 'Seconds per slide')}</label>
                <input
                  id="slideshow-interval"
                  type="number"
                  min={2}
                  max={60}
                  step={1}
                  value={slideshowIntervalSeconds}
                  onChange={(e) => {
                    const next = parseFloat(e.target.value);
                    if (Number.isFinite(next)) setSlideshowIntervalSeconds(Math.min(60, Math.max(2, next)));
                  }}
                  className="op-input w-full"
                />
                <p className="text-xs text-[var(--op-muted)]">{t('الوقت قبل الانتقال للصورة التالية', 'Time before switching to the next image')}</p>
              </div>

              <div>
                <p className="mb-2 text-sm font-bold">{t('اتجاه Slideshow', 'Slideshow direction')}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSlideshowDirection('horizontal')} className={`op-btn-secondary px-4 py-2 ${slideshowDirection === 'horizontal' ? 'ring-2 ring-[var(--op-accent)]' : ''}`}>{t('يمين / يسار', 'Left / Right')}</button>
                  <button type="button" onClick={() => setSlideshowDirection('vertical')} className={`op-btn-secondary px-4 py-2 ${slideshowDirection === 'vertical' ? 'ring-2 ring-[var(--op-accent)]' : ''}`}>{t('أعلى / أسفل', 'Up / Down')}</button>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-[var(--op-border)] p-4">
                <p className="font-bold text-sm">{t('صور Slideshow', 'Slideshow images')}</p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {slideshowImages.map((url, idx) => (
                    <div key={`${url}-${idx}`} className="relative aspect-video overflow-hidden rounded-lg border border-[var(--op-border)]">
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      <button type="button" onClick={() => removeSlideshowImage(idx)} className="absolute end-1 top-1 rounded-full bg-red-600 p-1 text-white">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {pendingSlideshowFiles.map((file, idx) => (
                    <div key={`pending-${idx}`} className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-[var(--op-accent)]">
                      <img src={URL.createObjectURL(file)} alt="" className="h-full w-full object-cover opacity-80" />
                    </div>
                  ))}
                </div>
                <input
                  ref={slideshowRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) setPendingSlideshowFiles((prev) => [...prev, ...files]);
                    e.target.value = '';
                  }}
                />
                <button type="button" onClick={() => slideshowRef.current?.click()} className="op-btn-secondary flex w-full items-center justify-center gap-2 py-2.5">
                  <Plus className="h-4 w-4" />
                  {t('إضافة صور للـ Slideshow', 'Add slideshow images')}
                </button>
              </div>
            </>
          )}

          {headerMode === 'logo' && (
          <div className="border-t border-[var(--op-border)] pt-4">
            <p className="mb-3 font-bold">{t('صورة الشعار', 'Logo image')}</p>
            {logoPreview && (
              <div className="relative mb-3 h-32 overflow-hidden rounded-xl border border-[var(--op-border)] bg-[var(--op-surface)]">
                <img src={logoPreview} alt="" className="h-full w-full object-contain" />
                {logoFile && (
                  <button type="button" onClick={() => { setLogoFile(null); }} className="absolute end-2 top-2 rounded-full bg-red-600 p-1.5 text-white"><X className="h-4 w-4" /></button>
                )}
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)); } }} />
            <button type="button" onClick={() => fileRef.current?.click()} className="op-btn-secondary flex w-full items-center justify-center gap-2 py-2.5">
              <Upload className="h-4 w-4" />
              {t('رفع / تغيير الشعار', 'Upload / change logo')}
            </button>
          </div>
          )}

          <button type="button" onClick={() => void handleSave()} disabled={saving || isUploading} className="op-btn-primary flex w-full items-center justify-center gap-2 py-3">
            {(saving || isUploading) ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            {t('حفظ', 'Save')}
          </button>
        </div>
      )}
    </div>
  );
}
