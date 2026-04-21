import { Plus, AlertCircle, Gamepad2, X } from 'lucide-react';
import { Item } from '../lib/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';

interface MenuItemProps {
  item: Item;
  onAddToCart: (item: Item, elementRef?: React.RefObject<HTMLDivElement>) => void;
}

export default function MenuItem({ item, onAddToCart }: MenuItemProps) {
  const { language, t } = useLanguage();
  const displayPrice = item.has_offer && item.offer_price ? item.offer_price : item.price;
  const currencySymbol = language === 'ar' ? 'ج' : 'EG';
  const [showDetails, setShowDetails] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const heroImgRef = useRef<HTMLImageElement>(null);
  const modalImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setImageBroken(false);
  }, [item.image_url]);

  useLayoutEffect(() => {
    const el = heroImgRef.current;
    if (el?.complete && el.naturalWidth > 0) el.classList.add('is-loaded');
  }, [item.image_url, imageBroken]);

  useLayoutEffect(() => {
    if (!showDetails) return;
    const el = modalImgRef.current;
    if (el?.complete && el.naturalWidth > 0) el.classList.add('is-loaded');
  }, [showDetails, item.image_url, imageBroken]);

  useEffect(() => {
    if (showDetails) {
      document.body.style.overflow = 'hidden';
      window.dispatchEvent(new CustomEvent('mobileFullscreenImage', { detail: true }));
    } else {
      document.body.style.overflow = '';
      window.dispatchEvent(new CustomEvent('mobileFullscreenImage', { detail: false }));
    }
    return () => {
      document.body.style.overflow = '';
      window.dispatchEvent(new CustomEvent('mobileFullscreenImage', { detail: false }));
    };
  }, [showDetails]);

  const description = language === 'ar'
    ? (item.description || '')
    : (item.description_en || item.description || '');

  const title = language === 'ar' ? item.name : item.name_en;
  const subtitle = language === 'ar' ? item.name_en : item.name;

  return (
    <>
      <div
        ref={itemRef}
        className="dark-surface-ignore-theme mx-menu-item group/menu-item relative overflow-hidden rounded-2xl border border-primary/35 bg-[hsl(var(--color-surface))] shadow-md transition-[box-shadow,border-color,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-primary/55 hover:shadow-lg hover:shadow-primary/10 motion-reduce:transition-none motion-reduce:hover:translate-y-0 [@media(hover:none)]:hover:translate-y-0"
      >
        <button
          type="button"
          className="mx-menu-item-btn relative flex w-full cursor-pointer flex-col border-0 bg-transparent p-0 text-right"
          onClick={() => setShowDetails(true)}
        >
          <div className="mx-menu-hero relative aspect-[5/4] w-full min-h-[11.5rem] overflow-hidden bg-black/30 sm:min-h-[13rem] md:aspect-[4/3] md:min-h-[14rem] [@media(max-width:768px)_and_(pointer:coarse)]:aspect-[5/4]">
            {item.image_url && !imageBroken ? (
              <img
                ref={heroImgRef}
                src={item.image_url}
                alt={item.name}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
                onError={() => setImageBroken(true)}
                className="menu-item-hero img-fade h-full w-full object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/menu-item:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover/menu-item:scale-100 [@media(hover:none)]:scale-100"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-surface">
                <Gamepad2 className="h-16 w-16 text-primary/80 sm:h-20 sm:w-20" />
              </div>
            )}

            {item.has_offer && item.offer_price && (
              <div className="absolute end-2 top-2 z-10 rounded-full bg-red-500 px-2.5 py-0.5 text-[10px] font-black text-white shadow-lg sm:text-xs">
                {t('menuItem.specialOffer')}
              </div>
            )}

            {!item.is_available && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/82">
                <div className="flex items-center gap-2 rounded-xl bg-red-500/95 px-3 py-2">
                  <AlertCircle className="h-5 w-5 text-white" />
                  <span className="text-sm font-bold text-white">{t('common.unavailable')}</span>
                </div>
              </div>
            )}
          </div>

          <div className="mx-menu-meta space-y-1.5 border-t border-primary/25 bg-[hsl(var(--color-surface))] px-3 py-2.5 text-right sm:px-3.5 sm:py-3">
            <h3 className="line-clamp-2 text-sm font-black leading-tight text-white sm:text-base">
              {title}
            </h3>
            {subtitle && subtitle !== title && (
              <p className="line-clamp-1 text-[10px] text-white/70 sm:text-xs">{subtitle}</p>
            )}
            {description && (
              <p className="hidden text-[10px] leading-snug text-white/80 sm:text-[11px] [@media(hover:hover)]:line-clamp-2 [@media(hover:hover)]:block">
                {description}
              </p>
            )}
            <div className="flex items-end justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.is_available) onAddToCart(item, itemRef);
                }}
                disabled={!item.is_available}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-md transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-primary/90 active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-600 sm:h-11 sm:w-11 motion-reduce:transition-none"
                title={t('menuItem.addToCart')}
              >
                <Plus className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.5} />
              </button>
              <div className="min-w-0 text-end">
                {item.has_offer && item.offer_price && (
                  <span className="text-[10px] text-white/45 line-through sm:text-xs">
                    {item.price} {currencySymbol}
                  </span>
                )}
                <p className="text-lg font-black text-primary sm:text-xl">
                  {displayPrice}{' '}
                  <span className="text-xs font-bold sm:text-sm">{currencySymbol}</span>
                </p>
              </div>
            </div>
          </div>
        </button>
      </div>

      {showDetails && (
        <div
          className="fixed inset-0 z-[70] flex justify-center bg-black/88 backdrop-blur-[3px] [@media(hover:none)]:items-stretch [@media(hover:hover)]:items-center [@media(hover:hover)]:p-5 [@media(hover:hover)]:lg:p-8"
          onClick={() => setShowDetails(false)}
        >
          <div
            ref={modalRef}
            className="dark-surface-ignore-theme relative flex max-h-[100dvh] w-full max-w-full flex-col overflow-hidden bg-[#0c0816] shadow-2xl [@media(hover:hover)]:max-h-[min(94vh,920px)] [@media(hover:hover)]:max-w-[min(100%,42rem)] [@media(hover:hover)]:lg:max-w-[min(100%,52rem)] [@media(hover:hover)]:rounded-[1.85rem] [@media(hover:hover)]:border [@media(hover:hover)]:border-white/12"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowDetails(false)}
              className="absolute start-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/70"
              aria-label={language === 'ar' ? 'إغلاق' : 'Close'}
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto custom-scrollbar">
              <div className="relative w-full shrink-0 bg-black">
                <div className="aspect-[4/3] w-full min-h-[min(58vh,420px)] max-h-[68vh] [@media(hover:hover)]:aspect-[16/10] [@media(hover:hover)]:min-h-0 [@media(hover:hover)]:max-h-[min(62vh,560px)]">
                  {item.image_url && !imageBroken ? (
                    <img
                      ref={modalImgRef}
                      src={item.image_url}
                      alt={item.name}
                      loading="eager"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
                      onError={() => setImageBroken(true)}
                      className="img-fade h-full w-full object-cover object-center [@media(hover:hover)]:rounded-t-[1.85rem]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-surface">
                      <Gamepad2 className="h-24 w-24 text-primary" />
                    </div>
                  )}
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/45 to-transparent [@media(hover:hover)]:h-28" />
              </div>

              <div className="space-y-4 px-4 pb-10 pt-4 text-right [@media(hover:hover)]:px-8 [@media(hover:hover)]:pb-8 [@media(hover:hover)]:pt-6">
                <div>
                  <h3 className="text-2xl font-black leading-tight text-white [@media(hover:hover)]:text-3xl">{title}</h3>
                  {subtitle && subtitle !== title && (
                    <p className="mt-1.5 text-sm text-white/60 [@media(hover:hover)]:text-base">{subtitle}</p>
                  )}
                </div>
                {description && (
                  <p className="text-base leading-relaxed text-white/90 whitespace-pre-wrap [@media(hover:hover)]:text-lg">
                    {description}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
                  <div className="text-end">
                    {item.has_offer && item.offer_price && (
                      <p className="text-sm text-white/40 line-through">
                        {item.price} {currencySymbol}
                      </p>
                    )}
                    <p className="text-3xl font-black text-primary [@media(hover:hover)]:text-4xl">
                      {displayPrice} <span className="text-xl [@media(hover:hover)]:text-2xl">{currencySymbol}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (item.is_available) {
                        onAddToCart(item, modalRef);
                        setShowDetails(false);
                      }
                    }}
                    disabled={!item.is_available}
                    className="flex shrink-0 items-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-base font-black text-white transition-transform hover:bg-primary/88 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-gray-700"
                  >
                    <Plus className="h-6 w-6" />
                    {t('menuItem.addToCart')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .img-fade {
          opacity: 0;
          transition: opacity 260ms ease-in;
        }
        .img-fade.is-loaded {
          opacity: 1;
        }
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(139, 92, 246, 0.45) transparent;
        }
      `}</style>
    </>
  );
}
