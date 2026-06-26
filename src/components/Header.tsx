import { Download, Gamepad2, ShoppingCart, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Category } from '../lib/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import '@fontsource/press-start-2p';
import { supabase } from '../lib/supabase';
import { useRealtimeRefetch } from '../hooks/useRealtimeSubscription';
import RealtimeIndicator from './RealtimeIndicator';

interface HeaderProps {
  cartCount: number;
  onCartClick: () => void;
  onProfileClick: () => void;
  hasOrders: boolean;
  ordersCount: number;
  categories: Category[];
  onCategorySelect: (categoryId: string) => void;
}

export default function Header({ cartCount, onCartClick, onProfileClick, hasOrders, ordersCount, categories, onCategorySelect }: HeaderProps) {
  const { language } = useLanguage();
  const [rotation, setRotation] = useState(0);
  const [isLogoClicked, setIsLogoClicked] = useState(false);
  const [gamepadRotation, setGamepadRotation] = useState({ left: 0, right: 0 });
  const [logoLightboxOpen, setLogoLightboxOpen] = useState(false);
  const [logoImageUrl, setLogoImageUrl] = useState<string>('/mx-brand-logo.png');
  const [rapidClickCount, setRapidClickCount] = useState(0);
  const [lastLogoClickAt, setLastLogoClickAt] = useState<number>(0);

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

  const loadOperatorLogo = async () => {
    const { data } = await supabase.from('settings').select('value').eq('key', 'logo_image_url').maybeSingle();
    const url = typeof data?.value === 'string' ? data.value.trim() : '';
    if (url) setLogoImageUrl(url);
  };

  useEffect(() => {
    void loadOperatorLogo();
  }, []);

  useRealtimeRefetch('header-settings', ['settings'], () => {
    void loadOperatorLogo();
  });

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

    if (nextCount >= 5) {
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
      <header className="relative bg-surface border-b-2 border-muted/30 shadow-2xl">
        <div className="container mx-auto px-4 py-4 md:py-6 relative">
          <div className="flex flex-col gap-4">
            <div className="hidden md:flex items-center justify-between">
              <div className="flex items-center gap-3">
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
              </div>
              <RealtimeIndicator className="hidden md:inline-flex" showDot={false} />
            </div>

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
          </div>
        </div>
      </header>

      {categories.length > 0 && (
        <div className="sticky top-0 z-40 border-t border-b border-muted/30 bg-dark/95 backdrop-blur-lg overflow-x-auto scrollbar-hide shadow-2xl">
          <div className="container mx-auto px-4 flex gap-3 py-3 min-w-max md:min-w-full">
            {categories.map(category => (
              <button
                key={category.id}
                onClick={() => onCategorySelect(category.id)}
                className="bg-surface/50 hover:bg-primary/20 border-b-4 border-transparent hover:border-primary text-muted px-4 py-3 transition-all whitespace-nowrap flex items-center gap-2 font-black hover:text-white uppercase tracking-tighter text-sm"
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
