import { Download, Gamepad2, ShoppingCart, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Category } from '../lib/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import { useMenuDisplay } from '../contexts/MenuDisplayContext';
import '@fontsource/press-start-2p';
import { supabase } from '../lib/supabase';
import { useRealtimeRefetch } from '../hooks/useRealtimeSubscription';
import RealtimeIndicator from './RealtimeIndicator';
import HeaderSlideshow from './HeaderSlideshow';

interface HeaderProps {
  cartCount: number;
  onCartClick: () => void;
  onProfileClick: () => void;
  hasOrders: boolean;
  ordersCount: number;
  categories: Category[];
  activeCategoryId?: string | null;
  onCategorySelect: (categoryId: string) => void;
}

export default function Header({ cartCount, onCartClick, onProfileClick, hasOrders, ordersCount, categories, activeCategoryId, onCategorySelect }: HeaderProps) {
  const { language } = useLanguage();
  const display = useMenuDisplay();
  const [rotation, setRotation] = useState(0);
  const [isLogoClicked, setIsLogoClicked] = useState(false);
  const [gamepadRotation, setGamepadRotation] = useState({ left: 0, right: 0 });
  const [logoLightboxOpen, setLogoLightboxOpen] = useState(false);
  const [logoImageUrl, setLogoImageUrl] = useState<string>('/mx-brand-logo.png');
  const [rapidClickCount, setRapidClickCount] = useState(0);
  const [logoTapMenuEnabled, setLogoTapMenuEnabled] = useState(true);
  const [headerDisplayMode, setHeaderDisplayMode] = useState<'logo' | 'slideshow' | 'none'>('logo');
  const [slideshowImages, setSlideshowImages] = useState<string[]>([]);
  const [slideshowAuto, setSlideshowAuto] = useState(true);
  const [slideshowDirection, setSlideshowDirection] = useState<'horizontal' | 'vertical'>('horizontal');
  const [headerHeightPx, setHeaderHeightPx] = useState(138);
  const [slideshowIntervalSeconds, setSlideshowIntervalSeconds] = useState(5);
  const [lastLogoClickAt, setLastLogoClickAt] = useState(0);

  const getDisplayLogoUrl = (url: string) => {
    try {
      const u = new URL(url, window.location.origin);
      u.searchParams.delete('download');
      u.searchParams.delete('dl');
      return u.toString();
    } catch {
      return url;
    }
  };

  useEffect(() => {
    let angle = -15;
    let direction = 1;
    const interval = setInterval(() => {
      angle += direction * 0.5;
      if (angle >= 15 || angle <= -15) {
        direction *= -1;
      }
      setRotation(angle);
    }, 50);

    return () => clearInterval(interval);
  }, []);

  const loadHeaderSettings = async () => {
    const { data } = await supabase.from('settings').select('key, value').in('key', [
      'logo_image_url', 'logo_tap_menu_enabled', 'header_display_mode', 'slideshow_images',
      'slideshow_auto', 'slideshow_direction', 'header_height_px', 'slideshow_interval_seconds',
    ]);
    const map = new Map((data || []).map((r) => [r.key, r.value]));
    const url = map.get('logo_image_url')?.trim();
    if (url) setLogoImageUrl(url);
    setLogoTapMenuEnabled(map.get('logo_tap_menu_enabled') !== 'false');
    const mode = map.get('header_display_mode');
    if (mode === 'slideshow' || mode === 'none') setHeaderDisplayMode(mode);
    else setHeaderDisplayMode('logo');
    setSlideshowAuto(map.get('slideshow_auto') !== 'false');
    setSlideshowDirection(map.get('slideshow_direction') === 'vertical' ? 'vertical' : 'horizontal');
    const heightRaw = parseInt(map.get('header_height_px') || '138', 10);
    setHeaderHeightPx(Number.isFinite(heightRaw) ? Math.min(320, Math.max(80, heightRaw)) : 138);
    const intervalRaw = parseFloat(map.get('slideshow_interval_seconds') || '5');
    setSlideshowIntervalSeconds(Number.isFinite(intervalRaw) ? Math.min(60, Math.max(2, intervalRaw)) : 5);
    try {
      const raw = map.get('slideshow_images');
      const parsed = raw ? JSON.parse(raw) : [];
      setSlideshowImages(Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string' && u.trim().length > 0) : []);
    } catch {
      setSlideshowImages([]);
    }
  };

  useEffect(() => {
    void loadHeaderSettings();
  }, []);

  useRealtimeRefetch('header-settings', ['settings'], () => {
    void loadHeaderSettings();
  });

  const overlayActionButtons = (
    <div className="flex items-center gap-2 md:gap-3">
      <button
        data-profile-button
        onClick={onProfileClick}
        className="relative rounded-xl border border-white/25 bg-black/45 p-2.5 md:p-3 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/60 hover:scale-105"
      >
        <User className="h-5 w-5 md:h-6 md:w-6" />
        {hasOrders && (
          <span className="absolute -top-2 -left-2 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-black/40 bg-green-500 px-1 text-[10px] font-bold text-white animate-pulse">
            {ordersCount > 9 ? '9+' : ordersCount}
          </span>
        )}
      </button>
      <button
        data-cart-button
        id="header-cart-icon"
        onClick={onCartClick}
        className="relative rounded-xl border border-white/25 bg-black/45 p-2.5 md:p-3 text-white shadow-lg backdrop-blur-md transition-all hover:bg-black/60 hover:scale-105"
      >
        <ShoppingCart className="h-5 w-5 md:h-6 md:w-6" />
        {cartCount > 0 && (
          <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-black/40 bg-red-600 text-xs font-bold text-white animate-pulse">
            {cartCount}
          </span>
        )}
      </button>
    </div>
  );

  const headerActionButtons = (
    <>
      <button
        data-profile-button
        onClick={onProfileClick}
        className="relative bg-surface/50 hover:bg-surface/80 p-3 rounded-xl border-2 border-muted/50 transition-all hover:scale-110"
      >
        <User className="w-6 h-6 text-muted" />
        {hasOrders && (
          <span className="absolute -top-2 -left-2 bg-green-500 text-white text-[10px] font-bold min-w-[20px] h-5 rounded-full flex items-center justify-center border-2 border-surface animate-pulse px-1">
            {ordersCount > 9 ? '9+' : ordersCount}
          </span>
        )}
      </button>
      <button
        data-cart-button
        id="header-cart-icon"
        onClick={onCartClick}
        className="relative bg-surface/50 hover:bg-surface/80 p-3 rounded-xl border-2 border-muted/50 transition-all hover:scale-110"
      >
        <ShoppingCart className="w-6 h-6 text-muted" />
        {cartCount > 0 && (
          <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-surface animate-pulse">
            {cartCount}
          </span>
        )}
      </button>
    </>
  );

  const handleLogoClick = () => {
    setIsLogoClicked(true);
    setGamepadRotation({ left: 360, right: -360 });
    setTimeout(() => {
      setGamepadRotation({ left: 0, right: 0 });
      setIsLogoClicked(false);
    }, 600);

    window.scrollTo({ top: 0, behavior: 'smooth' });

    const now = Date.now();
    const within1Second = now - lastLogoClickAt < 1000;
    const nextCount = within1Second ? rapidClickCount + 1 : 1;
    setLastLogoClickAt(now);
    setRapidClickCount(nextCount);

    if (logoTapMenuEnabled && nextCount >= 5) {
      setRapidClickCount(0);
      setLogoLightboxOpen(true);
    }
  };

  const downloadBrandLogo = async () => {
    const src = logoImageUrl || '/mx-brand-logo.png';
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'mx-brand-logo.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      const a = document.createElement('a');
      a.href = src;
      a.download = 'mx-brand-logo.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <>
      {headerDisplayMode === 'slideshow' ? (
        <header
          className="relative overflow-hidden overscroll-none border-b-2 border-muted/30 shadow-2xl"
          style={{ height: `${headerHeightPx}px`, touchAction: 'none' }}
        >
          <HeaderSlideshow
            images={slideshowImages}
            direction={slideshowDirection}
            auto={slideshowAuto}
            intervalSeconds={slideshowIntervalSeconds}
            className="absolute inset-0 h-full w-full"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-black/5 to-black/20" />
          <div className="relative z-10 flex h-full items-start justify-between p-3 md:px-4 md:py-4">
            {overlayActionButtons}
            <RealtimeIndicator className="hidden md:inline-flex shrink-0 rounded-lg border border-white/20 bg-black/40 px-2 py-1 backdrop-blur-md" showDot={false} />
          </div>
        </header>
      ) : (
      <header className="relative bg-surface border-b-2 border-muted/30 shadow-2xl">
        <div className="container mx-auto px-4 py-4 md:py-5 relative">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="hidden md:flex items-center gap-3 shrink-0">
                {headerActionButtons}
              </div>

              {headerDisplayMode === 'none' && <div className="hidden md:block flex-1" />}

              <RealtimeIndicator className="hidden md:inline-flex shrink-0 ms-auto" showDot={false} />
            </div>

            {headerDisplayMode === 'logo' && (
            <button
              onClick={handleLogoClick}
              className="mx-auto flex flex-col items-center justify-center gap-1 cursor-pointer group"
            >
              <div className="flex items-center justify-center gap-4 mb-1">
                <Gamepad2
                  className={`w-10 h-10 md:w-12 md:h-12 text-muted transition-all duration-300 ${isLogoClicked ? 'scale-125' : 'group-hover:scale-110'}`}
                  style={{
                    transform: `rotate(${rotation + gamepadRotation.left}deg)`,
                    transition: 'transform 0.3s ease-out'
                  }}
                />
                <div
                  className={`relative transition-all duration-300 ${isLogoClicked ? 'scale-110' : 'group-hover:scale-105'}`}
                >
                  <h1
                    className="relative text-4xl md:text-5xl font-black tracking-widest text-white leading-tight"
                    style={{ fontFamily: '"Press Start 2P", system-ui, cursive' }}
                  >
                    MX
                  </h1>
                </div>
                <Gamepad2
                  className={`w-10 h-10 md:w-12 md:h-12 text-muted transition-all duration-300 ${isLogoClicked ? 'scale-125' : 'group-hover:scale-110'}`}
                  style={{
                    transform: `rotate(${-rotation + gamepadRotation.right}deg) scaleX(-1)`,
                    transition: 'transform 0.3s ease-out'
                  }}
                />
              </div>
              <p className="text-lg md:text-2xl font-bold text-muted tracking-wide group-hover:text-white transition-colors">
                Level Up Your Taste!
              </p>
            </button>
            )}
          </div>
        </div>
      </header>
      )}

      {!display.hideSections && categories.length > 0 && (
        <div className="sticky top-0 z-40 border-t border-b border-muted/30 bg-dark/95 backdrop-blur-lg overflow-x-auto scrollbar-hide shadow-2xl">
          <div className="container mx-auto px-4 flex gap-3 py-3 min-w-max md:min-w-full">
            {categories.map(category => (
              <button
                key={category.id}
                type="button"
                onClick={(e) => {
                  onCategorySelect(category.id);
                  e.currentTarget.blur();
                }}
                className={`header-category-btn text-muted px-4 py-3 transition-all whitespace-nowrap flex items-center gap-2 font-black uppercase tracking-tighter text-sm ${activeCategoryId === category.id ? 'is-active' : ''}`}
              >
                <span>{language === 'ar' ? category.name : category.name_en}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrolling-behavior: smooth;
        }
      `}</style>

      {logoLightboxOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={language === 'ar' ? 'شعار MX' : 'MX logo'}
          onClick={() => setLogoLightboxOpen(false)}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void downloadBrandLogo();
            }}
            className="absolute top-4 left-4 z-[101] p-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white transition-colors"
            title={language === 'ar' ? 'تحميل الصورة' : 'Download image'}
            aria-label={language === 'ar' ? 'تحميل الشعار' : 'Download logo'}
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setLogoLightboxOpen(false)}
            className="absolute top-4 right-4 z-[101] p-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white transition-colors"
            aria-label={language === 'ar' ? 'إغلاق' : 'Close'}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={getDisplayLogoUrl(logoImageUrl || '/mx-brand-logo.png')}
            alt="MX — Level Up Your Taste"
            className="max-w-[min(100%,520px)] max-h-[85vh] w-auto h-auto object-contain select-none rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
