import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Navigation, X, ChevronRight, ShoppingBag, CreditCard, Banknote, User, Phone, Building, StickyNote, AlertTriangle, Lock, Plus, Pencil, Home, Briefcase, Clock } from 'lucide-react';
import MobileMapEditor from './MobileMapEditor';
import { supabase, DeviceCoupon, DeliveryService, DeliveryZoneLayer, Item, DeliveryZone, PolygonPoint, CustomerData, AddressType, SavedAddressTab } from '../lib/supabase';
import { generateEasyRecoveryCode, hashPhonePassword, hashRecoveryCode } from '../lib/phonePassword';
import { getOrCreateDeviceFingerprint } from '../lib/deviceFingerprint';
import { findCustomerIdByPhone, findCustomerAuthByPhone, ensureCustomerByPhone } from '../lib/customerPhone';
import { useLanguage } from '../contexts/LanguageContext';
import InteractiveMap from './InteractiveMap';
import { getDeliveryMatch } from '../lib/deliveryMatch';
import { useRealtimeRefetch } from '../hooks/useRealtimeSubscription';
import AddressNamePopover from './AddressNamePopover';
import TimePicker from './TimePicker';
import { isTouchPhoneChrome } from '../lib/viewportUi';
import ProgressiveImage from './ProgressiveImage';

import { saveSharedAddress, getSharedAddress, subscribeToAddressSync, saveSharedAddressTabs, getSharedAddressTabs } from '../lib/addressSync';

interface CheckoutCartItem extends Item {
  quantity: number;
  /** True when the item was found unavailable during a cart sync pass */
  cart_synced_unavailable?: boolean;
  /** True when the item's data (price, name, etc.) changed during a cart sync pass */
  cart_synced_data_changed?: boolean;
}

interface CheckoutProps {
  isOpen: boolean;
  onClose: () => void;
  embedded?: boolean;
  embeddedStep?: 'customer' | 'address';
  onEmbeddedStepChange?: (step: 'customer' | 'address') => void;
  total: number;
  availableCoupons?: DeviceCoupon[];
  cartItems: CheckoutCartItem[];
  onConfirm: (
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
  ) => void;
  /** When true, final order submit is in progress (blocks duplicate taps). */
  orderSubmitting?: boolean;
  onPhoneValidated?: (phone: string) => void | Promise<void>;
  onStartCartEdit?: () => void;
}


const MAX_SAVED_CUSTOM_ADDRESSES = 4;
const PICKUP_READY_STATUSES = ['preparing', 'arrived'];

function normalizeSavedAddressLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

/** Same text as the three built-in type tabs (AR + EN) — custom labels must not collide. */
function getReservedSavedAddressLabelKeys(): Set<string> {
  const raw = ['شقة', 'منزل', 'مكان عمل', 'apartment', 'house', 'workplace'];
  return new Set(raw.map(normalizeSavedAddressLabelKey));
}

function allocateUniqueSavedAddressLabel(rawLabel: string, savedTabs: SavedAddressTab[]): string {
  const base = rawLabel.trim();
  if (!base) return base;

  const taken = new Set<string>();
  for (const t of savedTabs) {
    taken.add(normalizeSavedAddressLabelKey(t.label));
  }
  for (const k of getReservedSavedAddressLabelKeys()) {
    taken.add(k);
  }

  let candidate = base;
  let n = 2;
  while (taken.has(normalizeSavedAddressLabelKey(candidate))) {
    candidate = `${base} ${n}`;
    n += 1;
  }
  return candidate;
}

export default function Checkout({
  isOpen,
  onClose,
  embedded = false,
  embeddedStep,
  onEmbeddedStepChange,
  total,
  availableCoupons,
  cartItems,
  onConfirm,
  orderSubmitting = false,
  onPhoneValidated,
  onStartCartEdit
}: CheckoutProps) {
  const { language, t } = useLanguage();
  const currencySymbol = language === 'ar' ? 'ج' : 'EG';
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'instant_transfer'>('cash');
  const [instantNumber, setInstantNumber] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [selectedCouponId, setSelectedCouponId] = useState<string | null>(null);
  const [deliveryMethod, setDeliveryMethod] = useState<'delivery' | 'pickup'>('delivery');
  const [deliveryServices, setDeliveryServices] = useState<DeliveryService[]>([]);
  const [deliveryFee, setDeliveryFee] = useState<number>(0);
  const [isInDeliveryZone, setIsInDeliveryZone] = useState<boolean | null>(null);
  const [customerData, setCustomerData] = useState<CustomerData>({
    name: '',
    phone: '',
    address_type: 'apartment',
    street: '',
    area: '',
    city: '',
    apartment: '',
    floor: '',
    building_number: '',
    house_name: '',
    company_name: '',
    landmark: ''
  });
  const [activeAddressType, setActiveAddressType] = useState<AddressType>('apartment');
  const [savedAddressTabs, setSavedAddressTabs] = useState<SavedAddressTab[]>([]);
  const [newAddressName, setNewAddressName] = useState('');
  const [pendingAddressType, setPendingAddressType] = useState<'apartment' | 'house' | 'workplace' | null>(null);
  const [isCreatingCustomAddress, setIsCreatingCustomAddress] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<'customer' | 'address'>('customer');
  const [showDebugMap, setShowDebugMap] = useState(false);
  const [allZones, setAllZones] = useState<DeliveryZone[]>([]);
  const [selectedServiceInfo, setSelectedServiceInfo] = useState<{
    service: DeliveryService;
    layer: DeliveryZoneLayer | null;
  } | null>(null);
  const [showSecondaryPhone, setShowSecondaryPhone] = useState(false);
  const [mobileMapFullscreen, setMobileMapFullscreen] = useState(false);
  const [addressFieldErrors, setAddressFieldErrors] = useState<Record<string, boolean>>({});
  const locationBackupRef = useRef<CustomerData | null>(null);
  const requiredFieldRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const phoneInputRef = useRef<HTMLInputElement | null>(null);
  const secondaryPhoneInputRef = useRef<HTMLInputElement | null>(null);
  const [phonePasswordInput, setPhonePasswordInput] = useState('');
  const [phonePasswordError, setPhonePasswordError] = useState<string | null>(null);
  /** إن كان الرقم مسجّلاً ومفعّلاً عليه كلمة مرور */
  const [phoneNeedsPassword, setPhoneNeedsPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');
  const [resetPwd1, setResetPwd1] = useState('');
  const [resetPwd2, setResetPwd2] = useState('');
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNewRecovery, setResetNewRecovery] = useState<string | null>(null);
  const [phoneLengthError, setPhoneLengthError] = useState<string | null>(null);
  const [secondaryPhoneLengthError, setSecondaryPhoneLengthError] = useState<string | null>(null);
  const [pickupCommitmentAccepted, setPickupCommitmentAccepted] = useState(false);
  const [pickupSlot, setPickupSlot] = useState<'now' | 'hour' | 'custom' | null>('hour');
  const [pickupCustomPickerOpen, setPickupCustomPickerOpen] = useState(false);
  const [pickupPreset, setPickupPreset] = useState<'now' | 'hour' | 'twohours' | 'custom'>('now');
  const [pickupCustomHour, setPickupCustomHour] = useState(() => {
    const dt = new Date(Date.now() + 60 * 60 * 1000);
    let h = dt.getHours() % 12;
    return h === 0 ? 12 : h;
  });
  const [pickupCustomMinute, setPickupCustomMinute] = useState(() => {
    const dt = new Date(Date.now() + 60 * 60 * 1000);
    return Math.round(dt.getMinutes() / 5) * 5 % 60;
  });
  const [pickupCustomAmPm, setPickupCustomAmPm] = useState<'AM' | 'PM'>(() => {
    const dt = new Date(Date.now() + 60 * 60 * 1000);
    return dt.getHours() >= 12 ? 'PM' : 'AM';
  });
  const [pickupCustomConfirmedLabel, setPickupCustomConfirmedLabel] = useState<string | null>(null);
  const [pickupSheetDragY, setPickupSheetDragY] = useState(0);
  const [mobileSavedTabSheet, setMobileSavedTabSheet] = useState<SavedAddressTab | null>(null);
  const [renameSavedTarget, setRenameSavedTarget] = useState<SavedAddressTab | null>(null);
  const [renameSavedInput, setRenameSavedInput] = useState('');
  const savedTabLongPressTimer = useRef<number | null>(null);
  const savedTabLongPressConsumed = useRef(false);
  const pickupSheetStartYRef = useRef(0);
  const pickupSheetDraggingRef = useRef(false);
  const customerAccountCacheRef = useRef<{
    phone: string;
    row: {
      id: string;
      phone_password_hash: string | null;
      phone_password_owner_fingerprint: string | null;
    } | null;
  } | null>(null);
  const customAddressAnchorRef = useRef<HTMLDivElement | null>(null);
  const pickupInlineRef = useRef<HTMLDivElement | null>(null);
  const addressFormScrollRef = useRef<HTMLDivElement | null>(null);
  /** موضع نافذة اسم العنوان (ثابت بالنسبة للشاشة) لتفادي الحواف وقصّ overflow-y */
  const [addressNamePopoverPos, setAddressNamePopoverPos] = useState<{ top: number; left: number } | null>(null);
  /** شريط تعديل/حذف العنوان المحفوظ على الجوال — نفس شكل سطح المكتب */
  const [mobileSavedTabMenuPos, setMobileSavedTabMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const isMobileLayout = useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') return () => { };
      const mq = window.matchMedia('(max-width: 767px)');
      mq.addEventListener('change', onStoreChange);
      return () => mq.removeEventListener('change', onStoreChange);
    },
    () => (typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false),
    () => false
  );
  const [pickupActivatedAt, setPickupActivatedAt] = useState<number | null>(null);

  useEffect(() => {
    if (deliveryMethod === 'pickup' && !pickupActivatedAt) {
      setPickupActivatedAt(Date.now());
    } else if (deliveryMethod === 'delivery') {
      setPickupActivatedAt(null);
    }
  }, [deliveryMethod, pickupActivatedAt]);

  useEffect(() => {
    const savedDefault = localStorage.getItem('default_pickup_time');
    if (savedDefault) {
      setPickupSlot('custom');
      setPickupCustomConfirmedLabel(savedDefault);
    }
  }, []);
  useEffect(() => {
    // Initial load
    const sharedData = getSharedAddress();
    if (Object.keys(sharedData).length > 0) {
      setCustomerData(prev => ({ ...prev, ...sharedData }));
    }

    const sharedTabs = getSharedAddressTabs();
    if (sharedTabs.length > 0) {
      setSavedAddressTabs(sharedTabs);
    }

    // Subscribe to updates
    return subscribeToAddressSync(
      (data) => {
        setCustomerData(prev => ({ ...prev, ...data }));
      },
      (tabs) => {
        setSavedAddressTabs(tabs);
      }
    );
  }, []);

  const isFinePointerDesktop = useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') return () => {};
      const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
      mq.addEventListener('change', onStoreChange);
      return () => mq.removeEventListener('change', onStoreChange);
    },
    () =>
      typeof window !== 'undefined'
        ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
        : true,
    () => true
  );
  const SAVED_ADDRESS_TABS_KEY = 'checkout_saved_address_tabs';
  const SAVED_ADDRESS_TYPE_KEY = 'checkout_address_type';

  const loadServerAddressTabs = useCallback(async (customerId: string) => {
    const { data, error } = await supabase
      .from('customer_saved_addresses')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });
    if (error) {
      console.warn('load server saved addresses failed:', error);
      return;
    }
    const mapped: SavedAddressTab[] = (data || []).map((r: any) => ({
      id: r.id,
      label: r.label,
      data: {
        address_type: r.address_type || 'custom',
        address_label: r.label,
        building_number: r.building_number || '',
        street: r.street || '',
        area: r.area || '',
        city: r.city || '',
        floor: r.floor || '',
        apartment: r.apartment || '',
        house_name: r.house_name || '',
        company_name: r.company_name || '',
        landmark: r.landmark || ''
      }
    }));
    setSavedAddressTabs(mapped);
    saveSharedAddressTabs(mapped);
  }, []);

  const fetchLatestCustomerAddress = useCallback(async (phone: string) => {
    const cleanPhone = filterDigits(phone || '');
    if (cleanPhone.length < 10) return;

    const { data: customerRow, error } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (error) {
      console.warn('fetchLatestCustomerAddress: failed', error);
      return;
    }

    if (customerRow) {
      const updated = {
        name: customerRow.name || '',
        phone: customerRow.phone || '',
        secondary_phone: customerRow.secondary_phone || '',
        building_number: customerRow.building_number || '',
        street: customerRow.street || '',
        area: customerRow.area || '',
        city: customerRow.city || '',
        floor: customerRow.floor || '',
        apartment: customerRow.apartment || '',
        house_name: customerRow.house_name || '',
        company_name: customerRow.company_name || '',
        landmark: customerRow.landmark || '',
        latitude: typeof customerRow.latitude === 'number' ? customerRow.latitude : undefined,
        longitude: typeof customerRow.longitude === 'number' ? customerRow.longitude : undefined,
        address_type: customerRow.address_type || 'apartment',
        address_label: customerRow.address_label || ''
      } as CustomerData;

      setCustomerData(prev => ({ ...prev, ...updated }));
      saveSharedAddress(updated);

      if (customerRow.id) {
        void loadServerAddressTabs(customerRow.id);
      }
    }
  }, [loadServerAddressTabs]);

  const identifyByFingerprint = useCallback(async () => {
    try {
      const fp = getOrCreateDeviceFingerprint();
      const { data: customerRow } = await supabase
        .from('customers')
        .select('*')
        .eq('device_fingerprint', fp)
        .maybeSingle();

      if (customerRow) {
        const updated = {
          name: customerRow.name || '',
          phone: customerRow.phone || '',
          secondary_phone: customerRow.secondary_phone || '',
          building_number: customerRow.building_number || '',
          street: customerRow.street || '',
          area: customerRow.area || '',
          city: customerRow.city || '',
          floor: customerRow.floor || '',
          apartment: customerRow.apartment || '',
          house_name: customerRow.house_name || '',
          company_name: customerRow.company_name || '',
          landmark: customerRow.landmark || '',
          latitude: typeof customerRow.latitude === 'number' ? customerRow.latitude : undefined,
          longitude: typeof customerRow.longitude === 'number' ? customerRow.longitude : undefined,
          address_type: customerRow.address_type || 'apartment',
          address_label: customerRow.address_label || ''
        } as CustomerData;

        setCustomerData(prev => ({ ...prev, ...updated }));
        saveSharedAddress(updated);
        
        if (customerRow.id) {
          void loadServerAddressTabs(customerRow.id);
        }
        
        // Also sync back to App
        if (customerRow.phone) {
          // Defer to avoid setState during another component render
          requestAnimationFrame(() => {
            void Promise.resolve(onPhoneValidated?.(customerRow.phone)).catch(() => {});
          });
        }
      }
    } catch (e) {
      console.warn('identifyByFingerprint failed:', e);
    }
  }, [loadServerAddressTabs, onPhoneValidated]);

  useEffect(() => {
    if (!isOpen) return;
    
    const p = customerData.phone ? filterDigits(customerData.phone) : '';
    if (p.length >= 10) {
      void fetchLatestCustomerAddress(p);
    } else {
      // If no phone yet, try identifying by device fingerprint
      void identifyByFingerprint();
    }
  }, [isOpen]);

  const validateAddressForSubmit = (): { message: string | null; fields: string[] } => {
    const c = customerData;
    const missing: string[] = [];

    if (!c.street?.trim()) {
      missing.push('street');
    }

    if (activeAddressType === 'apartment') {
      if (!c.building_number?.trim()) missing.push('building_number');
      if (!c.apartment?.trim()) missing.push('apartment');
    } else if (activeAddressType === 'house') {
      if (!c.house_name?.trim()) missing.push('house_name');
    } else if (activeAddressType === 'workplace') {
      if (!c.building_number?.trim()) missing.push('building_number');
      if (!c.company_name?.trim()) missing.push('company_name');
    } else {
      if (!c.apartment?.trim()) missing.push('apartment');
    }

    if (missing.length > 0) {
      return {
        message: language === 'ar'
          ? 'يجب ملء الخانات المطلوبة قبل تأكيد الطلب.'
          : 'Please fill all required fields before confirming the order.',
        fields: missing
      };
    }
    return { message: null, fields: [] };
  };

  const addTypedAddressTab = async (type: 'apartment' | 'house' | 'workplace', rawLabel: string) => {
    if (savedAddressTabs.length >= MAX_SAVED_CUSTOM_ADDRESSES) return;
    const trimmedLabel = rawLabel.trim();
    if (!trimmedLabel) return;
    const label = allocateUniqueSavedAddressLabel(trimmedLabel, savedAddressTabs);

    const newTab: SavedAddressTab = {
      id: `${Date.now()}`,
      label,
      data: {
        address_type: type,
        address_label: label,
        building_number: customerData.building_number,
        street: customerData.street,
        area: customerData.area,
        city: customerData.city,
        floor: customerData.floor,
        apartment: customerData.apartment,
        house_name: customerData.house_name,
        company_name: customerData.company_name,
        landmark: customerData.landmark
      }
    };
    setSavedAddressTabs((prev) => {
      const updated = [newTab, ...prev];
      saveSharedAddressTabs(updated);
      return updated;
    });
    setActiveAddressType(type);
    setCustomerData((prev) => {
      const updated = { ...prev, address_type: type, address_label: label };
      saveSharedAddress(updated);
      return updated;
    });
    setIsCreatingCustomAddress(false);
    setPendingAddressType(null);
    setNewAddressName('');

    const cid = await findCustomerIdByPhone(customerData.phone || '');
    if (cid) {
      await supabase.from('customer_saved_addresses').upsert({
        customer_id: cid,
        label,
        address_type: type,
        building_number: customerData.building_number || null,
        street: customerData.street || null,
        area: customerData.area || null,
        city: customerData.city || null,
        floor: customerData.floor || null,
        apartment: customerData.apartment || null,
        house_name: customerData.house_name || null,
        company_name: customerData.company_name || null,
        landmark: customerData.landmark || null
      }, { onConflict: 'customer_id,label' });
      await loadServerAddressTabs(cid);
    }
  };

  const removeSavedAddressTab = async (tab: SavedAddressTab) => {
    setMobileSavedTabSheet(null);
    setMobileSavedTabMenuPos(null);
    setSavedAddressTabs((prev) => {
      const updated = prev.filter((t) => t.id !== tab.id);
      saveSharedAddressTabs(updated);
      return updated;
    });
    if (customerData.address_label === tab.label) {
      setActiveAddressType('apartment');
      setCustomerData((prev) => {
        const updated = { ...prev, address_type: 'apartment', address_label: '' } as CustomerData;
        saveSharedAddress(updated);
        return updated;
      });
    }
    const cid = await findCustomerIdByPhone(customerData.phone || '');
    if (cid && tab.id.includes('-')) {
      await supabase.from('customer_saved_addresses').delete().eq('id', tab.id).eq('customer_id', cid);
    }
  };

  const renameSavedAddressTab = async (tab: SavedAddressTab, rawLabel: string) => {
    const trimmed = rawLabel.trim();
    if (!trimmed) return;
    const others = savedAddressTabs.filter((t) => t.id !== tab.id);
    const newLabel = allocateUniqueSavedAddressLabel(trimmed, others);
    if (newLabel === tab.label) {
      setRenameSavedTarget(null);
      setRenameSavedInput('');
      return;
    }
    setSavedAddressTabs((prev) => {
      const updated = prev.map((t) =>
        t.id === tab.id ? { ...t, label: newLabel, data: { ...t.data, address_label: newLabel } } : t
      );
      saveSharedAddressTabs(updated);
      return updated;
    });
    if (customerData.address_label === tab.label) {
      setCustomerData((prev) => {
        const updated = { ...prev, address_label: newLabel };
        saveSharedAddress(updated);
        return updated;
      });
    }
    const cid = await findCustomerIdByPhone(customerData.phone || '');
    if (cid && tab.id.includes('-')) {
      const { error } = await supabase
        .from('customer_saved_addresses')
        .update({ label: newLabel })
        .eq('id', tab.id)
        .eq('customer_id', cid);
      if (error) console.warn('rename saved address failed:', error);
      await loadServerAddressTabs(cid);
    }
    setRenameSavedTarget(null);
    setRenameSavedInput('');
  };

  const clearSavedTabLongPressTimer = () => {
    if (savedTabLongPressTimer.current) {
      window.clearTimeout(savedTabLongPressTimer.current);
      savedTabLongPressTimer.current = null;
    }
  };

  const onSavedTabTouchStart = (tab: SavedAddressTab) => {
    if (isFinePointerDesktop) return;
    savedTabLongPressConsumed.current = false;
    clearSavedTabLongPressTimer();
    savedTabLongPressTimer.current = window.setTimeout(() => {
      savedTabLongPressConsumed.current = true;
      setMobileSavedTabSheet(tab);
    }, 550);
  };

  const onSavedTabTouchEnd = () => {
    clearSavedTabLongPressTimer();
  };

  useEffect(() => {
    return () => {
      if (savedTabLongPressTimer.current) window.clearTimeout(savedTabLongPressTimer.current);
    };
  }, []);

  useEffect(() => {
    if (isFinePointerDesktop && mobileSavedTabSheet) {
      setMobileSavedTabSheet(null);
      setMobileSavedTabMenuPos(null);
    }
  }, [isFinePointerDesktop, mobileSavedTabSheet]);

  const applySavedTabSelection = (tab: SavedAddressTab) => {
    setMobileSavedTabSheet(null);
    setMobileSavedTabMenuPos(null);
    const savedType = ((tab.data.address_type as AddressType) || 'custom');
    setActiveAddressType(savedType);
    setCustomerData((prev) => {
      const updated = {
        ...prev,
        ...tab.data,
        address_type: savedType,
        address_label: tab.label
      };
      saveSharedAddress(updated);
      return updated;
    });
  };

  const filterDigits = (val: string) => val.replace(/\D/g, '');
  const trustedPhoneKey = (phone: string) => `trusted_phone_auth:${phone}`;

  useEffect(() => {
    const phone = filterDigits(customerData.phone || '');
    if (phone.length < 10) {
      customerAccountCacheRef.current = null;
      return;
    }
    const t = window.setTimeout(() => {
      const p = filterDigits(customerData.phone || '');
      if (p.length < 10) return;
      void supabase
        .from('customers')
        .select('id, phone_password_hash, phone_password_owner_fingerprint')
        .eq('phone', p)
        .maybeSingle()
        .then(({ data }) => {
          const latest = filterDigits(customerData.phone || '');
          if (latest !== p) return;
          customerAccountCacheRef.current = { phone: p, row: data ?? null };
        });
    }, 260);
    return () => window.clearTimeout(t);
  }, [customerData.phone]);

  useEffect(() => {
    const sec = filterDigits(customerData.secondary_phone || '');
    // If a secondary phone exists, keep the field visible across checkout reopen.
    if (sec.length > 0) {
      setShowSecondaryPhone(true);
    }
  }, [customerData.secondary_phone]);

  // Lock page scroll only for fullscreen modal checkout (not embedded inside cart)
  useEffect(() => {
    if (!isOpen || embedded) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, embedded]);

  const selectedCoupon = useMemo(
    () => (Array.isArray(availableCoupons) ? availableCoupons.find(c => c.id === selectedCouponId) || null : null),
    [availableCoupons, selectedCouponId]
  );

  useEffect(() => {
    if (!selectedCouponId) return;
    if (!availableCoupons || !availableCoupons.some((c) => c.id === selectedCouponId)) {
      setSelectedCouponId(null);
    }
  }, [availableCoupons, selectedCouponId]);

  const discountPercent = selectedCoupon?.discount_percent ?? 0;
  const discountAmount = discountPercent > 0 ? Math.round((total * discountPercent) / 100) : 0;
  const finalTotal = Math.max(0, total - discountAmount);
  const grandTotal = finalTotal + (deliveryFee || 0);

  const checkoutLiveRefetchRef = useRef<() => void>(() => {});

  useRealtimeRefetch(
    'checkout-live',
    ['settings', 'delivery_zones', 'delivery_services', 'delivery_zone_layers'],
    () => {
      checkoutLiveRefetchRef.current();
    },
    { enabled: isOpen }
  );

  useEffect(() => {
    const savedData = localStorage.getItem('customer_data');
    let resolvedAddressType: AddressType = 'apartment';
    if (savedData) {
      const parsed = JSON.parse(savedData);
      setCustomerData(parsed);
      resolvedAddressType = (parsed.address_type || 'apartment') as AddressType;
      // Check if GPS was previously enabled
      if (parsed.latitude && parsed.longitude) {
          }
    }
    const savedTabsRaw = localStorage.getItem(SAVED_ADDRESS_TABS_KEY);
    if (savedTabsRaw) {
      try {
        const parsedTabs = JSON.parse(savedTabsRaw) as SavedAddressTab[];
        setSavedAddressTabs(Array.isArray(parsedTabs) ? parsedTabs : []);
      } catch {
        setSavedAddressTabs([]);
      }
    }
    const savedAddressType = localStorage.getItem(SAVED_ADDRESS_TYPE_KEY) as AddressType | null;
    // Priority:
    // 1) Last used in previous successful order (customer_data.address_type)
    // 2) Last manually selected tab saved in localStorage
    // 3) First-time default => apartment
    if (!savedData && savedAddressType) {
      resolvedAddressType = savedAddressType;
    }
    setActiveAddressType(resolvedAddressType);

    const fetchInstantNumber = async () => {
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'instant_transfer_number')
        .maybeSingle();

      if (data) {
        setInstantNumber(data.value);
      }

      const { data: debugMapData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'show_debug_map')
        .maybeSingle();

      if (debugMapData) {
        setShowDebugMap(debugMapData.value === 'true');
      }
    };

    const fetchZones = async () => {
      const { data, error } = await supabase
        .from('delivery_zones')
        .select('*');

      if (error) {
        console.error('Error fetching delivery zones:', error);
        return;
      }

      if (data) {
        const parsedZones: DeliveryZone[] = data.map((zone: any) => {
          const parsedPoints = zone.polygon_points
            ? (typeof zone.polygon_points === 'string'
              ? JSON.parse(zone.polygon_points)
              : zone.polygon_points)
            : [];
          return {
            ...zone,
            polygon_points: parsedPoints
          };
        });
        setAllZones(parsedZones);
      }
    };

    const fetchServices = async () => {
      const { data: servicesData, error: servicesError } = await supabase
        .from('delivery_services')
        .select('*')
        .eq('is_active', true);

      if (servicesError) {
        console.error('Error fetching delivery services:', servicesError);
        return;
      }

      const { data: layersData, error: layersError } = await supabase
        .from('delivery_zone_layers')
        .select('*');

      if (layersError) {
        console.error('Error fetching delivery service layers:', layersError);
      }

      const layersByService: Record<string, DeliveryZoneLayer[]> = {};

      if (layersData) {
        layersData.forEach((layer: any) => {
          const serviceId = layer.service_id;
          if (!serviceId) return;

          const parsedPoints = layer.polygon_points
            ? (typeof layer.polygon_points === 'string'
              ? JSON.parse(layer.polygon_points)
              : layer.polygon_points)
            : [];

          const normalizedLayer: DeliveryZoneLayer = {
            id: layer.id,
            zone_id: layer.zone_id ?? undefined,
            service_id: serviceId,
            name: layer.name ?? null,
            order_index: layer.order_index ?? 1,
            polygon_points: parsedPoints,
            delivery_price: Number(layer.delivery_price ?? 0),
            created_at: layer.created_at
          };

          if (!layersByService[serviceId]) {
            layersByService[serviceId] = [];
          }
          layersByService[serviceId].push(normalizedLayer);
        });
      }

      if (servicesData) {
        const services: DeliveryService[] = servicesData.map((service: any) => {
          const rawBranch = service.branch_location;
          const branch_location = rawBranch
            ? (typeof rawBranch === 'string'
              ? JSON.parse(rawBranch)
              : rawBranch)
            : null;

          const layers = (layersByService[service.id] || []).slice().sort(
            (a, b) => (a.order_index || 0) - (b.order_index || 0)
          );

          return {
            id: service.id,
            name: service.name,
            branch_location,
            is_active: service.is_active,
            created_at: service.created_at,
            layers
          } as DeliveryService;
        });

        setDeliveryServices(services);
      }
    };

    fetchInstantNumber();
    fetchServices();
    fetchZones();

    checkoutLiveRefetchRef.current = () => {
      void fetchInstantNumber();
      void fetchServices();
      void fetchZones();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(SAVED_ADDRESS_TABS_KEY, JSON.stringify(savedAddressTabs));
  }, [savedAddressTabs]);

  useEffect(() => {
    if (savedAddressTabs.length >= MAX_SAVED_CUSTOM_ADDRESSES && isCreatingCustomAddress) {
      setIsCreatingCustomAddress(false);
      setPendingAddressType(null);
      setNewAddressName('');
    }
  }, [savedAddressTabs.length, isCreatingCustomAddress]);

  useEffect(() => {
    const nameUiOpen =
      !!renameSavedTarget || (!!isCreatingCustomAddress && !!pendingAddressType);
    if (!nameUiOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest('[data-address-name-popover]')) return;
      if (el.closest('[data-address-name-trigger]')) return;
      setRenameSavedTarget(null);
      setRenameSavedInput('');
      setIsCreatingCustomAddress(false);
      setPendingAddressType(null);
      setNewAddressName('');
      setAddressNamePopoverPos(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [renameSavedTarget, isCreatingCustomAddress, pendingAddressType]);

  const updateAddressNamePopoverPosition = useCallback(() => {
    const renameOpen = !!renameSavedTarget;
    const createOpen = !!isCreatingCustomAddress && !!pendingAddressType && !renameSavedTarget;
    if (!renameOpen && !createOpen) {
      setAddressNamePopoverPos(null);
      return;
    }
    let anchor: HTMLElement | null = null;
    if (renameOpen && renameSavedTarget) {
      anchor = document.querySelector(`[data-saved-tab-anchor="${renameSavedTarget.id}"]`);
    } else if (createOpen) {
      anchor = customAddressAnchorRef.current;
    }
    if (!anchor) {
      setAddressNamePopoverPos(null);
      return;
    }
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const margin = 12;
    const popoverWidthPx = Math.min(13.5 * 16, vw - margin * 2);
    let leftPx = r.left + r.width / 2;
    const half = popoverWidthPx / 2;
    leftPx = Math.max(half + margin, Math.min(leftPx, vw - half - margin));
    setAddressNamePopoverPos({ top: r.bottom + 8, left: leftPx });
  }, [renameSavedTarget, isCreatingCustomAddress, pendingAddressType]);

  useLayoutEffect(() => {
    updateAddressNamePopoverPosition();
  }, [updateAddressNamePopoverPosition, savedAddressTabs]);

  useEffect(() => {
    const renameOpen = !!renameSavedTarget;
    const createOpen = !!isCreatingCustomAddress && !!pendingAddressType && !renameSavedTarget;
    if (!renameOpen && !createOpen) return;
    const onScrollOrResize = () => updateAddressNamePopoverPosition();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    const scrollEl = addressFormScrollRef.current;
    scrollEl?.addEventListener('scroll', onScrollOrResize, { passive: true });
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
      scrollEl?.removeEventListener('scroll', onScrollOrResize);
    };
  }, [renameSavedTarget, isCreatingCustomAddress, pendingAddressType, updateAddressNamePopoverPosition]);

  const updateMobileSavedTabMenuPosition = useCallback(() => {
    if (!mobileSavedTabSheet) {
      setMobileSavedTabMenuPos(null);
      return;
    }
    const el = document.querySelector(`[data-saved-tab-anchor="${mobileSavedTabSheet.id}"]`);
    if (!el || !(el instanceof HTMLElement)) {
      setMobileSavedTabMenuPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const margin = 12;
    const width = Math.max(r.width, 112);
    let leftPx = r.left + r.width / 2;
    const half = width / 2;
    leftPx = Math.max(half + margin, Math.min(leftPx, vw - half - margin));
    setMobileSavedTabMenuPos({ top: r.bottom + 8, left: leftPx, width });
  }, [mobileSavedTabSheet]);

  useLayoutEffect(() => {
    updateMobileSavedTabMenuPosition();
  }, [updateMobileSavedTabMenuPosition, savedAddressTabs]);

  useEffect(() => {
    if (!mobileSavedTabSheet) return;
    const onScrollOrResize = () => updateMobileSavedTabMenuPosition();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    const scrollEl = addressFormScrollRef.current;
    scrollEl?.addEventListener('scroll', onScrollOrResize, { passive: true });
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
      scrollEl?.removeEventListener('scroll', onScrollOrResize);
    };
  }, [mobileSavedTabSheet, updateMobileSavedTabMenuPosition]);

  useEffect(() => {
    localStorage.setItem(SAVED_ADDRESS_TYPE_KEY, activeAddressType);
  }, [activeAddressType]);

  const reverseGeocodeAndSetAddress = async (lat: number, lng: number) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=ar`,
        {
          headers: {
            'User-Agent': 'MezzoApp/1.0',
            'Accept-Language': 'ar'
          }
        }
      );

      const data = await response.json();
      if (data && data.address) {
        const preciseHouseNumber = !!(data.address.house_number && data.osm_type === 'node');
        const address = {
          street: data.address.road || '',
          area: data.address.suburb || data.address.neighbourhood || data.address.quarter || '',
          city: data.address.city || data.address.town || data.address.village || data.address.state || '',
          buildingNumber: preciseHouseNumber ? (data.address.house_number || '') : ''
        };
        handleAddressChange(address);
      }
    } catch (error) {
      console.error('Reverse geocoding error (checkout):', error);
    }
  };

  const handleGetLocation = async () => {
    if (!navigator.geolocation) {
      setGpsError(language === 'ar' ? 'المتصفح لا يدعم تحديد الموقع' : 'Geolocation is not supported by your browser');
      return;
    }

    setGpsLoading(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setCustomerData(prev => ({
          ...prev,
          latitude,
          longitude
        }));
            setGpsLoading(false);
        // لا نفتح الخريطة تلقائياً، فقط نملأ العنوان من أقرب شارع/منطقة/مدينة
        await reverseGeocodeAndSetAddress(latitude, longitude);
      },
      (error) => {
        setGpsLoading(false);
        let errorMessage = '';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = language === 'ar' ? 'تم رفض الإذن لتحديد الموقع' : 'Location permission denied';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = language === 'ar' ? 'معلومات الموقع غير متاحة' : 'Location information unavailable';
            break;
          case error.TIMEOUT:
            errorMessage = language === 'ar' ? 'انتهت مهلة طلب الموقع' : 'Location request timeout';
            break;
          default:
            errorMessage = language === 'ar' ? 'حدث خطأ غير معروف' : 'An unknown error occurred';
            break;
        }
        setGpsError(errorMessage);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  const handleAddressChange = (address: { street: string; area: string; city: string; buildingNumber: string }) => {
    // Always sync fields with reverse-geocoded address when it changes
    setCustomerData(prev => ({
      ...prev,
      street: address.street,
      area: address.area,
      city: address.city,
      // Fill ONLY when the pin is on a building (house_number exists); otherwise keep it empty
      building_number: address.buildingNumber || ''
    }));
  };

  // Recalculate whether current location is inside any delivery zone
  // And compute delivery fee based on delivery services & their layers
  useEffect(() => {
    if (!customerData.latitude || !customerData.longitude) {
      if (deliveryMethod === 'pickup') {
        const fallbackService = (deliveryServices || []).find((s) => s.is_active && !!s.branch_location) || null;
        setIsInDeliveryZone(true);
        setDeliveryFee(0);
        setSelectedServiceInfo(fallbackService ? { service: fallbackService, layer: null } : null);
      } else {
        setIsInDeliveryZone(null);
        setDeliveryFee(0);
        setSelectedServiceInfo(null);
      }
      return;
    }
    if ((!deliveryServices || deliveryServices.length === 0) && (!allZones || allZones.length === 0)) {
      setIsInDeliveryZone(false);
      setDeliveryFee(0);
      setSelectedServiceInfo(null);
      return;
    }

    if (deliveryMethod === 'pickup') {
      setIsInDeliveryZone(true);
      setDeliveryFee(0);
      // We still want to find the "nearest" or best service info if possible to show branch location
      const match = getDeliveryMatch(
        customerData.latitude || 0,
        customerData.longitude || 0,
        deliveryServices,
        allZones
      );
      const fallbackService = (deliveryServices || []).find((s) => s.is_active && !!s.branch_location) || null;
      const serviceToUse = match.service || fallbackService || null;
      setSelectedServiceInfo(serviceToUse ? { service: serviceToUse, layer: match.layer || null } : null);
      return;
    }

    const match = getDeliveryMatch(
      customerData.latitude,
      customerData.longitude,
      deliveryServices,
      allZones
    );

    if (!match.isInGreen) {
      setIsInDeliveryZone(false);
      setDeliveryFee(0);
      setSelectedServiceInfo(null);
      return;
    }

    setIsInDeliveryZone(true);
    setDeliveryFee(match.price);
    setSelectedServiceInfo(match.service ? { service: match.service, layer: match.layer || null } : null);
  }, [customerData.latitude, customerData.longitude, deliveryServices, allZones, deliveryMethod]);

  const activeStep = embeddedStep ?? checkoutStep;
  const setActiveStep = (step: 'customer' | 'address') => {
    if (step === 'customer') {
      // Hide password UI when user goes back
      setPhoneNeedsPassword(false);
      setPhonePasswordError(null);
      setForgotMode(false);
      setRecoveryCodeInput('');
      setResetPwd1('');
      setResetPwd2('');
      setResetErr(null);
      setResetNewRecovery(null);
    }
    if (onEmbeddedStepChange) onEmbeddedStepChange(step);
    else setCheckoutStep(step);
  };

  // إذا تغيّر الرقم، لا تُظهر خانة كلمة المرور تلقائياً
  useEffect(() => {
    setPhoneNeedsPassword(false);
    setPhonePasswordError(null);
    setForgotMode(false);
    setRecoveryCodeInput('');
    setResetPwd1('');
    setResetPwd2('');
    setResetErr(null);
    setResetNewRecovery(null);
  }, [customerData.phone]);

  useEffect(() => {
    if (Object.keys(addressFieldErrors).length === 0) return;
    setAddressFieldErrors({});
  }, [
    customerData.street,
    customerData.building_number,
    customerData.floor,
    customerData.apartment,
    customerData.house_name,
    customerData.company_name,
    activeAddressType
  ]);

  const handleCustomerInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerData.name.trim() || !customerData.phone.trim()) {
      return;
    }
    const phone = filterDigits(customerData.phone.trim());
    if (phone.length > 15) {
      setPhoneLengthError('Phone number must not exceed 15 digits');
      setSecondaryPhoneLengthError(null);
      const input = phoneInputRef.current;
      if (input) {
        const rect = input.getBoundingClientRect();
        const notVisible = rect.top < 0 || rect.bottom > window.innerHeight;
        if (notVisible) {
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        window.setTimeout(() => input.focus(), 220);
      }
      return;
    }
    if (phone.length < 10) {
      setPhoneLengthError('يجب أن يكون الرقم 10 أرقام على الأقل');
      setSecondaryPhoneLengthError(null);
      const input = phoneInputRef.current;
      if (input) {
        const rect = input.getBoundingClientRect();
        const notVisible = rect.top < 0 || rect.bottom > window.innerHeight;
        if (notVisible) {
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        window.setTimeout(() => input.focus(), 220);
      }
      return;
    }

    const secondary = filterDigits(customerData.secondary_phone || '');
    if (secondary.length > 15) {
      setSecondaryPhoneLengthError('Phone number must not exceed 15 digits');
      setPhoneLengthError(null);
      const input = secondaryPhoneInputRef.current;
      if (input) {
        const rect = input.getBoundingClientRect();
        const notVisible = rect.top < 0 || rect.bottom > window.innerHeight;
        if (notVisible) {
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        window.setTimeout(() => input.focus(), 220);
      }
      return;
    }
    if (secondary.length > 0 && secondary.length < 10) {
      setSecondaryPhoneLengthError('يجب أن يكون الرقم 10 أرقام على الأقل');
      setPhoneLengthError(null);
      const input = secondaryPhoneInputRef.current;
      if (input) {
        const rect = input.getBoundingClientRect();
        const notVisible = rect.top < 0 || rect.bottom > window.innerHeight;
        if (notVisible) {
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        window.setTimeout(() => input.focus(), 220);
      }
      return;
    }
    setPhoneLengthError(null);
    setSecondaryPhoneLengthError(null);
    setPhonePasswordError(null);

    const cached = customerAccountCacheRef.current;
    let existing =
      cached && cached.phone === phone
        ? cached.row
        : undefined;
    if (existing === undefined) {
      existing = await findCustomerAuthByPhone(phone);
      customerAccountCacheRef.current = { phone, row: existing };
    }

    const fp = getOrCreateDeviceFingerprint();
    const ownerFp = (existing as any)?.phone_password_owner_fingerprint as string | null | undefined;
    const hasPwd = !!existing?.phone_password_hash;
    const requireByDevice = hasPwd && (!ownerFp || ownerFp.trim() === '' || ownerFp !== fp);
    const trustedHash = hasPwd ? localStorage.getItem(trustedPhoneKey(phone)) : null;
    const trustedOnThisDevice =
      hasPwd && existing && trustedHash && trustedHash === existing.phone_password_hash;
    const requirePwd = requireByDevice && !trustedOnThisDevice;

    if (requirePwd) {
      if (!existing?.phone_password_hash) return;
      if (!phonePasswordInput.trim()) {
        setPhoneNeedsPassword(true);
        setPhonePasswordError(
          language === 'ar'
            ? 'هذا الرقم مسجّل بكلمة مرور. أدخل كلمة المرور لمتابعة الطلب بهذا الرقم.'
            : 'This number is protected. Enter your password to continue.'
        );
        return;
      }
      const hash = await hashPhonePassword(phone, phonePasswordInput.trim());
      if (hash !== existing.phone_password_hash) {
        setPhoneNeedsPassword(true);
        setPhonePasswordError(
          language === 'ar'
            ? 'كلمة المرور غير صحيحة.'
            : 'Incorrect password.'
        );
        return;
      }
      // Remember this device for this phone until password changes
      localStorage.setItem(trustedPhoneKey(phone), existing.phone_password_hash);
      setPhoneNeedsPassword(false);
    }

    setActiveStep('address');
    localStorage.setItem('customer_phone', phone);
    
    const customerUpdatePayload = {
      name: customerData.name,
      phone: phone,
      secondary_phone: customerData.secondary_phone || null,
      device_fingerprint: fp,
      updated_at: new Date().toISOString()
    };

    const savedCustomerId = await ensureCustomerByPhone(phone, customerUpdatePayload);
    if (savedCustomerId) {
      void loadServerAddressTabs(savedCustomerId);
    }

    const updatedLocalStorage = {
      ...customerData,
      phone,
      deliveryMethod
    };
    localStorage.setItem('customer_data', JSON.stringify(updatedLocalStorage));
    saveSharedAddress(updatedLocalStorage);

    requestAnimationFrame(() => {
      void Promise.resolve(onPhoneValidated?.(phone)).catch(() => {});
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (orderSubmitting) return;
    // Require GPS location (lat & lng) before sending the order
    if (!customerData.latitude || !customerData.longitude) {
      setGpsError(
        language === 'ar'
          ? 'لا يمكن إرسال الطلب قبل اختيار موقعك على الخريطة والسماح بتحديد الموقع'
          : 'You must select your location on the map and allow GPS before submitting the order'
      );
      return;
    }
    if (deliveryMethod === 'delivery' && isInDeliveryZone !== true) {
      setGpsError(
        language === 'ar'
          ? 'عذراً، عنوانك الحالي خارج منطقة التوصيل المحددة أو لم يتم التحقق من الموقع بعد.'
          : 'Sorry, your address is outside the delivery zone or the location is not verified yet.'
      );
      return;
    }
    const validation = validateAddressForSubmit();
    if (validation.message) {
      setAddressFieldErrors(
        validation.fields.reduce((acc, key) => {
          acc[key] = true;
          return acc;
        }, {} as Record<string, boolean>)
      );
      setGpsError(validation.message);
      const first = validation.fields[0];
      if (first) {
        const el = requiredFieldRefs.current[first];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          window.setTimeout(() => el.focus(), 220);
        }
      }
      return;
    }
    if (deliveryMethod === 'pickup') {
      if (!pickupSlot) {
        setGpsError(language === 'ar' ? 'اختر موعد الاستلام أولاً.' : 'Please choose a pickup slot first.');
        return;
      }
      if (pickupSlot === 'custom' && !pickupCustomConfirmedLabel) {
        setGpsError(language === 'ar' ? 'يرجى تأكيد الموعد المخصص أولاً.' : 'Please confirm your custom pickup time first.');
        return;
      }
      if (!pickupCommitmentAccepted) {
        setGpsError(
          language === 'ar'
            ? 'يجب الموافقة على تعهد الحضور قبل إتمام طلب الاستلام.'
            : 'You must accept the pickup commitment before confirming the order.'
        );
        return;
      }
    }
    localStorage.setItem('customer_data', JSON.stringify({ ...customerData, deliveryMethod }));
    localStorage.setItem('customer_phone', customerData.phone);
    const now = new Date();
    let pickupDeadlineAt: string | undefined;
    let pickupCommitmentLabel: string | undefined;
    if (deliveryMethod === 'pickup') {
      if (pickupSlot === 'now') {
        pickupDeadlineAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
        pickupCommitmentLabel = language === 'ar' ? 'استلام الآن (خلال ساعتين)' : 'Pickup now (2 hours)';
      } else if (pickupSlot === 'hour') {
        const baseTs = pickupActivatedAt || now.getTime();
        pickupDeadlineAt = new Date(baseTs + 60 * 60 * 1000).toISOString();
        pickupCommitmentLabel = language === 'ar' ? 'خلال ساعة' : 'Within one hour';
      } else if (pickupSlot === 'custom') {
        const hour24 = (() => {
          const h = pickupCustomHour % 12;
          return pickupCustomAmPm === 'PM' ? h + 12 : h;
        })();
        const target = new Date();
        target.setHours(hour24, pickupCustomMinute, 0, 0);
        if (target.getTime() <= now.getTime()) {
          target.setDate(target.getDate() + 1);
        }
        pickupDeadlineAt = target.toISOString();
        const dayLabel = language === 'ar' 
          ? (target.getDate() !== now.getDate() ? 'غداً' : 'اليوم') 
          : (target.getDate() !== now.getDate() ? 'Tomorrow' : 'Today');

        pickupCommitmentLabel =
          language === 'ar'
            ? `موعد الاستلام: ${dayLabel} - ${pickupCustomHour}:${pickupCustomMinute.toString().padStart(2, '0')} ${pickupCustomAmPm === 'PM' ? 'م' : 'ص'}`
            : `Pickup at ${dayLabel} - ${pickupCustomHour}:${pickupCustomMinute.toString().padStart(2, '0')} ${pickupCustomAmPm}`;
      }
    }

    onConfirm(
      { ...customerData, deliveryMethod },
      paymentMethod,
      orderNote.trim() || undefined,
      selectedCouponId || undefined,
      deliveryFee || 0,
      selectedServiceInfo,
      deliveryMethod === 'pickup'
        ? {
            pickupDeadlineAt,
            pickupCommitmentKind: pickupSlot || undefined,
            pickupCommitmentAck: pickupCommitmentAccepted,
            pickupCommitmentLabel
          }
        : undefined
    );
  };

  useEffect(() => {
    if (isOpen && !embedded) {
      setActiveStep('customer');
      setPhonePasswordInput('');
      setPhonePasswordError(null);
      setPhoneNeedsPassword(false);
      setForgotMode(false);
      setRecoveryCodeInput('');
      setResetPwd1('');
      setResetPwd2('');
      setResetErr(null);
      setResetNewRecovery(null);
    }
  }, [isOpen, embedded]);

  useEffect(() => {
    if (deliveryMethod === 'delivery') {
      setPickupCommitmentAccepted(false);
      setPickupCustomPickerOpen(false);
    } else if (!pickupSlot) {
      setPickupSlot('hour');
      // Ensure custom picker states are also synced to "hour from now" when entering pickup mode
      const nowTs = Date.now();
      const dt = new Date(nowTs + 60 * 60 * 1000);
      let h = dt.getHours() % 12;
      if (h === 0) h = 12;
      setPickupCustomHour(h);
      setPickupCustomMinute(Math.round(dt.getMinutes() / 5) * 5 % 60);
      setPickupCustomAmPm(dt.getHours() >= 12 ? 'PM' : 'AM');
      if (!pickupActivatedAt) setPickupActivatedAt(nowTs);
    }
  }, [deliveryMethod, pickupSlot]);

  const applyPreset = useCallback(
    (preset: 'now' | 'hour' | 'twohours' | 'custom') => {
      setPickupPreset(preset);
      if (preset !== 'custom') {
        const dt = new Date(Date.now() + (preset === 'hour' ? 60 : 120) * 60 * 1000);
        let hour = dt.getHours();
        const ampm: 'AM' | 'PM' = hour >= 12 ? 'PM' : 'AM';
        hour = hour % 12;
        if (hour === 0) hour = 12;
        const minute = Math.round(dt.getMinutes() / 5) * 5 % 60;
        setPickupCustomHour(hour);
        setPickupCustomMinute(minute);
        setPickupCustomAmPm(ampm);
      }
    },
    []
  );

  const handleOpenCustomPicker = useCallback(() => {
    // Don't set pickupSlot to 'custom' yet; wait for onConfirm
    // This keeps the current (e.g. 'hour') badge visible while the picker is open.
    setPickupPreset('custom');
    setPickupCustomPickerOpen(true);
    setGpsError(null);
    window.setTimeout(() => pickupInlineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, []);


  if (!isOpen) return null;

  const sheet = (
    <div className={`relative w-full ${embedded ? 'max-w-none mx-0 px-0 pb-0 h-full' : 'max-w-md sm:max-w-lg mx-auto pointer-events-auto px-2 sm:px-4 pb-4'}`}>
        <div
          className={`bg-surface overflow-hidden checkout-slide-up flex flex-col ${embedded ? 'h-full rounded-none border-0 shadow-none' : 'border-2 border-primary shadow-2xl rounded-3xl max-h-[90vh] sm:max-h-[85vh]'}`}
          onClick={(e) => !embedded && e.stopPropagation()}
          style={embedded ? { background: 'hsl(var(--color-surface))' } : undefined}
        >
          {!embedded && (
            <div className="bg-primary/30 p-4 flex items-center justify-between border-b-2 border-primary">
              <button
                onClick={onClose}
                className="bg-red-600 hover:bg-red-500 p-2 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-white" />
              </button>
              <h2 className="text-xl font-black text-white">
                {activeStep === 'customer'
                  ? (language === 'ar' ? 'بيانات العميل' : 'Customer Info')
                  : t('checkout.title')}
              </h2>
              {activeStep === 'address' && (
                <button
                  onClick={() => setActiveStep('customer')}
                  className="text-white hover:text-purple-300 text-sm font-bold"
                >
                  {language === 'ar' ? 'رجوع' : 'Back'}
                </button>
              )}
              {activeStep === 'customer' && <div className="w-10"></div>}
            </div>
          )}

          {embedded && (
            <header className="shrink-0 bg-[hsl(var(--color-surface))] px-4 pb-3 pt-2">
              <h2 className="border-b border-primary/40 pb-2 text-right text-xl font-black text-white">
                {activeStep === 'customer' ? t('checkout.customerInfo') : t('checkout.title')}
              </h2>
            </header>
          )}

          {activeStep === 'customer' ? (
            <form id="checkout-customer-form" onSubmit={handleCustomerInfoSubmit} className="h-full flex flex-col">
              <div className="p-4 lg:p-6 space-y-4 flex-1 overflow-y-auto custom-scrollbar">
                {!embedded && (
                  <>
                    <div className="flex justify-start">
                      <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-primary/30 bg-surface/70 p-2 text-white transition-colors duration-200 ease-out hover:bg-surface"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                    <h3 className="border-b border-primary pb-2 text-right text-lg font-bold text-white lg:text-xl">
                      {t('checkout.customerInfo')}
                    </h3>
                  </>
                )}

                <div>
                  <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2">
                    <span>{t('checkout.name')}</span>
                    <User className="w-4 h-4" />
                  </label>
                  <input
                    type="text"
                    required
                    value={customerData.name}
                    onChange={(e) => setCustomerData({ ...customerData, name: e.target.value })}
                    className="w-full bg-dark border border-primary/40 rounded-lg px-3 py-2.5 text-white text-right focus:outline-none focus:border-primary text-sm"
                    placeholder={language === 'ar' ? 'أدخل اسمك' : 'Enter your name'}
                    dir={language === 'ar' ? 'rtl' : 'ltr'}
                  />
                </div>

                <div>
                  <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2">
                    <span>{t('checkout.phone')}</span>
                    <Phone className="w-4 h-4" />
                  </label>
                  <input
                    type="tel"
                    required
                    value={customerData.phone}
                    maxLength={15}
                    onChange={(e) => {
                      const next = filterDigits(e.target.value).slice(0, 15);
                      setCustomerData({ ...customerData, phone: next });
                      if (phoneLengthError) setPhoneLengthError(null);
                    }}
                    ref={phoneInputRef}
                    className={`w-full bg-dark border rounded-lg px-3 py-2.5 text-white text-right focus:outline-none text-sm font-bold ${phoneLengthError ? 'border-red-500 focus:border-red-500' : 'border-primary/40 focus:border-primary'}`}
                    placeholder={language === 'ar' ? 'رقم الهاتف الأساسي' : 'Primary phone number'}
                    dir="ltr"
                  />
                  {phoneLengthError && (
                    <p className="mt-2 text-right text-sm font-bold text-red-400">{phoneLengthError}</p>
                  )}
                </div>

                {showSecondaryPhone ? (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2">
                      <span>{language === 'ar' ? 'رقم الهاتف الاحتياطي' : 'Secondary Phone'}</span>
                      <Phone className="w-4 h-4 text-primary" />
                    </label>
                    <div>
                      <div className="relative">
                      <input
                        type="tel"
                        value={customerData.secondary_phone || ''}
                        maxLength={15}
                        ref={secondaryPhoneInputRef}
                        onChange={(e) => {
                          const next = filterDigits(e.target.value).slice(0, 15);
                          setCustomerData({ ...customerData, secondary_phone: next });
                          if (secondaryPhoneLengthError) setSecondaryPhoneLengthError(null);
                        }}
                        className={`w-full bg-dark border rounded-lg px-3 py-2.5 text-white text-right focus:outline-none text-sm font-bold pl-10 ${
                          secondaryPhoneLengthError ? 'border-red-500 focus:border-red-500' : 'border-primary/40 focus:border-primary'
                        }`}
                        placeholder={language === 'ar' ? 'رقم الهاتف الاحتياطي (اختياري)' : 'Secondary phone (optional)'}
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerData({ ...customerData, secondary_phone: '' });
                          setShowSecondaryPhone(false);
                          setSecondaryPhoneLengthError(null);
                        }}
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-red-400 hover:text-red-300 p-1.5 transition-colors"
                        title={language === 'ar' ? 'حذف الرقم' : 'Delete number'}
                      >
                        <X className="w-4 h-4" />
                      </button>
                      </div>

                      {secondaryPhoneLengthError && (
                        <p className="mt-2 text-right text-sm font-bold text-red-400">{secondaryPhoneLengthError}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowSecondaryPhone(true)}
                    className="w-full py-2 border-2 border-dashed border-primary/30 rounded-xl text-primary text-sm font-bold hover:bg-primary/5 transition-all flex items-center justify-center gap-2"
                  >
                    <Phone className="w-4 h-4" />
                    {language === 'ar' ? 'إضافة رقم هاتف احتياطي' : 'Add secondary phone'}
                  </button>
                )}

                {phoneNeedsPassword && (
                  <div className="rounded-xl border-2 border-amber-500/50 bg-amber-950/20 p-3 space-y-2 animate-in fade-in">
                    <p className="text-amber-200/95 text-xs text-right leading-relaxed">
                      {language === 'ar'
                        ? 'هذا الرقم مسجّل مسبقاً. أدخل كلمة المرور التي عيّنتها لحسابك لمتابعة الطلب بهذا الرقم.'
                        : 'This number is already registered. Enter your account password to continue.'}
                    </p>
                    <label className="block text-muted mb-1 text-right text-xs flex items-center justify-end gap-2">
                      <span>{language === 'ar' ? 'كلمة مرور الحساب' : 'Account password'}</span>
                      <Lock className="w-4 h-4 text-amber-400" />
                    </label>
                    <input
                      type="password"
                      value={phonePasswordInput}
                      onChange={(e) => {
                        setPhonePasswordInput(e.target.value);
                        setPhonePasswordError(null);
                        setResetErr(null);
                      }}
                      autoComplete="current-password"
                      className="w-full bg-dark border border-amber-500/50 rounded-lg px-3 py-2.5 text-white text-right focus:outline-none focus:border-amber-400 text-sm"
                      placeholder={language === 'ar' ? 'كلمة المرور' : 'Password'}
                      dir="ltr"
                    />

                    <button
                      type="button"
                      onClick={() => {
                        setForgotMode((v) => !v);
                        setResetErr(null);
                        setResetNewRecovery(null);
                      }}
                      className="text-[11px] font-black text-amber-200/90 hover:text-amber-200 underline text-right w-full"
                    >
                      {language === 'ar' ? 'هل نسيت كلمة المرور؟' : 'Forgot password?'}
                    </button>

                    {forgotMode && (
                      <div className="rounded-lg border border-amber-500/30 bg-black/20 p-2 space-y-2">
                        <p className="text-[11px] text-amber-100/85 text-right leading-relaxed">
                          {language === 'ar'
                            ? 'أدخل كود الأرقام الذي حصلت عليه عند إنشاء كلمة المرور، ثم عيّن كلمة مرور جديدة.'
                            : 'Enter your numeric recovery code, then set a new password.'}
                        </p>
                        <input
                          type="tel"
                          value={recoveryCodeInput}
                          onChange={(e) => {
                            setRecoveryCodeInput(filterDigits(e.target.value).slice(0, 6));
                            setResetErr(null);
                          }}
                          className="w-full bg-dark border border-amber-500/35 rounded-lg px-3 py-2 text-white text-right text-sm font-black"
                          placeholder={language === 'ar' ? 'كود الاسترجاع (6 أرقام)' : 'Recovery code (6 digits)'}
                          dir="ltr"
                        />
                        <div className="grid grid-cols-1 gap-2">
                          <input
                            type="password"
                            value={resetPwd1}
                            onChange={(e) => {
                              setResetPwd1(e.target.value);
                              setResetErr(null);
                            }}
                            className="w-full bg-dark border border-amber-500/35 rounded-lg px-3 py-2 text-white text-right text-sm"
                            placeholder={language === 'ar' ? 'كلمة مرور جديدة' : 'New password'}
                            dir="ltr"
                          />
                          <input
                            type="password"
                            value={resetPwd2}
                            onChange={(e) => {
                              setResetPwd2(e.target.value);
                              setResetErr(null);
                            }}
                            className="w-full bg-dark border border-amber-500/35 rounded-lg px-3 py-2 text-white text-right text-sm"
                            placeholder={language === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm password'}
                            dir="ltr"
                          />
                        </div>
                        {resetErr && <p className="text-red-400 text-[11px] font-black text-right">{resetErr}</p>}
                        {resetNewRecovery && (
                          <div className="rounded-lg border border-amber-500/35 bg-black/25 p-2 text-center">
                            <p className="text-[11px] text-amber-100/85 mb-1">
                              {language === 'ar' ? 'كود استرجاع جديد (احتفظ به):' : 'New recovery code (keep it):'}
                            </p>
                            <p className="font-mono text-lg font-black text-amber-200 tracking-widest">{resetNewRecovery}</p>
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={resetBusy}
                          onClick={async () => {
                            const phone = filterDigits(customerData.phone || '');
                            if (recoveryCodeInput.length !== 6) {
                              setResetErr(language === 'ar' ? 'أدخل كود استرجاع صحيح (6 أرقام).' : 'Enter a 6-digit recovery code.');
                              return;
                            }
                            if (resetPwd1.length < 4) {
                              setResetErr(language === 'ar' ? 'كلمة المرور 4 أحرف على الأقل.' : 'Password must be at least 4 characters.');
                              return;
                            }
                            if (resetPwd1 !== resetPwd2) {
                              setResetErr(language === 'ar' ? 'تأكيد كلمة المرور غير مطابق.' : 'Passwords do not match.');
                              return;
                            }
                            setResetBusy(true);
                            try {
                              const { data: row } = await supabase
                                .from('customers')
                                .select('id, phone_recovery_code_hash, phone_password_hash')
                                .eq('phone', phone)
                                .maybeSingle();
                              const expected = (row as any)?.phone_recovery_code_hash as string | null | undefined;
                              if (!row?.id || !expected) {
                                setResetErr(language === 'ar' ? 'لا يوجد كود استرجاع لهذا الرقم.' : 'No recovery code for this number.');
                                return;
                              }
                              const h = await hashRecoveryCode(phone, recoveryCodeInput);
                              if (h !== expected) {
                                setResetErr(language === 'ar' ? 'كود الاسترجاع غير صحيح.' : 'Invalid recovery code.');
                                return;
                              }
                              const fp = getOrCreateDeviceFingerprint();
                              const newPwdHash = await hashPhonePassword(phone, resetPwd1);
                              const oldPwdHash = (row as any)?.phone_password_hash as string | null | undefined;
                              if (oldPwdHash && newPwdHash === oldPwdHash) {
                                setResetErr(language === 'ar' ? 'لا يمكن اختيار نفس كلمة المرور السابقة.' : 'You cannot reuse the previous password.');
                                return;
                              }
                              const newRecovery = generateEasyRecoveryCode();
                              const newRecoveryHash = await hashRecoveryCode(phone, newRecovery);
                              const { error } = await supabase
                                .from('customers')
                                .update({
                                  phone_password_hash: newPwdHash,
                                  phone_recovery_code_hash: newRecoveryHash,
                                  phone_password_owner_fingerprint: fp,
                                  updated_at: new Date().toISOString()
                                })
                                .eq('id', row.id);
                              if (error) throw error;
                              localStorage.setItem(trustedPhoneKey(phone), newPwdHash);
                              setResetNewRecovery(newRecovery);
                              setForgotMode(false);
                              setPhoneNeedsPassword(false);
                              setPhonePasswordInput('');
                              setPhonePasswordError(null);
                              setRecoveryCodeInput('');
                              setResetPwd1('');
                              setResetPwd2('');
                              setResetErr(null);
                            } catch (e) {
                              console.error(e);
                              setResetErr(language === 'ar' ? 'تعذر إعادة تعيين كلمة المرور.' : 'Could not reset password.');
                            } finally {
                              setResetBusy(false);
                            }
                          }}
                          className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white py-2 rounded-lg font-black text-xs"
                        >
                          {resetBusy
                            ? language === 'ar'
                              ? 'جاري التحقق…'
                              : 'Verifying…'
                            : language === 'ar'
                              ? 'تأكيد الكود وتغيير كلمة المرور'
                              : 'Verify & change password'}
                        </button>
                      </div>
                    )}

                  </div>
                )}

                {phonePasswordError && (
                  <p className="text-red-400 text-right text-sm font-bold">{phonePasswordError}</p>
                )}

                <div className="pt-2 pb-3">
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-primary py-3 text-lg font-black text-white shadow-lg transition-colors duration-150 active:bg-primary/90"
                >
                  {language === 'ar' ? 'التالي' : 'Next'}
                </button>
              </div>
              </div>
            </form>
          ) : (
            <form id="checkout-address-form" onSubmit={handleSubmit} className="h-full flex flex-col overflow-hidden" style={{ maxHeight: embedded ? '100%' : 'calc(90vh - 60px)' }}>
              <div ref={addressFormScrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 pr-2 custom-scrollbar">
                {!embedded && (
                  <div className="flex justify-start">
                    <button
                      type="button"
                      onClick={() => setActiveStep('customer')}
                      className="rounded-lg border border-primary/30 bg-surface/70 p-2 text-white transition-colors duration-200 ease-out hover:bg-surface"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {/* Delivery Method Toggle */}
                <div className="bg-dark/50 p-1 rounded-xl border border-primary/20 flex gap-1 mb-2">
                  <button
                    type="button"
                    onClick={() => setDeliveryMethod('pickup')}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${deliveryMethod === 'pickup' ? 'bg-primary text-white shadow-lg' : 'text-muted hover:text-white'}`}
                  >
                    <ShoppingBag className="w-4 h-4" />
                    {language === 'ar' ? 'استلام من الفرع' : 'Pickup'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryMethod('delivery')}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${deliveryMethod === 'delivery' ? 'bg-primary text-white shadow-lg' : 'text-muted hover:text-white'}`}
                  >
                    <Navigation className="w-4 h-4" />
                    {language === 'ar' ? 'توصيل للمنزل' : 'Delivery'}
                  </button>
                </div>

                <div ref={pickupInlineRef} />

                {/* 1. Map */}
                <div className="space-y-3">
                  <h3 className="text-base font-bold text-white text-right flex items-center gap-2">
                    <MapPin className="w-4 h-4" />
                    <span>{language === 'ar' ? 'اختر موقعك على الخريطة' : 'Select your location on the map'}</span>
                  </h3>
                  <div>
                    {customerData.latitude && customerData.longitude ? (
                      <div className="mb-4">
                        {!isEditingLocation && (
                          <div className="bg-dark border border-primary/40 rounded-lg p-3 text-right space-y-2">
                            <div className="w-full overflow-hidden rounded-lg border border-primary/30">
                              <InteractiveMap
                                latitude={customerData.latitude}
                                longitude={customerData.longitude}
                                onLocationChange={() => { }}
                                onAddressChange={handleAddressChange}
                                isEditing={false}
                                className="!h-44 sm:!h-52"
                              />
                            </div>
                            <div className="flex items-center justify-between">
                                <button
                                  type="button"
                                  onClick={() => {
                                    locationBackupRef.current = { ...customerData };
                                    setIsEditingLocation(true);
                                    setMobileMapFullscreen(true);
                                  }}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-primary/35 bg-primary/10 text-primary transition-all active:scale-[0.95]"
                                  title={language === 'ar' ? 'تعديل الموقع' : 'Edit Location'}
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                              <p className="text-muted text-sm">
                                {language === 'ar'
                                  ? 'تم تحديد موقعك. يمكنك تعديل الموقع من الخريطة إذا رغبت.'
                                  : 'Your location is set. You can edit it on the map if you like.'}
                              </p>
                            </div>
                            {customerData.latitude && customerData.longitude && (
                              <p className="text-xs text-purple-400 font-mono">
                                {customerData.latitude.toFixed(6)}, {customerData.longitude.toFixed(6)}
                              </p>
                            )}
                            <p className="text-xs text-purple-300">
                              {customerData.street && <span>{customerData.street}، </span>}
                              {customerData.area && <span>{customerData.area}، </span>}
                              {customerData.city && <span>{customerData.city}</span>}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-dark border border-primary/40 rounded-lg p-6 text-center mb-4">
                        <Navigation className="w-12 h-12 text-primary mx-auto mb-4" />
                        <p className="text-muted mb-4">
                          {language === 'ar' ? 'اضغط على الزر أدناه للحصول على موقعك' : 'Click the button below to get your location'}
                        </p>
                        <button
                          type="button"
                          onClick={handleGetLocation}
                          disabled={gpsLoading}
                          className={`px-6 py-3 rounded-lg border-2 transition-all flex items-center gap-2 mx-auto ${gpsLoading
                            ? 'bg-gray-700 border-gray-600 text-gray-400 cursor-not-allowed'
                            : 'bg-primary border-primary text-white hover:bg-primary/80'
                            }`}
                        >
                          {gpsLoading ? (
                            <>
                              <Navigation className="w-5 h-5 animate-spin" />
                              <span>{language === 'ar' ? 'جاري الحصول على الموقع...' : 'Getting location...'}</span>
                            </>
                          ) : (
                            <>
                              <Navigation className="w-5 h-5" />
                              <span>{language === 'ar' ? 'الحصول على موقعي' : 'Get My Location'}</span>
                            </>
                          )}
                        </button>
                        {gpsError && (
                          <p className="text-red-400 text-sm mt-4">{gpsError}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {deliveryMethod === 'pickup' && selectedServiceInfo?.service.branch_location && (
                  <div className="mt-4 p-4 bg-primary/10 border-2 border-primary/30 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-white font-black text-sm">
                        {language === 'ar' ? 'موقع الاستلام (الفرع):' : 'Pickup Location (Branch):'}
                      </h4>
                      <MapPin className="w-5 h-5 text-primary" />
                    </div>
                    <div className="p-3 bg-dark/50 rounded-xl border border-primary/20">
                      <p className="text-primary font-bold text-lg mb-1">{selectedServiceInfo.service.name}</p>
                      <p className="text-xs text-muted">
                        {language === 'ar' ? 'يمكنك التوجه لهذا الموقع لاستلام طلبك' : 'You can head to this location to pick up your order'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const loc = selectedServiceInfo.service.branch_location as PolygonPoint;
                        window.open(`https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`, '_blank');
                      }}
                      className="w-full bg-white text-black py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 hover:bg-gray-200 transition-all shadow-lg active:scale-95"
                    >
                      <Navigation className="w-4 h-4" />
                      {language === 'ar' ? 'فتح في خرائط جوجل' : 'Open in Google Maps'}
                    </button>
                  </div>
                )}

                {deliveryMethod === 'pickup' && (
                  <div className="mt-3 p-4 bg-dark/60 border border-primary/35 rounded-2xl space-y-3">
                    <h4 className="text-white font-black text-sm text-right">
                      {language === 'ar' ? 'موعد الاستلام' : 'Pickup commitment time'}
                    </h4>
                    <div className="space-y-3">
                      {pickupSlot === 'hour' && (
                        <p className="text-[10px] text-primary/80 text-right leading-relaxed px-1">
                          {language === 'ar' 
                            ? 'تم تحديد موعد الاستلام تلقائياً "خلال ساعة" من الآن. اضغط على الموعد لتغييره.'
                            : 'Pickup time is automatically set to "within one hour". Click on the time to change it.'}
                        </p>
                      )}

                      {(pickupSlot === 'hour' || (pickupSlot === 'custom' && pickupCustomConfirmedLabel)) && (
                        <button
                          type="button"
                          onClick={handleOpenCustomPicker}
                          className="w-full p-3 bg-primary/10 border-2 border-primary/30 rounded-xl animate-in fade-in zoom-in duration-300 flex items-center justify-between gap-3 text-right transition-all hover:bg-primary/20 active:scale-[0.98] group"
                        >
                          <div className="flex-1">
                            <div className="flex items-center justify-end gap-1.5 mb-0.5">
                              <span className="text-[10px] text-primary/60 font-black group-hover:text-primary transition-colors">
                                {language === 'ar' ? '(اضغط للتعديل)' : '(Click to edit)'}
                              </span>
                              <p className="text-[10px] text-primary/70 font-black">
                                {language === 'ar' ? 'وقت الاستلام المتوقع:' : 'Expected Pickup Time:'}
                              </p>
                            </div>
                            <p className="text-sm text-white font-black">
                              {pickupSlot === 'hour' ? (() => {
                                const baseTime = pickupActivatedAt || Date.now();
                                const target = new Date(baseTime + 60 * 60 * 1000);
                                const hh = target.getHours();
                                const mm = target.getMinutes().toString().padStart(2, '0');
                                const ampmLabel = hh >= 12 ? (language === 'ar' ? 'م' : 'PM') : (language === 'ar' ? 'ص' : 'AM');
                                const h12 = hh % 12 || 12;
                                const isTomorrow = target.getDate() !== new Date(baseTime).getDate();
                                const dayLabel = language === 'ar' ? (isTomorrow ? 'غداً' : 'اليوم') : (isTomorrow ? 'Tomorrow' : 'Today');
                                return `${dayLabel} - ${h12}:${mm} ${ampmLabel}`;
                              })() : pickupCustomConfirmedLabel?.split(': ').slice(1).join(': ')}
                            </p>
                          </div>
                          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/30 transition-colors">
                            <Clock className="w-5 h-5 text-primary" />
                          </div>
                        </button>
                      )}
                    </div>
                    <label className="flex items-start gap-2 text-right text-xs text-gray-200 leading-relaxed">
                      <input
                        type="checkbox"
                        checked={pickupCommitmentAccepted}
                        onChange={(e) => {
                          setPickupCommitmentAccepted(e.target.checked);
                          if (e.target.checked) setGpsError(null);
                        }}
                        className="mt-0.5 accent-primary"
                      />
                      <span>
                        {language === 'ar'
                          ? 'أتعهد بالحضور لاستلام طلبي في الوقت المحدد، وأفهم أن الطلب قد يُلغى تلقائياً إذا لم أحضر'
                          : 'I commit to pick up my order on time and understand it may be auto-cancelled if I do not show up.'}
                      </span>
                    </label>
                  </div>
                )}

                {/* 2. Manual Address Input */}
                <div className="bg-dark/50 border border-primary/30 rounded-lg p-3 space-y-3">
                  <h3 className="text-base font-bold text-white text-right">
                    {language === 'ar' ? 'أو أدخل العنوان يدوياً (اختياري)' : 'Or enter address manually (optional)'}
                  </h3>
                  <div className="flex flex-wrap justify-end gap-2 items-center">
                    {savedAddressTabs.length < MAX_SAVED_CUSTOM_ADDRESSES && (
                      <div ref={customAddressAnchorRef} className="relative inline-flex flex-col items-stretch align-top">
                        <button
                          type="button"
                          data-address-name-trigger
                          onClick={() => {
                            if (isCreatingCustomAddress) {
                              setIsCreatingCustomAddress(false);
                              setPendingAddressType(null);
                              setNewAddressName('');
                              setAddressNamePopoverPos(null);
                              return;
                            }
                            setRenameSavedTarget(null);
                            setRenameSavedInput('');
                            const defType: 'apartment' | 'house' | 'workplace' =
                              activeAddressType === 'house' || activeAddressType === 'workplace'
                                ? activeAddressType
                                : 'apartment';
                            setIsCreatingCustomAddress(true);
                            setPendingAddressType(defType);
                            setNewAddressName(
                              defType === 'house'
                                ? (language === 'ar' ? 'المنزل' : 'House')
                                : defType === 'workplace'
                                  ? (language === 'ar' ? 'العمل' : 'Work')
                                  : (language === 'ar' ? 'الشقة' : 'Apartment')
                            );
                          }}
                          className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all ${isCreatingCustomAddress ? 'bg-red-500/20 text-red-300 border-red-400/60 rotate-180' : 'bg-dark border-primary/30 text-primary hover:bg-primary/10'
                            }`}
                          title={language === 'ar' ? 'إضافة عنوان مخصص' : 'Add custom address'}
                        >
                          {isCreatingCustomAddress ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      data-address-name-trigger
                      onClick={() => {
                        setActiveAddressType('apartment');
                        setCustomerData((prev) => ({ ...prev, address_type: 'apartment', address_label: '' }));
                        if (isCreatingCustomAddress) setPendingAddressType('apartment');
                      }}
                      className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 ${activeAddressType === 'apartment' && !customerData.address_label ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary'}`}
                    >
                      <Building className="w-3.5 h-3.5" />
                      <span>{language === 'ar' ? 'شقة' : 'Apartment'}</span>
                    </button>
                    <button
                      type="button"
                      data-address-name-trigger
                      onClick={() => {
                        setActiveAddressType('house');
                        setCustomerData((prev) => ({ ...prev, address_type: 'house', address_label: '' }));
                        if (isCreatingCustomAddress) setPendingAddressType('house');
                      }}
                      className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 ${activeAddressType === 'house' && !customerData.address_label ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary'}`}
                    >
                      <Home className="w-3.5 h-3.5" />
                      <span>{language === 'ar' ? 'منزل' : 'House'}</span>
                    </button>
                    <button
                      type="button"
                      data-address-name-trigger
                      onClick={() => {
                        setActiveAddressType('workplace');
                        setCustomerData((prev) => ({ ...prev, address_type: 'workplace', address_label: '' }));
                        if (isCreatingCustomAddress) setPendingAddressType('workplace');
                      }}
                      className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 ${activeAddressType === 'workplace' && !customerData.address_label ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary'}`}
                    >
                      <Briefcase className="w-3.5 h-3.5" />
                      <span>{language === 'ar' ? 'مكان عمل' : 'Workplace'}</span>
                    </button>
                    {savedAddressTabs.map((tab) => (
                      <div
                        key={tab.id}
                        className="relative inline-flex flex-col items-stretch align-top group/savedtab"
                      >
                        <button
                          type="button"
                          data-address-name-trigger
                          data-saved-tab-anchor={tab.id}
                          onClick={() => {
                            if (savedTabLongPressConsumed.current) {
                              savedTabLongPressConsumed.current = false;
                              return;
                            }
                            applySavedTabSelection(tab);
                          }}
                          onTouchStart={() => onSavedTabTouchStart(tab)}
                          onTouchEnd={onSavedTabTouchEnd}
                          onTouchCancel={onSavedTabTouchEnd}
                          className={`px-2 py-1 rounded-lg border text-xs flex items-center gap-1.5 w-full min-w-0 ${customerData.address_label === tab.label ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary'}`}
                          title={
                            isFinePointerDesktop
                              ? language === 'ar'
                                ? 'مرّر للقائمة أو انقر للاختيار'
                                : 'Hover for menu or click to select'
                              : language === 'ar'
                                ? 'اضغط مطوّلاً للقائمة'
                                : 'Long-press for menu'
                          }
                        >
                          <User className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate max-w-[9rem]">{tab.label}</span>
                        </button>
                        {/* سطح مكتب (فأرة): قائمة تحت التاب — لا تعتمد على عرض النافذة */}
                        <div
                          className={`pointer-events-none absolute left-0 right-0 top-[calc(100%-10px)] z-[70] pt-3 opacity-0 invisible translate-y-1 transition-all duration-150 [@media(hover:hover)]:group-hover/savedtab:pointer-events-auto [@media(hover:hover)]:group-hover/savedtab:visible [@media(hover:hover)]:group-hover/savedtab:opacity-100 [@media(hover:hover)]:group-hover/savedtab:translate-y-0 [@media(hover:none)]:hidden ${renameSavedTarget?.id === tab.id ? '[@media(hover:hover)]:!invisible [@media(hover:hover)]:!opacity-0 [@media(hover:hover)]:!pointer-events-none' : ''}`}
                        >
                          <div className="rounded-lg border border-primary/50 bg-[hsl(var(--color-surface))] shadow-xl flex w-full overflow-hidden">
                            <button
                              type="button"
                              data-address-name-trigger
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsCreatingCustomAddress(false);
                                setPendingAddressType(null);
                                setNewAddressName('');
                                setRenameSavedTarget(tab);
                                setRenameSavedInput(tab.label);
                              }}
                              className="flex-1 py-2 flex items-center justify-center text-primary hover:bg-primary/15 transition-colors"
                              title={language === 'ar' ? 'تعديل الاسم' : 'Rename'}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <div className="w-px bg-primary/25 self-stretch my-1" />
                            <button
                              type="button"
                              data-address-name-trigger
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void removeSavedAddressTab(tab);
                              }}
                              className="flex-1 py-2 flex items-center justify-center text-red-300 hover:bg-red-500/15 transition-colors"
                              title={language === 'ar' ? 'حذف العنوان' : 'Delete address'}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    {activeAddressType === 'apartment' && (
                      <>
                        <div>
                          <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2 text-sm">
                            <span>{language === 'ar' ? 'اسم/رقم المبنى' : 'Building Name/No.'}</span>
                            <Building className="w-3 h-3 text-primary" />
                          </label>
                          <input
                            type="text"
                            value={customerData.building_number}
                            onChange={(e) => setCustomerData({ ...customerData, building_number: e.target.value })}
                            ref={(el) => { requiredFieldRefs.current.building_number = el; }}
                            className={`w-full bg-dark border rounded-lg px-3 py-2 text-white text-right focus:outline-none text-sm font-bold ${addressFieldErrors.building_number ? 'border-red-500 focus:border-red-500' : 'border-primary/30 focus:border-primary'}`}
                            placeholder={language === 'ar' ? 'المبنى' : 'Building'}
                            dir={language === 'ar' ? 'rtl' : 'ltr'}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2 text-sm">
                              <span>{language === 'ar' ? 'الطابق' : 'Floor'}</span>
                              <Building className="w-3 h-3" />
                            </label>
                            <input
                              type="text"
                              value={customerData.floor || ''}
                              onChange={(e) => setCustomerData({ ...customerData, floor: e.target.value })}
                              ref={(el) => { requiredFieldRefs.current.floor = el; }}
                              className={`w-full bg-dark border rounded-lg px-3 py-2 text-white text-right focus:outline-none text-sm font-bold ${addressFieldErrors.floor ? 'border-red-500 focus:border-red-500' : 'border-primary/30 focus:border-primary'}`}
                              placeholder={language === 'ar' ? 'الطابق' : 'Floor'}
                              dir={language === 'ar' ? 'rtl' : 'ltr'}
                            />
                          </div>
                          <div>
                            <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2 text-sm">
                              <span>{language === 'ar' ? 'الشقة' : 'Apartment'}</span>
                              <Building className="w-3 h-3" />
                            </label>
                            <input
                              type="text"
                              value={customerData.apartment || ''}
                              onChange={(e) => setCustomerData({ ...customerData, apartment: e.target.value })}
                              ref={(el) => { requiredFieldRefs.current.apartment = el; }}
                              className={`w-full bg-dark border rounded-lg px-3 py-2 text-white text-right focus:outline-none text-sm font-bold ${addressFieldErrors.apartment ? 'border-red-500 focus:border-red-500' : 'border-primary/30 focus:border-primary'}`}
                              placeholder={language === 'ar' ? 'الشقة' : 'Apartment'}
                              dir={language === 'ar' ? 'rtl' : 'ltr'}
                            />
                          </div>
                        </div>
                      </>
                    )}
                    {activeAddressType === 'house' && (
                      <div>
                        <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2 text-sm">
                          <span>{language === 'ar' ? 'اسم/رقم المنزل' : 'House Name/No.'}</span>
                          <Home className="w-3 h-3 text-primary" />
                        </label>
                        <input
                          type="text"
                          value={customerData.house_name || ''}
                          onChange={(e) => setCustomerData({ ...customerData, house_name: e.target.value })}
                          ref={(el) => { requiredFieldRefs.current.house_name = el; }}
                          className={`w-full bg-dark border rounded-lg px-3 py-2 text-white text-right focus:outline-none text-sm font-bold ${addressFieldErrors.house_name ? 'border-red-500 focus:border-red-500' : 'border-primary/30 focus:border-primary'}`}
                          placeholder={language === 'ar' ? 'المنزل' : 'House'}
                          dir={language === 'ar' ? 'rtl' : 'ltr'}
                        />
                      </div>
                    )}
                    {activeAddressType === 'workplace' && (
                      <>
                        <div>
                          <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2 text-sm">
                            <span>{language === 'ar' ? 'اسم المبنى' : 'Building Name'}</span>
                            <Building className="w-3 h-3 text-primary" />
                          </label>
                          <input
                            type="text"
                            value={customerData.building_number}
                            onChange={(e) => setCustomerData({ ...customerData, building_number: e.target.value })}
                            ref={(el) => { requiredFieldRefs.current.building_number = el; }}
                            className={`w-full bg-dark border rounded-lg px-3 py-2 text-white text-right focus:outline-none text-sm font-bold ${addressFieldErrors.building_number ? 'border-red-500 focus:border-red-500' : 'border-primary/30 focus:border-primary'}`}
                            placeholder={language === 'ar' ? 'المبنى' : 'Building'}
                            dir={language === 'ar' ? 'rtl' : 'ltr'}
                          />
                        </div>
                        <div>
                          <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2 text-sm">
                            <span>{language === 'ar' ? 'اسم الشركة' : 'Company Name'}</span>
                            <Briefcase className="w-3 h-3 text-primary" />
                          </label>
                          <input
                            type="text"
                            value={customerData.company_name || ''}
                            onChange={(e) => setCustomerData({ ...customerData, company_name: e.target.value })}
                            ref={(el) => { requiredFieldRefs.current.company_name = el; }}
                            className={`w-full bg-dark border rounded-lg px-3 py-2 text-white text-right focus:outline-none text-sm ${addressFieldErrors.company_name ? 'border-red-500 focus:border-red-500' : 'border-primary/30 focus:border-primary'}`}
                            placeholder={language === 'ar' ? 'الشركة' : 'Company'}
                            dir={language === 'ar' ? 'rtl' : 'ltr'}
                          />
                        </div>
                        <div>
                          <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2 text-sm">
                            <span>{language === 'ar' ? 'الطابق' : 'Floor'}</span>
                            <Building className="w-3 h-3 text-primary" />
                          </label>
                          <input
                            type="text"
                            value={customerData.floor || ''}
                            onChange={(e) => setCustomerData({ ...customerData, floor: e.target.value })}
                            ref={(el) => { requiredFieldRefs.current.floor = el; }}
                            className={`w-full bg-dark border rounded-lg px-3 py-2 text-white text-right focus:outline-none text-sm font-bold ${addressFieldErrors.floor ? 'border-red-500 focus:border-red-500' : 'border-primary/30 focus:border-primary'}`}
                            placeholder={language === 'ar' ? 'الطابق' : 'Floor'}
                            dir={language === 'ar' ? 'rtl' : 'ltr'}
                          />
                        </div>
                      </>
                    )}
                    <div>
                      <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2 text-sm">
                        <span>{t('checkout.street')}</span>
                        <MapPin className="w-3 h-3" />
                      </label>
                      <input
                        type="text"
                        value={customerData.street}
                        onChange={(e) => setCustomerData({ ...customerData, street: e.target.value })}
                        ref={(el) => { requiredFieldRefs.current.street = el; }}
                        className={`w-full bg-dark border rounded-lg px-3 py-2 text-white text-right focus:outline-none text-sm ${addressFieldErrors.street ? 'border-red-500 focus:border-red-500' : 'border-primary/30 focus:border-primary'}`}
                        placeholder={t('checkout.street')}
                        dir={language === 'ar' ? 'rtl' : 'ltr'}
                      />
                    </div>
                    <div>
                      <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2 text-sm">
                        <span>{t('checkout.city')}</span>
                        <Building className="w-3 h-3 text-primary" />
                      </label>
                      <input
                        type="text"
                        value={customerData.city}
                        onChange={(e) => setCustomerData({ ...customerData, city: e.target.value })}
                        className="w-full bg-dark border border-primary/30 rounded-lg px-3 py-2 text-white text-right focus:outline-none focus:border-primary text-sm"
                        placeholder={t('checkout.city')}
                        dir={language === 'ar' ? 'rtl' : 'ltr'}
                      />
                    </div>
                    <div>
                      <label className="block text-muted mb-2 text-right flex items-center justify-end gap-2 text-sm">
                        <span>{language === 'ar' ? 'علامة مميزة' : 'Landmark'}</span>
                        <StickyNote className="w-3 h-3 text-primary" />
                      </label>
                      <input
                        type="text"
                        value={customerData.landmark}
                        onChange={(e) => setCustomerData({ ...customerData, landmark: e.target.value })}
                        className="w-full bg-dark border border-primary/30 rounded-lg px-3 py-2 text-white text-right focus:outline-none focus:border-primary text-sm"
                        placeholder={language === 'ar' ? 'بجانب...' : 'Landmark'}
                        dir={language === 'ar' ? 'rtl' : 'ltr'}
                      />
                    </div>
                  </div>
                </div>

                {/* Delivery zone warning (if outside) */}
                {isInDeliveryZone === false && (
                  <div className="bg-red-900/40 border border-red-500/70 rounded-lg p-2 flex items-center justify-end gap-2 text-xs text-red-100">
                    <span>{language === 'ar' ? 'أنت خارج زون الطلب، لا يمكن حفظ العنوان أو إكمال الطلب بهذا الموقع.' : 'You are outside the delivery zone. You cannot place an order from this location.'}</span>
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                )}

                {/* 3. Order Note */}
                <div className="space-y-2">
                  <h3 className="text-base font-bold text-white text-right flex items-center gap-2">
                    <StickyNote className="w-4 h-4" />
                    <span>{language === 'ar' ? 'ملاحظة على الطلب (اختياري)' : 'Order Note (Optional)'}</span>
                  </h3>
                  <textarea
                    value={orderNote}
                    onChange={(e) => setOrderNote(e.target.value)}
                    className="w-full bg-dark border border-primary/40 rounded-lg px-3 py-2 text-white text-right focus:outline-none focus:border-primary resize-none text-sm"
                    rows={2}
                    placeholder={language === 'ar' ? 'اكتب ملاحظة على الطلب (مثل: بدون بصل، بدون طماطم، إلخ)' : 'Write a note on the order (e.g., no onion, no tomato, etc.)'}
                    dir={language === 'ar' ? 'rtl' : 'ltr'}
                  />
                </div>

                {/* 4. Coupons */}
                {Array.isArray(availableCoupons) && availableCoupons.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-base font-bold text-white text-right">
                      {language === 'ar' ? 'كوبونات الخصم المتاحة' : 'Available Coupons'}
                    </h3>
                    <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar coupon-scrollbar">
                      <button
                        type="button"
                        onClick={() => setSelectedCouponId(null)}
                        className={`flex items-center justify-between rounded-xl px-4 py-3 border text-sm ${!selectedCouponId
                          ? 'bg-purple-700 border-purple-400 text-white'
                          : 'bg-gray-800 border-purple-500/40 text-purple-200 hover:bg-gray-700'
                          }`}
                      >
                        <span className="font-bold">
                          {language === 'ar' ? 'بدون كوبون' : 'No coupon'}
                        </span>
                      </button>
                      {availableCoupons.map(coupon => {
                        const expiresAt = coupon.expires_at ? new Date(coupon.expires_at) : null;
                        return (
                          <button
                            key={coupon.id}
                            type="button"
                            onClick={() => setSelectedCouponId(coupon.id)}
                            className={`flex items-center justify-between rounded-xl px-4 py-3 border text-sm ${selectedCouponId === coupon.id
                              ? 'bg-primary border-primary text-white shadow-lg'
                              : 'bg-dark border-primary/40 text-muted hover:bg-dark/80'
                              }`}
                          >
                            <div className="text-right">
                              <p className="font-bold">
                                {language === 'ar'
                                  ? `خصم ${coupon.discount_percent}%`
                                  : `${coupon.discount_percent}% discount`}
                              </p>
                              <p className="text-xs text-muted mt-0.5">
                                {language === 'ar' ? 'تم الحصول عليه من الشفرة السرية' : 'Unlocked via secret code'}
                              </p>
                              {expiresAt && (
                                <p className="text-[11px] text-purple-300 mt-0.5">
                                  {language === 'ar'
                                    ? `صالح حتى ${expiresAt.toLocaleDateString('ar-EG')}`
                                    : `Valid until ${expiresAt.toLocaleDateString('en-US')}`}
                                </p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 5. Payment Method */}
                <div className="space-y-3">
                  <h3 className="text-base font-bold text-white text-right">{t('checkout.paymentMethod')}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('cash')}
                      className={`p-3 rounded-xl border-2 transition-all ${paymentMethod === 'cash'
                        ? 'bg-primary border-primary shadow-lg shadow-primary/50'
                        : 'bg-dark border-primary/30 hover:border-primary'
                        }`}
                    >
                      <Banknote className="w-6 h-6 text-white mx-auto mb-1" />
                      <p className="text-white font-bold text-sm">{t('checkout.cash')}</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentMethod('instant_transfer')}
                      className={`p-3 rounded-xl border-2 transition-all ${paymentMethod === 'instant_transfer'
                        ? 'bg-primary border-primary shadow-lg shadow-primary/50'
                        : 'bg-dark border-primary/30 hover:border-primary'
                        }`}
                    >
                      <CreditCard className="w-6 h-6 text-white mx-auto mb-1" />
                      <p className="text-white font-bold text-sm">{t('checkout.instantTransfer')}</p>
                    </button>
                  </div>

                  {paymentMethod === 'instant_transfer' && instantNumber && (
                    <div className="bg-dark border border-primary/40 rounded-xl p-2 text-center">
                      <p className="text-muted text-xs mb-1">{t('checkout.instantTransferNumber')}</p>
                      <p className="text-xl font-black text-white" dir="ltr">{instantNumber}</p>
                    </div>
                  )}
                </div>

                {/* Totals (items + discount + delivery service) */}
                <div className="bg-dark border border-primary/40 rounded-xl p-3 text-center space-y-2">
                  <p className="text-muted text-sm mb-1">
                    {language === 'ar' ? 'ملخص الحساب' : 'Order Summary'}
                  </p>
                  {!!onStartCartEdit && (
                    <button
                      type="button"
                      onClick={onStartCartEdit}
                      className="mx-auto mb-2 px-3 py-1.5 rounded-lg border border-primary/40 text-primary hover:bg-primary/10 text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>{language === 'ar' ? 'تعديل السلة' : 'Edit Cart'}</span>
                    </button>
                  )}

                  {/* List of ordered items with images */}
                  {Array.isArray(cartItems) && cartItems.length > 0 && (
                    <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-1 text-right mb-2">
                      {cartItems.map(item => {
                        const hasOffer = !!(item.has_offer && item.offer_price);
                        const unitPrice = hasOffer ? (item.offer_price as number) : item.price;
                        const subtotal = unitPrice * item.quantity;
                        return (
                          <div
                            key={item.id}
                            className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 ${item.cart_synced_unavailable ? 'bg-red-900/40 border border-red-500/50' : 'bg-dark/60'}`}
                          >
                            <div className="flex items-center gap-2">
                              {item.image_url ? (
                                <ProgressiveImage
                                  src={item.image_url}
                                  alt={language === 'ar' ? item.name : item.name_en}
                                  preset="thumb"
                                  wrapperClassName="w-8 h-8 shrink-0"
                                  className={`w-full h-full rounded-md object-cover ${item.cart_synced_unavailable ? 'opacity-50 grayscale' : ''}`}
                                />
                              ) : (
                                <div className="w-8 h-8 rounded-md bg-surface flex items-center justify-center text-xs text-muted">
                                  MX
                                </div>
                              )}
                              <div className="flex flex-col items-start">
                                <div className="flex items-center gap-1">
                                  {item.cart_synced_unavailable && (
                                    <span className="text-[10px] text-red-400 font-bold bg-red-950/50 px-1.5 py-0.5 rounded">
                                      {language === 'ar' ? 'غير متوفر' : 'Unavailable'}
                                    </span>
                                  )}
                                  {item.cart_synced_data_changed && !item.cart_synced_unavailable && (
                                    <span className="text-[10px] text-yellow-500 font-bold bg-yellow-950/50 px-1.5 py-0.5 rounded">
                                      {language === 'ar' ? 'تم تحديث البيانات' : 'Updated'}
                                    </span>
                                  )}
                                  <span className="text-xs text-white font-bold line-clamp-1">
                                    {language === 'ar' ? item.name : item.name_en}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[11px]">
                                  <span className="text-muted">× {item.quantity}</span>
                                  <span className={`inline-flex items-center gap-1 ${language === 'ar' ? 'flex-row-reverse' : 'flex-row'}`}>
                                    {hasOffer && (
                                      <span className="text-muted/60 line-through text-[10px] whitespace-nowrap">
                                        {item.price} <span className="text-[10px]">{currencySymbol}</span>
                                      </span>
                                    )}
                                    <span className="text-primary font-black whitespace-nowrap">
                                      {unitPrice} <span className="text-[10px]">{currencySymbol}</span>
                                    </span>
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="text-[11px] text-white font-bold">
                              {subtotal}{' '}
                              <span className="text-[10px]">{currencySymbol}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Items Total */}
                  <div className="text-sm text-right flex items-center justify-between border-b border-primary/20 pb-2 mb-2">
                    <span className="text-white font-bold">
                      {total} {currencySymbol}
                    </span>
                    <span className="text-muted">
                      {language === 'ar' ? 'إجمالي الأصناف' : 'Items total'}
                    </span>
                  </div>

                  {deliveryMethod === 'delivery' && (
                  <div className="text-sm text-right mt-1 flex items-center justify-between">
                    <span className="text-muted">
                      {language === 'ar' ? 'خدمة التوصيل' : 'Delivery service'}
                    </span>
                    <span className="text-white font-bold">
                      {isInDeliveryZone === false
                        ? (language === 'ar' ? 'غير مدعوم' : 'Not supported')
                        : isInDeliveryZone === null
                          ? (language === 'ar' ? 'جاري التحقق…' : 'Checking…')
                          : deliveryFee > 0
                            ? `${deliveryFee} ${currencySymbol}`
                            : language === 'ar'
                              ? 'مجانية'
                              : 'Free'}
                    </span>
                  </div>
                  )}

                  {/* Discount Section moved below Delivery */}
                  {discountAmount > 0 && (
                    <div className="text-sm text-right mt-1 flex items-center justify-between text-green-300">
                      <span className="font-bold">
                        -{discountAmount} {currencySymbol} ({discountPercent}% خصم)
                      </span>
                      <span>{language === 'ar' ? 'كوبون الخصم' : 'Discount Coupon'}</span>
                    </div>
                  )}

                  {selectedServiceInfo && (
                    <div className="text-xs text-right mt-1 text-purple-300">
                      {language === 'ar'
                        ? (deliveryMethod === 'pickup' 
                            ? `سوف يتم الاستلام من فرع: ${selectedServiceInfo.service.name}`
                            : `سوف يتم التوصيل من فرع: ${selectedServiceInfo.service.name}`)
                        : (deliveryMethod === 'pickup'
                            ? `Pickup from branch: ${selectedServiceInfo.service.name}`
                            : `Delivery from branch: ${selectedServiceInfo.service.name}`)}
                    </div>
                  )}

                  {/* Grand total to be paid */}
                  <div className="pt-2 border-t border-primary/30">
                    <p className="text-xs text-muted mb-1">
                      {language === 'ar' ? 'الإجمالي المطلوب' : 'Total to pay'}
                    </p>
                    <p className="text-3xl font-black text-white">
                      {grandTotal}{' '}
                      <span className="text-xl">{currencySymbol}</span>
                    </p>
                  </div>
                </div>
              <div className="pt-2 pb-4">
                <button
                  type="submit"
                  disabled={
                    orderSubmitting ||
                    (deliveryMethod === 'delivery' && isInDeliveryZone !== true) ||
                    (deliveryMethod === 'pickup' && (!pickupCommitmentAccepted || !pickupSlot || (pickupSlot === 'custom' && !pickupCustomConfirmedLabel)))
                  }
                  className={`w-full rounded-2xl py-3 text-lg font-black shadow-lg ${
                    orderSubmitting ||
                    (deliveryMethod === 'delivery' && isInDeliveryZone !== true) ||
                    (deliveryMethod === 'pickup' && (!pickupCommitmentAccepted || !pickupSlot || (pickupSlot === 'custom' && !pickupCustomConfirmedLabel)))
                    ? 'cursor-not-allowed bg-gray-700 text-gray-300'
                    : 'bg-primary text-white'
                    }`}
                >
                  {orderSubmitting
                    ? language === 'ar'
                      ? 'جاري إرسال الطلب…'
                      : 'Sending order…'
                    : deliveryMethod === 'delivery' && isInDeliveryZone !== true
                    ? language === 'ar'
                      ? 'خارج زون التوصيل'
                      : 'Outside delivery zone'
                    : deliveryMethod === 'pickup' && !pickupCommitmentAccepted
                      ? (language === 'ar' ? 'وافق على التعهد أولاً' : 'Accept commitment first')
                    : t('checkout.confirm')}
                </button>
              </div>
              </div>
            </form>
          )}
        </div>
      </div>
  );

  return (
    <>
      {embedded ? (
        <div className="h-full">{sheet}</div>
      ) : (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center pointer-events-none"
          onClick={onClose}
        >
          {sheet}
        </div>
      )}
      {isEditingLocation && mobileMapFullscreen && (
        <MobileMapEditor
          initialLatitude={customerData.latitude}
          initialLongitude={customerData.longitude}
          zones={allZones}
          services={deliveryServices}
          showVisualZones={showDebugMap}
          onConfirm={(data) => {
            const currentLabel = customerData.address_label;
            const currentType = activeAddressType;
            const updatedData = {
              latitude: data.latitude,
              longitude: data.longitude,
              city: data.city,
              area: data.area,
              street: data.street,
              building_number: data.buildingNumber,
              address_label: currentLabel,
              address_type: currentType
            };
            setCustomerData(prev => ({ ...prev, ...updatedData }));
            saveSharedAddress(updatedData);
            setActiveAddressType(currentType);
            setIsEditingLocation(false);
            setMobileMapFullscreen(false);

            // Persist to database immediately to ensure no data loss
            const phone = filterDigits(customerData.phone || '');
            if (phone) {
              void findCustomerIdByPhone(phone).then(async (cid) => {
                if (cid) {
                  const fp = getOrCreateDeviceFingerprint();
                  const fullPayload = {
                    latitude: data.latitude,
                    longitude: data.longitude,
                    city: data.city,
                    area: data.area,
                    street: data.street,
                    building_number: data.buildingNumber as any,
                    apartment: customerData.apartment || null,
                    floor: customerData.floor || null,
                    landmark: customerData.landmark || null,
                    house_name: customerData.house_name || null,
                    company_name: customerData.company_name || null,
                    address_label: currentLabel || null,
                    address_type: currentType || 'apartment',
                    device_fingerprint: fp,
                    updated_at: new Date().toISOString()
                  };

                  // Update main customer address record
                  await supabase.from('customers').update(fullPayload).eq('id', cid);

                  // If we are on a named saved address tab, update that as well
                  if (currentLabel && currentLabel.trim()) {
                    await supabase.from('customer_saved_addresses').update({
                      latitude: data.latitude,
                      longitude: data.longitude,
                      city: data.city,
                      area: data.area,
                      street: data.street,
                      building_number: data.buildingNumber as any,
                      apartment: customerData.apartment || null,
                      floor: customerData.floor || null,
                      landmark: customerData.landmark || null,
                      house_name: customerData.house_name || null,
                      company_name: customerData.company_name || null,
                      address_type: currentType || 'apartment'
                    }).eq('customer_id', cid).eq('label', currentLabel);
                    
                    // Refresh server address tabs to keep UI in sync
                    void loadServerAddressTabs(cid);
                  }
                }
              });
            }
          }}
          onCancel={() => {
            if (locationBackupRef.current) {
              setCustomerData(locationBackupRef.current);
            }
            setIsEditingLocation(false);
            setMobileMapFullscreen(false);
          }}
        />
      )}

      <TimePicker
        isOpen={pickupCustomPickerOpen}
        onClose={() => setPickupCustomPickerOpen(false)}
        onConfirm={(h, m, ampm) => {
          setPickupCustomHour(h);
          setPickupCustomMinute(m);
          setPickupCustomAmPm(ampm);
          
          const now = new Date();
          const hour24 = (() => {
            const val = h % 12;
            return ampm === 'PM' ? val + 12 : val;
          })();
          const target = new Date();
          target.setHours(hour24, m, 0, 0);
          const isTomorrow = target.getTime() <= now.getTime();
          
          const dayLabel = language === 'ar' 
            ? (isTomorrow ? 'غداً' : 'اليوم') 
            : (isTomorrow ? 'Tomorrow' : 'Today');

          const label =
            language === 'ar'
              ? `موعد الاستلام: ${dayLabel} - ${h}:${m.toString().padStart(2, '0')} ${ampm === 'PM' ? 'م' : 'ص'}`
              : `Pickup time: ${dayLabel} - ${h}:${m.toString().padStart(2, '0')} ${ampm}`;
          
          setPickupCustomConfirmedLabel(label);
          setPickupSlot('custom'); // Update actual slot only on confirmation
          setPickupCommitmentAccepted(false);
          setPickupCustomPickerOpen(false);
        }}
        initialHour={pickupCustomHour}
        initialMinute={pickupCustomMinute}
        initialAmPm={pickupCustomAmPm}
        language={language}
      />

      <style>{`
        @keyframes checkoutSlideUp {
          0% {
            transform: translateY(100%);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .checkout-slide-up {
          animation: checkoutSlideUp 0.3s ease-out;
        }
        @keyframes profileMobilePush {
          0% {
            transform: translateX(100%);
          }
          100% {
            transform: translateX(0);
          }
        }
        .profile-mobile-push {
          animation: profileMobilePush 0.22s ease-out both;
        }
        .custom-scrollbar {
          scrollbar-width: thin;
          scrollbar-color: rgba(139, 92, 246, 0.65) rgba(22, 17, 43, 0.95);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(22, 17, 43, 0.85);
          border-radius: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, rgba(139, 92, 246, 0.75), rgba(124, 58, 237, 0.55));
          border-radius: 8px;
          border: 2px solid rgba(22, 17, 43, 0.85);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, rgba(167, 139, 250, 0.85), rgba(139, 92, 246, 0.7));
        }
        .coupon-scrollbar::-webkit-scrollbar-track {
          background: #16112b;
        }
        .coupon-scrollbar::-webkit-scrollbar-thumb {
          border-color: #16112b;
        }
        .img-fade {
          opacity: 0;
          transition: opacity 260ms ease-in;
        }
        .img-fade.is-loaded {
          opacity: 1;
        }
      `}</style>

      {typeof document !== 'undefined' &&
        addressNamePopoverPos &&
        (renameSavedTarget || (isCreatingCustomAddress && pendingAddressType && !renameSavedTarget)) &&
        createPortal(
          <AddressNamePopover
            mode={renameSavedTarget ? 'rename' : 'create'}
            language={language}
            value={renameSavedTarget ? renameSavedInput : newAddressName}
            onChange={(nextValue) => {
              if (renameSavedTarget) {
                setRenameSavedInput(nextValue);
              } else {
                setNewAddressName(nextValue);
              }
            }}
            onSave={() => {
              if (renameSavedTarget) {
                void renameSavedAddressTab(renameSavedTarget, renameSavedInput);
                return;
              }
              if (pendingAddressType) {
                void addTypedAddressTab(pendingAddressType, newAddressName);
              }
            }}
            onCancel={() => {
              if (renameSavedTarget) {
                setRenameSavedTarget(null);
                setRenameSavedInput('');
              } else {
                setIsCreatingCustomAddress(false);
                setPendingAddressType(null);
                setNewAddressName('');
              }
              setAddressNamePopoverPos(null);
            }}
            position={addressNamePopoverPos}
          />,
          document.body
        )}

      {typeof document !== 'undefined' &&
        !isFinePointerDesktop &&
        mobileSavedTabSheet &&
        mobileSavedTabMenuPos &&
        createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[310] bg-black/40 border-0 cursor-default"
              aria-label={language === 'ar' ? 'إغلاق' : 'Close'}
              onClick={() => {
                setMobileSavedTabSheet(null);
                setMobileSavedTabMenuPos(null);
              }}
            />
            <div
              data-mobile-saved-tab-menu
              data-address-name-trigger
              role="dialog"
              aria-modal="true"
              aria-label={mobileSavedTabSheet.label}
              className="fixed z-[320] rounded-lg border border-primary/50 bg-[hsl(var(--color-surface))] shadow-xl flex overflow-hidden pointer-events-auto"
              style={{
                top: mobileSavedTabMenuPos.top,
                left: mobileSavedTabMenuPos.left,
                transform: 'translateX(-50%)',
                width: mobileSavedTabMenuPos.width,
                minWidth: '7rem',
              }}
            >
              <button
                type="button"
                data-address-name-trigger
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const t = mobileSavedTabSheet;
                  setMobileSavedTabSheet(null);
                  setMobileSavedTabMenuPos(null);
                  setIsCreatingCustomAddress(false);
                  setPendingAddressType(null);
                  setNewAddressName('');
                  setRenameSavedTarget(t);
                  setRenameSavedInput(t.label);
                }}
                className="flex-1 py-2 flex items-center justify-center text-primary active:bg-primary/15 transition-colors"
                title={language === 'ar' ? 'تعديل الاسم' : 'Rename'}
              >
                <Pencil className="w-4 h-4" />
              </button>
              <div className="w-px bg-primary/25 self-stretch my-1" />
              <button
                type="button"
                data-address-name-trigger
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void removeSavedAddressTab(mobileSavedTabSheet);
                  setMobileSavedTabMenuPos(null);
                }}
                className="flex-1 py-2 flex items-center justify-center text-red-300 active:bg-red-500/15 transition-colors"
                title={language === 'ar' ? 'حذف العنوان' : 'Delete address'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </>,
          document.body
        )}

    </>
  );
}
