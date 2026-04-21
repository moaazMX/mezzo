import { ChevronRight, Minus, Package, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { Item } from '../lib/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import { ReactNode, useEffect, useRef, useCallback, useState } from 'react';
import { isTouchPhoneChrome } from '../lib/viewportUi';

interface CartItem extends Item {
  quantity: number;
}

interface CartProps {
  isOpen: boolean;
  onClose: () => void;
  onHandleClick: () => void;
  cartItems: CartItem[];
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onRemoveItem: (itemId: string) => void;
  onCheckout: () => void;
  onClearCart?: () => void;
  isCheckoutOpen?: boolean;
  showCheckoutPanel?: boolean;
  checkoutPanel?: ReactNode;
  checkoutStep?: 'customer' | 'address';
  suggestedItems?: Item[];
  onAddSuggestedItem?: (item: Item) => void;
  checkoutCartEditMode?: boolean;
  onSaveCheckoutCartEdit?: () => void;
  onCancelCheckoutCartEdit?: () => void;
  onCheckoutHandleBack?: () => void;
}

export default function Cart({
  isOpen,
  onClose,
  onHandleClick,
  cartItems,
  onUpdateQuantity,
  onRemoveItem,
  onCheckout,
  onClearCart,
  isCheckoutOpen = false,
  showCheckoutPanel = false,
  checkoutPanel,
  checkoutStep = 'customer',
  suggestedItems = [],
  onAddSuggestedItem,
  checkoutCartEditMode = false,
  onSaveCheckoutCartEdit,
  onCancelCheckoutCartEdit,
  onCheckoutHandleBack
}: CartProps) {
  const { language, t } = useLanguage();
  const currencySymbol = language === 'ar' ? 'ج' : 'EG';

  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const isDraggingRef = useRef(false);
  const currentSnapRef = useRef(0);
  const hideAfterOffscreenTimeoutRef = useRef<number | null>(null);
  const [sheetState, setSheetState] = useState<'offscreen' | 'mini' | 'half' | 'full'>('mini');
  const [phoneChrome, setPhoneChrome] = useState<boolean>(() => isTouchPhoneChrome());

  const startYRef = useRef(0);
  const startTYRef = useRef(0);
  const lastYRef = useRef(0);
  const velYRef = useRef(0);
  const lastTimeRef = useRef(0);
  const gestureFromContentRef = useRef(false);

  const callbacksRef = useRef({ onClose, onHandleClick, isOpen });
  useEffect(() => {
    callbacksRef.current = { onClose, onHandleClick, isOpen };
  }, [onClose, onHandleClick, isOpen]);

  useEffect(() => {
    const onChange = () => setPhoneChrome(isTouchPhoneChrome());
    window.addEventListener('resize', onChange);
    const mq = window.matchMedia('(pointer: coarse)');
    mq.addEventListener('change', onChange);
    return () => {
      window.removeEventListener('resize', onChange);
      mq.removeEventListener('change', onChange);
    };
  }, []);

  const itemCount = cartItems.reduce((sum, item) => sum + Math.max(0, item.quantity || 0), 0);
  const total = cartItems.reduce((sum, item) => {
    const price = item.has_offer && item.offer_price ? item.offer_price : item.price;
    return sum + price * item.quantity;
  }, 0);
  const hasItems = itemCount > 0;

  const getSnaps = useCallback(() => {
    const vh = window.innerHeight;
    const fullH = isTouchPhoneChrome() ? vh : vh * 0.92;
    return {
      offscreen: fullH + 50,
      mini: fullH - 75,
      half: fullH * 0.45,
      full: 0,
      fullH
    };
  }, []);

  const setTranslate = useCallback((ty: number, animated = false) => {
    if (!sheetRef.current) return;
    const sheet = sheetRef.current;

    // If we are moving away from offscreen, ensure it's visible again immediately
    if (hideAfterOffscreenTimeoutRef.current) {
      window.clearTimeout(hideAfterOffscreenTimeoutRef.current);
      hideAfterOffscreenTimeoutRef.current = null;
    }
    if (sheet.getAttribute('data-hidden') === '1') {
      sheet.style.opacity = '1';
      sheet.removeAttribute('data-hidden');
    }

    sheet.style.setProperty('--ty', `${ty}`);
    sheet.style.transition = animated
      ? 'transform 0.42s cubic-bezier(0.32,0.72,0,1), width 0.42s cubic-bezier(0.32,0.72,0,1), margin-left 0.42s cubic-bezier(0.32,0.72,0,1)'
      : 'none';

    const snaps = getSnaps();
    const state = ty >= snaps.offscreen - 10
      ? 'offscreen'
      : ty === snaps.full
        ? 'full'
        : ty <= snaps.half + 10
          ? 'half'
          : 'mini';
    setSheetState(state as 'offscreen' | 'mini' | 'half' | 'full');
    sheet.setAttribute('data-state', state);

    // When going fully offscreen, hide only after the slide-down completes
    if (animated && state === 'offscreen') {
      hideAfterOffscreenTimeoutRef.current = window.setTimeout(() => {
        if (!sheetRef.current) return;
        const sheetNow = sheetRef.current;
        if (sheetNow.getAttribute('data-state') === 'offscreen') {
          sheetNow.style.opacity = '0';
          sheetNow.setAttribute('data-hidden', '1');
        }
        hideAfterOffscreenTimeoutRef.current = null;
      }, 420);
    }

    const footerTy = Math.min(ty, snaps.half);
    sheet.style.setProperty('--footer-ty', `${footerTy}`);

    const contentOpacity = ty >= snaps.mini - 10 ? 0 : 1;
    sheet.style.setProperty('--content-opacity', `${contentOpacity}`);
    sheet.style.setProperty('--content-events', contentOpacity === 0 ? 'none' : 'auto');
  }, [getSnaps]);

  useEffect(() => {
    return () => {
      if (hideAfterOffscreenTimeoutRef.current) {
        window.clearTimeout(hideAfterOffscreenTimeoutRef.current);
        hideAfterOffscreenTimeoutRef.current = null;
      }
    };
  }, []);

  const snapTo = useCallback((stop: number, animated = true) => {
    currentSnapRef.current = stop;
    setTranslate(stop, animated);

    if (contentRef.current) {
      const snaps = getSnaps();
      // أثناء الشيك أوت: اسمح بالسكرول حتى في وضع "نص" عند تصغير السلة
      contentRef.current.style.overflowY = showCheckoutPanel ? 'auto' : (stop === snaps.full ? 'auto' : 'hidden');
    }
  }, [getSnaps, setTranslate, showCheckoutPanel]);

  // While checkout form is open (not mini), lock page scroll/background interaction.
  useEffect(() => {
    const lockPage = phoneChrome
      ? showCheckoutPanel
      : (showCheckoutPanel && (sheetState === 'full' || sheetState === 'half'));
    if (!lockPage) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (contentRef.current && target && contentRef.current.contains(target)) return;
      if (e.cancelable) e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (contentRef.current && target && contentRef.current.contains(target)) return;
      if (e.cancelable) e.preventDefault();
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchmove', onTouchMove);
    };
  }, [showCheckoutPanel, sheetState, phoneChrome]);

  const nearestSnap = useCallback((ty: number, vel: number) => {
    const snaps = getSnaps();
    const biased = ty + vel * 60; // Reduced bias for more control

    const baseSnap = snaps.mini;
    const candidates = [baseSnap, snaps.half, snaps.full];

    // Priority: if swiping up fast from half, go to full
    if (vel < -4 && ty < snaps.half + 80) return snaps.full;
    // If swiping down fast from half, go to mini/offscreen
    if (vel > 4 && ty > snaps.half - 80) return baseSnap;

    const nearest = candidates.reduce((a, b) =>
      Math.abs(b - biased) < Math.abs(a - biased) ? b : a
    );

    return nearest;
  }, [getSnaps, cartItems.length]);

  const onStart = useCallback((e: TouchEvent | MouseEvent | React.TouchEvent | React.MouseEvent) => {
    if (!isTouchPhoneChrome()) return; // Disable drag on desktop / narrow non-touch
    if (showCheckoutPanel) return; // prevent sheet drag while filling checkout

    const target = e.target as HTMLElement | null;
    // Allow dragging from the whole sheet except interactive controls
    if (target?.closest('button, input, textarea, select, a, [data-no-drag="1"]')) {
      return;
    }

    const isTouch = 'touches' in e;
    const pt = isTouch ? (e as any).touches[0] : (e as MouseEvent);

    startYRef.current = pt.clientY;
    startTYRef.current = currentSnapRef.current;
    lastYRef.current = startYRef.current;
    lastTimeRef.current = Date.now();
    velYRef.current = 0;
    gestureFromContentRef.current = !!(contentRef.current && target && contentRef.current.contains(target));

    // If gesture starts inside scrollable content, wait for edge check in onMove.
    if (gestureFromContentRef.current) {
      isDraggingRef.current = false;
      return;
    }

    isDraggingRef.current = true;
    if (sheetRef.current) {
      sheetRef.current.classList.add('dragging');
      sheetRef.current.style.transition = 'none';
    }
  }, [showCheckoutPanel]);

  const onMove = useCallback((e: TouchEvent | MouseEvent) => {
    const isTouch = 'touches' in e;
    const pt = isTouch ? (e as any).touches[0] : (e as MouseEvent);

    // For gestures that started in content: only drag sheet at scroll edges.
    if (!isDraggingRef.current && gestureFromContentRef.current) {
      const scroller = contentRef.current;
      if (!scroller) return;
      const dy = pt.clientY - startYRef.current;
      if (Math.abs(dy) < 8) return;

      const atTop = scroller.scrollTop <= 0;
      const atBottom = Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight;
      const movingDown = dy > 0;
      const movingUp = dy < 0;

      // If content can still scroll in this direction, do not drag sheet.
      if ((movingDown && !atTop) || (movingUp && !atBottom)) {
        return;
      }

      // Edge reached: allow sheet drag now.
      isDraggingRef.current = true;
      if (sheetRef.current) {
        sheetRef.current.classList.add('dragging');
        sheetRef.current.style.transition = 'none';
      }
    }

    if (!isDraggingRef.current) return;
    if (e.cancelable) e.preventDefault();

    const now = Date.now();
    const dt = now - lastTimeRef.current || 1;
    velYRef.current = ((pt.clientY - lastYRef.current) / dt) * 16;
    lastYRef.current = pt.clientY;
    lastTimeRef.current = now;

    let ty = startTYRef.current + (pt.clientY - startYRef.current);
    const snaps = getSnaps();
    const baseSnap = snaps.mini;

    ty = Math.max(-10, Math.min(baseSnap + 20, ty));
    if (ty < 0) ty *= 0.3;

    setTranslate(ty, false);
  }, [getSnaps, setTranslate, cartItems.length]);

  const onEnd = useCallback(() => {
    gestureFromContentRef.current = false;
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    if (sheetRef.current) {
      sheetRef.current.classList.remove('dragging');
    }

    const sheet = sheetRef.current;
    if (!sheet) return;

    const styles = window.getComputedStyle(sheet);
    const matrix = new WebKitCSSMatrix(styles.transform);
    const currentTY = matrix.m42;

    const snaps = getSnaps();
    const stop = nearestSnap(currentTY, velYRef.current);
    snapTo(stop, true);

    if (stop === snaps.full || stop === snaps.half) {
      if (!callbacksRef.current.isOpen) {
        callbacksRef.current.onHandleClick();
      }
    } else {
      if (callbacksRef.current.isOpen) {
        callbacksRef.current.onClose();
      }
    }
  }, [getSnaps, nearestSnap, snapTo]);

  useEffect(() => {
    const options = { passive: false } as EventListenerOptions;
    window.addEventListener('touchmove', onMove, options);
    window.addEventListener('touchend', onEnd);
    window.addEventListener('mousemove', onMove, options);
    window.addEventListener('mouseup', onEnd);

    return () => {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
    };
  }, [onMove, onEnd]);

  useEffect(() => {
    const snaps = getSnaps();
    if (isOpen) {
      snapTo(snaps.full, true);
    } else if (hasItems && !showCheckoutPanel) {
      snapTo(snaps.mini, true);
    } else {
      const target = snaps.offscreen;
      snapTo(target, true);
    }
  }, [isOpen, hasItems, showCheckoutPanel, getSnaps, snapTo]);

  useEffect(() => {
    const snaps = getSnaps();
    if (isOpen) {
      if (currentSnapRef.current !== snaps.full && currentSnapRef.current !== snaps.half) {
        snapTo(snaps.half, true);
      }
    } else if (hasItems && !showCheckoutPanel) {
      const target = snaps.mini;
      if (currentSnapRef.current !== target) {
        snapTo(target, true);
      }
    } else {
      const target = snaps.offscreen;
      if (currentSnapRef.current !== target) {
        snapTo(target, true);
      }
    }
  }, [isOpen, hasItems, showCheckoutPanel, getSnaps, snapTo, cartItems.length]);

  useEffect(() => {
    if (showCheckoutPanel) return;
    if (cartItems.length > 0) return;
    if (callbacksRef.current.isOpen) return;
    const snaps = getSnaps();
    snapTo(snaps.offscreen, true);
    if (callbacksRef.current.isOpen) callbacksRef.current.onClose();
  }, [cartItems.length, showCheckoutPanel, getSnaps, snapTo]);

  // Keep sheet snap stable on viewport resize (prevents half-open glitch).
  useEffect(() => {
    const onResize = () => {
      const snaps = getSnaps();
      if (callbacksRef.current.isOpen) {
        snapTo(snaps.full, false);
      } else if (hasItems && !showCheckoutPanel) {
        // Mobile: keep collapsed cart visible only when it has items
        snapTo(snaps.mini, false);
      } else {
        // Ensure cart stays fully hidden after close when empty
        snapTo(snaps.offscreen, false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [getSnaps, snapTo, hasItems, showCheckoutPanel]);

  // PC: If user scrolls down while in half/mini state, expand to full
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const handleWheel = (e: WheelEvent) => {
      if (!isTouchPhoneChrome() && currentSnapRef.current > 0 && e.deltaY > 0) {
        if (cartItems.length > 3) { // Only if there are enough items to justify expanding
          snapTo(getSnaps().full);
          e.preventDefault(); // Prevent page scroll
          return;
        }
      }
    };

    sheet.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      sheet.removeEventListener('wheel', handleWheel);
    };
  }, [getSnaps, snapTo, cartItems.length]);

  return (
    <>
      <div
        className={`fixed inset-0 z-[39] bg-black/0 transition-colors duration-300 pointer-events-none ${
          showCheckoutPanel && (sheetState === 'full' || sheetState === 'half') ? '!bg-black/30 !pointer-events-auto' : ''
        }`}
      />
      <div
        ref={sheetRef}
        className={`cart-sheet ${phoneChrome ? 'cart-sheet--phone-chrome' : ''} ${showCheckoutPanel ? 'show-checkout-panel' : ''} ${showCheckoutPanel && checkoutStep === 'address' ? 'checkout-confirm-mode' : ''}`}
        id="cart-bottom-sheet"
        style={{ display: isCheckoutOpen ? 'none' : 'block' }}
      >
        <div
          className="cart-sheet-inner"
          onTouchStart={onStart as any}
          onMouseDown={onStart as any}
        >
          <div
            className="handle-area"
            data-cart-handle
            onClick={(e) => {
              e.stopPropagation();
              if (showCheckoutPanel) return;
              if (currentSnapRef.current !== getSnaps().full && currentSnapRef.current !== getSnaps().half) {
                snapTo(getSnaps().half, true);
                callbacksRef.current.onHandleClick();
              } else {
                const snaps = getSnaps();
                const target = snaps.mini;
                snapTo(target, true);
                callbacksRef.current.onClose();
              }
            }}
          >
            <div className="handle-bar"></div>

            <div className="relative mt-1 flex w-full min-h-[1.75rem] items-center justify-center px-6">
              {showCheckoutPanel && (
                <button
                  type="button"
                  data-no-drag="1"
                  aria-label={language === 'ar' ? 'رجوع' : 'Back'}
                  className="absolute right-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg border border-white/20 bg-black/35 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/45 active:scale-95"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCheckoutHandleBack?.();
                  }}
                >
                  <ChevronRight className="h-5 w-5" strokeWidth={2.25} />
                </button>
              )}
              <div className="handle-summary flex w-full items-center justify-between pointer-events-none">
                <div className="flex gap-2 items-center text-white font-bold">
                  <ShoppingBag className="w-5 h-5 shrink-0 text-primary" />
                  {itemCount} {t('cart.items')}
                </div>
                <div className="text-primary font-black text-lg tabular-nums">
                  {total} <span className="text-sm">{currencySymbol}</span>
                </div>
              </div>
            </div>
          </div>

          <div ref={contentRef} className="sheet-content">
            {showCheckoutPanel ? (
              <div className="h-full flex flex-col min-h-0">
                <div className="flex-1 min-h-0 overflow-hidden">{checkoutPanel}</div>
              </div>
            ) : (
              <>
            <div className="flex justify-between items-center px-4 mb-4 mt-2">
              <h2 className="text-xl text-white font-black flex items-center gap-2">
                <ShoppingBag className="w-6 h-6" />
                {t('cart.title')}
              </h2>
              {cartItems.length > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onClearCart) onClearCart();
                  }}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 text-xs font-black transition-all active:scale-95"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{language === 'ar' ? 'حذف الكل' : 'Clear'}</span>
                </button>
              )}
            </div>

            <div id="cart-items-container" className="space-y-4 px-4 pb-4">
              {cartItems.length === 0 && (
                <div className="bg-dark/60 border border-primary/20 rounded-xl p-6 text-center">
                  <Package className="w-10 h-10 text-primary/70 mx-auto mb-3" />
                  <p className="text-white font-black">{language === 'ar' ? 'لا يوجد أصناف' : 'No items yet'}</p>
                </div>
              )}

              {cartItems.map(item => {
                const price = item.has_offer && item.offer_price ? item.offer_price : item.price;
                const subtotal = price * item.quantity;

                return (
                  <div key={item.id} id={`cart-item-${item.id}`} className="cart-item-card">
                    <div className="w-14 h-14 rounded-lg overflow-hidden border border-primary/20 flex-shrink-0">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={language === 'ar' ? item.name : item.name_en}
                          loading="lazy"
                          decoding="async"
                          onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
                          className="w-full h-full object-cover img-fade"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-dark text-xs text-muted font-black">MX</div>
                      )}
                    </div>
                    <div className="flex-1 text-right">
                      <h3 className="text-white font-bold text-sm leading-tight">
                        {language === 'ar' ? item.name : item.name_en}
                      </h3>
                      <p className="text-muted text-xs">
                        {language === 'ar' ? item.name_en : item.name}
                      </p>
                      <div className="flex items-center justify-end gap-2 mt-1">
                        <span className="text-primary font-bold text-xs">
                          {price} {currencySymbol}
                        </span>
                        {item.has_offer && item.offer_price && (
                          <span className="text-muted/60 line-through text-[10px]">
                            {item.price} {currencySymbol}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onRemoveItem(item.id)}
                        className="bg-red-600/80 hover:bg-red-500 p-1.5 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-white" />
                      </button>

                      <div className="flex items-center gap-1 bg-dark rounded-lg p-0.5">
                        <button
                          onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                          className="bg-primary hover:bg-primary/80 p-1 rounded transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5 text-white" />
                        </button>
                        <span className="text-white font-bold w-5 text-center text-sm">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                          className="bg-primary hover:bg-primary/80 p-1 rounded transition-colors disabled:bg-dark/60"
                          disabled={item.quantity <= 1}
                        >
                          <Minus className="w-3.5 h-3.5 text-white" />
                        </button>
                      </div>

                      <div className="text-primary font-black text-sm w-16 text-right">
                        {subtotal} {currencySymbol}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {cartItems.length > 0 && suggestedItems.length > 0 && (
              <div className="px-4 pb-4">
                <h3 className="text-white font-black text-sm mb-2 text-right">
                  {language === 'ar' ? 'مقترحة لك' : 'Suggested for you'}
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {suggestedItems.slice(0, 6).map(suggested => (
                    <button
                      key={suggested.id}
                      onClick={() => onAddSuggestedItem?.(suggested)}
                      className="bg-dark/60 border border-primary/20 rounded-lg p-2 text-right hover:border-primary/60 transition-all"
                    >
                      <div className="flex items-center gap-2">
                        {suggested.image_url ? (
                          <img
                            src={suggested.image_url}
                            alt={suggested.name}
                            loading="lazy"
                            decoding="async"
                            onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
                            className="w-10 h-10 rounded-md object-cover img-fade"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-surface flex items-center justify-center text-[10px] text-muted">MX</div>
                        )}
                        <div className="flex-1 min-w-0 text-right">
                          <p className="text-white text-xs font-bold truncate">{language === 'ar' ? suggested.name : suggested.name_en}</p>
                          <p className="text-primary text-[11px] font-black">
                            {(suggested.has_offer && suggested.offer_price ? suggested.offer_price : suggested.price)} {currencySymbol}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            </>
            )}
          </div>

          {(!showCheckoutPanel || checkoutCartEditMode) && (
          <div className="sheet-footer">
            {!showCheckoutPanel && (
            <div className="flex items-center justify-between mb-3">
              <div className="text-xl font-black text-white">
                {total} <span className="text-base">{currencySymbol}</span>
              </div>
              <div className="text-base text-muted font-bold">{t('common.total')}</div>
            </div>
            )}
            {!showCheckoutPanel && !checkoutCartEditMode && (
              <button
                onClick={onCheckout}
                type="button"
                disabled={cartItems.length === 0}
                className="w-full bg-primary hover:bg-primary/80 text-white py-2.5 rounded-xl font-black text-lg transition-all transform hover:scale-[1.02] shadow-lg"
              >
                {t('cart.checkout')}
              </button>
            )}
            {!showCheckoutPanel && checkoutCartEditMode && (
              <div className="space-y-2">
                <p className="text-xs text-primary font-bold text-center">
                  {language === 'ar' ? 'وضع تعديل السلة' : 'Cart edit mode'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={onCancelCheckoutCartEdit}
                    className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-xl font-black text-sm"
                  >
                    {language === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={onSaveCheckoutCartEdit}
                    className="w-full bg-primary hover:bg-primary/80 text-white py-2.5 rounded-xl font-black text-sm"
                  >
                    {language === 'ar' ? 'حفظ' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      <style>{`
        .cart-sheet {
          position: fixed;
          left: auto;
          right: auto;
          bottom: 0;
          width: min(100vw, 430px);
          height: 92vh;
          z-index: 55;
          will-change: transform, opacity;
          touch-action: none;
          transform: translateY(calc(var(--ty, 1000) * 1px));
          opacity: 1;
          
          left: 50%;
          margin-left: calc(min(100vw, 430px) / -2);
          pointer-events: none;
          transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.24s ease-out;
        }

        @media (min-width: 769px) {
          .cart-sheet[data-state="full"] {
            width: 700px;
            margin-left: -350px;
          }
          .cart-sheet.checkout-confirm-mode[data-state="full"] {
            width: 820px;
            margin-left: -410px;
            height: 96vh;
          }
        }
        .cart-sheet[data-state="offscreen"] { pointer-events: none; }
        .cart-sheet[data-hidden="1"] { opacity: 0; }
        
        .cart-sheet-inner {
          width: 100%;
          height: 100%;
          background: hsl(var(--color-surface));
          border-radius: 24px 24px 0 0;
          box-shadow: 0 -8px 40px rgba(0,0,0,0.25), 0 -1px 0 rgba(124,58,237,0.3);
          pointer-events: auto;
          display: flex;
          flex-direction: column;
          position: relative;
        }

        .cart-sheet.cart-sheet--phone-chrome {
          width: 100vw;
          height: 100vh;
          height: 100dvh;
          margin-left: -50vw;
        }
        .cart-sheet.cart-sheet--phone-chrome .cart-sheet-inner {
          border-radius: 20px 20px 0 0;
        }

        .cart-sheet-inner::before {
          content: '';
          position: absolute;
          top: 0; left: 10%; right: 10%;
          height: 1px;
          background: linear-gradient(90deg, transparent, #7c3aed, #06b6d4, transparent);
          opacity: 0.35;
          pointer-events: none;
        }

        .handle-area {
          width: 100%;
          padding: 8px 0 6px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          cursor: grab;
          user-select: none;
          position: relative;
          z-index: 2;
        }
        .handle-area:active { cursor: grabbing; }
        
        .handle-bar {
          width: 44px; height: 5px;
          background: rgba(255,255,255,0.18);
          border-radius: 3px;
          transition: background 0.2s, width 0.2s;
        }
        .cart-sheet.dragging .handle-bar {
          background: #7c3aed;
          width: 58px;
        }

        .handle-summary {
          transition: opacity 0.22s ease-out, transform 0.22s ease-out;
          opacity: var(--footer-opacity, 1);
        }
        /* أثناء الشيك أوت: إخفاء الملخص عندما تكون القائمة مفتوحة (half/full)، وإظهاره في حالة mini */
        .cart-sheet.show-checkout-panel[data-state="full"] .handle-summary,
        .cart-sheet.show-checkout-panel[data-state="half"] .handle-summary {
          opacity: 0;
          transform: translateY(-4px);
          pointer-events: none;
        }
        .sheet-content {
          padding: 6px 0 120px;
          overflow-y: hidden;
          height: calc(100% - 72px);
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          opacity: var(--content-opacity, 0);
          pointer-events: var(--content-events, none);
          transition: opacity 0.2s;
        }
        .cart-sheet.show-checkout-panel .sheet-content {
          padding: 6px 0 12px;
        }
        
        .sheet-content::-webkit-scrollbar { width: 4px; }
        .sheet-content::-webkit-scrollbar-track { background: transparent; margin: 8px 0; }
        .sheet-content::-webkit-scrollbar-thumb {
          background: rgba(124,58,237,0.35);
          border-radius: 4px;
        }
        .sheet-content::-webkit-scrollbar-thumb:hover {
          background: rgba(124,58,237,0.6);
        }
        .img-fade {
          opacity: 0;
          transition: opacity 240ms ease-in;
        }
        .img-fade.is-loaded {
          opacity: 1;
        }

        .cart-item-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: rgba(30,25,55,0.6);
          border: 1px solid rgba(124,58,237,0.15);
          border-radius: 14px;
        }

        .sheet-footer {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          background: color-mix(in srgb, hsl(var(--color-surface)) 94%, black 6%);
          backdrop-filter: blur(10px);
          border-top: 1px solid rgba(124,58,237,0.3);
          padding: 16px;
          z-index: 20;
          border-radius: 0 0 24px 24px;
          
          transform: translateY(calc(var(--footer-ty, 0) * -1px));
        }

        /* Disable hover effects on touch devices (cart only) */
        @media (hover: none) {
          .cart-sheet button:hover {
            transform: none !important;
          }
        }
      `}</style>
    </>
  );
}