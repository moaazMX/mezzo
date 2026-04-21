import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Package, Clock, Truck, CheckCircle, XCircle, AlertTriangle, StickyNote, Globe, Moon, Sun, Edit2, Save, Archive, TicketPercent, MoreVertical, MessageSquare, Lock, Plus, ChevronRight, Building, Home, Briefcase } from 'lucide-react';
import { supabase, Order, OrderItem, CustomerNote, Customer, DeviceCoupon } from '../lib/supabase';
import { getOrCreateDeviceFingerprint } from '../lib/deviceFingerprint';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { generateEasyRecoveryCode, hashPhonePassword, hashRecoveryCode } from '../lib/phonePassword';
import { isTouchPhoneChrome } from '../lib/viewportUi';
import InteractiveMap from './InteractiveMap';

interface CustomerProfileProps {
  isOpen: boolean;
  onClose: () => void;
  customerPhone: string;
  highlightOrderId?: string | null;
  initialTab?: 'settings' | 'orders';
  onMobileSubflowChange?: (isActive: boolean) => void;
}

interface OrderWithDetails extends Order {
  items: OrderItem[];
  notes: CustomerNote[];
  customer?: Customer | null;
  isArchived?: boolean;
}

type ProfileSavedAddressTab = {
  id: string;
  label: string;
  type: 'apartment' | 'house' | 'workplace';
  data: ProfileAddressDraftData;
};

type ProfileAddressDraftData = {
  street: string;
  area: string;
  city: string;
  building_number: string;
  floor: string;
  apartment: string;
  house_name: string;
  company_name: string;
  landmark: string;
  latitude?: number;
  longitude?: number;
};

export default function CustomerProfile({ isOpen, onClose, customerPhone, highlightOrderId, initialTab = 'settings', onMobileSubflowChange }: CustomerProfileProps) {
  const { language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [editingNoteOrderId, setEditingNoteOrderId] = useState<string | null>(null);
  const [editedNote, setEditedNote] = useState('');
  const [activeTab, setActiveTab] = useState<'settings' | 'orders'>(initialTab);
  const [customerCoupons, setCustomerCoupons] = useState<DeviceCoupon[]>([]);
  const [showCouponList, setShowCouponList] = useState(false);
  const [couponDetailsCode, setCouponDetailsCode] = useState<string | null>(null);
  const [showActionMenu, setShowActionMenu] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left?: number; right?: number }>({ top: 80, left: 16 });
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);

  function normalizeProfileAddressLabelKey(label: string): string {
    return label.trim().toLowerCase();
  }

  function getReservedProfileAddressLabelKeys(): Set<string> {
    const raw = ['شقة', 'منزل', 'مكان عمل', 'apartment', 'house', 'workplace'];
    return new Set(raw.map(normalizeProfileAddressLabelKey));
  }

  function allocateUniqueProfileAddressLabel(rawLabel: string, savedTabs: ProfileSavedAddressTab[]): string {
    const base = rawLabel.trim();
    if (!base) return base;

    const taken = new Set<string>();
    for (const t of savedTabs) {
      taken.add(normalizeProfileAddressLabelKey(t.label));
    }
    for (const k of getReservedProfileAddressLabelKeys()) {
      taken.add(k);
    }

    let candidate = base;
    let n = 2;
    while (taken.has(normalizeProfileAddressLabelKey(candidate))) {
      candidate = `${base} ${n}`;
      n += 1;
    }
    return candidate;
  }

  const [profileCustomerId, setProfileCustomerId] = useState<string | null>(null);
  const [profileCustomer, setProfileCustomer] = useState<Partial<Customer> | null>(null);
  const [settingsView, setSettingsView] = useState<'main' | 'account' | 'data' | 'addresses' | 'map'>('main');
  const [profileSaving, setProfileSaving] = useState(false);
  const [showSecondaryProfilePhone, setShowSecondaryProfilePhone] = useState(false);
  const [profileAddressType, setProfileAddressType] = useState<'apartment' | 'house' | 'workplace'>('apartment');
  const [profileSavedAddressTabs, setProfileSavedAddressTabs] = useState<ProfileSavedAddressTab[]>([]);
  const [activeProfileAddressTabId, setActiveProfileAddressTabId] = useState('builtin-apartment');
  const [, setProfileAddressTabsData] = useState<Record<string, ProfileAddressDraftData>>({});
  const [showProfileCustomAddressInput, setShowProfileCustomAddressInput] = useState(false);
  const [newProfileAddressName, setNewProfileAddressName] = useState('');
  const [desktopAddressMapOverlayOpen, setDesktopAddressMapOverlayOpen] = useState(false);
  const [profileDraft, setProfileDraft] = useState({
    name: '',
    phone: '',
    secondary_phone: '',
    street: '',
    area: '',
    city: '',
    building_number: '',
    floor: '',
    apartment: '',
    house_name: '',
    company_name: '',
    landmark: '',
    latitude: undefined as number | undefined,
    longitude: undefined as number | undefined
  });
  const [hasPhonePassword, setHasPhonePassword] = useState(false);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [secPwd1, setSecPwd1] = useState('');
  const [secPwd2, setSecPwd2] = useState('');
  const [secRecoveryInput, setSecRecoveryInput] = useState('');
  const [secErr, setSecErr] = useState<string | null>(null);
  const [secBusy, setSecBusy] = useState(false);
  const [secNewRecoveryShown, setSecNewRecoveryShown] = useState<string | null>(null);
  const [securityDetailsOpen, setSecurityDetailsOpen] = useState(false);
  const [phoneChrome, setPhoneChrome] = useState(() =>
    typeof window !== 'undefined' ? isTouchPhoneChrome() : false
  );

  const [mobileProfileTabSheet, setMobileProfileTabSheet] = useState<ProfileSavedAddressTab | null>(null);
  const [mobileProfileTabMenuPos, setMobileProfileTabMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [renameProfileTabTarget, setRenameProfileTabTarget] = useState<ProfileSavedAddressTab | null>(null);
  const [renameProfileTabInput, setRenameProfileTabInput] = useState('');
  const profileTabLongPressTimer = useRef<number | null>(null);
  const profileTabLongPressConsumed = useRef(false);
  const isFinePointerDesktop = typeof window !== 'undefined'
    ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
    : true;

  const syncPhoneChrome = useCallback(() => {
    setPhoneChrome(isTouchPhoneChrome());
  }, []);

  useEffect(() => {
    syncPhoneChrome();
    window.addEventListener('resize', syncPhoneChrome);
    const mq = window.matchMedia('(pointer: coarse)');
    mq.addEventListener('change', syncPhoneChrome);
    return () => {
      window.removeEventListener('resize', syncPhoneChrome);
      mq.removeEventListener('change', syncPhoneChrome);
    };
  }, [syncPhoneChrome]);

  const clearProfileTabLongPressTimer = () => {
    if (profileTabLongPressTimer.current) {
      window.clearTimeout(profileTabLongPressTimer.current);
      profileTabLongPressTimer.current = null;
    }
  };

  const onProfileTabTouchStart = (tab: ProfileSavedAddressTab) => {
    if (isFinePointerDesktop) return;
    profileTabLongPressConsumed.current = false;
    clearProfileTabLongPressTimer();
    profileTabLongPressTimer.current = window.setTimeout(() => {
      profileTabLongPressConsumed.current = true;
      setMobileProfileTabSheet(tab);
    }, 550);
  };

  const onProfileTabTouchEnd = () => {
    clearProfileTabLongPressTimer();
  };

  useEffect(() => {
    return () => {
      if (profileTabLongPressTimer.current) window.clearTimeout(profileTabLongPressTimer.current);
    };
  }, []);

  useEffect(() => {
    if (isFinePointerDesktop && mobileProfileTabSheet) {
      setMobileProfileTabSheet(null);
      setMobileProfileTabMenuPos(null);
    }
  }, [isFinePointerDesktop, mobileProfileTabSheet]);

  const removeProfileAddressTab = (tab: ProfileSavedAddressTab) => {
    setMobileProfileTabSheet(null);
    setMobileProfileTabMenuPos(null);
    setProfileSavedAddressTabs((prev) => prev.filter((t) => t.id !== tab.id));
    setProfileAddressTabsData((prev) => {
      const next = { ...prev };
      delete next[tab.id];
      return next;
    });
    if (activeProfileAddressTabId === tab.id) {
      setActiveProfileAddressTabId('builtin-apartment');
      setProfileAddressType('apartment');
    }
  };

  const renameProfileAddressTab = (tab: ProfileSavedAddressTab, rawLabel: string) => {
    const trimmed = rawLabel.trim();
    if (!trimmed) return;
    const others = profileSavedAddressTabs.filter((t) => t.id !== tab.id);
    const newLabel = allocateUniqueProfileAddressLabel(trimmed, others);
    if (newLabel === tab.label) {
      setRenameProfileTabTarget(null);
      setRenameProfileTabInput('');
      return;
    }
    setProfileSavedAddressTabs((prev) =>
      prev.map((t) => (t.id === tab.id ? { ...t, label: newLabel } : t))
    );
    setRenameProfileTabTarget(null);
    setRenameProfileTabInput('');
  };

  useEffect(() => {
    if (!mobileProfileTabSheet) {
      setMobileProfileTabMenuPos(null);
      return;
    }
    const el = document.querySelector(`[data-profile-tab-anchor="${mobileProfileTabSheet.id}"]`);
    if (!el || !(el instanceof HTMLElement)) return;
    const updatePos = () => {
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const margin = 12;
      const width = Math.max(r.width, 112);
      let leftPx = r.left + r.width / 2;
      const half = width / 2;
      leftPx = Math.max(half + margin, Math.min(leftPx, vw - half - margin));
      setMobileProfileTabMenuPos({ top: r.bottom + 8, left: leftPx, width });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    return () => window.removeEventListener('resize', updatePos);
  }, [mobileProfileTabSheet, profileSavedAddressTabs]);

  // Sync highlighting and handle timeout
  useEffect(() => {
    if (highlightOrderId) {
      setActiveHighlightId(highlightOrderId);
      const timer = setTimeout(() => {
        setActiveHighlightId(null);
      }, 2000); // Stop glowing after 2 seconds
      return () => clearTimeout(timer);
    }
  }, [highlightOrderId]);

  // Anchor origin to profile button for desktop open animation.
  useEffect(() => {
    if (!isOpen || phoneChrome) return;
    const profileButton = document.querySelector('[data-profile-button]') as HTMLElement;
    if (profileButton) {
      const rect = profileButton.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 8,
        left: rect.left
      });
    }
  }, [isOpen, phoneChrome]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setSettingsView('main');
      fetchOrders();
    }
  }, [isOpen, customerPhone, initialTab]);

  useEffect(() => {
    onMobileSubflowChange?.(!!(isOpen && phoneChrome && activeTab === 'settings' && settingsView !== 'main'));
  }, [onMobileSubflowChange, isOpen, phoneChrome, activeTab, settingsView]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) return;
    const old = meta.content;
    if (phoneChrome && settingsView === 'map') {
      meta.content = '#7c3aed';
    }
    return () => {
      meta.content = old;
    };
  }, [phoneChrome, settingsView]);

  // Prevent body scroll while profile is open.
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Keep profile button anchor updated for desktop transform-origin.
  useEffect(() => {
    if (!isOpen || phoneChrome) return;

    const updatePosition = () => {
      const profileButton = document.querySelector('[data-profile-button]') as HTMLElement;
      if (profileButton) {
        const rect = profileButton.getBoundingClientRect();
        // For RTL (Arabic), position from right
        if (language === 'ar') {
          setMenuPosition({
            top: rect.bottom + 8, // 8px gap below button
            left: undefined,
            right: window.innerWidth - rect.right
          });
        } else {
          setMenuPosition({
            top: rect.bottom + 8,
            left: rect.left,
            right: undefined
          });
        }
      }
    };

    updatePosition();
    // Update on scroll to follow the button
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, language, phoneChrome]);

  // Handle jumping to highlighted order
  useEffect(() => {
    if (isOpen && highlightOrderId && orders.length > 0) {
      setActiveTab('orders');
      setTimeout(() => {
        const element = document.getElementById(`order-${highlightOrderId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.classList.add('order-highlight-glow');
          setTimeout(() => {
            element.classList.remove('order-highlight-glow');
          }, 3000);
        }
      }, 500);
    }
  }, [isOpen, highlightOrderId, orders]);

  useEffect(() => {
    if (!isOpen) return;

    const fingerprint = getOrCreateDeviceFingerprint();
    const channelId = customerPhone ? `customer-orders-${customerPhone}` : `customer-orders-${fingerprint}`;

    const ordersChannel = supabase
      .channel(channelId)
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders'
        },
        () => {
          fetchOrders();
        }
      )
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_items'
        },
        () => {
          fetchOrders();
        }
      )
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customer_notes'
        },
        () => {
          fetchOrders();
        }
      )
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'archive_orders'
        },
        () => {
          fetchOrders();
        }
      )
      .subscribe();

    return () => {
      ordersChannel.unsubscribe();
    };
  }, [isOpen, customerPhone]);

  const fetchOrders = async () => {
    setLoading(true);
    setCustomerCoupons([]);

    try {
      // 0) حاول إيجاد المعرف في التخزين المحلي
      let customerId: string | null = localStorage.getItem('customer_id');

      // 1) حاول إيجاد العميل برقم الهاتف (fallback)
      if (customerPhone) {
        const { data: customerByPhone, error: phoneErr } = await supabase
          .from('customers')
          .select('id')
          .eq('phone', customerPhone)
          .maybeSingle();

        if (phoneErr) console.error("fetchOrders: error fetching by phone", phoneErr);

        if (customerByPhone?.id) {
          customerId = customerByPhone.id;
        }
      }

      if (!customerId) {
        // 2) في حال عدم وجود سجل برقم الهاتف (عميل جديد أو رقم تغيّر)،
        //    استخدم device_fingerprint لربط الطلبات بنفس الجهاز.
        try {
          const fingerprint = getOrCreateDeviceFingerprint();
          if (fingerprint) {
            const { data: customerByDevice } = await supabase
              .from('customers')
              .select('id')
              .eq('device_fingerprint', fingerprint)
              .maybeSingle();

            if (customerByDevice?.id) {
              customerId = customerByDevice.id;
            }
          }
        } catch (fpError) {
          console.error("fetchOrders: error with fingerprint", fpError);
        }
      }

      // 3) Fetch coupons linked to the currently active phone/account only
      try {
        if (!customerId) {
          setCustomerCoupons([]);
        } else {
          const [byCustomer, byPhone] = await Promise.all([
            supabase
              .from('device_coupons')
              .select('*')
              .eq('customer_id', customerId)
              .order('created_at', { ascending: false }),
            customerPhone
              ? supabase
                  .from('device_coupons')
                  .select('*')
                  .eq('customer_phone', customerPhone)
                  .order('created_at', { ascending: false })
              : Promise.resolve({ data: [], error: null } as any)
          ]);
          const map = new Map<string, any>();
          [...(byCustomer.data || []), ...(byPhone.data || [])].forEach((c: any) => map.set(c.id, c));
          const now = new Date();
          const activeCoupons = Array.from(map.values()).filter((c: any) =>
            !c.is_disabled && (!c.expires_at || new Date(c.expires_at) > now)
          );
          setCustomerCoupons(activeCoupons);
        }
      } catch (e) {
        console.error('Error loading coupons for profile:', e);
      }

      if (!customerId) {
        setOrders([]);
        setProfileCustomerId(null);
        setProfileCustomer(null);
        setProfileDraft((prev) => ({ ...prev, phone: customerPhone || '' }));
        setLoading(false);
        return;
      }

      setProfileCustomerId(customerId);
      try {
        const { data: customerRow } = await supabase
          .from('customers')
          .select('*')
          .eq('id', customerId)
          .maybeSingle();
        if (customerRow) {
          const normalized = customerRow as Customer;
          setProfileCustomer(normalized);
          setProfileDraft({
            name: normalized.name || '',
            phone: normalized.phone || customerPhone || '',
            secondary_phone: (normalized as any).secondary_phone || '',
            street: normalized.street || '',
            area: normalized.area || '',
            city: normalized.city || '',
            building_number: normalized.building_number || '',
            floor: normalized.floor || '',
            apartment: normalized.apartment || '',
            house_name: normalized.house_name || '',
            company_name: normalized.company_name || '',
            landmark: normalized.landmark || '',
            latitude: typeof normalized.latitude === 'number' ? normalized.latitude : undefined,
            longitude: typeof normalized.longitude === 'number' ? normalized.longitude : undefined
          });
          const initialAddressData: ProfileAddressDraftData = {
            street: normalized.street || '',
            area: normalized.area || '',
            city: normalized.city || '',
            building_number: normalized.building_number || '',
            floor: normalized.floor || '',
            apartment: normalized.apartment || '',
            house_name: normalized.house_name || '',
            company_name: normalized.company_name || '',
            landmark: normalized.landmark || '',
            latitude: typeof normalized.latitude === 'number' ? normalized.latitude : undefined,
            longitude: typeof normalized.longitude === 'number' ? normalized.longitude : undefined
          };
          const normalizedAddressType = (normalized as any).address_type;
          const initialAddressType = (normalizedAddressType === 'house' || normalizedAddressType === 'workplace')
            ? normalizedAddressType
            : 'apartment';
          setProfileAddressTabsData({
            'builtin-apartment': initialAddressData,
            'builtin-house': initialAddressData,
            'builtin-workplace': initialAddressData
          });
          setActiveProfileAddressTabId(`builtin-${initialAddressType}`);
          setProfileAddressType(initialAddressType);
          setShowSecondaryProfilePhone(!!(normalized as any).secondary_phone);
        } else {
          setProfileCustomer(null);
          setProfileDraft({
            name: '',
            phone: customerPhone || '',
            secondary_phone: '',
            street: '',
            area: '',
            city: '',
            building_number: '',
            floor: '',
            apartment: '',
            house_name: '',
            company_name: '',
            landmark: '',
            latitude: undefined,
            longitude: undefined
          });
          const emptyDraft: ProfileAddressDraftData = {
            street: '', area: '', city: '', building_number: '', floor: '', apartment: '', house_name: '', company_name: '', landmark: '', latitude: undefined, longitude: undefined
          };
          setProfileAddressTabsData({
            'builtin-apartment': emptyDraft,
            'builtin-house': emptyDraft,
            'builtin-workplace': emptyDraft
          });
          setProfileSavedAddressTabs([]);
        }
      } catch (e) {
        console.error('Could not load customer profile row:', e);
      }
      // Load security flags (password/recovery exist)
      try {
        setSecurityLoading(true);
        const { data: secRow } = await supabase
          .from('customers')
          .select('phone_password_hash')
          .eq('id', customerId)
          .maybeSingle();
        const enabled = !!(secRow as any)?.phone_password_hash;
        setHasPhonePassword(enabled);
        if (!enabled) setSecurityDetailsOpen(false);
      } finally {
        setSecurityLoading(false);
      }

      // Fetch active orders
      const { data: ordersData, error: ordersErr } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });

      if (ordersErr) console.error("fetchOrders: error fetching active orders", ordersErr);

      // Fetch archived orders
      const { data: archivedOrdersData, error: archErr } = await supabase
        .from('archive_orders')
        .select('*')
        .eq('customer_id', customerId)
        .order('archived_at', { ascending: false });

      if (archErr) console.error("fetchOrders: error fetching archive orders", archErr);

      const allOrders: OrderWithDetails[] = [];

      // Process active orders
      if (ordersData) {
        const ordersWithDetails = await Promise.all(
          ordersData.map(async (order) => {
            const { data: items } = await supabase
              .from('order_items')
              .select('*')
              .eq('order_id', order.id);

            const { data: notes } = await supabase
              .from('customer_notes')
              .select('*')
              .eq('order_id', order.id);

            return {
              ...order,
              items: items || [],
              notes: (notes || []).filter((note) => note.created_by === 'customer' || note.is_public !== false),
              isArchived: false
            } as OrderWithDetails;
          })
        );
        allOrders.push(...ordersWithDetails);
      }

      // Process archived orders
      if (archivedOrdersData) {
        const archivedWithDetails = await Promise.all(
          archivedOrdersData.map(async (order) => {
            const { data: items } = await supabase
              .from('archive_order_items')
              .select('*')
              .eq('archive_order_id', order.id);

            const { data: notes } = await supabase
              .from('archive_customer_notes')
              .select('*')
              .eq('archive_order_id', order.id);

            let customer = null;
            if (order.customer_id) {
              const { data: customerFromDb } = await supabase
                .from('customers')
                .select('*')
                .eq('id', order.customer_id)
                .maybeSingle();

              if (customerFromDb) {
                customer = customerFromDb;
              } else if (order.customer_name || order.customer_phone) {
                customer = {
                  id: order.customer_id || '',
                  name: order.customer_name || '',
                  phone: order.customer_phone || '',
                  street: order.customer_street || '',
                  area: order.customer_area || '',
                  city: order.customer_city || '',
                  updated_at: order.original_updated_at || '',
                  latitude: undefined,
                  longitude: undefined
                } as Customer;
              }
            }

            return {
              ...order,
              id: order.id,
              items: items || [],
              notes: (notes || []).filter((note) => note.created_by === 'customer' || note.is_public !== false),
              customer: customer,
              isArchived: true,
              created_at: order.original_created_at || order.created_at
            };
          })
        );
        allOrders.push(...archivedWithDetails);
      }

      // Sort all orders by created_at (most recent first)
      allOrders.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateB - dateA;
      });

      setOrders(allOrders);

    } catch (err) {
      console.error("fetchOrders: unexpected unhandled error", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!cancelReason.trim()) {
      alert(language === 'ar' ? 'الرجاء إدخال سبب الإلغاء' : 'Please enter cancellation reason');
      return;
    }

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    if (order.status === 'on_way' || order.status === 'arrived') {
      const confirm = window.confirm(
        'تنبيه: إلغاء الطلب الآن سيسبب خسائر على الشركة. هل أنت متأكد من الإلغاء؟'
      );
      if (!confirm) {
        return;
      }
    }

    await supabase
      .from('orders')
      .update({
        status: 'cancellation_pending',
        cancellation_reason: cancelReason,
        cancelled_by: 'customer',
        cancellation_stage: order.status
      })
      .eq('id', orderId);

    setCancelOrderId(null);
    setCancelReason('');
    fetchOrders();
  };

  const saveProfileData = async () => {
    const phone = profileDraft.phone.trim();
    const name = profileDraft.name.trim();
    if (!phone || !name) return;

    setProfileSaving(true);
    try {
      const payload: any = {
        name,
        phone,
        secondary_phone: profileDraft.secondary_phone || null,
        street: profileDraft.street || '',
        area: profileDraft.area || '',
        city: profileDraft.city || '',
        building_number: profileDraft.building_number || null,
        floor: profileDraft.floor || null,
        apartment: profileDraft.apartment || null,
        house_name: profileDraft.house_name || null,
        company_name: profileDraft.company_name || null,
        landmark: profileDraft.landmark || null,
        latitude: typeof profileDraft.latitude === 'number' ? profileDraft.latitude : null,
        longitude: typeof profileDraft.longitude === 'number' ? profileDraft.longitude : null,
        updated_at: new Date().toISOString()
      };

      if (profileCustomerId) {
        const { data, error } = await supabase
          .from('customers')
          .update(payload)
          .eq('id', profileCustomerId)
          .select('*')
          .single();
        if (error) throw error;
        if (data) setProfileCustomer(data as Customer);
      } else {
        const { data, error } = await supabase
          .from('customers')
          .upsert([payload], { onConflict: 'phone' })
          .select('*')
          .single();
        if (error) throw error;
        if (data?.id) {
          setProfileCustomerId(data.id);
          localStorage.setItem('customer_id', data.id);
        }
        if (data) setProfileCustomer(data as Customer);
      }

      localStorage.setItem('customer_phone', phone);
      localStorage.setItem('customer_data', JSON.stringify({
        ...profileDraft,
        phone,
        name
      }));
      setSettingsView('account');
      
      const { data: updatedCustomer } = await supabase.from('customers').select('*').eq('phone', phone).single();
      if (updatedCustomer) {
        setProfileCustomer(updatedCustomer as Customer);
      }
      await fetchOrders();
    } catch (e) {
      console.error('Failed to save profile data:', e);
    } finally {
      setProfileSaving(false);
    }
  };

  const displayName = (profileCustomer?.name || '').trim();
  const profileInitial = displayName ? displayName.charAt(0).toUpperCase() : '?';
  const hasOrderInfo = !!(displayName || (profileCustomer?.phone || '').trim());
  const hasAddressSummary = !!((profileCustomer?.street || '').trim() || (profileCustomer?.area || '').trim() || (profileCustomer?.city || '').trim() || (typeof profileCustomer?.latitude === 'number' && typeof profileCustomer?.longitude === 'number'));
  const mapLat = typeof profileDraft.latitude === 'number' ? profileDraft.latitude : profileCustomer?.latitude;
  const mapLng = typeof profileDraft.longitude === 'number' ? profileDraft.longitude : profileCustomer?.longitude;
  const profileAddressTypeLabel = profileAddressType === 'house'
    ? (language === 'ar' ? 'منزل' : 'House')
    : profileAddressType === 'workplace'
      ? (language === 'ar' ? 'مكان عمل' : 'Workplace')
      : (language === 'ar' ? 'شقة' : 'Apartment');

  const pullAddressDraftFromProfile = useCallback((): ProfileAddressDraftData => ({
    street: profileDraft.street || '',
    area: profileDraft.area || '',
    city: profileDraft.city || '',
    building_number: profileDraft.building_number || '',
    floor: profileDraft.floor || '',
    apartment: profileDraft.apartment || '',
    house_name: profileDraft.house_name || '',
    company_name: profileDraft.company_name || '',
    landmark: profileDraft.landmark || '',
    latitude: profileDraft.latitude,
    longitude: profileDraft.longitude
  }), [profileDraft]);

  const applyAddressDraftToProfile = useCallback((data: Partial<ProfileAddressDraftData>) => {
    setProfileDraft((prev) => ({
      ...prev,
      street: data.street ?? prev.street,
      area: data.area ?? prev.area,
      city: data.city ?? prev.city,
      building_number: data.building_number ?? prev.building_number,
      floor: data.floor ?? prev.floor,
      apartment: data.apartment ?? prev.apartment,
      house_name: data.house_name ?? prev.house_name,
      company_name: data.company_name ?? prev.company_name,
      landmark: data.landmark ?? prev.landmark,
      latitude: data.latitude ?? prev.latitude,
      longitude: data.longitude ?? prev.longitude
    }));
  }, []);

  const addProfileCustomAddressTab = () => {
    const raw = newProfileAddressName.trim();
    if (!raw) return;
    const label = allocateUniqueProfileAddressLabel(raw, profileSavedAddressTabs);
    const tabId = `profile-tab-${Date.now()}`;
    const currentData = pullAddressDraftFromProfile();
    setProfileSavedAddressTabs((prev) => [...prev, { id: tabId, label, type: profileAddressType, data: currentData }]);
    setProfileAddressTabsData((prev) => ({ ...prev, [tabId]: currentData }));
    setActiveProfileAddressTabId(tabId);
    setShowProfileCustomAddressInput(false);
    setNewProfileAddressName('');
  };

  const switchAddressTab = useCallback((nextTabId: string, nextType: 'apartment' | 'house' | 'workplace') => {
    const currentData = pullAddressDraftFromProfile();
    setProfileAddressTabsData((prev) => {
      const merged = { ...prev, [activeProfileAddressTabId]: currentData };
      const customTabData = profileSavedAddressTabs.find((t) => t.id === nextTabId)?.data;
      const target = merged[nextTabId] || customTabData;
      if (target) applyAddressDraftToProfile(target);
      setProfileAddressType(nextType);
      setActiveProfileAddressTabId(nextTabId);
      return merged;
    });
  }, [activeProfileAddressTabId, applyAddressDraftToProfile, pullAddressDraftFromProfile, profileSavedAddressTabs]);

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'under_review':
        return { icon: Clock, text: language === 'ar' ? 'قيد المعاينة' : 'Under Review', color: 'text-yellow-400', glow: 'shadow-[0_0_10px_rgba(250,204,21,0.4)]' };
      case 'preparing':
        return { icon: Package, text: language === 'ar' ? 'قيد التحضير' : 'Preparing', color: 'text-blue-400', glow: 'shadow-[0_0_10px_rgba(96,165,250,0.4)]' };
      case 'on_way':
        return { icon: Truck, text: language === 'ar' ? 'في الطريق' : 'On the Way', color: 'text-purple-400', glow: 'shadow-[0_0_10px_rgba(168,85,247,0.4)]' };
      case 'arrived':
        return { icon: AlertTriangle, text: language === 'ar' ? 'وصل الآن' : 'Arrived', color: 'text-orange-400', glow: 'shadow-[0_0_10px_rgba(251,146,60,0.4)]' };
      case 'completed':
        return { icon: CheckCircle, text: language === 'ar' ? 'تم التسليم والدفع' : 'Completed', color: 'text-green-400', glow: '' };
      case 'cancelled':
        return { icon: XCircle, text: language === 'ar' ? 'ملغي' : 'Cancelled', color: 'text-red-400', glow: '' };
      case 'cancellation_pending':
        return { icon: Clock, text: language === 'ar' ? 'إلغاء قيد المعاينة' : 'Cancellation Pending', color: 'text-yellow-400', glow: 'shadow-[0_0_10px_rgba(250,204,21,0.4)]' };
      default:
        return { icon: Package, text: status, color: 'text-gray-400', glow: '' };
    }
  };

  const canCancel = (status: string) => {
    return status === 'under_review' || status === 'preparing' || status === 'on_way' || status === 'arrived';
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex justify-center ${
        phoneChrome
          ? 'items-stretch'
          : 'items-center'
      }`}
      onClick={onClose}
    >
      <div
        className={`pointer-events-auto flex flex-col overflow-hidden shadow-2xl ${
          phoneChrome
            ? 'profile-dropdown-phone h-full w-full max-w-none flex-1 rounded-none'
            : `profile-dropdown-desktop relative h-auto max-h-[min(88vh,860px)] w-full ${
                activeTab === 'orders' ? 'max-w-5xl' : 'max-w-2xl'
              } rounded-[1.85rem] border-2 border-primary/45`
        }`}
        onClick={(e) => e.stopPropagation()}
        style={!phoneChrome ? { transformOrigin: `${menuPosition.left ?? window.innerWidth / 2}px ${menuPosition.top}px` } : undefined}
      >
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-dark ${
            phoneChrome ? 'rounded-none border-0' : 'rounded-[1.85rem] border-2 border-primary'
          }`}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b-2 border-primary bg-primary/30 p-4">
            {!phoneChrome ? (
              <button
                onClick={onClose}
                className="bg-gray-600 hover:bg-gray-500 p-2 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            ) : (
              <div className="w-10" />
            )}
            <h2 className="text-xl font-black text-white">
              {activeTab === 'orders'
                ? (language === 'ar' ? 'طلباتي' : 'My Orders')
                : (language === 'ar' ? 'الملف الشخصي' : 'Profile')}
            </h2>
            <div className="w-10" />
          </div>

          <div
            className={`custom-scrollbar flex-1 overflow-y-auto p-4 ${
              phoneChrome ? 'min-h-0 max-h-none' : 'max-h-[calc(85vh-80px)]'
            }`}
          >
            {!phoneChrome && (
              <div
                className={`mb-6 grid h-11 gap-2 rounded-xl border border-primary/40 bg-dark/60 p-1 ${
                  activeTab === 'orders' ? 'grid-cols-[1.35fr_1fr]' : 'grid-cols-[1fr_1.35fr]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab('orders')}
                  className={`h-9 rounded-lg text-sm font-black transition-colors ${activeTab === 'orders'
                    ? 'bg-primary text-white'
                    : 'text-muted hover:bg-dark/80'
                    }`}
                >
                  {language === 'ar' ? 'طلباتي' : 'My Orders'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('settings');
                    setSettingsView('main');
                  }}
                  className={`h-9 rounded-lg text-sm font-black transition-colors ${activeTab === 'settings'
                    ? 'bg-primary text-white'
                    : 'text-muted hover:bg-dark/80'
                    }`}
                >
                  {language === 'ar' ? 'الحساب' : 'Account'}
                </button>
              </div>
            )}

            {/* Settings Tab */}
            {activeTab === 'settings' && (
              <div className="bg-dark/50 border-2 border-primary/30 rounded-xl p-6 mb-6">
                <div className="relative mb-5 rounded-2xl border border-primary/35 bg-surface/40 p-4">
                  {settingsView === 'main' && (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => setSettingsView('account')}
                        className="w-full rounded-2xl border border-primary/40 bg-primary/10 p-4 text-right transition-colors hover:bg-primary/15"
                      >
                        {displayName ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/25 text-lg font-black text-white">
                                {profileInitial}
                              </div>
                              <div>
                                <p className="text-white text-base font-black">{displayName}</p>
                                <p className="text-xs text-muted">{profileCustomer?.phone}</p>
                              </div>
                            </div>
                            <span className="rounded-lg border border-primary/40 bg-primary/20 px-3 py-1.5 text-xs font-black text-primary">
                              {language === 'ar' ? 'تعديل' : 'Edit'}
                            </span>
                          </div>
                        ) : (
                          <span className="flex items-center justify-between text-sm font-black text-white">
                            <Plus className="h-4 w-4 text-primary" />
                            <span>{language === 'ar' ? 'إضافة حساب' : 'Add account'}</span>
                          </span>
                        )}
                      </button>

                    </div>
                  )}

                  {settingsView === 'account' && (
                    <div className={`space-y-3 ${phoneChrome ? 'profile-mobile-push' : ''}`}>
                      <button
                        type="button"
                        onClick={() => setSettingsView('main')}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-black text-white"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                        {language === 'ar' ? 'رجوع' : 'Back'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSettingsView('data')}
                        className="w-full rounded-xl border border-primary/35 bg-dark/70 p-4 text-right"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-sm font-black text-white">{language === 'ar' ? 'معلومات الطلب' : 'Order Information'}</h4>
                          {!hasOrderInfo && <Plus className="h-4 w-4 text-primary" />}
                        </div>
                        {hasOrderInfo ? (
                          <div className="space-y-1 text-xs text-muted">
                            <p>{displayName || '—'}</p>
                            <p dir="ltr">{profileCustomer?.phone || '—'}</p>
                          </div>
                        ) : (
                          <p className="text-xs text-muted">{language === 'ar' ? 'اضغط لإضافة البيانات' : 'Tap to add data'}</p>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setSettingsView('addresses')}
                        className="w-full rounded-xl border border-primary/35 bg-dark/70 p-4 text-right"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-sm font-black text-white">{language === 'ar' ? 'العناوين' : 'Addresses'}</h4>
                          {!hasAddressSummary && <Plus className="h-4 w-4 text-primary" />}
                        </div>
                        {hasAddressSummary && typeof mapLat === 'number' && typeof mapLng === 'number' ? (
                          <div className="space-y-2">
                            <div className="overflow-hidden rounded-lg border border-primary/30">
                              <InteractiveMap
                                latitude={mapLat}
                                longitude={mapLng}
                                onLocationChange={() => {}}
                                isEditing={false}
                                className="!h-28"
                              />
                            </div>
                            <p className="text-xs text-muted">
                              {[profileCustomer?.street, profileCustomer?.area, profileCustomer?.city].filter(Boolean).join(', ')}
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-muted">{language === 'ar' ? 'اضغط لإضافة عنوان' : 'Tap to add address'}</p>
                        )}
                      </button>
                    </div>
                  )}

                  {settingsView === 'data' && (
                    <div className={`space-y-3 ${phoneChrome ? 'profile-mobile-push' : ''}`}>
                      <button
                        type="button"
                        onClick={() => setSettingsView('account')}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-black text-white"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                        {language === 'ar' ? 'رجوع' : 'Back'}
                      </button>
                      <h4 className="text-sm font-black text-white text-right">{language === 'ar' ? 'معلومات الطلب' : 'Order Information'}</h4>
                      <div>
                        <label className="mb-1 block text-right text-xs text-muted">{language === 'ar' ? 'الاسم' : 'Name'}</label>
                        <input
                          value={profileDraft.name}
                          onChange={(e) => setProfileDraft((p) => ({ ...p, name: e.target.value }))}
                          placeholder={language === 'ar' ? 'الاسم' : 'Name'}
                          className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-right text-xs text-muted">{language === 'ar' ? 'رقم الهاتف' : 'Phone Number'}</label>
                        <input
                          value={profileDraft.phone}
                          onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value.replace(/\D/g, '') }))}
                          placeholder={language === 'ar' ? 'رقم الهاتف' : 'Phone'}
                          className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                          dir="ltr"
                        />
                      </div>
                      {showSecondaryProfilePhone ? (
                        <div className="relative">
                          <input
                            value={profileDraft.secondary_phone}
                            onChange={(e) => setProfileDraft((p) => ({ ...p, secondary_phone: e.target.value.replace(/\D/g, '') }))}
                            placeholder={language === 'ar' ? 'رقم إضافي (اختياري)' : 'Secondary phone (optional)'}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                            dir="ltr"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setShowSecondaryProfilePhone(false);
                              setProfileDraft((p) => ({ ...p, secondary_phone: '' }));
                            }}
                            className="absolute left-2 top-1/2 -translate-y-1/2 text-red-400"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowSecondaryProfilePhone(true)}
                          className="w-full rounded-lg border border-dashed border-primary/35 py-2 text-xs font-black text-primary"
                        >
                          {language === 'ar' ? 'إضافة رقم هاتف احتياطي' : 'Add secondary phone'}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={profileSaving}
                        onClick={() => void saveProfileData()}
                        className="w-full rounded-xl bg-primary py-2 text-sm font-black text-white disabled:opacity-60"
                      >
                        {profileSaving ? (language === 'ar' ? 'جاري الحفظ…' : 'Saving...') : (language === 'ar' ? 'حفظ البيانات' : 'Save data')}
                      </button>
                    </div>
                  )}

                  {settingsView === 'addresses' && (
                    <div className={`space-y-3 text-right ${phoneChrome ? 'profile-mobile-push' : ''}`}>
                      <button
                        type="button"
                        onClick={() => setSettingsView('account')}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-black text-white"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                        {language === 'ar' ? 'رجوع' : 'Back'}
                      </button>
                      <h4 className="text-sm font-black text-white">{language === 'ar' ? 'العناوين' : 'Addresses'}</h4>
                      <button
                        type="button"
                        onClick={() => {
                          if (phoneChrome) setSettingsView('map');
                          else setDesktopAddressMapOverlayOpen(true);
                        }}
                        className="w-full rounded-lg border border-primary/35 bg-primary/10 px-3 py-2 text-xs font-black text-primary"
                      >
                        {language === 'ar' ? 'تعديل الموقع' : 'Edit Location'}
                      </button>
                      {typeof mapLat === 'number' && typeof mapLng === 'number' && (
                        <p className="text-xs font-mono text-purple-400">{mapLat.toFixed(6)}, {mapLng.toFixed(6)}</p>
                      )}
                      <div className="flex flex-wrap justify-end gap-2 items-center">
                        {profileSavedAddressTabs.length < 4 && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowProfileCustomAddressInput((v) => !v);
                              if (!showProfileCustomAddressInput) setNewProfileAddressName(profileAddressTypeLabel);
                            }}
                            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all ${showProfileCustomAddressInput ? 'bg-red-500/20 text-red-300 border-red-400/60 rotate-180' : 'bg-dark border-primary/30 text-primary hover:bg-primary/10'
                              }`}
                            title={language === 'ar' ? 'إضافة عنوان مخصص' : 'Add custom address'}
                          >
                            {showProfileCustomAddressInput ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => switchAddressTab('builtin-apartment', 'apartment')}
                          className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 ${activeProfileAddressTabId === 'builtin-apartment' ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary'}`}
                        >
                          <Building className="w-3.5 h-3.5" />
                          <span>{language === 'ar' ? 'شقة' : 'Apartment'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => switchAddressTab('builtin-house', 'house')}
                          className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 ${activeProfileAddressTabId === 'builtin-house' ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary'}`}
                        >
                          <Home className="w-3.5 h-3.5" />
                          <span>{language === 'ar' ? 'منزل' : 'House'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => switchAddressTab('builtin-workplace', 'workplace')}
                          className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 ${activeProfileAddressTabId === 'builtin-workplace' ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary'}`}
                        >
                          <Briefcase className="w-3.5 h-3.5" />
                          <span>{language === 'ar' ? 'مكان عمل' : 'Workplace'}</span>
                        </button>
                        {profileSavedAddressTabs.map((tab) => (
                          <div key={tab.id} className="relative inline-flex flex-col items-stretch align-top group/profiletab">
                            <button
                              type="button"
                              data-profile-tab-anchor={tab.id}
                              onClick={() => {
                                if (profileTabLongPressConsumed.current) {
                                  profileTabLongPressConsumed.current = false;
                                  return;
                                }
                                switchAddressTab(tab.id, tab.type);
                              }}
                              onTouchStart={() => onProfileTabTouchStart(tab)}
                              onTouchEnd={onProfileTabTouchEnd}
                              onTouchCancel={onProfileTabTouchEnd}
                              className={`px-2 py-1 rounded-lg border text-xs flex items-center gap-1.5 w-full min-w-0 ${activeProfileAddressTabId === tab.id ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary'}`}
                            >
                              <span className="truncate max-w-[9rem]">{tab.label}</span>
                            </button>
                            
                            <div className={`pointer-events-none absolute left-0 right-0 top-[calc(100%-10px)] z-[70] pt-3 opacity-0 invisible translate-y-1 transition-all duration-150 [@media(hover:hover)]:group-hover/profiletab:pointer-events-auto [@media(hover:hover)]:group-hover/profiletab:visible [@media(hover:hover)]:group-hover/profiletab:opacity-100 [@media(hover:hover)]:group-hover/profiletab:translate-y-0 [@media(hover:none)]:hidden ${renameProfileTabTarget?.id === tab.id ? '[@media(hover:hover)]:!invisible [@media(hover:hover)]:!opacity-0 [@media(hover:hover)]:!pointer-events-none' : ''}`}>
                              <div className="rounded-lg border border-primary/50 bg-[hsl(var(--color-surface))] shadow-xl flex w-full overflow-hidden">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault(); e.stopPropagation();
                                    setShowProfileCustomAddressInput(false);
                                    setRenameProfileTabTarget(tab);
                                    setRenameProfileTabInput(tab.label);
                                  }}
                                  className="flex-1 py-2 flex items-center justify-center text-primary hover:bg-primary/15 transition-colors"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <div className="w-px bg-primary/25 self-stretch my-1" />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault(); e.stopPropagation();
                                    removeProfileAddressTab(tab);
                                  }}
                                  className="flex-1 py-2 flex items-center justify-center text-red-300 hover:bg-red-500/15 transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {renameProfileTabTarget && (
                        <div className="space-y-2 rounded-lg border border-primary/25 bg-dark/60 p-2">
                          <input
                            value={renameProfileTabInput}
                            onChange={(e) => setRenameProfileTabInput(e.target.value)}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setRenameProfileTabTarget(null)}
                              className="rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-black text-white"
                            >
                              {language === 'ar' ? 'إلغاء' : 'Cancel'}
                            </button>
                            <button
                              type="button"
                              onClick={() => renameProfileAddressTab(renameProfileTabTarget, renameProfileTabInput)}
                              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-white"
                            >
                              {language === 'ar' ? 'حفظ' : 'Save'}
                            </button>
                          </div>
                        </div>
                      )}
                      {showProfileCustomAddressInput && (
                        <div className="space-y-2 rounded-lg border border-primary/25 bg-dark/60 p-2">
                          <input
                            value={newProfileAddressName}
                            onChange={(e) => setNewProfileAddressName(e.target.value)}
                            placeholder={language === 'ar' ? 'اسم العنوان' : 'Address name'}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setShowProfileCustomAddressInput(false);
                                setNewProfileAddressName('');
                              }}
                              className="rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-black text-white"
                            >
                              {language === 'ar' ? 'إلغاء' : 'Cancel'}
                            </button>
                            <button
                              type="button"
                              onClick={addProfileCustomAddressTab}
                              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-white"
                            >
                              {language === 'ar' ? 'إضافة' : 'Add'}
                            </button>
                          </div>
                        </div>
                      )}
                      {profileAddressType === 'apartment' && (
                        <>
                          <input
                            value={profileDraft.building_number}
                            onChange={(e) => setProfileDraft((p) => ({ ...p, building_number: e.target.value }))}
                            placeholder={language === 'ar' ? 'اسم/رقم المبنى' : 'Building Name/No.'}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              value={profileDraft.floor}
                              onChange={(e) => setProfileDraft((p) => ({ ...p, floor: e.target.value }))}
                              placeholder={language === 'ar' ? 'الطابق' : 'Floor'}
                              className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                            />
                            <input
                              value={profileDraft.apartment}
                              onChange={(e) => setProfileDraft((p) => ({ ...p, apartment: e.target.value }))}
                              placeholder={language === 'ar' ? 'الشقة' : 'Apartment'}
                              className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                            />
                          </div>
                        </>
                      )}
                      {profileAddressType === 'house' && (
                        <input
                          value={profileDraft.house_name}
                          onChange={(e) => setProfileDraft((p) => ({ ...p, house_name: e.target.value }))}
                          placeholder={language === 'ar' ? 'اسم/رقم المنزل' : 'House Name/No.'}
                          className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                        />
                      )}
                      {profileAddressType === 'workplace' && (
                        <>
                          <input
                            value={profileDraft.building_number}
                            onChange={(e) => setProfileDraft((p) => ({ ...p, building_number: e.target.value }))}
                            placeholder={language === 'ar' ? 'اسم المبنى' : 'Building Name'}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                          />
                          <input
                            value={profileDraft.company_name}
                            onChange={(e) => setProfileDraft((p) => ({ ...p, company_name: e.target.value }))}
                            placeholder={language === 'ar' ? 'اسم الشركة' : 'Company Name'}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                          />
                          <input
                            value={profileDraft.floor}
                            onChange={(e) => setProfileDraft((p) => ({ ...p, floor: e.target.value }))}
                            placeholder={language === 'ar' ? 'الطابق' : 'Floor'}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                          />
                        </>
                      )}
                      <input
                        value={profileDraft.street}
                        onChange={(e) => setProfileDraft((p) => ({ ...p, street: e.target.value }))}
                        placeholder={language === 'ar' ? 'الشارع' : 'Street'}
                        className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                      />
                      <input
                        value={profileDraft.city}
                        onChange={(e) => setProfileDraft((p) => ({ ...p, city: e.target.value }))}
                        placeholder={language === 'ar' ? 'المدينة' : 'City'}
                        className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                      />
                      <input
                        value={profileDraft.landmark}
                        onChange={(e) => setProfileDraft((p) => ({ ...p, landmark: e.target.value }))}
                        placeholder={language === 'ar' ? 'علامة مميزة' : 'Landmark'}
                        className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-right text-sm text-white"
                      />
                      <button
                        type="button"
                        disabled={profileSaving}
                        onClick={() => void saveProfileData()}
                        className="w-full rounded-xl bg-primary py-2 text-sm font-black text-white disabled:opacity-60"
                      >
                        {profileSaving ? (language === 'ar' ? 'جاري الحفظ…' : 'Saving...') : (language === 'ar' ? 'حفظ العنوان' : 'Save address')}
                      </button>
                    </div>
                  )}
                  {settingsView === 'map' && (
                    <div className={`text-right ${phoneChrome ? 'fixed inset-0 z-[130] bg-dark profile-mobile-push' : ''}`}>
                      {phoneChrome && (
                        <div className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-dark">
                          <div className="relative flex-1 min-h-0">
                            <InteractiveMap
                              latitude={typeof mapLat === 'number' ? mapLat : 30.0444}
                              longitude={typeof mapLng === 'number' ? mapLng : 31.2357}
                              onLocationChange={(lat, lng) => setProfileDraft((p) => ({ ...p, latitude: lat, longitude: lng }))}
                              onAddressChange={(address) =>
                                setProfileDraft((p) => ({
                                  ...p,
                                  street: address.street || p.street,
                                  area: address.area || p.area,
                                  city: address.city || p.city,
                                  building_number: address.buildingNumber || p.building_number
                                }))
                              }
                              isEditing={true}
                              className="h-full"
                              containerHeight="100%"
                            />
                            <div className="absolute left-3 top-3 z-[700]">
                              <button
                                type="button"
                                onClick={() => setSettingsView('addresses')}
                                className="rounded-lg border border-white/20 bg-black/45 px-3 py-1.5 text-xs font-black text-white shadow-lg"
                              >
                                {language === 'ar' ? 'رجوع' : 'Back'}
                              </button>
                            </div>
                          </div>
                          <div className="shrink-0">
                            <button
                              type="button"
                              onClick={() => setSettingsView('addresses')}
                              className="w-full bg-primary py-4 text-sm font-black text-white shadow-[0_-10px_24px_rgba(0,0,0,0.35)]"
                            >
                              {language === 'ar' ? 'تأكيد الموقع' : 'Confirm Location'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {settingsView === 'main' && (
                <>
                <h3 className="text-xl font-bold text-white mb-4 text-right">
                  {language === 'ar' ? 'الأعدادات' : 'Settings'}
                </h3>

                <div className="space-y-4">
                  {/* Account Security (phone password) - show only for registered customer accounts */}
                  {profileCustomerId && (
                  <div className="bg-dark/50 rounded-lg p-4 border border-amber-500/25">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <Lock className="w-5 h-5 text-amber-400" />
                        <span className="text-white font-bold">
                          {language === 'ar' ? 'أمان الحساب' : 'Account security'}
                        </span>
                      </div>
                      {securityLoading && (
                        <span className="text-[11px] text-muted">{language === 'ar' ? 'جاري التحميل…' : 'Loading…'}</span>
                      )}
                    </div>

                    <p className="text-[11px] text-gray-400 text-right leading-relaxed mb-3">
                      {language === 'ar'
                        ? 'يمكنك إضافة كلمة مرور مرتبطة برقمك (اختياري). عند تسجيل الدخول من جهاز آخر سيُطلب إدخالها. إذا نسيتها استخدم كود الاسترجاع.'
                        : 'You can set an optional password for your phone. Other devices will be asked for it. If you forget it, use the recovery code.'}
                    </p>

                    {secErr && <p className="text-red-400 text-[11px] font-black text-right mb-2">{secErr}</p>}

                    {!hasPhonePassword ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-1 gap-2">
                          <input
                            type="password"
                            value={secPwd1}
                            onChange={(e) => {
                              setSecPwd1(e.target.value);
                              setSecErr(null);
                              setSecNewRecoveryShown(null);
                            }}
                            className="w-full bg-gray-900 border border-amber-500/35 rounded-lg px-3 py-2 text-white text-right text-sm"
                            placeholder={language === 'ar' ? 'كلمة المرور (اختياري)' : 'Password (optional)'}
                            dir="ltr"
                          />
                          <input
                            type="password"
                            value={secPwd2}
                            onChange={(e) => {
                              setSecPwd2(e.target.value);
                              setSecErr(null);
                              setSecNewRecoveryShown(null);
                            }}
                            className="w-full bg-gray-900 border border-amber-500/35 rounded-lg px-3 py-2 text-white text-right text-sm"
                            placeholder={language === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm password'}
                            dir="ltr"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={secBusy}
                          onClick={async () => {
                            if (!profileCustomerId || !customerPhone) return;
                            setSecErr(null);
                            setSecNewRecoveryShown(null);
                            if (secPwd1.trim().length < 4) {
                              setSecErr(language === 'ar' ? 'كلمة المرور 4 أحرف على الأقل.' : 'Password must be at least 4 characters.');
                              return;
                            }
                            if (secPwd1 !== secPwd2) {
                              setSecErr(language === 'ar' ? 'تأكيد كلمة المرور غير مطابق.' : 'Passwords do not match.');
                              return;
                            }
                            setSecBusy(true);
                            try {
                              const fp = getOrCreateDeviceFingerprint();
                              const pwdHash = await hashPhonePassword(customerPhone, secPwd1.trim());
                              const newRecovery = generateEasyRecoveryCode();
                              const recHash = await hashRecoveryCode(customerPhone, newRecovery);
                              const { error } = await supabase
                                .from('customers')
                                .update({
                                  phone_password_hash: pwdHash,
                                  phone_recovery_code_hash: recHash,
                                  phone_password_owner_fingerprint: fp,
                                  updated_at: new Date().toISOString()
                                })
                                .eq('id', profileCustomerId);
                              if (error) throw error;
                              setHasPhonePassword(true);
                              setSecPwd1('');
                              setSecPwd2('');
                              setSecNewRecoveryShown(newRecovery);
                            } catch (e) {
                              console.error(e);
                              setSecErr(language === 'ar' ? 'تعذر حفظ كلمة المرور.' : 'Could not save password.');
                            } finally {
                              setSecBusy(false);
                            }
                          }}
                          className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white py-2.5 rounded-lg font-black text-sm"
                        >
                          {language === 'ar' ? 'حفظ كلمة المرور' : 'Save password'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-[11px] text-amber-200/90 text-right font-bold">
                          {language === 'ar' ? 'كلمة المرور مفعّلة على هذا الرقم.' : 'Password is enabled for this phone.'}
                        </p>
                        <button
                          type="button"
                          onClick={() => setSecurityDetailsOpen((v) => !v)}
                          className="w-full flex items-center justify-between rounded-lg border border-amber-500/25 bg-black/10 px-3 py-2 text-amber-200 font-black text-xs"
                        >
                          <span>{language === 'ar' ? 'إظهار التفاصيل' : 'Show details'}</span>
                          <span className="text-[10px] text-amber-200/70">
                            {securityDetailsOpen ? (language === 'ar' ? 'إخفاء' : 'Hide') : (language === 'ar' ? 'فتح' : 'Open')}
                          </span>
                        </button>

                        {securityDetailsOpen && (
                          <div className="rounded-lg border border-amber-500/20 bg-black/15 p-2 space-y-2">
                          <p className="text-[11px] text-gray-300 text-right">
                            {language === 'ar'
                              ? 'لتغيير كلمة المرور في أي وقت: أدخل كود الاسترجاع ثم ضع كلمة مرور جديدة. سيتم إنشاء كود استرجاع جديد تلقائياً.'
                              : 'To change password anytime: enter recovery code, set a new password. A new recovery code will be generated.'}
                          </p>
                          <input
                            type="tel"
                            value={secRecoveryInput}
                            onChange={(e) => {
                              setSecRecoveryInput(e.target.value.replace(/\\D/g, '').slice(0, 6));
                              setSecErr(null);
                              setSecNewRecoveryShown(null);
                            }}
                            className="w-full bg-gray-900 border border-amber-500/30 rounded-lg px-3 py-2 text-white text-right text-sm font-black"
                            placeholder={language === 'ar' ? 'كود الاسترجاع (6 أرقام)' : 'Recovery code (6 digits)'}
                            dir="ltr"
                          />
                          <div className="grid grid-cols-1 gap-2">
                            <input
                              type="password"
                              value={secPwd1}
                              onChange={(e) => {
                                setSecPwd1(e.target.value);
                                setSecErr(null);
                                setSecNewRecoveryShown(null);
                              }}
                              className="w-full bg-gray-900 border border-amber-500/30 rounded-lg px-3 py-2 text-white text-right text-sm"
                              placeholder={language === 'ar' ? 'كلمة مرور جديدة' : 'New password'}
                              dir="ltr"
                            />
                            <input
                              type="password"
                              value={secPwd2}
                              onChange={(e) => {
                                setSecPwd2(e.target.value);
                                setSecErr(null);
                                setSecNewRecoveryShown(null);
                              }}
                              className="w-full bg-gray-900 border border-amber-500/30 rounded-lg px-3 py-2 text-white text-right text-sm"
                              placeholder={language === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm password'}
                              dir="ltr"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={secBusy}
                            onClick={async () => {
                              if (!profileCustomerId || !customerPhone) return;
                              setSecErr(null);
                              setSecNewRecoveryShown(null);
                              if (secRecoveryInput.length !== 6) {
                                setSecErr(language === 'ar' ? 'أدخل كود استرجاع صحيح (6 أرقام).' : 'Enter a 6-digit recovery code.');
                                return;
                              }
                              if (secPwd1.trim().length < 4) {
                                setSecErr(language === 'ar' ? 'كلمة المرور 4 أحرف على الأقل.' : 'Password must be at least 4 characters.');
                                return;
                              }
                              if (secPwd1 !== secPwd2) {
                                setSecErr(language === 'ar' ? 'تأكيد كلمة المرور غير مطابق.' : 'Passwords do not match.');
                                return;
                              }
                              setSecBusy(true);
                              try {
                                const { data: row } = await supabase
                                  .from('customers')
                                  .select('phone_recovery_code_hash')
                                  .eq('id', profileCustomerId)
                                  .maybeSingle();
                                const expected = (row as any)?.phone_recovery_code_hash as string | null | undefined;
                                if (!expected) {
                                  setSecErr(language === 'ar' ? 'لا يوجد كود استرجاع محفوظ لهذا الرقم.' : 'No recovery code saved for this number.');
                                  return;
                                }
                                const recHash = await hashRecoveryCode(customerPhone, secRecoveryInput);
                                if (recHash !== expected) {
                                  setSecErr(language === 'ar' ? 'كود الاسترجاع غير صحيح.' : 'Invalid recovery code.');
                                  return;
                                }
                                const fp = getOrCreateDeviceFingerprint();
                                const pwdHash = await hashPhonePassword(customerPhone, secPwd1.trim());
                                const { data: existingPwdRow } = await supabase
                                  .from('customers')
                                  .select('phone_password_hash')
                                  .eq('id', profileCustomerId)
                                  .maybeSingle();
                                const oldHash = (existingPwdRow as any)?.phone_password_hash as string | null | undefined;
                                if (oldHash && pwdHash === oldHash) {
                                  setSecErr(language === 'ar' ? 'لا يمكن اختيار نفس كلمة المرور السابقة.' : 'You cannot reuse the previous password.');
                                  return;
                                }
                                const newRecovery = generateEasyRecoveryCode();
                                const newRecHash = await hashRecoveryCode(customerPhone, newRecovery);
                                const { error } = await supabase
                                  .from('customers')
                                  .update({
                                    phone_password_hash: pwdHash,
                                    phone_recovery_code_hash: newRecHash,
                                    phone_password_owner_fingerprint: fp,
                                    updated_at: new Date().toISOString()
                                  })
                                  .eq('id', profileCustomerId);
                                if (error) throw error;
                                setSecPwd1('');
                                setSecPwd2('');
                                setSecRecoveryInput('');
                                setSecNewRecoveryShown(newRecovery);
                              } catch (e) {
                                console.error(e);
                                setSecErr(language === 'ar' ? 'تعذر تغيير كلمة المرور.' : 'Could not change password.');
                              } finally {
                                setSecBusy(false);
                              }
                            }}
                            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white py-2.5 rounded-lg font-black text-sm"
                          >
                            {language === 'ar' ? 'تغيير كلمة المرور' : 'Change password'}
                          </button>
                          </div>
                        )}
                      </div>
                    )}

                    {secNewRecoveryShown && (
                      <div className="mt-3 rounded-xl border border-amber-500/35 bg-black/20 p-3 text-center">
                        <p className="text-[11px] text-amber-100/80 mb-1">
                          {language === 'ar' ? 'كود استرجاع جديد (احتفظ به):' : 'New recovery code (keep it):'}
                        </p>
                        <p className="font-mono text-2xl font-black text-amber-200 tracking-widest">{secNewRecoveryShown}</p>
                        <p className="text-[10px] text-amber-100/60 mt-1">
                          {language === 'ar'
                            ? 'الكود القديم لم يعد صالحاً.'
                            : 'Old code is no longer valid.'}
                        </p>
                      </div>
                    )}
                  </div>
                  )}

                  {/* Language Toggle */}
                  <div className="flex items-center justify-between bg-dark/50 rounded-lg p-4">
                    <div className="flex items-center gap-3">
                      <Globe className="w-5 h-5 text-primary" />
                      <span className="text-white font-bold">
                        {language === 'ar' ? 'اللغة' : 'Language'}
                      </span>
                    </div>
                    <button
                      onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                      className="bg-primary hover:bg-primary/80 text-white px-6 py-2 rounded-lg transition-colors font-bold flex items-center gap-2"
                    >
                      <Globe className="w-4 h-4" />
                      <span>{language === 'ar' ? 'العربية' : 'English'}</span>
                    </button>
                  </div>

                  {/* Theme Toggle */}
                  <div className="flex items-center justify-between bg-dark/50 rounded-lg p-4">
                    <div className="flex items-center gap-3">
                      {theme === 'dark' ? (
                        <Moon className="w-5 h-5 text-primary" />
                      ) : (
                        <Sun className="w-5 h-5 text-primary" />
                      )}
                      <span className="text-white font-bold">
                        {language === 'ar' ? 'الوضع' : 'Theme'}
                      </span>
                    </div>
                    <button
                      onClick={toggleTheme}
                      className="bg-primary hover:bg-primary/80 text-white px-6 py-2 rounded-lg transition-colors font-bold flex items-center gap-2"
                    >
                      {theme === 'dark' ? (
                        <>
                          <Moon className="w-4 h-4" />
                          <span>{language === 'ar' ? 'مظلم' : 'Dark'}</span>
                        </>
                      ) : (
                        <>
                          <Sun className="w-4 h-4" />
                          <span>{language === 'ar' ? 'فاتح' : 'Light'}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Coupons Button */}
                  <div className="relative">
                    <button
                      onClick={() => setShowCouponList(true)}
                      className="w-full flex items-center justify-between bg-dark/50 rounded-lg p-4 hover:bg-dark/70 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <TicketPercent className="w-5 h-5 text-primary" />
                        <span className="text-white font-bold">
                          {language === 'ar' ? 'الكوبونات' : 'Coupons'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {customerCoupons.length > 0 && (
                          <span className="bg-primary text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-[0_0_10px_rgba(168,85,247,0.5)]">
                            {customerCoupons.length}
                          </span>
                        )}
                        <span className="text-muted text-sm">
                          {language === 'ar' ? 'عرض' : 'View'}
                        </span>
                      </div>
                    </button>
                  </div>
                </div>
                </>
                )}
              </div>
            )}

            {/* Coupons Modal */}
            {showCouponList && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
                <div className="bg-surface w-full max-w-sm rounded-[2.5rem] border-2 border-primary/30 shadow-2xl shadow-primary/20 overflow-hidden scale-in">
                  <div className="p-6 border-b border-primary/20 flex items-center justify-between bg-dark/80 backdrop-blur-md relative z-10">
                    <button onClick={() => setShowCouponList(false)} className="p-2 hover:bg-white/10 bg-white/5 rounded-full transition-colors text-white hover:scale-110">
                      <X className="w-5 h-5" />
                    </button>
                    <h3 className="text-xl font-black text-white flex items-center gap-2">
                      {language === 'ar' ? 'كوبونات الخصم' : 'Your Coupons'}
                      <TicketPercent className="w-6 h-6 text-primary" />
                    </h3>
                  </div>
                  
                  <div className="p-5 max-h-[65vh] overflow-y-auto custom-scrollbar space-y-4 bg-surface relative">
                    <div className="absolute top-0 right-0 w-full h-32 bg-primary/5 blur-3xl pointer-events-none rounded-full"></div>
                    {customerCoupons.length === 0 ? (
                      <div className="py-12 text-center relative z-10">
                        <TicketPercent className="w-20 h-20 text-primary/30 mx-auto mb-4 drop-shadow-[0_0_15px_rgba(168,85,247,0.3)]" />
                        <p className="text-lg text-primary font-bold">
                          {language === 'ar' ? 'لا توجد كوبونات متاحة' : 'No available coupons'}
                        </p>
                      </div>
                    ) : (
                      customerCoupons.map((coupon, idx) => {
                        const expiresAt = coupon.expires_at ? new Date(coupon.expires_at) : null;
                        const couponOrders = orders.filter((o) => {
                          if (o.status === 'cancelled') return false;
                          return (o as any).applied_coupon_id === coupon.id || (o as any).applied_coupon_code === coupon.code;
                        });
                        const totalSaved = couponOrders.reduce((acc, order) => {
                          const itemsTotal = (order.items || []).reduce((sum, item) => sum + item.subtotal, 0);
                          const pct = (order as any).applied_coupon_discount_percent || coupon.discount_percent || 0;
                          const d = pct ? Math.round((itemsTotal * pct) / 100) : 0;
                          return acc + d;
                        }, 0);
                        return (
                          <div
                            key={coupon.id}
                            className="bg-dark/80 rounded-2xl p-5 border border-primary/20 relative overflow-hidden group hover:border-primary/50 transition-all hover:-translate-y-1 shadow-lg shadow-black/50"
                            style={{ animation: `slideUp 0.4s ease-out forwards`, animationDelay: `${idx * 0.1}s`, opacity: 0 }}
                          >
                            {/* Decorative element */}
                            <div className="absolute -right-6 -top-6 w-24 h-24 bg-primary/10 rounded-full blur-2xl group-hover:bg-primary/20 transition-all"></div>
                            <div className="absolute -left-6 -bottom-6 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all"></div>
                            
                            <div className="flex items-start justify-between relative z-10">
                              <div className="text-right flex-1">
                                <div className="flex items-center justify-end gap-2 mb-3">
                                  <span className="bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded-full text-xs font-black shadow-[0_0_10px_rgba(168,85,247,0.2)]">
                                    {language === 'ar' ? `خصم ${coupon.discount_percent}%` : `${coupon.discount_percent}% OFF`}
                                  </span>
                                </div>
                                <p className="text-[12px] text-green-300 font-black text-right mb-2">
                                  {language === 'ar'
                                    ? `وفّرت: ${totalSaved} ج`
                                    : `Saved: ${totalSaved} EG`}
                                </p>
                                <div className="flex items-center justify-end gap-3 mt-4 bg-black/40 p-3 rounded-xl border border-white/5 group-hover:border-white/10 transition-colors">
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(coupon.code);
                                      const el = document.getElementById(`copy-${coupon.id}`);
                                      if (el) {
                                        el.innerText = language === 'ar' ? 'تم النسخ!' : 'Copied!';
                                        setTimeout(() => {
                                          el.innerText = language === 'ar' ? 'نسخ الكود' : 'Copy Code';
                                        }, 2000);
                                      }
                                    }}
                                    className="text-[10px] text-white/70 hover:text-white transition-colors flex items-center gap-1.5 bg-primary/20 hover:bg-primary/40 px-3 py-1.5 rounded-lg font-bold"
                                    title={language === 'ar' ? 'نسخ' : 'Copy'}
                                  >
                                    <span id={`copy-${coupon.id}`}>{language === 'ar' ? 'نسخ الكود' : 'Copy Code'}</span>
                                  </button>
                                  <span className="text-xl font-mono font-black text-white tracking-widest drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]">{coupon.code}</span>
                                </div>
                                <div className="mt-2 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => setCouponDetailsCode(coupon.code)}
                                    className="text-[11px] bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg px-3 py-1.5 font-black"
                                  >
                                    {language === 'ar' ? 'عرض التفاصيل' : 'View details'}
                                  </button>
                                </div>
                              </div>
                            </div>
                            {expiresAt && (
                              <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-end gap-1.5 text-[10px] text-muted font-bold relative z-10">
                                <Clock className="w-3.5 h-3.5 text-primary/70" />
                                <span>
                                  {language === 'ar'
                                    ? `صالح حتى ${expiresAt.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}`
                                    : `Valid until ${expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {couponDetailsCode && (
              <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80" onClick={() => setCouponDetailsCode(null)}>
                <div className="bg-surface w-full max-w-sm rounded-2xl border border-primary/30 p-4 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-3">
                    <button className="text-gray-400" onClick={() => setCouponDetailsCode(null)}>
                      <X className="w-5 h-5" />
                    </button>
                    <h4 className="text-white font-black text-sm">{language === 'ar' ? 'طلبات هذا الكوبون' : 'Coupon orders'}</h4>
                  </div>
                  <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar">
                    {orders
                      .filter((o) => o.status !== 'cancelled' && (((o as any).applied_coupon_code || '') === couponDetailsCode))
                      .map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => {
                            setCouponDetailsCode(null);
                            setShowCouponList(false);
                            setActiveTab('orders');
                            setExpandedOrderId(o.id);
                            setActiveHighlightId(o.id);
                            window.setTimeout(() => setActiveHighlightId(null), 2200);
                          }}
                          className="w-full rounded-lg border border-primary/30 bg-dark/70 p-2 text-right hover:border-primary/60"
                        >
                          <p className="text-white font-black text-sm">#{(o as any).order_number}</p>
                          <p className="text-xs text-muted">{new Date(o.created_at).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}</p>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* Orders Tab */}
            {activeTab === 'orders' && (
              <>
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-white text-right mb-4">
                    {language === 'ar' ? 'طلباتي' : 'My Orders'}
                  </h3>
                </div>
                {loading ? (
                  <div className="text-center py-12">
                    <div className="animate-spin w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full mx-auto"></div>
                    <p className="text-muted mt-4">{language === 'ar' ? 'جاري التحميل...' : 'Loading...'}</p>
                  </div>
                ) : orders.length === 0 ? (
                  <div className="text-center py-12">
                    <Package className="w-24 h-24 text-primary/50 mx-auto mb-4" />
                    <p className="text-2xl text-purple-300 font-bold">{language === 'ar' ? 'لا توجد طلبات' : 'No Orders'}</p>
                  </div>
                ) : (
                  <div className="space-y-8 flex flex-col w-full">
                    {(() => {
                      const activeOrders = orders.filter(o => !o.isArchived && o.status !== 'completed' && o.status !== 'cancelled');
                      const pastOrders = orders.filter(o => o.isArchived || o.status === 'completed' || o.status === 'cancelled');

                      return (
                        <>
                          {/* Active Orders Horizontal Swipe Carousel */}
                          <div className="space-y-3">
                            <h4 className="text-white font-bold text-right flex items-center justify-end gap-2 text-lg">
                              <span>{language === 'ar' ? 'طلبات قيد التنفيذ' : 'Pending Orders'}</span>
                              <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(250,204,21,0.8)]"></div>
                            </h4>
                            {activeOrders.length === 0 ? (
                              <div className="text-center py-8 bg-surface rounded-2xl border border-primary/20">
                                <Package className="w-16 h-16 text-primary/50 mx-auto mb-3" />
                                <p className="text-lg text-primary font-bold">{language === 'ar' ? 'لا توجد طلبات قيد التنفيذ' : 'No Pending Orders'}</p>
                              </div>
                            ) : (
                              <div
                                className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory pt-2 custom-horizontal-scrollbar w-full"
                                dir={language === 'ar' ? 'rtl' : 'ltr'}
                              >
                                {activeOrders.map(order => {
                                  const statusInfo = getStatusInfo(order.status);
                                  const StatusIcon = statusInfo.icon;
                                  const isExpanded = expandedOrderId === order.id;
                                  const isEditingNote = editingNoteOrderId === order.id;
                                  const isCancelling = cancelOrderId === order.id;
                                  const isDetailsOpen = isExpanded || isCancelling;

                                  const itemsTotal = order.items.reduce((sum, item) => sum + item.subtotal, 0);
                                  const discount = order.applied_coupon_discount_percent
                                    ? Math.round((itemsTotal * order.applied_coupon_discount_percent) / 100)
                                    : 0;
                                  const deliveryFee = order.total_amount - (itemsTotal - discount);

                                  return (
                                      <div
                                        key={order.id}
                                        id={`order-${order.id}`}
                                        className={`snap-center shrink-0 w-[85%] sm:w-[320px] bg-dark/70 border-2 rounded-2xl p-5 shadow-xl transition-all duration-500 flex flex-col hover:border-primary/50 ${order.id === activeHighlightId ? 'order-highlight-glow border-primary' : 'border-primary/20'}`}
                                      >
                                      <div className="flex items-start justify-between mb-3 relative">
                                        <div className="text-right flex-1 cursor-pointer" onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}>
                                          <p className="text-muted text-[10px] mb-0.5">{language === 'ar' ? 'رقم الطلب' : 'Order ID'}</p>
                                          <p className="text-white font-black text-2xl">#{order.order_number}</p>
                                        </div>

                                        <div className="flex flex-col items-end gap-2">
                                          <div className="relative">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setShowActionMenu(showActionMenu === order.id ? null : order.id);
                                              }}
                                              className="p-2 hover:bg-white/10 rounded-full transition-colors text-gray-400 hover:text-white"
                                            >
                                              <MoreVertical className="w-5 h-5" />
                                            </button>

                                            {showActionMenu === order.id && (
                                              <>
                                                <div
                                                  className="fixed inset-0 z-[80]"
                                                  onClick={() => setShowActionMenu(null)}
                                                ></div>
                                                <div className="absolute top-10 left-0 z-[81] bg-surface border border-primary/30 rounded-xl shadow-2xl py-2 min-w-[150px] animate-in fade-in zoom-in duration-200">
                                                  {order.status === 'under_review' && (
                                                    <button
                                                      onClick={() => {
                                                        setCancelOrderId(order.id);
                                                        setCancelReason('');
                                                        setExpandedOrderId(order.id); // ensure expanded
                                                        setShowActionMenu(null);
                                                      }}
                                                      className="w-full text-right px-4 py-2 hover:bg-red-500/10 text-red-500 text-sm font-bold flex items-center justify-between"
                                                    >
                                                      <XCircle className="w-4 h-4" />
                                                      <span>{language === 'ar' ? 'إلغاء الطلب' : 'Cancel Order'}</span>
                                                    </button>
                                                  )}
                                                  <button
                                                    onClick={() => {
                                                      setEditingNoteOrderId(order.id);
                                                      setEditedNote(order.order_note || '');
                                                      setExpandedOrderId(order.id);
                                                      setShowActionMenu(null);
                                                    }}
                                                    className="w-full text-right px-4 py-2 hover:bg-primary/10 text-white text-sm font-bold flex items-center justify-between"
                                                  >
                                                    <MessageSquare className="w-4 h-4" />
                                                    <span>
                                                      {order.order_note?.trim()
                                                        ? (language === 'ar' ? 'تعديل الملاحظة' : 'Edit Note')
                                                        : (language === 'ar' ? 'أضف ملاحظة' : 'Add Note')}
                                                    </span>
                                                  </button>
                                                </div>
                                              </>
                                            )}
                                          </div>
                                          
                                          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/40 border border-primary/20 ${statusInfo.color}`}>
                                            <StatusIcon className="w-3.5 h-3.5" />
                                            <span className="font-bold text-[9px] whitespace-nowrap uppercase tracking-wider">{statusInfo.text}</span>
                                          </div>
                                        </div>
                                      </div>

                                      <div
                                        className="flex-1"
                                      >
                                        <div 
                                          className="flex items-baseline justify-between text-xs text-gray-400 mb-4 border-b border-primary/10 pb-3 cursor-pointer"
                                          onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                                        >
                                          <div className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            <span>
                                              {new Date(order.created_at).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', {
                                                hour: '2-digit',
                                                minute: '2-digit'
                                              })}
                                            </span>
                                          </div>
                                          <span className="text-primary font-black text-lg">
                                            {order.total_amount} <span className="text-[10px] font-bold">{language === 'ar' ? 'ج' : 'EG'}</span>
                                          </span>
                                        </div>

                                        <div className="text-center mb-2">
                                          <button 
                                            onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                                            className="w-full text-primary text-xs font-bold py-2 rounded-xl bg-primary/5 border border-primary/20 hover:bg-primary/10 transition-all"
                                          >
                                            {(isExpanded || isCancelling)
                                              ? (language === 'ar' ? 'إخفاء التفاصيل' : 'Hide Details')
                                              : (language === 'ar' ? 'عرض التفاصيل' : 'Show Details')}
                                          </button>
                                        </div>

                                        {/* Expanded Content */}
                                        <div className={`overflow-hidden ease-in-out ${isDetailsOpen ? 'transition-all duration-500 max-h-[1000px] opacity-100 mt-4' : 'max-h-0 opacity-0 transition-none'}`}>
                                          <div className="space-y-4">
                                            {/* Cancellation Reason UI */}
                                            {isCancelling && (
                                              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 space-y-3 animate-in fade-in slide-in-from-top-2">
                                                <p className="text-red-400 text-xs font-bold text-right">{language === 'ar' ? 'سبب الإلغاء:' : 'Cancellation Reason:'}</p>
                                                <textarea
                                                  value={cancelReason}
                                                  onChange={(e) => setCancelReason(e.target.value)}
                                                  className="w-full bg-dark border border-red-500/50 rounded-lg p-2 text-white text-right text-xs resize-none"
                                                  rows={2}
                                                  dir="rtl"
                                                  placeholder={language === 'ar' ? 'اكتب سبب الإلغاء...' : 'Write reason...'}
                                                  autoFocus
                                                />
                                                <div className="flex gap-2">
                                                  <button
                                                    onClick={() => handleCancelOrder(order.id)}
                                                    className="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs py-2 rounded-lg font-bold transition-colors"
                                                  >
                                                    {language === 'ar' ? 'تأكيد الإلغاء' : 'Confirm Cancel'}
                                                  </button>
                                                  <button
                                                    onClick={() => setCancelOrderId(null)}
                                                    className="px-3 bg-gray-600 hover:bg-gray-500 text-white text-xs py-2 rounded-lg transition-colors"
                                                  >
                                                    {language === 'ar' ? 'تراجع' : 'Back'}
                                                  </button>
                                                </div>
                                              </div>
                                            )}

                                            {/* Note Editing UI */}
                                            {isEditingNote && (
                                              <div className="bg-primary/10 border border-primary/30 rounded-xl p-3 space-y-3 animate-in fade-in slide-in-from-top-2">
                                                <p className="text-primary text-xs font-bold text-right">
                                                  {order.order_note?.trim()
                                                    ? (language === 'ar' ? 'تعديل الملاحظة:' : 'Edit Note:')
                                                    : (language === 'ar' ? 'إضافة ملاحظة:' : 'Add Note:')}
                                                </p>
                                                <textarea
                                                  value={editedNote}
                                                  onChange={(e) => setEditedNote(e.target.value)}
                                                  className="w-full bg-dark border border-primary/50 rounded-lg p-2 text-white text-right text-xs resize-none"
                                                  rows={2}
                                                  dir="rtl"
                                                  placeholder={language === 'ar' ? 'اكتب ملاحظتك هنا...' : 'Write note...'}
                                                  autoFocus
                                                />
                                                <div className="flex gap-2">
                                                  <button
                                                    onClick={async () => {
                                                      const noteToSave = editedNote.trim();
                                                      await supabase
                                                        .from('orders')
                                                        .update({ order_note: noteToSave })
                                                        .eq('id', order.id);
                                                      setEditingNoteOrderId(null);
                                                      fetchOrders();
                                                    }}
                                                    className="flex-1 bg-green-600 text-white text-xs py-2 rounded-lg font-bold flex items-center justify-center gap-1"
                                                  >
                                                    <Save className="w-3 h-3" />
                                                    {language === 'ar' ? 'حفظ' : 'Save'}
                                                  </button>
                                                  <button
                                                    onClick={() => setEditingNoteOrderId(null)}
                                                    className="px-3 bg-gray-600 text-white text-xs py-2 rounded-lg"
                                                  >
                                                    {language === 'ar' ? 'إلغاء' : 'Cancel'}
                                                  </button>
                                                </div>
                                              </div>
                                            )}

                                            <div>
                                              <p className="text-white/60 text-[10px] font-bold mb-2 text-right">{language === 'ar' ? 'الأصناف' : 'ITEMS'}</p>
                                              <div className="space-y-1.5">
                                                {order.items.map(item => (
                                                  <div key={item.id} className="flex items-center justify-between text-[11px] bg-white/5 p-2 rounded-xl border border-white/5">
                                                    <span className="text-primary font-bold">{item.subtotal} {language === 'ar' ? 'ج' : 'EG'}</span>
                                                    <div className="text-right">
                                                      <span className="text-white font-medium">{item.item_name}</span>
                                                      <span className="text-primary ml-2 font-black">x{item.quantity}</span>
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>

                                            <div className="bg-primary/5 rounded-2xl p-3 border border-primary/20 space-y-2">
                                              <div className="flex justify-between items-center text-[11px] text-gray-400">
                                                <span className="font-bold">{itemsTotal} {language === 'ar' ? 'ج' : 'EG'}</span>
                                                <span>{language === 'ar' ? 'إجمالي الأصناف' : 'Items Total'}</span>
                                              </div>
                                              {discount > 0 && (
                                                <div className="flex justify-between items-center text-green-400 text-[11px]">
                                                  <span className="font-bold">-{discount} {language === 'ar' ? 'ج' : 'EG'}</span>
                                                  <span>{language === 'ar' ? 'كوبون الخصم' : 'Discount Coupon'}</span>
                                                </div>
                                              )}
                                              {(order.delivery_method === 'delivery' || deliveryFee > 0) && (
                                                <div className="flex justify-between items-center text-[11px] text-gray-400">
                                                  <span className="font-bold">
                                                    {deliveryFee > 0 ? `${deliveryFee} ${language === 'ar' ? 'ج' : 'EG'}` : (language === 'ar' ? 'مجاني' : 'Free')}
                                                  </span>
                                                  <span>{language === 'ar' ? 'التوصيل' : 'Delivery Fee'}</span>
                                                </div>
                                              )}
                                              <div className="flex justify-between items-center text-white border-t border-primary/20 pt-2 mt-2">
                                                <span className="font-black text-lg text-primary">{order.total_amount} {language === 'ar' ? 'ج' : 'EG'}</span>
                                                <span className="font-black text-sm">{language === 'ar' ? 'الإجمالي' : 'Total'}</span>
                                              </div>
                                            </div>

                                            {/* Note Display if exists and not editing */}
                                            {order.notes && order.notes.length > 0 && (
                                              <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-3 flex flex-col items-end gap-2 mt-2 mb-2">
                                                <div className="flex items-center gap-2">
                                                  <span className="text-[10px] text-yellow-300 font-bold">{language === 'ar' ? 'ملاحظة الأوبراتور:' : 'Operator Note:'}</span>
                                                  <StickyNote className="w-4 h-4 text-yellow-300" />
                                                </div>
                                                {order.notes.map(note => (
                                                  <p key={note.id} className="text-xs text-yellow-200 text-right">{note.note}</p>
                                                ))}
                                              </div>
                                            )}

                                            {order.order_note && !isEditingNote && (
                                              <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 flex items-start gap-3">
                                                <StickyNote className="w-4 h-4 text-primary mt-0.5" />
                                                <div className="flex-1">
                                                  <p className="text-[10px] text-primary/60 font-bold mb-1 text-right">{language === 'ar' ? 'ملاحظة الطلب:' : 'Order Note:'}</p>
                                                  <p className="text-xs text-white text-right">{order.order_note}</p>
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Past Orders List */}
                          <div className="space-y-4">
                            <h4 className="text-white font-bold text-right text-lg border-t border-primary/20 pt-6">
                              {language === 'ar' ? 'الطلبات السابقة' : 'Past Orders'}
                            </h4>
                            {pastOrders.length === 0 ? (
                              <div className="text-center py-8 bg-surface rounded-2xl border border-primary/20">
                                <Package className="w-16 h-16 text-primary/50 mx-auto mb-3" />
                                <p className="text-lg text-primary font-bold">{language === 'ar' ? 'لا توجد طلبات سابقة' : 'No Past Orders'}</p>
                              </div>
                            ) : (
                              pastOrders.map(order => {
                                const statusInfo = getStatusInfo(order.status);
                                const StatusIcon = statusInfo.icon;

                                return (
                                  <div
                                    key={order.id}
                                    className="bg-dark/50 border border-primary/30 rounded-xl p-6"
                                  >
                                    <div className="flex items-start justify-between mb-4">
                                      <div className="text-right flex-1">
                                        <div className="flex items-center justify-end gap-2 mb-1">
                                          {order.isArchived && (
                                            <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full font-bold flex items-center gap-1">
                                              <Archive className="w-3 h-3" />
                                              {language === 'ar' ? 'أرشيف' : 'Archived'}
                                            </span>
                                          )}
                                          <p className="text-muted text-sm">{language === 'ar' ? 'رقم الطلب' : 'Order Number'}</p>
                                        </div>
                                        <p className="text-white font-bold text-lg">{order.order_number}</p>
                                        <p className="text-gray-400 text-sm mt-1">
                                          {new Date(order.created_at).toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
                                            year: 'numeric',
                                            month: 'long',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                          })}
                                        </p>
                                      </div>

                                      <div className={`flex items-center gap-2 ${statusInfo.color}`}>
                                        <span className="font-bold">{statusInfo.text}</span>
                                        <StatusIcon className="w-6 h-6" />
                                      </div>
                                    </div>

                                    <div className="border-t border-purple-500/30 pt-4 mb-4">
                                      <h4 className="text-white font-bold mb-2 text-right">{language === 'ar' ? 'الأصناف:' : 'Items:'}</h4>
                                      <div className="space-y-2">
                                        {order.items.map(item => (
                                          <div key={item.id} className="flex items-center justify-between text-sm bg-gray-900/50 p-2 rounded">
                                            <span className="text-primary font-bold">{item.subtotal} {language === 'ar' ? 'ج' : 'EG'}</span>
                                            <div className="text-right">
                                              <span className="text-white">{item.item_name}</span>
                                              <span className="text-gray-400 mr-2">x{item.quantity}</span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>

                                    {(() => {
                                      const itemsTotal = order.items.reduce((sum, item) => sum + item.subtotal, 0);
                                      const discount = order.applied_coupon_discount_percent
                                        ? Math.round((itemsTotal * order.applied_coupon_discount_percent) / 100)
                                        : 0;
                                      const deliveryFee = order.total_amount - (itemsTotal - discount);

                                      return (
                                        <div className="border-t border-purple-500/30 pt-3 pb-4 mb-4 space-y-2 px-2 text-sm bg-black/20 rounded-lg">
                                          <div className="flex justify-between items-center text-gray-300">
                                            <span className="font-bold">{itemsTotal} {language === 'ar' ? 'ج' : 'EG'}</span>
                                            <span>{language === 'ar' ? 'إجمالي الأصناف' : 'Items Total'}</span>
                                          </div>

                                          {(order.delivery_method === 'delivery' || deliveryFee > 0) && (
                                            <div className="flex justify-between items-center text-gray-300">
                                              <span className="font-bold">
                                                {deliveryFee > 0 ? `${deliveryFee} ${language === 'ar' ? 'ج' : 'EG'}` : (language === 'ar' ? 'مجاني' : 'Free')}
                                              </span>
                                              <span>{language === 'ar' ? 'خدمة التوصيل' : 'Delivery Service'}</span>
                                            </div>
                                          )}

                                          {discount > 0 && (
                                            <div className="flex justify-between items-center text-green-400 text-xs mt-1">
                                              <span className="font-bold">-{discount} {language === 'ar' ? 'ج' : 'EG'}</span>
                                              <span>{language === 'ar' ? 'خصم الكوبون' : 'Coupon Discount'} ({order.applied_coupon_discount_percent}%)</span>
                                            </div>
                                          )}

                                          <div className="flex justify-between items-center text-white border-t border-purple-500/20 pt-2 mt-2">
                                            <span className="font-black text-lg text-primary">{order.total_amount} {language === 'ar' ? 'ج' : 'EG'}</span>
                                            <span className="font-bold">{language === 'ar' ? 'الإجمالي المطلوب' : 'Grand Total'}</span>
                                          </div>
                                        </div>
                                      );
                                    })()}

                                    {/* Order Note Section */}
                                    {order.order_note !== undefined && (
                                      <div className="bg-primary/20 border border-primary/50 rounded-lg p-3 mb-4">
                                        <div className="flex items-center justify-between mb-2">
                                          <div className="flex items-center gap-2">
                                            <span className="text-muted font-bold">{language === 'ar' ? 'ملاحظة الطلب' : 'Order Note'}</span>
                                            <StickyNote className="w-5 h-5 text-muted" />
                                          </div>
                                          {!order.isArchived &&
                                            order.status !== 'on_way' &&
                                            order.status !== 'arrived' &&
                                            order.status !== 'completed' &&
                                            order.status !== 'cancelled' && (
                                              <button
                                                onClick={() => {
                                                  setEditingNoteOrderId(order.id);
                                                  setEditedNote(order.order_note || '');
                                                }}
                                                className="text-primary hover:text-purple-300 transition-colors"
                                              >
                                                <Edit2 className="w-4 h-4" />
                                              </button>
                                            )}
                                        </div>
                                        {editingNoteOrderId === order.id ? (
                                          <div className="space-y-2">
                                            <textarea
                                              value={editedNote}
                                              onChange={(e) => setEditedNote(e.target.value)}
                                              className="w-full bg-dark border border-primary rounded-lg p-2 text-white text-right resize-none"
                                              rows={3}
                                              dir="rtl"
                                              placeholder={language === 'ar' ? 'اكتب ملاحظة...' : 'Write a note...'}
                                            />
                                            <div className="flex gap-2">
                                              <button
                                                onClick={async () => {
                                                  try {
                                                    if (!editedNote.trim()) {
                                                      // Delete note if empty
                                                      await supabase
                                                        .from('orders')
                                                        .update({ order_note: '' })
                                                        .eq('id', order.id);
                                                    } else {
                                                      // Update note
                                                      await supabase
                                                        .from('orders')
                                                        .update({ order_note: editedNote.trim() })
                                                        .eq('id', order.id);
                                                    }
                                                    setEditingNoteOrderId(null);
                                                    setEditedNote('');
                                                    fetchOrders();
                                                  } catch (error) {
                                                    console.error('Error updating note:', error);
                                                    alert(language === 'ar' ? 'حدث خطأ أثناء تحديث الملاحظة' : 'Error updating note');
                                                  }
                                                }}
                                                className="flex-1 bg-green-600 hover:bg-green-500 text-white py-2 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
                                              >
                                                <Save className="w-4 h-4" />
                                                {language === 'ar' ? 'حفظ' : 'Save'}
                                              </button>
                                              <button
                                                onClick={() => {
                                                  setEditingNoteOrderId(null);
                                                  setEditedNote('');
                                                }}
                                                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition-colors"
                                              >
                                                {language === 'ar' ? 'إلغاء' : 'Cancel'}
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <p className="text-muted text-sm text-right">
                                            {order.order_note || (language === 'ar' ? 'لا توجد ملاحظة' : 'No note')}
                                          </p>
                                        )}
                                      </div>
                                    )}

                                    {order.notes.length > 0 && (
                                      <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-3 mb-4">
                                        <div className="flex items-center gap-2 mb-2 justify-end">
                                          <span className="text-yellow-300 font-bold">{language === 'ar' ? 'ملاحظات' : 'Notes'}</span>
                                          <StickyNote className="w-5 h-5 text-yellow-300" />
                                        </div>
                                        {order.notes.map(note => (
                                          <p key={note.id} className="text-yellow-200 text-sm text-right">
                                            {note.note}
                                          </p>
                                        ))}
                                      </div>
                                    )}

                                    {order.status === 'cancelled' && order.cancellation_reason && (
                                      <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3 mb-4">
                                        <div className="flex items-center gap-2 mb-2 justify-end">
                                          <span className="text-red-300 font-bold">{language === 'ar' ? 'سبب الإلغاء' : 'Cancellation Reason'}</span>
                                        </div>
                                        <p className="text-red-200 text-sm text-right">{order.cancellation_reason}</p>
                                      </div>
                                    )}

                                    <div className="flex items-center justify-between border-t border-purple-500/30 pt-4">
                                      {!order.isArchived && canCancel(order.status) && (
                                        <button
                                          onClick={() => setCancelOrderId(order.id)}
                                          className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg transition-colors font-bold"
                                        >
                                          {language === 'ar' ? 'إلغاء الطلب' : 'Cancel Order'}
                                        </button>
                                      )}
                                      {!order.isArchived && order.status === 'cancellation_pending' && (
                                        <div className="bg-yellow-900/30 text-yellow-300 px-4 py-2 rounded-lg text-sm">
                                          {language === 'ar' ? 'في انتظار مراجعة الإلغاء' : 'Cancellation Pending Review'}
                                        </div>
                                      )}
                                      {order.isArchived && (
                                        <div className="text-blue-400 text-sm">
                                          {language === 'ar' ? 'تم الأرشفة' : 'Archived'}
                                        </div>
                                      )}
                                      <div className="text-2xl font-black text-white">
                                        {order.total_amount} <span className="text-lg">{language === 'ar' ? 'ج' : 'EG'}</span>
                                      </div>
                                    </div>

                                    {cancelOrderId === order.id && (
                                      <div className="mt-4 bg-red-900/20 border border-red-500 rounded-lg p-4">
                                        <label className="block text-red-300 mb-2 text-right">{language === 'ar' ? 'سبب الإلغاء' : 'Cancellation Reason'}</label>
                                        <textarea
                                          value={cancelReason}
                                          onChange={(e) => setCancelReason(e.target.value)}
                                          className="w-full bg-gray-800 border border-red-500 rounded-lg p-3 text-white text-right resize-none"
                                          rows={3}
                                          placeholder={language === 'ar' ? 'الرجاء كتابة سبب الإلغاء...' : 'Please enter cancellation reason...'}
                                          dir={language === 'ar' ? 'rtl' : 'ltr'}
                                        />
                                        <div className="flex gap-2 mt-2">
                                          <button
                                            onClick={() => {
                                              setCancelOrderId(null);
                                              setCancelReason('');
                                            }}
                                            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition-colors"
                                          >
                                            {language === 'ar' ? 'إلغاء' : 'Cancel'}
                                          </button>
                                          <button
                                            onClick={() => handleCancelOrder(order.id)}
                                            className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-lg transition-colors font-bold"
                                          >
                                            {language === 'ar' ? 'تأكيد الإلغاء' : 'Confirm Cancellation'}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </>
                      );
                    })()}
                    </div>
                  )}
                </>
              )}
            </div>
        </div>
        {!phoneChrome && desktopAddressMapOverlayOpen && (
          <div className="absolute inset-0 z-[95] rounded-[1.85rem] border-2 border-primary/45 bg-dark/95 p-3 profile-mobile-push">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setDesktopAddressMapOverlayOpen(false)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-black/25 px-3 py-1.5 text-xs font-black text-white"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              {language === 'ar' ? 'رجوع' : 'Back'}
            </button>
            <button
              type="button"
              onClick={() => setDesktopAddressMapOverlayOpen(false)}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-white"
            >
              {language === 'ar' ? 'تأكيد الموقع' : 'Confirm Location'}
            </button>
          </div>
          <InteractiveMap
            latitude={typeof mapLat === 'number' ? mapLat : 30.0444}
            longitude={typeof mapLng === 'number' ? mapLng : 31.2357}
            onLocationChange={(lat, lng) => setProfileDraft((p) => ({ ...p, latitude: lat, longitude: lng }))}
            onAddressChange={(address) =>
              setProfileDraft((p) => ({
                ...p,
                street: address.street || p.street,
                area: address.area || p.area,
                city: address.city || p.city,
                building_number: address.buildingNumber || p.building_number
              }))
            }
            isEditing={true}
            className="h-[calc(100%-40px)]"
            containerHeight="100%"
          />
          </div>
        )}
      </div>
      {phoneChrome && mobileProfileTabSheet && mobileProfileTabMenuPos && (
        <>
          <div className="fixed inset-0 z-[120]" onClick={() => setMobileProfileTabSheet(null)} />
          <div
            className="fixed z-[130] rounded-lg border border-primary/50 bg-[hsl(var(--color-surface))] shadow-xl flex overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            style={{
              top: mobileProfileTabMenuPos.top,
              left: mobileProfileTabMenuPos.left,
              width: mobileProfileTabMenuPos.width,
              transform: 'translateX(-50%)'
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault(); e.stopPropagation();
                setShowProfileCustomAddressInput(false);
                setRenameProfileTabTarget(mobileProfileTabSheet);
                setRenameProfileTabInput(mobileProfileTabSheet.label);
                setMobileProfileTabSheet(null);
                setMobileProfileTabMenuPos(null);
              }}
              className="flex-1 py-3 flex items-center justify-center text-primary hover:bg-primary/15 transition-colors"
            >
              <Edit2 className="w-5 h-5" />
            </button>
            <div className="w-px bg-primary/25 self-stretch my-1" />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault(); e.stopPropagation();
                removeProfileAddressTab(mobileProfileTabSheet);
              }}
              className="flex-1 py-3 flex items-center justify-center text-red-300 hover:bg-red-500/15 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </>
      )}
      <style>{`
        .profile-dropdown-desktop {
          animation: profileDockSheet 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
          transition: max-width 320ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes profileDockSheet {
          from {
            opacity: 0;
            transform: translateY(22px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .profile-dropdown-phone {
          animation: profilePhoneIn 0.22s ease-out both;
        }
        @keyframes profilePhoneIn {
          from {
            opacity: 0.85;
          }
          to {
            opacity: 1;
          }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(168, 85, 247, 0.1);
          border-radius: 0;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(168, 85, 247, 0.6);
          border-radius: 10px;
          border: 2px solid rgba(168, 85, 247, 0.1);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(168, 85, 247, 0.8);
        }
        .hide-scroll::-webkit-scrollbar {
          display: none;
        }
        .hide-scroll {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .custom-horizontal-scrollbar::-webkit-scrollbar {
          height: 6px;
        }
        .custom-horizontal-scrollbar::-webkit-scrollbar-track {
          background: rgba(168, 85, 247, 0.05);
          border-radius: 10px;
          margin: 0 20px;
        }
        .custom-horizontal-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(168, 85, 247, 0.4);
          border-radius: 10px;
        }
        .custom-horizontal-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(168, 85, 247, 0.6);
        }
        .order-highlight-glow {
          animation: orderGlow 1.5s ease-in-out infinite alternate;
          border-color: #a855f7 !important;
          z-index: 10;
        }
        @keyframes orderGlow {
          from {
            box-shadow: 0 0 5px rgba(168, 85, 247, 0.2), inset 0 0 5px rgba(168, 85, 247, 0.1);
          }
          to {
            box-shadow: 0 0 20px rgba(168, 85, 247, 0.6), inset 0 0 10px rgba(168, 85, 247, 0.3);
          }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}