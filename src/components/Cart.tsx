import { ChevronLeft, ChevronRight, Minus, Package, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { Item } from '../lib/supabase';
import { useLanguage } from '../contexts/LanguageContext';
import { ReactNode, useEffect, useRef, useCallback, useState } from 'react';
import { isTouchPhoneChrome } from '../lib/viewportUi';
import ProgressiveImage from './ProgressiveImage';

interface CartItem extends Item {
  quantity: number;
  /** True when the item was found unavailable during a cart sync pass */
  cart_synced_unavailable?: boolean;
  /** True when the item's data (price, name, etc.) changed during a cart sync pass */
  cart_synced_data_changed?: boolean;
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
  isHidden?: boolean;
  editingOrder?: any;
  onSaveOrderEdit?: () => void;
  onCancelOrderEdit?: () => void;
  onAcknowledgeUpdate?: (itemId: string) => void;
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
  onCheckoutHandleBack,
  isHidden = false,
  editingOrder = null,
  onSaveOrderEdit,
  onCancelOrderEdit,
  onAcknowledgeUpdate
}: CartProps) {
  const { language, t } = useLanguage();
  const currencySymbol = language === 'ar' ? 'ج' : 'EG';

  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const isDraggingRef = useRef(false);
  const currentSnapRef = useRef(0);
  const hideAfterOffscreenTimeoutRef = useRef<number | null>(null);
  const [sheetState, setSheetState] = useState<'offscreen' | 'mini' | 'full'>('offscreen');
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
    // On mobile, increase mini snap so the handle stays above the bottom nav
    const navH = phoneChrome ? 74 : 0; 
    return {
      offscreen: fullH + 50,
      mini: fullH - (75 + navH),
      full: 0,
      fullH
    };
  }, [phoneChrome]);

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
      : ty <= snaps.mini / 2
        ? 'full'
        : 'mini';
    setSheetState(state as 'offscreen' | 'mini' | 'full');
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

    const showFooter = state === 'full' && !showCheckoutPanel;
    sheet.style.setProperty('--sheet-footer-opacity', showFooter ? '1' : '0');
    sheet.style.setProperty('--sheet-footer-events', showFooter ? 'auto' : 'none');
    sheet.style.setProperty('--sheet-footer-shift', showFooter ? '0%' : '110%');
    const contentOpacity = state === 'full' ? 1 : 0;
    sheet.style.setProperty('--content-opacity', `${contentOpacity}`);
    sheet.style.setProperty('--content-events', contentOpacity === 0 ? 'none' : 'auto');
  }, [getSnaps, showCheckoutPanel]);

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
      : (showCheckoutPanel && sheetState === 'full');
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

    const candidates = [snaps.mini, snaps.full];
    if (vel < -4) return snaps.full;
    if (vel > 4) return snaps.mini;

    return candidates.reduce((a, b) =>
      Math.abs(b - biased) < Math.abs(a - biased) ? b : a
    );
  }, [getSnaps]);

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
    ty = Math.max(-10, Math.min(snaps.mini + 20, ty));
    if (ty < 0) ty *= 0.3;

    setTranslate(ty, false);
  }, [getSnaps, setTranslate]);

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

    if (stop === snaps.full) {
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
    } else if (showCheckoutPanel) {
      snapTo(snaps.full, true);
    } else if (hasItems && !isHidden) {
      snapTo(snaps.mini, true);
    } else {
      const target = snaps.offscreen;
      snapTo(target, true);
    }
  }, [isOpen, hasItems, showCheckoutPanel, getSnaps, snapTo, isHidden]);

  useEffect(() => {
    const snaps = getSnaps();
    if (isOpen) {
      if (currentSnapRef.current !== snaps.full) {
        snapTo(snaps.full, true);
      }
    } else if (showCheckoutPanel) {
      if (currentSnapRef.current !== snaps.full) snapTo(snaps.full, true);
    } else if (hasItems && !isHidden) {
      if (currentSnapRef.current !== snaps.mini) {
        snapTo(snaps.mini, true);
      }
    } else {
      const target = snaps.offscreen;
      if (currentSnapRef.current !== target) {
        snapTo(target, true);
      }
    }
  }, [isOpen, hasItems, showCheckoutPanel, getSnaps, snapTo, cartItems.length, isHidden]);

  useEffect(() => {
    if (showCheckoutPanel) return;
    if (cartItems.length > 0) return;
    if (callbacksRef.current.isOpen) return;
    const snaps = getSnaps();
    snapTo(snaps.offscreen, true);
    if (callbacksRef.current.isOpen) callbacksRef.current.onClose();
  }, [cartItems.length, showCheckoutPanel, getSnaps, snapTo]);

  // Keep sheet snap stable on viewport resize.
  useEffect(() => {
    const onResize = () => {
      const snaps = getSnaps();
      if (callbacksRef.current.isOpen) {
        snapTo(snaps.full, false);
      } else if (showCheckoutPanel) {
        snapTo(snaps.full, false);
      } else if (hasItems && !isHidden) {
        snapTo(snaps.mini, false);
      } else {
        snapTo(snaps.offscreen, false);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [getSnaps, snapTo, hasItems, showCheckoutPanel, isHidden]);

  // Desktop: while collapsed, wheel down can expand to full.
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;

    const handleWheel = (e: WheelEvent) => {
      if (!isTouchPhoneChrome() && currentSnapRef.current > 0 && e.deltaY > 0) {
        snapTo(getSnaps().full);
        e.preventDefault();
        return;
      }
    };

    sheet.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      sheet.removeEventListener('wheel', handleWheel);
    };
  }, [getSnaps, snapTo, cartItems.length]);

  return (
    <>
      {/* Invisible click-blocker during checkout (no dimming) */}
      <div
        className={`fixed inset-0 z-[80] bg-transparent ${
          showCheckoutPanel ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className={`cart-sheet ${phoneChrome ? 'cart-sheet--phone-chrome' : ''} ${showCheckoutPanel ? 'show-checkout-panel' : ''} ${showCheckoutPanel && checkoutStep === 'address' ? 'checkout-confirm-mode' : ''} ${showCheckoutPanel && phoneChrome ? 'mobile-checkout-fullscreen' : ''}`}
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
              if (currentSnapRef.current !== getSnaps().full) {
                snapTo(getSnaps().full, true);
                callbacksRef.current.onHandleClick();
              } else {
                const snaps = getSnaps();
                const target = hasItems && !isHidden && !showCheckoutPanel ? snaps.mini : snaps.offscreen;
                snapTo(target, true);
                callbacksRef.current.onClose();
              }
            }}
          >
            <div className="handle-bar"></div>

            <div className="relative mt-1 flex h-9 w-full items-center justify-center px-6 isolate">
              {showCheckoutPanel && (
                <button
                  type="button"
                  data-no-drag="1"
                  className={`absolute ${language === 'ar' ? 'right-3' : 'left-3'} top-0 bottom-0 my-auto z-10 h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none pointer-events-auto`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCheckoutHandleBack?.();
                  }}
                >
                  {language === 'ar' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
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
                {editingOrder 
                  ? (language === 'ar' ? `تعديل طلب #${editingOrder.order_number}` : `Edit Order #${editingOrder.order_number}`)
                  : t('cart.title')}
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

                const originalItem = editingOrder?.items?.find((oi: any) => oi.item_id === item.id);
                const isOriginal = !!originalItem;
                const originalQty = originalItem ? originalItem.quantity : 0;
                const isPreparing = editingOrder?.status === 'preparing';
                const disableRemove = isOriginal && isPreparing;
                const disableDecrease = item.quantity <= 1 || (isOriginal && isPreparing && item.quantity <= originalQty);

                return (
                  <div key={item.id} id={`cart-item-${item.id}`} className="cart-item-card flex-col gap-0">
                    {/* Status banners inside the card */}
                    {item.cart_synced_unavailable && (
                      <div className="w-full flex items-center justify-between bg-red-600/20 border border-red-500/40 rounded-lg px-3 py-1.5 mb-2">
                        <span className="text-red-400 text-[11px] font-black">{language === 'ar' ? 'هذا الصنف لم يعد متوفراً، يرجى إزالته' : 'Item no longer available — please remove'}</span>
                      </div>
                    )}
                    {item.cart_synced_data_changed && !item.cart_synced_unavailable && (
                      <div className="w-full flex items-center justify-between bg-yellow-500/15 border border-yellow-500/40 rounded-lg px-3 py-1.5 mb-2">
                        <span className="text-yellow-400 text-[11px] font-black">{language === 'ar' ? 'تم تحديث بيانات هذا الصنف' : 'Item data was updated'}</span>
                        <button onClick={(e) => { e.stopPropagation(); onAcknowledgeUpdate?.(item.id); }} className="text-yellow-400 hover:text-yellow-200 transition-colors p-0.5">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {/* Main item row */}
                    <div className="flex items-center gap-3 w-full">
                      <div className="w-14 h-14 rounded-lg overflow-hidden border border-primary/20 flex-shrink-0">
                        {item.image_url ? (
                          <ProgressiveImage
                            src={item.image_url}
                            alt={language === 'ar' ? item.name : item.name_en}
                            preset="thumb"
                            wrapperClassName="w-full h-full"
                            className={`w-full h-full object-cover ${item.cart_synced_unavailable ? 'grayscale opacity-50' : ''}`}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-dark text-xs text-muted font-black">MX</div>
                        )}
                      </div>
                      <div className="flex-1 text-right">
                        <h3 className={`font-bold text-sm leading-tight ${item.cart_synced_unavailable ? 'text-white/50 line-through' : 'text-white'}`}>
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
                          disabled={disableRemove}
                          className="bg-red-600/80 hover:bg-red-500 p-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:hover:bg-red-600/80 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-white" />
                        </button>

                        {!item.cart_synced_unavailable && (
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
                              className="bg-primary hover:bg-primary/80 p-1 rounded transition-colors disabled:bg-dark/60 disabled:cursor-not-allowed"
                              disabled={disableDecrease}
                            >
                              <Minus className="w-3.5 h-3.5 text-white" />
                            </button>
                          </div>
                        )}

                        <div className="text-primary font-black text-sm w-16 text-right">
                          {subtotal} {currencySymbol}
                        </div>
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
                          <ProgressiveImage
                            src={suggested.image_url}
                            alt={suggested.name}
                            preset="thumb"
                            wrapperClassName="w-10 h-10 shrink-0"
                            className="w-full h-full rounded-md object-cover"
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
              editingOrder ? (
                <div className="flex gap-2 w-full">
                  <button
                    onClick={onCancelOrderEdit}
                    type="button"
                    className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-xl font-black text-sm transition-all"
                  >
                    {language === 'ar' ? 'إلغاء التعديل' : 'Cancel Edit'}
                  </button>
                  <button
                    onClick={onSaveOrderEdit}
                    type="button"
                    disabled={cartItems.length === 0}
                    className="flex-1 bg-green-600 hover:bg-green-500 text-white py-2.5 rounded-xl font-black text-sm transition-all shadow-lg"
                  >
                    {language === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={onCheckout}
                  type="button"
                  disabled={cartItems.length === 0}
                  className="w-full bg-primary hover:bg-primary/80 text-white py-2.5 rounded-xl font-black text-lg transition-all transform hover:scale-[1.02] shadow-lg"
                >
                  {t('cart.checkout')}
                </button>
              )
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
          z-index: 90;
          will-change: transform, opacity;
          touch-action: none;
          transform: translateY(calc(var(--ty, 1000) * 1px));
          opacity: 1;
          
          left: 50%;
          margin-left: calc(min(100vw, 430px) / -2);
          pointer-events: none;
          transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.24s ease-out;
        }

        @media (max-width: 768px) {
          .cart-sheet--phone-chrome {
            bottom: 0 !important;
            height: 100vh;
            height: 100dvh;
          }
        }

        @media (min-width: 769px) {
          .cart-sheet[data-state="full"] {
            width: 700px;
            margin-left: -350px;
          }
          .cart-sheet.desktop-checkout-fullscreen[data-state="full"] {
            width: 100vw;
            height: 100vh;
            margin-left: -50vw;
          }
          .cart-sheet.desktop-checkout-fullscreen .cart-sheet-inner {
            border-radius: 0;
          }
          .cart-sheet.checkout-confirm-mode[data-state="full"] {
            width: 820px;
            margin-left: -410px;
            height: 96vh;
          }
          .cart-sheet.desktop-checkout-fullscreen.checkout-confirm-mode[data-state="full"] {
            width: 100vw;
            height: 100vh;
            margin-left: -50vw;
          }
        }
        .cart-sheet[data-state="offscreen"] { pointer-events: none; }
        .cart-sheet[data-hidden="1"] { opacity: 0; }
        
        .cart-sheet-inner {
          width: 100%;
          height: 100%;
          background: hsl(var(--color-surface));
          border-radius: 24px 24px 0 0;
          box-shadow: 0 -1px 0 rgba(124,58,237,0.3);
          pointer-events: auto;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        .light .cart-sheet-inner {
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.08), 0 -1px 0 rgba(0, 0, 0, 0.1) !important;
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
          pointer-events: none;
          transition: background 0.2s, width 0.2s, opacity 0.28s ease, transform 0.28s ease;
        }
        .cart-sheet.dragging .handle-bar {
          background: #7c3aed;
          width: 58px;
        }

        .handle-summary {
          transition: opacity 0.22s ease-out, transform 0.22s ease-out;
          opacity: 1;
        }
        .cart-sheet.show-checkout-panel[data-state="full"] .handle-summary {
          opacity: 0;
          transform: translateY(-4px);
          pointer-events: none;
        }
        .cart-sheet.desktop-checkout-fullscreen .handle-bar {
          opacity: 0;
          transform: translateY(-2px);
        }
        .cart-sheet.mobile-checkout-fullscreen .handle-bar {
          opacity: 0;
          transform: translateY(-2px);
        }
        .cart-sheet.mobile-checkout-fullscreen .cart-sheet-inner {
          border-radius: 0;
        }
        .cart-sheet.mobile-checkout-fullscreen {
          width: 100vw;
          height: 100vh;
          height: 100dvh;
          margin-left: -50vw;
        }
        .cart-sheet.desktop-checkout-fullscreen .handle-area {
          cursor: default;
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
        .light .cart-item-card {
          background: rgba(0, 0, 0, 0.03) !important;
          border-color: rgba(0, 0, 0, 0.08) !important;
        }

        .sheet-footer {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          background: hsl(var(--color-surface));

          border-top: 1px solid rgba(124,58,237,0.3);
          padding: 16px;
          z-index: 20;
          border-radius: 0 0 24px 24px;
          
          transform: translateY(var(--sheet-footer-shift, 110%));
          opacity: var(--sheet-footer-opacity, 0);
          pointer-events: var(--sheet-footer-events, none);
          transition: transform 0.22s ease, opacity 0.2s ease;
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