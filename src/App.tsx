import { useState, useEffect, useCallback, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { supabase, Category, Item, DeviceCoupon, DeliveryService, DeliveryZoneLayer, PolygonPoint, Order, OrderItem } from './lib/supabase';
import { fetchDeliveryZonesAndServices, getDeliveryMatch } from './lib/deliveryMatch';
import { generateEasyRecoveryCode, hashPhonePassword, hashRecoveryCode } from './lib/phonePassword';
import { getOrCreateDeviceFingerprint } from './lib/deviceFingerprint';
import {
  CheckCircle2, Navigation, MapPin, Lock,
  ChevronLeft, ChevronRight, Clock, Package, Truck,
  AlertTriangle as AlertTriangleIcon, CheckCircle, XCircle,
  Keyboard, ReceiptText, User
} from 'lucide-react';
import Header from './components/Header';
import CategorySection from './components/CategorySection';
import Cart from './components/Cart';
import Checkout, { CustomerData } from './components/Checkout';
import CustomerProfile from './components/CustomerProfile';
import CheatCodeInput from './components/CheatCodeInput';
import OperatorLogin from './components/OperatorLogin';
import OperatorDashboard from './components/OperatorDashboard';
import { isTouchPhoneChrome } from './lib/viewportUi';

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
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<'customer' | 'address'>('customer');
  const [checkoutCartEditMode, setCheckoutCartEditMode] = useState(false);
  const [checkoutCartSnapshot, setCheckoutCartSnapshot] = useState<CartItem[] | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [profileInitialTab, setProfileInitialTab] = useState<'settings' | 'orders'>('settings');
  const [customerPhone, setCustomerPhone] = useState('');
  const [couponSecretCode, setCouponSecretCode] = useState<string | null>(null);
  const [couponDiscountPercent, setCouponDiscountPercent] = useState<number>(0);
  const [deviceCoupons, setDeviceCoupons] = useState<DeviceCoupon[]>([]);
  const [ordersCount, setOrdersCount] = useState(0);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [currentPendingOrderIndex, setCurrentPendingOrderIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [phoneChrome, setPhoneChrome] = useState(false);
  const mobileKeyboardInputRef = useRef<HTMLInputElement>(null);
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
  const [hideMobileBottomNav, setHideMobileBottomNav] = useState(false);
  const [isProductImageFullscreen, setIsProductImageFullscreen] = useState(false);

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
    const handler = (e: any) => setIsProductImageFullscreen(e.detail);
    window.addEventListener('mobileFullscreenImage', handler);
    return () => window.removeEventListener('mobileFullscreenImage', handler);
  }, []);

  useEffect(() => {
    fetchData();
    fetchCouponConfigAndCoupons();

    const categoriesChannel = supabase
      .channel('categories-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => {
        fetchData();
      })
      .subscribe();

    const itemsChannel = supabase
      .channel('items-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => {
        fetchData();
      })
      .subscribe();

    const couponsChannel = supabase
      .channel('device-coupons-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_coupons' }, () => {
        fetchCouponConfigAndCoupons();
      })
      .subscribe();

    return () => {
      categoriesChannel.unsubscribe();
      itemsChannel.unsubscribe();
      couponsChannel.unsubscribe();
    };
  }, []);

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
        const { data: customer } = await supabase
          .from('customers')
          .select('id')
          .eq('phone', phone)
          .maybeSingle();

        if (customer?.id) {
          customerId = customer.id;
        }
      } catch (e) {
        console.error(e);
      }
    }

    if (!customerId) {
      setPendingOrders([]);
      return;
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

  // Listen for order changes to refresh pending orders
  useEffect(() => {
    const ordersChannel = supabase
      .channel('pending-orders-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchPendingOrders();
      })
      .subscribe();

    return () => {
      ordersChannel.unsubscribe();
    };
  }, [fetchPendingOrders]);

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

  // Helper for order status display (rest preserved)
  const getOrderStatusInfo = (status: string) => {
    switch (status) {
      case 'under_review':
        return { icon: Clock, text: language === 'ar' ? 'قيد المعاينة' : 'Under Review', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
      case 'preparing':
        return { icon: Package, text: language === 'ar' ? 'قيد التحضير' : 'Preparing', color: 'text-blue-400', bg: 'bg-blue-500/20' };
      case 'on_way':
        return { icon: Truck, text: language === 'ar' ? 'في الطريق' : 'On the Way', color: 'text-purple-400', bg: 'bg-purple-500/20' };
      case 'arrived':
        return { icon: AlertTriangleIcon, text: language === 'ar' ? 'وصل الآن' : 'Arrived', color: 'text-orange-400', bg: 'bg-orange-500/20' };
      case 'completed':
        return { icon: CheckCircle, text: language === 'ar' ? 'تم التسليم' : 'Completed', color: 'text-green-400', bg: 'bg-green-500/20' };
      case 'cancelled':
        return { icon: XCircle, text: language === 'ar' ? 'ملغي' : 'Cancelled', color: 'text-red-400', bg: 'bg-red-500/20' };
      case 'cancellation_pending':
        return { icon: Clock, text: language === 'ar' ? 'إلغاء قيد المعاينة' : 'Cancellation Pending', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
      default:
        return { icon: Package, text: status, color: 'text-gray-400', bg: 'bg-gray-500/20' };
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
        } catch (e) {}
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

  const fetchData = async () => {
    setLoading(true);

    const [categoriesRes, itemsRes] = await Promise.all([
      supabase.from('categories').select('*').eq('is_active', true).order('display_order'),
      supabase.from('items').select('*').eq('is_active', true).order('display_order')
    ]);

    if (categoriesRes.data) setCategories(categoriesRes.data);
    if (itemsRes.data) setItems(itemsRes.data);

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
    if (quantity < 1) {
      handleRemoveItem(itemId);
      return;
    }
    setCartItems(prev =>
      prev.map(item => (item.id === itemId ? { ...item, quantity } : item))
    );
  };

  const handleRemoveItem = (itemId: string) => {
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

  const handleConfirmOrder = async (
    customerData: CustomerData,
    paymentMethod: 'cash' | 'instant_transfer',
    orderNote?: string,
    appliedCouponId?: string,
    deliveryFee?: number,
    serviceInfo?: { service: DeliveryService; layer: DeliveryZoneLayer | null } | null
  ) => {
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

      // Check for existing customer with same phone
      const { data: existingCustomer, error: customerCheckError } = await supabase
        .from('customers')
        .select('id, device_fingerprint, name')
        .eq('phone', customerData.phone)
        .maybeSingle();

      if (customerCheckError) {
        console.error('Error checking customer:', customerCheckError);
        throw new Error('خطأ في التحقق من بيانات العميل');
      }

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

      let customerId = existingCustomer?.id;

      if (!customerId) {
        // Try to insert with device_fingerprint, if it fails, try without
        // Only send columns الموجودة فعلاً في جدول customers
        const customerDataToInsert: any = {
          name: customerData.name,
          phone: customerData.phone,
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
          secondary_phone: customerData.secondary_phone
        };
        // Remove deliveryMethod as it's not a column in customers table
        delete customerDataToInsert.deliveryMethod;
        try {
          customerDataToInsert.device_fingerprint = deviceFingerprint;
        } catch (e) {
          // device_fingerprint column might not exist yet
          console.warn('device_fingerprint not available, continuing without it');
        }

        const { data: newCustomer, error: insertError } = await supabase
          .from('customers')
          .insert([customerDataToInsert])
          .select('id')
          .single();

        if (insertError) {
          console.error('Error inserting customer:', insertError);
          // Try without device_fingerprint
          const { data: newCustomerRetry, error: insertErrorRetry } = await supabase
            .from('customers')
            .insert([{
              name: customerData.name,
              phone: customerData.phone,
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
              secondary_phone: customerData.secondary_phone
            }])
            .select('id')
            .single();

          if (insertErrorRetry) throw insertErrorRetry;
          customerId = newCustomerRetry?.id;
        } else {
          customerId = newCustomer?.id;
        }
        if (customerId) {
          localStorage.setItem('customer_id', customerId);
        }
      } else {
        // Existing customer
        if (customerId) {
          localStorage.setItem('customer_id', customerId);
        }
        const updateData: any = {
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
          secondary_phone: customerData.secondary_phone
        };
        // Remove deliveryMethod as it's not a column in customers table
        delete updateData.deliveryMethod;

        try {
          updateData.device_fingerprint = deviceFingerprint;
          const { error: updateError } = await supabase
            .from('customers')
            .update(updateData)
            .eq('id', customerId);

          if (updateError) {
            // Try without device_fingerprint
            delete updateData.device_fingerprint;
            const { error: retryError } = await supabase
              .from('customers')
              .update(updateData)
              .eq('id', customerId);
            if (retryError) throw retryError;
          }
        } catch (e) {
          console.warn('Could not update customer data:', e);
        }

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
      }

      if (!customerId) throw new Error('فشل في إنشاء/تحديث بيانات العميل');

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
            subtotal: (item.has_offer && item.offer_price ? item.offer_price : item.price) * item.quantity
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
        subtotal: (item.has_offer && item.offer_price ? item.offer_price : item.price) * item.quantity
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
  };



  const handleCategoryClick = (categoryId: string) => {
    const element = document.getElementById(`category-${categoryId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

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
          setActiveBottomTab('account');
          setShowProfile(prev => !prev);
        }}
        hasOrders={ordersCount > 0}
        ordersCount={ordersCount}
        categories={categories}
        onCategorySelect={handleCategoryClick}
      />

      {/* Pending Orders Banner */}
      {pendingOrders.length > 0 && (
        <div className="bg-gradient-to-r from-primary/20 via-surface to-primary/20 border-b border-primary/30 relative overflow-hidden">
          <div className="container mx-auto px-4 py-3">
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
                  const statusInfo = getOrderStatusInfo(order.status);
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
                        <div className={`flex-shrink-0 p-2 rounded-xl ${statusInfo.bg}`}>
                          <StatusIcon className={`w-5 h-5 ${statusInfo.color}`} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-bold text-sm">
                              #{order.order_number}
                            </span>
                            <span className={`text-xs font-bold ${statusInfo.color}`}>
                              {statusInfo.text}
                            </span>
                          </div>
                          <p className="text-muted text-xs truncate">
                            {order.items.map(i => i.item_name).join('، ')}
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
        {loading ? (
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
        }}
        customerPhone={customerPhone}
        highlightOrderId={highlightOrderId}
        initialTab={profileInitialTab}
        onMobileSubflowChange={setHideMobileBottomNav}
      />

      {phoneChrome && !showCart && cartItems.length === 0 && !hideMobileBottomNav && !isProductImageFullscreen && (
      <nav className="fixed bottom-0 inset-x-0 z-[75] border-t border-white/10 bg-[hsl(var(--color-surface))] px-2 pt-1 pb-[max(0.4rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-3 gap-1 max-w-md mx-auto">
          <button
            type="button"
            onClick={() => {
              setActiveBottomTab('home');
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
      {phoneChrome && !showCart && cartItems.length === 0 && !showCheckout && !showProfile && !orderSuccess && (
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
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
