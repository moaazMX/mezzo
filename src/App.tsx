import { useState, useEffect, useCallback, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { MenuDisplayProvider } from './contexts/MenuDisplayContext';
import { supabase, Category, Item, DeviceCoupon, DeliveryService, DeliveryZoneLayer, PolygonPoint, Order, OrderItem, CustomerData } from './lib/supabase';
import { fetchDeliveryZonesAndServices, getDeliveryMatch } from './lib/deliveryMatch';
import { generateEasyRecoveryCode, hashPhonePassword, hashRecoveryCode } from './lib/phonePassword';
import { getOrCreateDeviceFingerprint } from './lib/deviceFingerprint';
import { findCustomerIdByPhone, findCustomerSummaryByPhone, ensureCustomerByPhone } from './lib/customerPhone';
import {
  CheckCircle2, Navigation, MapPin, Lock,
  ChevronLeft, ChevronRight, Clock, Package, Truck,
  AlertTriangle as AlertTriangleIcon, CheckCircle, XCircle,
  Keyboard, ReceiptText, User
} from 'lucide-react';
import Header from './components/Header';
import CategorySection from './components/CategorySection';
import Cart from './components/Cart';
import Checkout from './components/Checkout';
import CustomerProfile from './components/CustomerProfile';
import CheatCodeInput from './components/CheatCodeInput';
import OperatorLogin from './components/OperatorLogin';
import OperatorDashboard from './components/OperatorDashboard';
import { RatePage } from './components/RateDashboard';
import { RateAuthProvider } from './contexts/RateAuthContext';
import { fetchRateSettings } from './lib/rateDiscount';
import { isTouchPhoneChrome } from './lib/viewportUi';
import { formatDeadline } from './lib/dateUtils';
import { RealtimeProvider } from './contexts/RealtimeContext';
import { useRealtimeRefetch } from './hooks/useRealtimeSubscription';
import { formatOrderItemsList, buildCatalogLookup } from './lib/itemDisplayName';

function OperatorPage() {
  const { isOperator } = useAuth();

  useEffect(() => {
    // re-render when auth changes
  }, [isOperator]);

  if (isOperator) {
    return <OperatorDashboard />;
  }

  return (
    <div className="min-h-screen bg-dark flex items-center justify-center">
      <OperatorLogin onClose={() => window.location.href = '/'} />
    </div>
  );
}

interface CartItem extends Item {
  quantity: number;
  cart_synced_unavailable?: boolean;
  cart_synced_data_changed?: boolean;
}

interface PendingOrder extends Order {
  items: OrderItem[];
}

function AppContent() {
  const { language } = useLanguage();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const hasLoadedMenuRef = useRef(false);
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<'customer' | 'address'>('customer');
  const [checkoutCartEditMode, setCheckoutCartEditMode] = useState(false);
  const [checkoutCartSnapshot, setCheckoutCartSnapshot] = useState<CartItem[] | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [editingOrder, setEditingOrder] = useState<any | null>(null);
  const [profileInitialTab, setProfileInitialTab] = useState<'settings' | 'orders'>('settings');
  const [customerPhone, setCustomerPhone] = useState('');
  const [couponSecretCode, setCouponSecretCode] = useState<string | null>(null);
  const [couponDiscountPercent, setCouponDiscountPercent] = useState<number>(0);
  const [deviceCoupons, setDeviceCoupons] = useState<DeviceCoupon[]>([]);
  const [ordersCount, setOrdersCount] = useState(0);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [pickupNowMs, setPickupNowMs] = useState(() => Date.now());
  const [currentPendingOrderIndex, setCurrentPendingOrderIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [phoneChrome, setPhoneChrome] = useState(false);
  const mobileKeyboardInputRef = useRef<HTMLInputElement>(null);
  /** Prevents double-submit (rapid taps / Enter) creating duplicate orders. */
  const orderConfirmInFlightRef = useRef(false);
  const [highlightOrderId, setHighlightOrderId] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<{
    orderNumber: string;
    deliveryMethod?: 'delivery' | 'pickup';
    branchName?: string | null;
    branchLocation?: PolygonPoint | null;
    needsPasswordSetup?: boolean;
    setupCustomerId?: string;
    setupPhone?: string;
  } | null>(null);
  const [postOrderPwd, setPostOrderPwd] = useState('');
  const [postOrderPwd2, setPostOrderPwd2] = useState('');
  const [postOrderPwdErr, setPostOrderPwdErr] = useState<string | null>(null);
  const [postOrderPwdSaving, setPostOrderPwdSaving] = useState(false);
  const [postOrderRecoveryCode, setPostOrderRecoveryCode] = useState<string | null>(null);
  const [showOptionalSecurity, setShowOptionalSecurity] = useState(false);
  const [activeBottomTab, setActiveBottomTab] = useState<'home' | 'orders' | 'account'>('home');
  const [isProductImageFullscreen, setIsProductImageFullscreen] = useState(false);
  const [orderConfirmSubmitting, setOrderConfirmSubmitting] = useState(false);
  const [profileSettingsView, setProfileSettingsView] = useState('main');

  useEffect(() => {
    try {
      const raw = localStorage.getItem('cart_items');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setCartItems(parsed);
      }
    } catch (e) {
      console.warn('Could not restore cart_items:', e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('cart_items', JSON.stringify(cartItems));
    } catch (e) {
      console.warn('Could not persist cart_items:', e);
    }
  }, [cartItems]);

  useEffect(() => {
    const handler = (e: any) => {
      const isFullscreen = !!e.detail;
      setIsProductImageFullscreen(isFullscreen);
    };
    window.addEventListener('mobileFullscreenImage', handler);
    return () => window.removeEventListener('mobileFullscreenImage', handler);
  }, []);

  useEffect(() => {
    fetchData();
    fetchCouponConfigAndCoupons();
  }, []);

  useRealtimeRefetch('app-menu', ['categories', 'items'], () => {
    void fetchData(true);
  });

  useRealtimeRefetch('app-coupons-settings', ['device_coupons', 'settings'], () => {
    void fetchCouponConfigAndCoupons();
  });

  /** True phones only (coarse pointer + narrow) — not a desktop window resized small */
  useEffect(() => {
    const sync = () => setPhoneChrome(isTouchPhoneChrome());
    sync();
    window.addEventListener('resize', sync);
    const mq = window.matchMedia('(pointer: coarse)');
    mq.addEventListener('change', sync);
    return () => {
      window.removeEventListener('resize', sync);
      mq.removeEventListener('change', sync);
    };
  }, []);

  // Fetch pending (undelivered) orders
  const fetchPendingOrders = useCallback(async () => {
    let customerId: string | null = null;
    const phone = customerPhone || localStorage.getItem('customer_phone');

    if (phone) {
      try {
        customerId = await findCustomerIdByPhone(phone);
      } catch (e) {
        console.error(e);
      }
    }

    if (!customerId) {
      setPendingOrders([]);
      return;
    }

    try {
      const { data: activeOrders } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customerId)
        .not('status', 'in', '("completed","cancelled")')
        .order('created_at', { ascending: false });

      if (!activeOrders || activeOrders.length === 0) {
        setPendingOrders([]);
        return;
      }

      // Fetch items for each order
      const ordersWithItems: PendingOrder[] = await Promise.all(
        activeOrders.map(async (order) => {
          const { data: orderItems } = await supabase
            .from('order_items')
            .select('*')
            .eq('order_id', order.id);
          return { ...order, items: orderItems || [] } as PendingOrder;
        })
      );

      setPendingOrders(ordersWithItems);
      setCurrentPendingOrderIndex(0);
    } catch (error) {
      console.error('Error fetching pending orders:', error);
    }
  }, [customerPhone]);

  useEffect(() => {
    fetchPendingOrders();
  }, [fetchPendingOrders]);

  useEffect(() => {
    const t = window.setInterval(() => setPickupNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const getPickupCountdownMeta = useCallback((order: PendingOrder) => {
    if (order.delivery_method !== 'pickup') return null;
    if (!['under_review', 'preparing', 'arrived', 'cancellation_pending'].includes(order.status)) return null;
    const deadlineRaw = (order as any).pickup_deadline_at as string | null | undefined;
    if (!deadlineRaw) return null;
    const deadlineMs = new Date(deadlineRaw).getTime();
    if (Number.isNaN(deadlineMs)) return null;
    const diff = deadlineMs - pickupNowMs;
    if (diff <= 0) {
      return {
        text: '00:00',
        className: 'text-red-500 font-black animate-pulse',
        deadlineRaw
      };
    }
    const totalSec = Math.floor(diff / 1000);
    const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    // Removed seconds as per user request
    const cls = diff < 15 * 60 * 1000 ? 'text-red-400 animate-pulse' : diff <= 60 * 60 * 1000 ? 'text-orange-300' : 'text-green-400';
    return { text: `${hh}:${mm}`, className: cls, deadlineRaw };
  }, [language, pickupNowMs]);

  const refreshCustomerOrderBadge = useCallback(async () => {
    await fetchPendingOrders();
    if (!customerPhone) {
      setOrdersCount(0);
      return;
    }
    try {
      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('phone', customerPhone)
        .maybeSingle();
      if (!customer) {
        setOrdersCount(0);
        return;
      }
      const { data: activeOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('customer_id', customer.id)
        .not('status', 'in', '("completed","cancelled")');
      setOrdersCount(activeOrders?.length || 0);
    } catch (error) {
      console.error('Error refreshing customer order badge:', error);
    }
  }, [customerPhone, fetchPendingOrders]);

  useRealtimeRefetch(
    'app-customer-orders',
    ['orders', 'order_items'],
    () => {
      void refreshCustomerOrderBadge();
    },
    { enabled: !!customerPhone }
  );

  // Slideshow for pending orders: Only advance when status changes
  useEffect(() => {
    if (pendingOrders.length === 0) return;

    // Monitor for status changes
    const ordersStatuses = pendingOrders.map(o => `${o.id}-${o.status}`).join('|');
    const lastStatuses = (window as any)._lastOrdersStatuses;

    if (lastStatuses && lastStatuses !== ordersStatuses) {
      // Find which order changed status
      const lastStatusArr = lastStatuses ? lastStatuses.split('|') : [];
      const currentStatusArr = ordersStatuses.split('|');

      for (let i = 0; i < currentStatusArr.length; i++) {
        if (currentStatusArr[i] !== lastStatusArr[i]) {
          setCurrentPendingOrderIndex(i);
          break;
        }
      }
    }

    (window as any)._lastOrdersStatuses = ordersStatuses;
  }, [pendingOrders]);

  // Swipe handling for pending orders banner
  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    if (isLeftSwipe) {
      setCurrentPendingOrderIndex(prev =>
        prev < pendingOrders.length - 1 ? prev + 1 : 0
      );
    } else if (isRightSwipe) {
      setCurrentPendingOrderIndex(prev =>
        prev > 0 ? prev - 1 : pendingOrders.length - 1
      );
    }
  };

  const getOrderStatusInfo = (status: string, deliveryMethod?: string) => {
    if (deliveryMethod === 'pickup') {
      switch (status) {
        case 'under_review':
          return { icon: Clock, text: 'قيد المعاينة', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' };
        case 'preparing':
          return { icon: Package, text: 'قيد التحضير', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' };
        case 'arrived':
          return { icon: Package, text: 'تم التحضير', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' };
        case 'completed':
          return { icon: CheckCircle, text: 'تم التسليم', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' };
      }
    }

    switch (status) {
      case 'under_review':
        return { icon: Clock, text: language === 'ar' ? 'قيد المعاينة' : 'Under Review', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' };
      case 'preparing':
        return { icon: Package, text: language === 'ar' ? 'قيد التحضير' : 'Preparing', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' };
      case 'on_way':
        return { icon: Truck, text: language === 'ar' ? 'في الطريق' : 'On the Way', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' };
      case 'arrived':
        return { icon: AlertTriangleIcon, text: language === 'ar' ? 'وصل الآن' : 'Arrived', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' };
      case 'completed':
        return { icon: CheckCircle, text: language === 'ar' ? 'مكتمل' : 'Completed', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30' };
      case 'cancelled':
        return { icon: XCircle, text: language === 'ar' ? 'ملغي' : 'Cancelled', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' };
      case 'cancellation_pending':
        return { icon: Clock, text: language === 'ar' ? 'طلب إلغاء' : 'Cancel Request', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' };
      default:
        return { icon: Package, text: status, color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/30' };
    }
  };


  const fetchCouponConfigAndCoupons = async (phoneOverride?: string) => {
    try {
      const { data: settingsData } = await supabase
        .from('settings')
        .select('key, value')
        .in('key', ['coupon_secret_code', 'coupon_discount_percent']);

      if (settingsData) {
        const secret = settingsData.find(s => s.key === 'coupon_secret_code');
        const percent = settingsData.find(s => s.key === 'coupon_discount_percent');

        setCouponSecretCode(secret?.value || null);
        const parsedPercent = percent ? parseInt(percent.value, 10) : 0;
        setCouponDiscountPercent(isNaN(parsedPercent) ? 0 : parsedPercent);
      }

      const fingerprint = getOrCreateDeviceFingerprint();
      const phone = ((phoneOverride ?? customerPhone) || '').trim();
      let customerIdForPhone: string | null = null;
      if (phone) {
        const { data: cRow } = await supabase
          .from('customers')
          .select('id')
          .eq('phone', phone)
          .maybeSingle();
        customerIdForPhone = (cRow as any)?.id ?? null;
      }

      const byDevicePromise = supabase
        .from('device_coupons')
        .select('*')
        .eq('device_fingerprint', fingerprint)
        .order('created_at', { ascending: false });
      const byCustomerPromise = customerIdForPhone
        ? supabase
          .from('device_coupons')
          .select('*')
          .eq('customer_id', customerIdForPhone)
          .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null } as any);
      const [byDevice, byCustomer] = await Promise.all([byDevicePromise, byCustomerPromise]);
      const mergedMap = new Map<string, any>();
      [...(byDevice.data || []), ...(byCustomer.data || [])].forEach((c: any) => mergedMap.set(c.id, c));
      const couponsData = Array.from(mergedMap.values());

      if (couponsData) {
        const now = new Date();
        const expiredIds = couponsData
          .filter((c) => !!c.expires_at && new Date(c.expires_at) <= now && !c.is_disabled)
          .map((c) => c.id);
        if (expiredIds.length) {
          await supabase
            .from('device_coupons')
            .update({ is_disabled: true })
            .in('id', expiredIds);
        }
        // نظهر لجميع الكوبونات (حتى المستخدمة) حتى تبقى في البروفايل،
        // لكن في شاشة الدفع سنختار غير المستخدمة فقط.
        const validCoupons = couponsData.filter((c) => {
          if (c.is_disabled) return false;
          if (c.expires_at && new Date(c.expires_at) <= now) return false;
          // If phone is provided: only coupons linked to that phone/account are visible.
          if (phone) {
            if (!customerIdForPhone) return false;
            const linkedById = !!c.customer_id && c.customer_id === customerIdForPhone;
            const linkedByPhone = !!c.customer_phone && c.customer_phone.trim() === phone;
            if (!linkedById && !linkedByPhone) return false;
          }
          return true;
        });
        setDeviceCoupons(validCoupons);
      }
    } catch (error) {
      console.error('Error loading coupon config or coupons:', error);
    }
  };

  useEffect(() => {
    void fetchCouponConfigAndCoupons();
  }, [customerPhone]);

  useEffect(() => {
    const savedPhone = localStorage.getItem('customer_phone');
    if (savedPhone) {
      setCustomerPhone(savedPhone);
    } else {
      const savedData = localStorage.getItem('customer_data');
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          if (parsed && parsed.phone) {
            setCustomerPhone(parsed.phone);
          }
        } catch (e) { }
      }
    }
    // No need to set customerId state here, handled in fetches
  }, []);

  useEffect(() => {
    const checkCustomerOrders = async () => {
      if (!customerPhone) {
        setOrdersCount(0);
        return;
      }

      try {
        const { data: customer } = await supabase
          .from('customers')
          .select('id')
          .eq('phone', customerPhone)
          .maybeSingle();

        if (!customer) {
          setOrdersCount(0);
          return;
        }

        const { data: activeOrders } = await supabase
          .from('orders')
          .select('id')
          .eq('customer_id', customer.id)
          .not('status', 'in', '("completed","cancelled")');

        const total = (activeOrders?.length || 0);
        setOrdersCount(total);
      } catch (error) {
        console.error('Error checking customer orders for profile badge:', error);
      }
    };

    checkCustomerOrders();
  }, [customerPhone]);

  const fetchData = async (silent = false) => {
    if (!silent && !hasLoadedMenuRef.current) {
      setLoading(true);
    }

    const [categoriesRes, itemsRes] = await Promise.all([
      supabase.from('categories').select('*').eq('is_active', true).order('display_order'),
      supabase.from('items').select('*').eq('is_active', true).order('display_order')
    ]);

    if (categoriesRes.data) setCategories(categoriesRes.data);
    if (itemsRes.data) {
      setItems(itemsRes.data);
      
      setCartItems(prevCart => {
        if (prevCart.length === 0) return prevCart;
        let hasChanges = false;
        const newCart = prevCart.map(cartItem => {
          const dbItem = itemsRes.data.find(i => i.id === cartItem.id);
          
          if (!dbItem || !dbItem.is_active || !dbItem.is_available) {
            if (!cartItem.cart_synced_unavailable) {
              hasChanges = true;
              return { ...cartItem, cart_synced_unavailable: true };
            }
            return cartItem;
          }
          
          const dataChanged = 
            dbItem.price !== cartItem.price ||
            dbItem.name !== cartItem.name ||
            dbItem.image_url !== cartItem.image_url ||
            dbItem.has_offer !== cartItem.has_offer ||
            dbItem.offer_price !== cartItem.offer_price ||
            cartItem.cart_synced_unavailable === true;
            
          if (dataChanged) {
            hasChanges = true;
            return { ...dbItem, quantity: cartItem.quantity, cart_synced_data_changed: true, cart_synced_unavailable: false };
          }
          
          return cartItem;
        });
        return hasChanges ? newCart : prevCart;
      });
    }

    hasLoadedMenuRef.current = true;
    setLoading(false);
  };

  const handleAddToCart = (item: Item, elementRef?: React.RefObject<HTMLDivElement>) => {
    // Animate item to cart
    if (elementRef?.current) {
      const itemElement = elementRef.current;
      const itemRect = itemElement.getBoundingClientRect();

      let targetElement: HTMLElement | null = null;
      let isItemRow = false;

      const headerCartBtn = document.querySelector('[data-cart-button]') as HTMLElement;
      const bottomHandle = document.querySelector('[data-cart-handle]') as HTMLElement;

      const bottomSheet = document.getElementById('cart-bottom-sheet');
      const isSheetFull = bottomSheet?.getAttribute('data-state') === 'full';

      if (showCart && isSheetFull) {
        const existingRow = document.getElementById(`cart-item-${item.id}`);
        if (existingRow) {
          targetElement = existingRow;
          isItemRow = true;
        } else {
          const itemsContainer = document.getElementById('cart-items-container');
          if (itemsContainer) {
            targetElement = (itemsContainer.lastElementChild as HTMLElement) || itemsContainer;
            isItemRow = true;
          }
        }
      }

      if (!targetElement) {
        const toPhoneHandle = isTouchPhoneChrome();
        if (toPhoneHandle && bottomHandle) {
          targetElement = bottomHandle;
        } else {
          const headerVisible = window.scrollY < 80;
          if (headerVisible && headerCartBtn) {
            targetElement = headerCartBtn;
          } else if (bottomHandle) {
            targetElement = bottomHandle;
          } else {
            targetElement = headerCartBtn;
          }
        }
      }

      // --- PHASE 1: Create a DOM clone of the whole product card ---
      const clone = itemElement.cloneNode(true) as HTMLElement;
      clone.style.position = 'fixed';
      clone.style.top = `${itemRect.top}px`;
      clone.style.left = `${itemRect.left}px`;
      clone.style.width = `${itemRect.width}px`;
      clone.style.height = `${itemRect.height}px`;
      clone.style.margin = '0';
      clone.style.zIndex = '9999';
      clone.style.pointerEvents = 'none';
      clone.style.transformOrigin = 'center';
      clone.style.overflow = 'hidden';
      clone.style.boxShadow = '0 12px 35px rgba(168, 85, 247, 0.65)';
      clone.style.transition = 'transform 0.45s cubic-bezier(0.5, 0, 0.2, 1), opacity 0.4s ease-in-out';

      // Disable internal transitions to keep the morph clean during flight
      const allDesc = clone.querySelectorAll('*');
      allDesc.forEach((el) => {
        const h = el as HTMLElement;
        if (h && h.style) h.style.transition = 'none';
      });

      document.body.appendChild(clone);

      const startCX = itemRect.left + itemRect.width / 2;
      const startCY = itemRect.top + itemRect.height / 2;

      if (targetElement) {
        const targetRect = targetElement.getBoundingClientRect();
        let targetCX, targetCY;

        if (isItemRow) {
          targetCX = targetRect.left + targetRect.width / 2;
          targetCY = targetRect.top + targetRect.height / 2;
        } else {
          targetCX = targetRect.left + targetRect.width / 2;
          targetCY = targetRect.top + targetRect.height / 2;
        }

        // Start flying to target
        requestAnimationFrame(() => {
          const dx = targetCX - startCX;
          const dy = targetCY - startCY;
          const endScale = isItemRow ? 0.3 : 0.05;
          clone.style.transform = `translate(${dx}px, ${dy}px) scale(${endScale})`;
          clone.style.opacity = '0'; // smooth fade out as it enters the button
        });

        // Optional small shake: Entire inner sheet dips down and back
        setTimeout(() => {
          const headerCartBtn = document.querySelector('[data-cart-button]') as HTMLElement;
          const bottomHandle = document.querySelector('[data-cart-handle]') as HTMLElement;

          const headerVisible = window.scrollY < 80;
          const isTargetHeader = headerVisible && targetElement === headerCartBtn;
          const isTargetBottom = (isTouchPhoneChrome() || !headerVisible) && targetElement === bottomHandle;

          if (isTargetHeader && headerCartBtn) {
            headerCartBtn.classList.remove('cart-shake-impact');
            void headerCartBtn.offsetHeight; // trigger reflow
            headerCartBtn.classList.add('cart-shake-impact');
            setTimeout(() => headerCartBtn.classList.remove('cart-shake-impact'), 800);
          } else if (isTargetBottom) {
            const innerSheet = document.querySelector('.cart-sheet-inner') as HTMLElement;
            if (innerSheet) {
              innerSheet.style.animation = 'none';
              void innerSheet.offsetHeight; // trigger reflow
              innerSheet.style.animation = 'cartInnerImpact 0.8s cubic-bezier(0.22, 1, 0.36, 1) both';
            }
          }
        }, 300);

        // Remove clone after animation
        setTimeout(() => clone.remove(), 450);
      } else {
        // Fallback: fly to bottom center
        const targetCX = window.innerWidth / 2;
        const targetCY = window.innerHeight - 120;
        requestAnimationFrame(() => {
          const dx = targetCX - startCX;
          const dy = targetCY - startCY;
          clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.1)`;
          clone.style.opacity = '0';
        });

        setTimeout(() => clone.remove(), 450);
      }
    }

    setCartItems(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        return prev.map(i =>
          i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const handleUpdateQuantity = (itemId: string, quantity: number) => {
    if (editingOrder && editingOrder.status === 'preparing') {
      const originalItem = editingOrder.items.find((oi: any) => oi.item_id === itemId);
      if (originalItem && quantity < originalItem.quantity) {
        return; // prevent decreasing below original quantity
      }
    }
    if (quantity < 1) {
      handleRemoveItem(itemId);
      return;
    }
    setCartItems(prev =>
      prev.map(item => (item.id === itemId ? { ...item, quantity } : item))
    );
  };

  const handleRemoveItem = (itemId: string) => {
    if (editingOrder && editingOrder.status === 'preparing') {
      const originalItem = editingOrder.items.find((oi: any) => oi.item_id === itemId);
      if (originalItem) {
        return; // prevent removal
      }
    }
    setCartItems(prev => prev.filter(item => item.id !== itemId));
  };

  const handleCheckout = () => {
    setCheckoutStep('customer');
    setShowCheckout(true);
    setCheckoutCartEditMode(false);
  };

  const handleStartCheckoutCartEdit = () => {
    setCheckoutCartSnapshot(cartItems.map((i) => ({ ...i })));
    setCheckoutCartEditMode(true);
    setShowCheckout(false);
    setShowCart(true);
  };

  const handleSaveCheckoutCartEdit = () => {
    setCheckoutCartEditMode(false);
    setCheckoutCartSnapshot(null);
    setCheckoutStep('address');
    setShowCheckout(true);
    setShowCart(true);
  };

  const handleCancelCheckoutCartEdit = () => {
    if (checkoutCartSnapshot) {
      setCartItems(checkoutCartSnapshot);
    }
    setCheckoutCartEditMode(false);
    setCheckoutCartSnapshot(null);
    setCheckoutStep('address');
    setShowCheckout(true);
    setShowCart(true);
  };

  const handleStartOrderEdit = (order: any) => {
    setEditingOrder(order);
    setShowProfile(false);
    
    // Map order.items to CartItem[]
    const initialCartItems = order.items.map((orderItem: any) => {
      const catalogItem = items.find(i => i.id === orderItem.item_id);
      return {
        id: orderItem.item_id,
        category_id: catalogItem?.category_id || '',
        name: orderItem.item_name,
        name_en: catalogItem?.name_en || orderItem.item_name,
        price: orderItem.unit_price,
        image_url: catalogItem?.image_url || '',
        is_available: catalogItem?.is_available ?? true,
        is_active: catalogItem?.is_active ?? true,
        has_offer: catalogItem?.has_offer ?? false,
        offer_price: catalogItem?.offer_price,
        display_order: catalogItem?.display_order || 0,
        created_at: catalogItem?.created_at || '',
        updated_at: catalogItem?.updated_at || '',
        quantity: orderItem.quantity
      } as CartItem;
    });
    
    setCartItems(initialCartItems);
    setShowCart(true);
  };

  const handleCancelOrderEdit = () => {
    setEditingOrder(null);
    setCartItems([]);
    setShowCart(false);
    setShowProfile(true);
  };

  const handleSaveOrderEdit = async () => {
    if (!editingOrder) return;
    
    const newOrderItems = cartItems.map(item => ({
      order_id: editingOrder.id,
      item_id: item.id,
      item_name: item.name,
      quantity: item.quantity,
      unit_price: item.has_offer && item.offer_price ? item.offer_price : item.price,
      subtotal: (item.has_offer && item.offer_price ? item.offer_price : item.price) * item.quantity
    }));

    // Calculate new total amount
    const itemsTotal = newOrderItems.reduce((sum, item) => sum + item.subtotal, 0);
    const discount = editingOrder.applied_coupon_discount_percent 
      ? Math.round((itemsTotal * editingOrder.applied_coupon_discount_percent) / 100) 
      : 0;
      
    // original delivery fee calculation
    const originalItemsTotal = editingOrder.items.reduce((sum: number, item: any) => sum + item.subtotal, 0);
    const originalDiscount = editingOrder.applied_coupon_discount_percent 
      ? Math.round((originalItemsTotal * editingOrder.applied_coupon_discount_percent) / 100) 
      : 0;
    const originalDeliveryFee = editingOrder.total_amount - (originalItemsTotal - originalDiscount);
    
    const newTotalAmount = itemsTotal - discount + originalDeliveryFee;

    // Database updates: delete existing order items first
    const { error: deleteError } = await supabase
      .from('order_items')
      .delete()
      .eq('order_id', editingOrder.id);

    if (deleteError) {
      console.error('Error deleting order items:', deleteError);
      alert(language === 'ar' ? 'فشل تحديث الطلب.' : 'Failed to update order items.');
      return;
    }

    // Insert new order items
    const { error: insertError } = await supabase
      .from('order_items')
      .insert(newOrderItems);

    if (insertError) {
      console.error('Error inserting new order items:', insertError);
      alert(language === 'ar' ? 'فشل تحديث الطلب.' : 'Failed to update order items.');
      return;
    }

    // Update order total and flag
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        total_amount: newTotalAmount,
        customer_update_flag: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', editingOrder.id);

    if (updateError) {
      console.error('Error updating order:', updateError);
      alert(language === 'ar' ? 'فشل تحديث الطلب.' : 'Failed to update order.');
      return;
    }

    // Done saving
    setEditingOrder(null);
    setCartItems([]);
    setShowCart(false);
    setShowProfile(true);
  };

  const handleConfirmOrder = async (
    customerData: CustomerData,
    paymentMethod: 'cash' | 'instant_transfer',
    orderNote?: string,
    appliedCouponId?: string,
    deliveryFee?: number,
    serviceInfo?: { service: DeliveryService; layer: DeliveryZoneLayer | null } | null,
    pickupMeta?: {
      pickupDeadlineAt?: string;
      pickupCommitmentKind?: 'now' | 'hour' | 'custom';
      pickupCommitmentAck?: boolean;
      pickupCommitmentLabel?: string;
    }
  ) => {
    if (orderConfirmInFlightRef.current) return;
    
    if (cartItems.some(item => item.cart_synced_unavailable)) {
      alert(language === 'ar' ? 'بعض الأصناف في سلتك لم تعد متوفرة، يرجى إزالتها أولاً' : 'Some items in your cart are no longer available, please remove them first');
      return;
    }
    
    orderConfirmInFlightRef.current = true;
    setOrderConfirmSubmitting(true);
    try {
      try {
        let authoritativeDeliveryFee = deliveryFee ?? 0;
        if (customerData.deliveryMethod === 'delivery') {
          const lat = customerData.latitude;
          const lng = customerData.longitude;
          if (lat == null || lng == null) {
            throw new Error('يجب تحديد موقع التوصيل على الخريطة قبل إتمام الطلب.');
          }
          const { zones, services } = await fetchDeliveryZonesAndServices();
          const match = getDeliveryMatch(lat, lng, services, zones);
          if (!match.isInGreen) {
            throw new Error('عذراً، عنوانك خارج منطقة التوصيل المحددة. لا يمكن إتمام الطلب.');
          }
          authoritativeDeliveryFee = match.price;
        }

        const deviceFingerprint = getOrCreateDeviceFingerprint();

        const existingCustomer = await findCustomerSummaryByPhone(customerData.phone);

        // Check if same name and phone but different device
        if (existingCustomer && existingCustomer.device_fingerprint &&
          existingCustomer.device_fingerprint !== deviceFingerprint &&
          existingCustomer.name === customerData.name) {
          const confirm = window.confirm(
            'تحذير: يوجد حساب آخر بنفس الاسم ورقم الهاتف على جهاز مختلف.\n\n' +
            'هل أنت متأكد أنك تريد المتابعة؟'
          );
          if (!confirm) {
            return;
          }
        }

        const customerPayload: Record<string, unknown> = {
          name: customerData.name,
          address_type: customerData.address_type,
          address_label: customerData.address_label,
          street: customerData.street,
          area: customerData.area,
          city: customerData.city,
          apartment: customerData.apartment,
          floor: customerData.floor,
          building_number: customerData.building_number,
          house_name: customerData.house_name,
          company_name: customerData.company_name,
          landmark: customerData.landmark,
          latitude: customerData.latitude,
          longitude: customerData.longitude,
          secondary_phone: customerData.secondary_phone,
          device_fingerprint: deviceFingerprint
        };

        const customerId = await ensureCustomerByPhone(customerData.phone, customerPayload);
        if (!customerId) {
          throw new Error('خطأ في التحقق من بيانات العميل');
        }
        localStorage.setItem('customer_id', customerId);

        // Keep coupon owner identity synced with latest customer name/phone
        try {
          await supabase
            .from('device_coupons')
            .update({
              customer_name: customerData.name,
              customer_phone: customerData.phone
            })
            .eq('customer_id', customerId);
        } catch (e) {
          console.warn('Could not sync coupon customer identity:', e);
        }

        const GLOBAL_COUPON_TEMPLATE_FP = 'GLOBAL_TEMPLATE';

        // Bind all existing device coupons to this customer (for new customers who already unlocked coupons)
        try {
          const { data: unboundCoupons } = await supabase
            .from('device_coupons')
            .select('id, expires_at, is_disabled')
            .eq('device_fingerprint', deviceFingerprint)
            .neq('device_fingerprint', 'GLOBAL_TEMPLATE')
            .is('customer_id', null);

          if (unboundCoupons && unboundCoupons.length > 0) {
            const now = new Date();
            for (const coupon of unboundCoupons) {
              if (coupon.is_disabled) {
                continue;
              }
              if (coupon.expires_at && new Date(coupon.expires_at) <= now) {
                await supabase.from('device_coupons').delete().eq('id', coupon.id);
                continue;
              }
              await supabase
                .from('device_coupons')
                .update({
                  customer_id: customerId,
                  customer_name: customerData.name,
                  customer_phone: customerData.phone
                })
                .eq('id', coupon.id);
            }
          }
        } catch (e) {
          console.warn('Could not bind/clean device coupons:', e);
        }

        // Server-side coupon sync: reject stale/local-only coupons (e.g. operator deleted row)
        // IMPORTANT: verify AFTER binding so coupon belongs to the current customer_id
        if (appliedCouponId) {
          const { data: couponRow, error: couponFetchErr } = await supabase
            .from('device_coupons')
            .select('id, device_fingerprint, customer_id, code, discount_percent, expires_at, is_disabled')
            .eq('id', appliedCouponId)
            .maybeSingle();

          if (couponFetchErr) {
            console.error('Coupon verify error:', couponFetchErr);
            throw new Error('تعذر التحقق من الكوبون. تحقق من الاتصال وحاول مرة أخرى.');
          }

          const nowCoupon = new Date();

          const invalidateLocalCoupon = async () => {
            setDeviceCoupons((prev) => prev.filter((c) => c.id !== appliedCouponId));
            await fetchCouponConfigAndCoupons();
          };

          if (!couponRow || couponRow.device_fingerprint === GLOBAL_COUPON_TEMPLATE_FP) {
            await invalidateLocalCoupon();
            throw new Error(
              'لم يعد الكوبون المحدد صالحاً (قد تم إزالته أو تعديله). تم تحديث القائمة — أعد المحاولة من دون كوبون أو اختر كوبوناً متاحاً.'
            );
          }

          if (couponRow.is_disabled) {
            await invalidateLocalCoupon();
            throw new Error('تم تعطيل هذا الكوبون. لا يمكن إتمام الطلب باستخدامه.');
          }

          if (couponRow.expires_at && new Date(couponRow.expires_at) <= nowCoupon) {
            await invalidateLocalCoupon();
            throw new Error('انتهت صلاحية هذا الكوبون.');
          }

          const customerMatch = couponRow.customer_id != null && couponRow.customer_id === customerId;
          if (!customerMatch) {
            // Prevent using coupons from old phone/customer even on same device
            await invalidateLocalCoupon();
            throw new Error('هذا الكوبون غير مرتبط بهذا الرقم/الحساب.');
          }
        }

        // Get customer general notes by phone and name (from customer_general_notes table)
        let generalNotes: any[] = [];
        try {
          const { data: generalNotesData, error: generalNotesError } = await supabase
            .from('customer_general_notes')
            .select('*')
            .eq('customer_phone', customerData.phone)
            .eq('customer_name', customerData.name)
            .order('created_at', { ascending: false });

          if (!generalNotesError && generalNotesData) {
            generalNotes = generalNotesData;
            console.log('General notes found by phone and name:', generalNotes.length);
          } else if (generalNotesError) {
            console.warn('Error fetching general notes:', generalNotesError);
          }
        } catch (e) {
          console.warn('Could not fetch general notes:', e);
        }

        // Generate 4 random digits for order number
        const randomDigits = Math.floor(1000 + Math.random() * 9000);
        const orderNumber = randomDigits.toString();
        const baseTotalAmount = cartItems.reduce((sum, item) => {
          const price = item.has_offer && item.offer_price ? item.offer_price : item.price;
          return sum + price * item.quantity;
        }, 0);

        let appliedCoupon: DeviceCoupon | null = null;
        let finalTotalAmount = baseTotalAmount;

        // Apply selected coupon if provided (must match server re-fetch after verify above)
        if (appliedCouponId) {
          const { data: serverCoupon } = await supabase
            .from('device_coupons')
            .select('*')
            .eq('id', appliedCouponId)
            .maybeSingle();
          if (serverCoupon && serverCoupon.device_fingerprint !== GLOBAL_COUPON_TEMPLATE_FP) {
            appliedCoupon = serverCoupon as DeviceCoupon;
          }
        }

        if (appliedCouponId && !appliedCoupon) {
          await fetchCouponConfigAndCoupons();
          throw new Error('تعذر تطبيق الكوبون أثناء إنشاء الطلب. حدّث الصفحة وأعد المحاولة.');
        }

        if (appliedCoupon) {
          const discount = Math.round((baseTotalAmount * appliedCoupon.discount_percent) / 100);
          finalTotalAmount = Math.max(0, baseTotalAmount - discount);
        }

        // Add delivery fee from server-side zone match (cannot rely on client-only value)
        if (customerData.deliveryMethod === 'delivery' && authoritativeDeliveryFee > 0) {
          finalTotalAmount += authoritativeDeliveryFee;
        }

        const rateSettings = await fetchRateSettings();
        const rateDiscountPercent = rateSettings.percent > 0 ? rateSettings.percent : null;

        // Try to insert order with order_note, if it fails, try without
        const orderData: any = {
          customer_id: customerId,
          order_number: orderNumber,
          payment_method: paymentMethod,
          total_amount: finalTotalAmount,
          status: 'under_review',
          delivery_method: customerData.deliveryMethod,
          building_number: customerData.building_number
        };

        if (customerData.deliveryMethod === 'pickup' && pickupMeta?.pickupDeadlineAt) {
          orderData.pickup_deadline_at = pickupMeta.pickupDeadlineAt;
          orderData.pickup_commitment_kind = pickupMeta.pickupCommitmentKind || null;
          orderData.pickup_commitment_ack = pickupMeta.pickupCommitmentAck ?? true;
          orderData.pickup_commitment_label = pickupMeta.pickupCommitmentLabel || null;
        }

        if (appliedCoupon) {
          orderData.applied_coupon_id = appliedCoupon.id;
          orderData.applied_coupon_code = appliedCoupon.code;
          orderData.applied_coupon_discount_percent = appliedCoupon.discount_percent;
        }

        // Snapshot customer data into order fields
        orderData.customer_name = customerData.name;
        orderData.customer_phone = customerData.phone;
        orderData.customer_secondary_phone = customerData.secondary_phone;
        orderData.customer_address_type = customerData.address_type;
        orderData.customer_address_label = customerData.address_label;
        orderData.customer_street = customerData.street;
        orderData.customer_area = customerData.area;
        orderData.customer_city = customerData.city;
        orderData.customer_apartment = customerData.apartment;
        orderData.customer_floor = customerData.floor;
        orderData.customer_building_number = customerData.building_number;
        orderData.customer_house_name = customerData.house_name;
        orderData.customer_company_name = customerData.company_name;
        orderData.customer_landmark = customerData.landmark;
        orderData.customer_latitude = customerData.latitude;
        orderData.customer_longitude = customerData.longitude;

        // Set order_note only if customer provided a new note (don't copy from previous orders)
        // Customer notes stay only on the order they were written for
        if (orderNote && orderNote.trim()) {
          try {
            orderData.order_note = orderNote.trim();
          } catch (e) {
            console.warn('order_note column might not exist');
          }
        }

        const { data: order, error: orderError } = await supabase
          .from('orders')
          .insert([orderData])
          .select()
          .single();

        if (orderError) {
          console.error('Error creating order:', orderError);
          // Try without order_note
          if (orderData.order_note) {
            delete orderData.order_note;
            const { data: orderRetry, error: orderErrorRetry } = await supabase
              .from('orders')
              .insert([orderData])
              .select()
              .single();

            if (orderErrorRetry) throw orderErrorRetry;
            if (!orderRetry) throw new Error('فشل في إنشاء الطلب');

            // Use retry order
            const orderItems = cartItems.map(item => ({
              order_id: orderRetry.id,
              item_id: item.id,
              item_name: item.name,
              quantity: item.quantity,
              unit_price: item.has_offer && item.offer_price ? item.offer_price : item.price,
              subtotal: (item.has_offer && item.offer_price ? item.offer_price : item.price) * item.quantity,
              rate_discount_percent: rateDiscountPercent,
            }));

            const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
            if (itemsError) throw itemsError;

            // Mark coupon as used and bind it to customer after successful order creation
            // Bind coupon to customer but DO NOT mark as used (keep it persistent)
            if (appliedCoupon) {
              try {
                await supabase
                  .from('device_coupons')
                  .update({
                    customer_id: customerId,
                    customer_name: customerData.name,
                    customer_phone: customerData.phone
                  })
                  .eq('id', appliedCoupon.id);
                // Do not remove from state so it remains visible
                // setDeviceCoupons(prev => prev.filter(c => c.id !== appliedCoupon!.id));
              } catch (e) {
                console.error('Error binding coupon to customer (retry path):', e);
              }
            }

            // Add order note as customer note if order_note column doesn't exist
            if (orderNote && orderNote.trim()) {
              try {
                await supabase.from('customer_notes').insert([{
                  customer_id: customerId,
                  order_id: orderRetry.id,
                  note: orderNote.trim(),
                  created_by: 'customer'
                }]);
              } catch (e) {
                console.warn('Could not add order note:', e);
              }
            }

            localStorage.setItem('customer_phone', customerData.phone);
            setCustomerPhone(customerData.phone);
            setCartItems([]);
            setShowCheckout(false);

            const { data: pwdRowRetry } = await supabase
              .from('customers')
              .select('phone_password_hash')
              .eq('id', customerId)
              .maybeSingle();

            setPostOrderPwd('');
            setPostOrderPwd2('');
            setPostOrderPwdErr(null);
            setPostOrderRecoveryCode(null);
            setShowOptionalSecurity(false);

            setOrderSuccess({
              orderNumber,
              deliveryMethod: customerData.deliveryMethod,
              branchName: serviceInfo?.service.name,
              branchLocation: serviceInfo?.service.branch_location as any,
              needsPasswordSetup: !pwdRowRetry?.phone_password_hash,
              setupCustomerId: customerId,
              setupPhone: customerData.phone
            });
            void fetchCouponConfigAndCoupons();
            return;
          }
          throw orderError;
        }

        if (!order) throw new Error('فشل في إنشاء الطلب');

        const orderItems = cartItems.map(item => ({
          order_id: order.id,
          item_id: item.id,
          item_name: item.name,
          quantity: item.quantity,
          unit_price: item.has_offer && item.offer_price ? item.offer_price : item.price,
          subtotal: (item.has_offer && item.offer_price ? item.offer_price : item.price) * item.quantity,
          rate_discount_percent: rateDiscountPercent,
        }));

        const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
        if (itemsError) {
          console.error('Error inserting order items:', itemsError);
          throw itemsError;
        }

        // Mark coupon as used and bind it to customer after successful order creation
        // Bind coupon to customer but DO NOT mark as used (keep it persistent)
        if (appliedCoupon) {
          try {
            await supabase
              .from('device_coupons')
              .update({
                customer_id: customerId,
                customer_name: customerData.name,
                customer_phone: customerData.phone
              })
              .eq('id', appliedCoupon.id);
            // Do not remove from state so it remains visible
            // setDeviceCoupons(prev => prev.filter(c => c.id !== appliedCoupon!.id));
          } catch (e) {
            console.error('Error binding coupon to customer:', e);
          }
        }

        // Copy general customer notes to this order (from customer_general_notes)
        if (generalNotes && generalNotes.length > 0) {
          try {
            const notesToInsert = generalNotes.map(note => ({
              customer_id: customerId,
              order_id: order.id,
              note: note.note,
              created_by: note.created_by || 'operator',
              general_note_id: note.general_note_id || note.id || null,
              is_public: note.is_public ?? true
            }));

            console.log('Inserting general notes to order:', notesToInsert);
            const { data: insertedNotes, error: notesInsertError } = await supabase
              .from('customer_notes')
              .insert(notesToInsert)
              .select();

            if (notesInsertError) {
              console.error('Could not copy general notes:', notesInsertError);
              // Try inserting one by one if batch fails
              for (const note of notesToInsert) {
                try {
                  await supabase.from('customer_notes').insert([note]);
                } catch (singleError) {
                  console.error('Could not insert single note:', singleError);
                }
              }
            } else {
              console.log('Successfully copied', insertedNotes?.length || 0, 'general notes to order');
            }
          } catch (e) {
            console.error('Could not copy general notes:', e);
          }
        }

        // order_note is already saved in order.order_note field, no need to duplicate in customer_notes

        setCartItems([]);
        setShowCheckout(false);

        const { data: pwdRowAfterOrder } = await supabase
          .from('customers')
          .select('phone_password_hash')
          .eq('id', customerId)
          .maybeSingle();

        setPostOrderPwd('');
        setPostOrderPwd2('');
        setPostOrderPwdErr(null);
        setPostOrderRecoveryCode(null);
        setShowOptionalSecurity(false);

        setOrderSuccess({
          orderNumber,
          deliveryMethod: customerData.deliveryMethod,
          branchName: serviceInfo?.service.name,
          branchLocation: serviceInfo?.service.branch_location as any,
          needsPasswordSetup: !pwdRowAfterOrder?.phone_password_hash,
          setupCustomerId: customerId,
          setupPhone: customerData.phone
        });
        void fetchCouponConfigAndCoupons();
      } catch (error: any) {
        console.error('Error creating order:', error);
        const errorMessage = error?.message || 'حدث خطأ أثناء إنشاء الطلب';
        setTimeout(() => {
          alert(`${errorMessage}\n\nالرجاء المحاولة مرة أخرى أو التحقق من اتصال الإنترنت.`);
        }, 100);
      }
    } finally {
      orderConfirmInFlightRef.current = false;
      setOrderConfirmSubmitting(false);
    }
  };



  const handleCategoryClick = (categoryId: string) => {
    setActiveCategoryId(categoryId);
    const element = document.getElementById(`category-${categoryId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY < 80) {
        setActiveCategoryId(null);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleSavePostOrderPassword = async () => {
    if (!orderSuccess?.setupCustomerId || !orderSuccess?.setupPhone) return;
    setPostOrderPwdErr(null);
    if (postOrderPwd.length < 4) {
      setPostOrderPwdErr(language === 'ar' ? 'كلمة المرور 4 أحرف على الأقل' : 'Password at least 4 characters');
      return;
    }
    if (postOrderPwd !== postOrderPwd2) {
      setPostOrderPwdErr(language === 'ar' ? 'تأكيد كلمة المرور غير مطابق' : 'Passwords do not match');
      return;
    }
    setPostOrderPwdSaving(true);
    try {
      const hash = await hashPhonePassword(orderSuccess.setupPhone, postOrderPwd);
      const recoveryCode = generateEasyRecoveryCode();
      const recoveryHash = await hashRecoveryCode(orderSuccess.setupPhone, recoveryCode);
      const fp = getOrCreateDeviceFingerprint();
      // Overwrite password + recovery code (old ones become invalid automatically)
      const { error } = await supabase
        .from('customers')
        .update({
          phone_password_hash: hash,
          phone_recovery_code_hash: recoveryHash,
          phone_password_owner_fingerprint: fp,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderSuccess.setupCustomerId);
      if (error) throw error;
      setOrderSuccess((prev) => (prev ? { ...prev, needsPasswordSetup: false } : null));
      setPostOrderPwd('');
      setPostOrderPwd2('');
      setPostOrderRecoveryCode(recoveryCode);
      setShowOptionalSecurity(true);
    } catch (e) {
      console.error(e);
      setPostOrderPwdErr(language === 'ar' ? 'تعذر حفظ كلمة المرور' : 'Could not save password');
    } finally {
      setPostOrderPwdSaving(false);
    }
  };

  if (window.location.pathname === '/operator') {
    return <OperatorPage />;
  }

  if (window.location.pathname === '/rate') {
    return (
      <RateAuthProvider>
        <RatePage />
      </RateAuthProvider>
    );
  }

  const totalAmount = cartItems.reduce((sum, item) => {
    const price = item.has_offer && item.offer_price ? item.offer_price : item.price;
    return sum + price * item.quantity;
  }, 0);

  const suggestedItems = items
    .filter(item => !cartItems.some(ci => ci.id === item.id))
    .map(item => {
      const category = categories.find(c => c.id === item.category_id);
      const text = `${item.name} ${item.name_en} ${category?.name || ''} ${category?.name_en || ''}`.toLowerCase();
      let score = 0;
      if (cartItems.some(ci => ci.category_id === item.category_id)) score += 20;
      if (text.includes('جرعة') || text.includes('energy shot') || text.includes('energy')) score += 120;
      if (text.includes('جانبي') || text.includes('sides') || text.includes('side')) score += 80;
      if (text.includes('صوص') || text.includes('dip') || text.includes('sauce')) score += 60;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.item)
    .slice(0, Math.min(6, Math.max(2, cartItems.length + 1)));

  const catalogLookup = buildCatalogLookup(items);

  return (
    <div className="min-h-screen bg-dark">
      <CheatCodeInput
        couponSecretCode={couponSecretCode || undefined}
        couponDiscountPercent={couponDiscountPercent}
        onCouponUnlocked={fetchCouponConfigAndCoupons}
        enabled={!showCart && !showProfile}
      />


      <Header
        cartCount={cartItems.reduce((sum, item) => sum + item.quantity, 0)}
        onCartClick={() => setShowCart(prev => !prev)}
        onProfileClick={() => {
          setProfileInitialTab('settings');
          if (phoneChrome) setActiveBottomTab('account');
          setShowProfile(prev => !prev);
        }}
        hasOrders={ordersCount > 0}
        ordersCount={ordersCount}
        categories={categories}
        activeCategoryId={activeCategoryId}
        onCategorySelect={handleCategoryClick}
      />

      {/* Pending Orders Banner */}
      {pendingOrders.length > 0 && (
        <div className="pending-orders-banner bg-gradient-to-r from-primary/20 via-surface to-primary/20 border-b border-primary/30 relative overflow-hidden">
          <div className="container mx-auto px-4 py-1.5">
            <div className="flex items-center gap-3">
              {/* Left Arrow with count */}
              {currentPendingOrderIndex > 0 && (
                <button
                  onClick={() => setCurrentPendingOrderIndex(currentPendingOrderIndex - 1)}
                  className="relative flex-shrink-0 bg-primary/30 hover:bg-primary/50 text-white p-2 rounded-full transition-all hover:scale-110 active:scale-90"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="absolute -top-1.5 -left-1.5 bg-primary text-white text-[10px] font-black min-w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 border-surface">
                    {currentPendingOrderIndex}
                  </span>
                </button>
              )}

              {/* Order Card */}
              <div
                className="flex-1 min-w-0 pending-order-slide"
                key={pendingOrders[currentPendingOrderIndex]?.id}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
              >
                {(() => {
                  const order = pendingOrders[currentPendingOrderIndex];
                  if (!order) return null;
                  const statusInfo = getOrderStatusInfo(order.status, order.delivery_method);
                  const StatusIcon = statusInfo.icon;
                  const currencySymbol = language === 'ar' ? 'ج' : 'EG';

                  return (
                    <div
                      className="flex items-center gap-3 justify-between cursor-pointer group hover:bg-white/5 p-1 rounded-xl transition-all"
                      onClick={() => {
                        setHighlightOrderId(order.id);
                        setProfileInitialTab('orders');
                        setActiveBottomTab('orders');
                        setShowProfile(true);
                      }}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3">
                            <span className="text-white font-bold text-sm">
                              #{order.order_number}
                            </span>
                            <div className="flex items-center gap-2">
                              <div className={`px-2 py-0.5 rounded-full border flex items-center gap-1.5 ${statusInfo.bg} ${statusInfo.border} ${statusInfo.color}`}>
                                <span className="font-bold text-[10px] whitespace-nowrap">{statusInfo.text}</span>
                                <StatusIcon className="w-3.5 h-3.5" />
                              </div>
                              {(() => {
                                const timer = getPickupCountdownMeta(order);
                                if (!timer || !timer.deadlineRaw) return null;
                                const diff = new Date(timer.deadlineRaw).getTime() - pickupNowMs;
                                let remLabel = '';
                                if (diff <= 0) {
                                  remLabel = language === 'ar' ? 'انتهى الوقت' : 'Time up';
                                } else {
                                  const totalMins = Math.floor(diff / 60000);
                                  const totalHours = Math.floor(totalMins / 60);
                                  if (language === 'ar') {
                                    if (totalHours >= 1) {
                                      if (totalHours === 1) remLabel = 'متبقي ساعة';
                                      else if (totalHours === 2) remLabel = 'متبقي ساعتان';
                                      else remLabel = `متبقي ${totalHours} ساعات`;
                                    } else {
                                      if (totalMins <= 0) remLabel = 'انتهى الوقت';
                                      else if (totalMins === 1) remLabel = 'متبقي دقيقة';
                                      else if (totalMins === 2) remLabel = 'متبقي دقيقتان';
                                      else remLabel = `متبقي ${totalMins} دقيقة`;
                                    }
                                  } else {
                                    if (totalHours >= 1) {
                                      remLabel = totalHours === 1 ? '1 hr left' : `${totalHours} hrs left`;
                                    } else {
                                      if (totalMins <= 0) remLabel = 'Time up';
                                      else if (totalMins === 1) remLabel = '1 min left';
                                      else remLabel = `${totalMins} mins left`;
                                    }
                                  }
                                }
                                return (
                                  <span className={`text-[11px] font-black whitespace-nowrap ${timer.className}`}>
                                    {remLabel}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>

                          <div className="min-h-[1rem] flex items-center">
                            {(() => {
                              const timer = getPickupCountdownMeta(order);
                              const formattedDeadline = timer?.deadlineRaw ? formatDeadline(timer.deadlineRaw as string, language) : '';
                              if (!formattedDeadline) return null;
                              return (
                                <p className="text-[9px] text-muted font-bold leading-none">{formattedDeadline}</p>
                              );
                            })()}
                          </div>

                          <p className="text-muted text-[10px] truncate leading-tight">
                            {formatOrderItemsList(order.items, language, catalogLookup)}
                          </p>
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="text-primary font-black text-sm">
                          {order.total_amount} {currencySymbol}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Right Arrow with count */}
              {currentPendingOrderIndex < pendingOrders.length - 1 && (
                <button
                  onClick={() => setCurrentPendingOrderIndex(currentPendingOrderIndex + 1)}
                  className="relative flex-shrink-0 bg-primary/30 hover:bg-primary/50 text-white p-2 rounded-full transition-all hover:scale-110 active:scale-90"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-[10px] font-black min-w-[18px] h-[18px] rounded-full flex items-center justify-center border-2 border-surface">
                    {pendingOrders.length - 1 - currentPendingOrderIndex}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <main className={`container mx-auto px-4 py-8 ${phoneChrome ? 'pb-24' : 'pb-8'}`}>
        {loading && categories.length === 0 ? (
          <div className="text-center py-24">
            <div className="animate-spin w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-2xl text-gray-300 font-bold">جاري التحميل...</p>
          </div>
        ) : (
          <div className="space-y-12">
            {categories.map(category => {
              const categoryItems = items.filter(item => item.category_id === category.id);
              return (
                <div key={category.id} id={`category-${category.id}`}>
                  <CategorySection
                    category={category}
                    items={categoryItems}
                    onAddToCart={handleAddToCart}
                  />
                </div>
              );
            })}
          </div>
        )}
      </main>

      <Cart
        isOpen={showCart}
        onClose={() => setShowCart(false)}
        onHandleClick={() => setShowCart(true)}
        cartItems={cartItems}
        onUpdateQuantity={handleUpdateQuantity}
        onRemoveItem={handleRemoveItem}
        onCheckout={handleCheckout}
        editingOrder={editingOrder}
        onSaveOrderEdit={handleSaveOrderEdit}
        onCancelOrderEdit={handleCancelOrderEdit}
        onAcknowledgeUpdate={(itemId) => {
          setCartItems(prev => prev.map(item => 
            item.id === itemId ? { ...item, cart_synced_data_changed: false } : item
          ));
        }}
        checkoutCartEditMode={checkoutCartEditMode}
        onSaveCheckoutCartEdit={handleSaveCheckoutCartEdit}
        onCancelCheckoutCartEdit={handleCancelCheckoutCartEdit}
        onClearCart={() => {
          setCartItems([]);
          setShowCart(false);
        }}
        isCheckoutOpen={false}
        showCheckoutPanel={showCheckout}
        checkoutPanel={
          <Checkout
            isOpen={showCheckout}
            embedded
            onClose={() => setShowCheckout(false)}
            embeddedStep={checkoutStep}
            onEmbeddedStepChange={setCheckoutStep}
            total={totalAmount}
            availableCoupons={deviceCoupons}
            cartItems={cartItems}
            onConfirm={handleConfirmOrder}
            orderSubmitting={orderConfirmSubmitting}
            onPhoneValidated={async (phone) => {
              setCustomerPhone(phone);
              await fetchCouponConfigAndCoupons(phone);
            }}
            onStartCartEdit={handleStartCheckoutCartEdit}
          />
        }
        checkoutStep={checkoutStep}
        onCheckoutHandleBack={() => {
          if (showCheckout && checkoutStep === 'address') {
            setCheckoutStep('customer');
            return;
          }
          setShowCheckout(false);
        }}
        suggestedItems={suggestedItems}
        onAddSuggestedItem={(item) => handleAddToCart(item)}
      />

      {/* Order Success Modal */}
      {orderSuccess && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-surface w-full max-w-sm rounded-[2.5rem] border-2 border-primary shadow-2xl overflow-hidden scale-in max-h-[90vh] overflow-y-auto">
            <div className="p-8 text-center space-y-6">
              <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto border-2 border-green-500/30">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-black text-white">
                  {language === 'ar' ? 'تم تأكيد طلبك!' : 'Order Confirmed!'}
                </h2>
                <p className="text-muted font-bold">
                  {language === 'ar' ? `رقم الطلب: #${orderSuccess.orderNumber}` : `Order ID: #${orderSuccess.orderNumber}`}
                </p>
              </div>

              {(orderSuccess.needsPasswordSetup || postOrderRecoveryCode) && (
                <div className="rounded-2xl border border-amber-500/35 bg-amber-950/10 p-3 text-right">
                  <button
                    type="button"
                    onClick={() => setShowOptionalSecurity((v) => !v)}
                    className="w-full flex items-center justify-between gap-2 text-amber-200 font-black text-sm"
                  >
                    <span className="flex items-center justify-end gap-2">
                      <Lock className="w-4 h-4 shrink-0" />
                      {language === 'ar' ? 'حماية الحساب (اختياري)' : 'Secure account (optional)'}
                    </span>
                    <span className="text-[11px] text-amber-300/80">{showOptionalSecurity ? 'إخفاء' : 'عرض'}</span>
                  </button>

                  {showOptionalSecurity && !postOrderRecoveryCode && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] text-amber-100/85 leading-relaxed">
                        {language === 'ar'
                          ? 'عيّن كلمة مرور لهذا الرقم لمنع أي شخص آخر من استخدامه. ستحصل أيضاً على كود أرقام للاسترجاع إذا نسيت كلمة المرور.'
                          : 'Set a password for this number. You will also get a numeric recovery code in case you forget it.'}
                      </p>
                      <div className="grid grid-cols-1 gap-2">
                        <input
                          type="password"
                          value={postOrderPwd}
                          onChange={(e) => {
                            setPostOrderPwd(e.target.value);
                            setPostOrderPwdErr(null);
                          }}
                          className="w-full bg-dark border border-amber-500/35 rounded-xl px-3 py-2 text-white text-right text-sm"
                          placeholder={language === 'ar' ? 'كلمة المرور (اختياري)' : 'Password (optional)'}
                          dir="ltr"
                        />
                        <input
                          type="password"
                          value={postOrderPwd2}
                          onChange={(e) => {
                            setPostOrderPwd2(e.target.value);
                            setPostOrderPwdErr(null);
                          }}
                          className="w-full bg-dark border border-amber-500/35 rounded-xl px-3 py-2 text-white text-right text-sm"
                          placeholder={language === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm password'}
                          dir="ltr"
                        />
                      </div>
                      {postOrderPwdErr && <p className="text-red-400 text-[11px] font-bold text-center">{postOrderPwdErr}</p>}
                      <button
                        type="button"
                        disabled={postOrderPwdSaving}
                        onClick={() => void handleSavePostOrderPassword()}
                        className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white py-2.5 rounded-xl font-black text-sm"
                      >
                        {postOrderPwdSaving
                          ? language === 'ar'
                            ? 'جاري الحفظ…'
                            : 'Saving…'
                          : language === 'ar'
                            ? 'حفظ كلمة المرور'
                            : 'Save password'}
                      </button>
                    </div>
                  )}

                  {postOrderRecoveryCode && (
                    <div className="mt-3 rounded-xl border border-amber-500/35 bg-black/20 p-3 text-center">
                      <p className="text-[11px] text-amber-100/80 mb-1">
                        {language === 'ar' ? 'كود الاسترجاع (احتفظ به):' : 'Recovery code (keep it):'}
                      </p>
                      <p className="font-mono text-2xl font-black text-amber-200 tracking-widest">{postOrderRecoveryCode}</p>
                      <p className="text-[10px] text-amber-100/60 mt-1">
                        {language === 'ar'
                          ? 'يُستخدم عند نسيان كلمة المرور على جهاز آخر. عند تغيير كلمة المرور سيتغير هذا الكود.'
                          : 'Used to reset password on another device. It changes whenever you change the password.'}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {!orderSuccess.needsPasswordSetup && orderSuccess.deliveryMethod === 'pickup' && orderSuccess.branchLocation && (
                <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 space-y-4">
                  <div className="flex items-center justify-center gap-2 text-primary">
                    <MapPin className="w-4 h-4" />
                    <span className="font-bold text-sm">
                      {language === 'ar' ? 'موقع استلام الطلب' : 'Pickup Location'}
                    </span>
                  </div>

                  <div className="text-center">
                    <p className="text-white font-black">{orderSuccess.branchName}</p>
                    <p className="text-xs text-muted mt-1">
                      {language === 'ar' ? 'توجه للفرع لاستلام طلبك' : 'Head to the branch to pick up'}
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      const loc = orderSuccess.branchLocation!;
                      window.open(`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`, '_blank');
                    }}
                    className="w-full bg-white text-black py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 hover:bg-gray-100 transition-all active:scale-95"
                  >
                    <Navigation className="w-4 h-4" />
                    {language === 'ar' ? 'فتح في خرائط جوجل' : 'Open in Maps'}
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  setOrderSuccess(null);
                  fetchPendingOrders();
                }}
                className="w-full bg-primary hover:bg-primary/90 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95"
              >
                {language === 'ar' ? 'حسناً' : 'Get it'}
              </button>
            </div>
          </div>
        </div>
      )}

      <CustomerProfile
        isOpen={showProfile}
        onClose={() => {
          setShowProfile(false);
          setHighlightOrderId(null);
          setActiveBottomTab('home');
        }}
        customerPhone={customerPhone}
        highlightOrderId={highlightOrderId}
        initialTab={profileInitialTab}
        onPhoneValidated={async (phone) => {
          setCustomerPhone(phone);
          await fetchCouponConfigAndCoupons(phone);
        }}
        onSettingsViewChange={setProfileSettingsView}
        onStartOrderEdit={handleStartOrderEdit}
        catalogItems={items}
      />

      {phoneChrome && (
        <nav
          className={`fixed bottom-0 inset-x-0 z-[120] border-t border-white/10 bg-[hsl(var(--color-surface))] px-2 pt-1 pb-[max(0.4rem,env(safe-area-inset-bottom))] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${showCart || showCheckout
              ? 'translate-y-full'
              : 'translate-y-0'
            }`}
        >
          <div className="grid grid-cols-3 gap-1 max-w-md mx-auto">
            <button
              type="button"
              onClick={() => {
                setActiveBottomTab('home');
                setHighlightOrderId(null);
                setShowProfile(false);
                setShowCart(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 ${activeBottomTab === 'home' ? 'bg-primary/15 text-primary' : 'text-white/80'}`}
            >
              <img
                src="/mx-brand-logo.png"
                alt="MX"
                className="h-5 w-5 rounded-full object-cover"
              />
              <span className="text-[11px] font-black">{language === 'ar' ? 'الرئيسية' : 'Home'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveBottomTab('orders');
                setProfileInitialTab('orders');
                setShowProfile(true);
              }}
              className={`relative flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 ${activeBottomTab === 'orders' ? 'bg-primary/15 text-primary' : 'text-white/80'}`}
            >
              <ReceiptText className="h-5 w-5 text-primary" />
              {ordersCount > 0 && (
                <span className="absolute right-3 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-black text-white">
                  {ordersCount > 9 ? '9+' : ordersCount}
                </span>
              )}
              <span className="text-[11px] font-black">{language === 'ar' ? 'طلباتي' : 'Orders'}</span>
            </button>
            <button
              type="button"
              data-profile-button
              onClick={() => {
                setActiveBottomTab('account');
                setHighlightOrderId(null);
                setProfileInitialTab('settings');
                setShowProfile(true);
              }}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 ${activeBottomTab === 'account' ? 'bg-primary/15 text-primary' : 'text-white/80'}`}
            >
              <User className="h-5 w-5 text-primary" />
              <span className="text-[11px] font-black">{language === 'ar' ? 'الحساب' : 'Account'}</span>
            </button>
          </div>
        </nav>
      )}

      {/* Floating Keyboard Button - Mobile only */}
      {phoneChrome && !showCart && cartItems.length === 0 && !showCheckout && !showProfile && !orderSuccess && !isProductImageFullscreen && (
        <button
          onClick={() => {
            if (mobileKeyboardInputRef.current) {
              mobileKeyboardInputRef.current.focus();
            }
          }}
          className="fixed bottom-20 left-4 z-[55] rounded-full border border-violet-300/50 bg-white/90 p-3 text-violet-700 shadow-2xl shadow-black/15 backdrop-blur-md transition-colors duration-150 hover:bg-white active:scale-95 floating-keyboard-btn"
          style={{ animation: 'floatBounce 3s ease-in-out infinite' }}
        >
          <Keyboard className="h-5 w-5" strokeWidth={2.25} />
        </button>
      )}

      {/* Hidden input for mobile keyboard trigger */}
      <input
        ref={mobileKeyboardInputRef}
        type="text"
        className="fixed -top-20 left-0 w-0 h-0 opacity-0"
        style={{ pointerEvents: 'none' }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        onKeyDown={(e) => {
          // Forward key events to window for CheatCodeInput to capture
          const event = new KeyboardEvent('keypress', {
            key: e.key,
            bubbles: true,
          });
          window.dispatchEvent(event);
        }}
        onChange={(e) => {
          // Clear input after each character so it keeps accepting input
          const val = e.target.value;
          if (val.length > 0) {
            const lastChar = val[val.length - 1];
            const event = new KeyboardEvent('keypress', {
              key: lastChar,
              bubbles: true,
            });
            window.dispatchEvent(event);
            e.target.value = '';
          }
        }}
      />

      <footer className={`bg-dark border-t-2 border-muted/30 mt-16 py-8 ${phoneChrome ? 'pb-24' : ''}`}>
        <div className="container mx-auto text-center">
          <p className="text-muted text-lg font-bold">MX - Level Up Your Taste!</p>
          <p className="text-muted/60 mt-2">جميع الحقوق محفوظة © 2024</p>
        </div>
      </footer>

      {/* Animations */}
      <style>{`
        @keyframes pendingOrderSlide {
          0% {
            transform: translateX(20px);
            opacity: 0;
          }
          100% {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .pending-order-slide {
          animation: pendingOrderSlide 0.3s ease-out;
        }
        @keyframes floatBounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }
        @keyframes cartShakeImpact {
          0% { transform: translateY(0); }
          20% { transform: translateY(15px); }
          100% { transform: translateY(0); }
        }
         @keyframes cartInnerImpact {
          0% { transform: translateY(0); }
          15% { transform: translateY(15px); }
          100% { transform: translateY(0); }
        }

        .cart-shake-impact {
          animation: cartShakeImpact 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
        }

        @media (hover: none) {
          .hover\:scale-110:hover, 
          .hover\:scale-105:hover, 
          .hover\:scale-\[1\.02\]:hover { 
            transform: none !important; 
          }
          .hover\:bg-primary\/80:hover,
          .hover\:bg-primary\/30:hover,
          .hover\:bg-white\/10:hover {
            background-color: transparent !important;
          }
        }
      `}</style>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <MenuDisplayProvider>
        <AuthProvider>
          <RealtimeProvider>
            <AppContent />
          </RealtimeProvider>
        </AuthProvider>
        </MenuDisplayProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
