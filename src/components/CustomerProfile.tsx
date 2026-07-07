import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, X, Package, Clock, Truck, AlertTriangle, StickyNote, Globe, Moon, Sun, Edit2, Save, Archive, TicketPercent, MoreVertical, MessageSquare, Lock, Plus, ChevronRight, ChevronLeft, Building, Home, Briefcase, XCircle, Pencil, LogOut } from 'lucide-react';
import MobileMapEditor from './MobileMapEditor';
import { saveSharedAddress, getSharedAddress, subscribeToAddressSync, saveSharedAddressTabs, getSharedAddressTabs } from '../lib/addressSync';
import { fetchDeliveryZonesAndServices } from '../lib/deliveryMatch';
import { supabase, Order, OrderItem, Item, CustomerNote, Customer, DeviceCoupon, CustomerData, SavedAddressTab, AddressType, DeliveryZone, DeliveryService } from '../lib/supabase';
import { buildCatalogLookup, resolveOrderItemNames, type CatalogLookup } from '../lib/itemDisplayName';
import { getOrCreateDeviceFingerprint } from '../lib/deviceFingerprint';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { generateEasyRecoveryCode, hashPhonePassword, hashRecoveryCode } from '../lib/phonePassword';
import { findCustomerIdByPhone, findCustomerAuthByPhone, ensureCustomerByPhone } from '../lib/customerPhone';
import { isTouchPhoneChrome } from '../lib/viewportUi';
import InteractiveMap from './InteractiveMap';
import TimePicker from './TimePicker';
import AddressNamePopover from './AddressNamePopover';
import { formatDeadline } from '../lib/dateUtils';

interface CustomerProfileProps {
  isOpen: boolean;
  onClose: () => void;
  customerPhone: string;
  highlightOrderId?: string | null;
  initialTab?: 'settings' | 'orders';
  onPhoneValidated?: (phone: string) => void | Promise<void>;
  onSettingsViewChange?: (view: string) => void;
  onStartOrderEdit?: (order: OrderWithDetails) => void;
  catalogItems?: Item[];
}

interface OrderWithDetails extends Order {
  items: OrderItem[];
  notes: CustomerNote[];
  customer?: Customer | null;
  isArchived?: boolean;
}

type PickupActionMeta = { showPickupAction: boolean; pickupActionType: 'add' | 'edit' };

function getOrderPickupActionMeta(order: Order): PickupActionMeta {
  const isPickup = order.delivery_method === 'pickup';
  const isUnderReview = order.status === 'under_review';
  const deadline = order.pickup_deadline_at ? new Date(order.pickup_deadline_at).getTime() : 0;
  const hasDeadline = deadline > 0;
  let showPickupAction = false;
  let pickupActionType: 'add' | 'edit' = 'add';
  if (isUnderReview) {
    showPickupAction = true;
    pickupActionType = (isPickup && hasDeadline) ? 'edit' : 'add';
  } else if (isPickup && hasDeadline) {
    const now = Date.now();
    const diffHours = (deadline - now) / (1000 * 60 * 60);
    const updatedAt = order.pickup_deadline_updated_at
      ? new Date(order.pickup_deadline_updated_at).getTime()
      : new Date(order.created_at).getTime();
    const minsSinceUpdate = (now - updatedAt) / (1000 * 60);
    if (diffHours > 1 || minsSinceUpdate <= 30) {
      showPickupAction = true;
      pickupActionType = 'edit';
    }
  }
  return { showPickupAction, pickupActionType };
}

interface OrderOptionsDropdownProps {
  order: OrderWithDetails;
  language: 'ar' | 'en';
  isOpen: boolean;
  onClose: () => void;
  onPickupTime: () => void;
  onEditOrder: () => void;
  onCancelOrder: () => void;
  onEditNote: () => void;
  overlayZClass?: string;
  menuZClass?: string;
}

function OrderOptionsDropdown({
  order,
  language,
  isOpen,
  onClose,
  onPickupTime,
  onEditOrder,
  onCancelOrder,
  onEditNote,
  overlayZClass = 'z-[100]',
  menuZClass = 'z-[101]',
}: OrderOptionsDropdownProps) {
  if (!isOpen) return null;
  const isAr = language === 'ar';
  const { showPickupAction, pickupActionType } = getOrderPickupActionMeta(order);

  return (
    <>
      <div
        className={`fixed inset-0 ${overlayZClass}`}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      />
      <div
        dir={isAr ? 'rtl' : 'ltr'}
        className={`absolute top-full mt-2 ${isAr ? 'left-0' : 'right-0'} w-[min(280px,calc(100vw-2rem))] ${menuZClass} bg-dark border border-primary/30 rounded-xl shadow-2xl overflow-hidden flex flex-col origin-top animate-in fade-in slide-in-from-top-2 duration-200`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
          <h3 className="text-sm font-black text-white">{isAr ? 'خيارات الطلب' : 'Order Options'}</h3>
        </div>
        <div className="py-1">
          {showPickupAction && (
            <button
              type="button"
              onClick={() => { onPickupTime(); onClose(); }}
              className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-primary/10 transition-colors text-white text-sm font-bold"
            >
              <Clock className="w-4 h-4 text-primary shrink-0" />
              <span>{pickupActionType === 'add' ? (isAr ? 'إضافة موعد الاستلام' : 'Add Pickup Time') : (isAr ? 'تعديل موعد الاستلام' : 'Change Pickup Time')}</span>
            </button>
          )}
          {(order.status === 'under_review' || order.status === 'preparing') && (
            <button
              type="button"
              onClick={() => { onEditOrder(); onClose(); }}
              className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-primary/10 transition-colors text-white text-sm font-bold"
            >
              <Edit2 className="w-4 h-4 text-primary shrink-0" />
              <span>{isAr ? 'تعديل الطلب' : 'Edit Order'}</span>
            </button>
          )}
          {order.status === 'under_review' && (
            <button
              type="button"
              onClick={() => { onCancelOrder(); onClose(); }}
              className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-red-500/10 transition-colors text-red-400 text-sm font-bold"
            >
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{isAr ? 'إلغاء الطلب' : 'Cancel Order'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => { onEditNote(); onClose(); }}
            className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-primary/10 transition-colors text-white text-sm font-bold"
          >
            <MessageSquare className="w-4 h-4 text-primary shrink-0" />
            <span>{order.order_note?.trim() ? (isAr ? 'تعديل الملاحظة' : 'Edit Note') : (isAr ? 'أضف ملاحظة' : 'Add Note')}</span>
          </button>
        </div>
      </div>
    </>
  );
}

function normalizeSavedAddressLabelKey(label: string): string {
  return label.trim().toLowerCase();
}

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



function OrderTimeline({ order, language }: { order: any; language: 'ar' | 'en' }) {
  const isPickup = order.delivery_method === 'pickup';

  const deliverySteps = [
    { status: 'under_review', label: language === 'ar' ? 'المعالجة' : 'Processing', icon: Clock },
    { status: 'preparing', label: language === 'ar' ? 'قيد التحضير' : 'Preparing', icon: Package },
    { status: 'on_way', label: language === 'ar' ? 'في الطريق' : 'On the Way', icon: Truck },
    { status: 'completed', label: language === 'ar' ? 'تم التسليم' : 'Delivered', icon: CheckCircle }
  ];

  const pickupSteps = [
    { status: 'under_review', label: language === 'ar' ? 'قيد المعاينة' : 'Under Review', icon: Clock },
    { status: 'preparing', label: language === 'ar' ? 'قيد التحضير' : 'Preparing', icon: Package },
    { status: 'arrived', label: language === 'ar' ? 'تم التحضير' : 'Ready', icon: CheckCircle },
    { status: 'completed', label: language === 'ar' ? 'تم التسليم' : 'Delivered', icon: CheckCircle }
  ];

  const steps = isPickup ? pickupSteps : deliverySteps;
  const currentIndex = steps.findIndex(s => s.status === order.status);

  // If order is cancelled/rejected, we don't show normal timeline, or we show it greyed out
  if (order.status === 'cancelled' || order.status === 'rejected') {
    return (
      <div className="py-4 flex flex-col items-center justify-center opacity-70">
        <XCircle className="w-12 h-12 text-red-500 mb-2" />
        <p className="text-red-500 font-bold">{language === 'ar' ? 'الطلب ملغي' : 'Order Cancelled'}</p>
      </div>
    );
  }

  return (
    <div className="relative py-4 px-2 select-none" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {steps.map((step, idx) => {
        const isCompleted = currentIndex >= idx;
        const isCurrent = currentIndex === idx;
        const Icon = step.icon;

        return (
          <div key={step.status} className="flex items-start mb-6 relative">
            {/* Vertical Line */}
            {idx < steps.length - 1 && (
              <div className={`absolute top-10 bottom-[-24px] w-0.5 transition-colors duration-500 ${language === 'ar' ? 'right-6' : 'left-6'} ${currentIndex > idx ? 'bg-primary' : 'bg-primary/20 border-dashed border-l border-primary/40'}`}></div>
            )}

            <div className={`relative z-10 flex items-center justify-center w-12 h-12 rounded-full transition-all duration-500 border-4 ${isCurrent ? 'bg-primary border-primary/20 shadow-[0_0_15px_rgba(var(--color-primary),0.5)] scale-110' : isCompleted ? 'bg-primary border-transparent' : 'bg-dark border-primary/30'}`}>
              <Icon className={`w-5 h-5 transition-colors duration-500 ${isCurrent || isCompleted ? 'text-white' : 'text-gray-500'}`} />
            </div>

            <div className={`flex-1 transition-all duration-500 ${language === 'ar' ? 'pr-4' : 'pl-4'} pt-3`}>
              <div className="flex items-center gap-3">
                <h4 className={`text-sm font-bold transition-colors duration-500 ${isCurrent ? 'text-white' : isCompleted ? 'text-gray-300' : 'text-gray-500'}`}>
                  {step.label}
                </h4>
                {step.status === 'under_review' && order.created_at && (
                  <span className="text-[10px] text-gray-400 font-bold bg-white/5 px-2 py-0.5 rounded" dir="ltr">
                    {new Date(order.created_at).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {step.status !== 'under_review' && isCompleted && order.updated_at && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isCurrent ? 'text-primary bg-primary/10' : 'text-gray-400 bg-white/5'}`} dir="ltr">
                    {new Date(order.updated_at).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}


function OrderItemsSlider({ items, language, catalog }: { items: OrderItem[]; language: 'ar' | 'en'; catalog?: CatalogLookup }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const itemsPerSlide = 3;
  const totalSlides = Math.ceil(items.length / itemsPerSlide);

  const slides = Array.from({ length: totalSlides }, (_, i) => 
    items.slice(i * itemsPerSlide, (i + 1) * itemsPerSlide)
  );

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, clientWidth } = scrollRef.current;
    const index = Math.round(Math.abs(scrollLeft) / clientWidth);
    setCurrentIndex(index);
  };

  const scrollToSlide = (index: number) => {
    if (!scrollRef.current) return;
    const child = scrollRef.current.children[index] as HTMLElement;
    if (child) {
      child.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
  };

  if (items.length === 0) return null;

  const hasItemsLeft = language === 'ar' ? currentIndex < totalSlides - 1 : currentIndex > 0;
  const hasItemsRight = language === 'ar' ? currentIndex > 0 : currentIndex < totalSlides - 1;

  const goLeft = () => {
    const nextIndex = language === 'ar' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex >= 0 && nextIndex < totalSlides) scrollToSlide(nextIndex);
  };

  const goRight = () => {
    const nextIndex = language === 'ar' ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex >= 0 && nextIndex < totalSlides) scrollToSlide(nextIndex);
  };

  return (
    <div className="flex flex-col mb-6">
      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div className="flex justify-between items-center mb-3 px-1" dir="ltr">
        <div className="w-8 shrink-0">
          <button 
            onClick={goLeft}
            disabled={!(totalSlides > 1 && hasItemsLeft)}
            className={`p-1 rounded-full transition-colors ${
              totalSlides > 1 && hasItemsLeft 
                ? 'bg-primary/20 text-primary hover:bg-primary/30' 
                : 'opacity-0 cursor-default pointer-events-none'
            }`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
        
        <h3 className="text-sm font-black text-white flex-1 text-center" dir={language === 'ar' ? 'rtl' : 'ltr'}>
          {language === 'ar' ? 'الأصناف' : 'Items'}
        </h3>
        
        <div className="w-8 shrink-0 flex justify-end">
          <button 
            onClick={goRight}
            disabled={!(totalSlides > 1 && hasItemsRight)}
            className={`p-1 rounded-full transition-colors ${
              totalSlides > 1 && hasItemsRight 
                ? 'bg-primary/20 text-primary hover:bg-primary/30' 
                : 'opacity-0 cursor-default pointer-events-none'
            }`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar -mx-1"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {slides.map((slideItems, slideIdx) => (
          <div key={slideIdx} className="w-full shrink-0 snap-center px-1">
            <div className="space-y-3">
              {slideItems.map(item => {
                const { title, subtitle } = resolveOrderItemNames(item, language, catalog);
                return (
                <div key={item.id} className="flex gap-4 p-3 bg-white/5 rounded-2xl border border-white/5">
                  <div className="w-16 h-16 rounded-xl bg-dark/50 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center p-1">
                    {item.image_url ? (
                      <img src={item.image_url} alt={title} className="w-full h-full object-cover rounded-lg" />
                    ) : (
                      <Package className="w-6 h-6 text-white/20" />
                    )}
                  </div>
                  <div className="flex-1 py-1 flex flex-col justify-between text-start">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <span className="font-bold text-white text-sm line-clamp-2 block">{title}</span>
                        {subtitle && (
                          <span className="text-[10px] text-gray-400 line-clamp-1 block mt-0.5">{subtitle}</span>
                        )}
                      </div>
                      <span className="font-black text-primary bg-primary/10 px-2 py-0.5 rounded text-sm shrink-0 block mr-2" dir="ltr">x{item.quantity}</span>
                    </div>
                    <span className="font-bold text-white block mt-2 text-start">{item.subtotal} <span className="text-[10px] text-gray-400">{language === 'ar' ? 'ج' : 'EG'}</span></span>
                  </div>
                </div>
              );})}
            </div>
          </div>
        ))}
      </div>

      {totalSlides > 1 && (
        <div className="flex justify-center gap-1.5 mt-4" dir="ltr">
          {Array.from({ length: totalSlides }).map((_, idx) => (
            <div 
              key={idx}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                (language === 'ar' ? (totalSlides - 1 - currentIndex) : currentIndex) === idx ? 'w-4 bg-primary' : 'w-1.5 bg-white/20'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}


export default function CustomerProfile({ isOpen, onClose, customerPhone, highlightOrderId, initialTab = 'settings', onPhoneValidated, onSettingsViewChange, onStartOrderEdit, catalogItems = [] }: CustomerProfileProps) {
  const { language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const catalogLookup = buildCatalogLookup(catalogItems);
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedOrdersRef = useRef(false);
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
  const [fullScreenOrderId, setFullScreenOrderId] = useState<string | null>(null);

  const [profileCustomerId, setProfileCustomerId] = useState<string | null>(null);
  const [profileCustomer, setProfileCustomer] = useState<Partial<Customer> | null>(null);
  const [settingsView, setSettingsViewInternal] = useState<'main' | 'account' | 'data' | 'addresses' | 'map' | 'add_account' | 'switch_accounts' | 'security' | 'coupons'>('main');

  const setSettingsView = useCallback((view: 'main' | 'account' | 'data' | 'addresses' | 'map' | 'add_account' | 'switch_accounts' | 'security' | 'coupons') => {
    setSettingsViewInternal(view);
    onSettingsViewChange?.(view);
  }, [onSettingsViewChange]);
  const [savedAccounts, setSavedAccounts] = useState<{ name: string; phone: string }[]>([]);
  const [logoutConfirm, setLogoutConfirm] = useState<{ name: string; phone: string } | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState<string | null>(null);
  const [accountEditBackTarget, setAccountEditBackTarget] = useState<'main' | 'switch_accounts'>('main');
  const [viewingAccountPhone, setViewingAccountPhone] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [showDefaultTimePicker, setShowDefaultTimePicker] = useState(false);
  const [defaultPickupTime, setDefaultPickupTime] = useState<string | null>(localStorage.getItem('default_pickup_time'));
  const [profilePhoneError, setProfilePhoneError] = useState<string | null>(null);
  const [isSwitchingAccount, setIsSwitchingAccount] = useState<string | null>(null);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [isDeletingTime, setIsDeletingTime] = useState(false);
  const [showSecondaryProfilePhone, setShowSecondaryProfilePhone] = useState(false);
  const [profileAddressType, setProfileAddressType] = useState<AddressType>('apartment');
  const [profileSavedAddressTabs, setProfileSavedAddressTabs] = useState<SavedAddressTab[]>([]);
  const [showUpdateTimePicker, setShowUpdateTimePicker] = useState<string | null>(null); // orderId
  const [activeProfileAddressTabId, setActiveProfileAddressTabId] = useState('builtin-apartment');
  const [showProfileCustomAddressInput, setShowProfileCustomAddressInput] = useState(false);
  const [newProfileAddressName, setNewProfileAddressName] = useState('');
  const [pendingProfileAddressType, setPendingProfileAddressType] = useState<'apartment' | 'house' | 'workplace' | null>(null);
  const customAddressAnchorRef = useRef<HTMLDivElement | null>(null);
  const [addressNamePopoverPos, setAddressNamePopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [profileDraft, setProfileDraft] = useState<CustomerData>({
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
    latitude: undefined,
    longitude: undefined,
    address_type: 'apartment',
    address_label: ''
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
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [deliveryServices, setDeliveryServices] = useState<DeliveryService[]>([]);
  const [pickupTimerNow, setPickupTimerNow] = useState(() => Date.now());
  const activeSavedPhone = filterDigits(
    profileCustomer?.phone || profileDraft.phone || customerPhone || localStorage.getItem('customer_phone') || ''
  );
  const switchableAccountsCount = savedAccounts.filter((acc) => filterDigits(acc.phone || '') !== activeSavedPhone).length;

  const fetchSavedAccounts = useCallback(async () => {
    try {
      const fp = getOrCreateDeviceFingerprint();
      const activePhone = filterDigits(
        customerPhone || profileCustomer?.phone || profileDraft.phone || localStorage.getItem('customer_phone') || ''
      );

      const { data, error } = await supabase
        .from('customers')
        .select('name, phone')
        .eq('device_fingerprint', fp)
        .order('updated_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      const byFingerprint = (data || []) as { name: string; phone: string }[];
      let activeAccount: { name: string; phone: string } | null = null;

      // Fallback: if active phone exists but is missing in fingerprint results,
      // fetch it explicitly so the UI always reflects the currently active account.
      if (activePhone && !byFingerprint.some((acc) => filterDigits(acc.phone || '') === activePhone)) {
        const { data: activeRow, error: activeErr } = await supabase
          .from('customers')
          .select('name, phone')
          .eq('phone', activePhone)
          .maybeSingle();
        if (!activeErr && activeRow) {
          activeAccount = activeRow as { name: string; phone: string };
        }
      }

      const deduped = Array.from(
        new Map([...(activeAccount ? [activeAccount] : []), ...byFingerprint].map((acc) => [acc.phone, acc])).values()
      );
      setSavedAccounts(deduped);
      localStorage.setItem('mx_saved_accounts_cache', JSON.stringify(deduped));
    } catch (e) {
      console.error('Failed to fetch saved accounts:', e);
    }
  }, [customerPhone, profileCustomer?.phone, profileDraft.phone]);

  useEffect(() => {
    if (isOpen) {
      const cache = localStorage.getItem('mx_saved_accounts_cache');
      if (cache) {
        try {
          const parsed = JSON.parse(cache) as { name: string; phone: string }[];
          const deduped = Array.from(
            new Map((parsed || []).map((acc) => [acc.phone, acc])).values()
          );
          setSavedAccounts(deduped);
        } catch (e) { }
      }
      fetchSavedAccounts();
    }
  }, [isOpen, fetchSavedAccounts]);

  useEffect(() => {
    const fetchZones = async () => {
      try {
        const { zones, services } = await fetchDeliveryZonesAndServices();
        setDeliveryZones(zones || []);
        setDeliveryServices(services || []);
      } catch (err) {
        console.error('Failed to fetch delivery zones:', err);
      }
    };
    if (isOpen) {
      fetchZones();
    }
  }, [isOpen]);

  useEffect(() => {
    const sharedData = getSharedAddress();
    if (Object.keys(sharedData).length > 0) {
      setProfileDraft(prev => ({ ...prev, ...sharedData }));
    }

    const sharedTabs = getSharedAddressTabs();
    if (sharedTabs.length > 0) {
      setProfileSavedAddressTabs(sharedTabs);
    }

    return subscribeToAddressSync(
      (data) => {
        setProfileDraft(prev => ({ ...prev, ...data }));
      },
      (tabs) => {
        setProfileSavedAddressTabs(tabs);
      }
    );
  }, []);

  const locationBackupRef = useRef<any>(null);
  // Snapshot refs for discarding unsaved changes when navigating back
  const profileDraftSnapshotRef = useRef<CustomerData | null>(null);
  const addressTypeSnapshotRef = useRef<AddressType>('apartment');
  const addressTabIdSnapshotRef = useRef<string>('builtin-apartment');

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

  useEffect(() => {
    if (highlightOrderId) {
      setActiveHighlightId(highlightOrderId);
      const timer = setTimeout(() => {
        setActiveHighlightId(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [highlightOrderId]);

  useEffect(() => {
    const t = window.setInterval(() => setPickupTimerNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!fullScreenOrderId) setShowActionMenu(null);
  }, [fullScreenOrderId]);

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
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (isOpen) {
      hasLoadedOrdersRef.current = false;
      fetchOrders();
    }
  }, [isOpen, customerPhone]);

  useEffect(() => {
    if (profileCustomer) {
      const time = profileCustomer.default_pickup_time;
      setDefaultPickupTime(time || null);
      if (time) {
        localStorage.setItem('default_pickup_time', time);
      } else {
        localStorage.removeItem('default_pickup_time');
      }
    } else {
      const saved = localStorage.getItem('default_pickup_time');
      setDefaultPickupTime(saved || null);
    }
  }, [profileCustomer]);

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

  const updateAddressNamePopoverPosition = useCallback(() => {
    if (!showProfileCustomAddressInput) {
      setAddressNamePopoverPos(null);
      return;
    }
    const anchor = customAddressAnchorRef.current?.querySelector('[data-address-name-trigger]') as HTMLElement | null;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    setAddressNamePopoverPos({
      top: Math.round(r.bottom + 10),
      left: Math.round(r.left + r.width / 2)
    });
  }, [showProfileCustomAddressInput]);

  useEffect(() => {
    updateAddressNamePopoverPosition();
    if (!showProfileCustomAddressInput) return;
    const onScrollOrResize = () => updateAddressNamePopoverPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [showProfileCustomAddressInput, updateAddressNamePopoverPosition]);

  useEffect(() => {
    if (!showProfileCustomAddressInput) return;
    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-address-name-trigger]')) return;
      if (target.closest('[data-address-name-popover]')) return;
      setShowProfileCustomAddressInput(false);
      setPendingProfileAddressType(null);
      setAddressNamePopoverPos(null);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [showProfileCustomAddressInput]);

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

  useEffect(() => {
    if (!isOpen || phoneChrome) return;

    const updatePosition = () => {
      const profileButton = document.querySelector('[data-profile-button]') as HTMLElement;
      if (profileButton) {
        const rect = profileButton.getBoundingClientRect();
        if (language === 'ar') {
          setMenuPosition({
            top: rect.bottom + 8,
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
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, language, phoneChrome]);

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
          fetchOrders(undefined, false, true);
        }
      )
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_items'
        },
        () => {
          fetchOrders(undefined, false, true);
        }
      )
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customer_notes'
        },
        () => {
          fetchOrders(undefined, false, true);
        }
      )
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'archive_orders'
        },
        () => {
          fetchOrders(undefined, false, true);
        }
      )
      .subscribe();

    return () => {
      ordersChannel.unsubscribe();
    };
  }, [isOpen, customerPhone]);

  const fetchOrders = async (overridePhone?: string, skipPersistence = false, silent = false) => {
    if (!silent && !hasLoadedOrdersRef.current) {
      setLoading(true);
      setCustomerCoupons([]);
    }

    try {
      const activePhone = filterDigits(overridePhone || customerPhone || localStorage.getItem('customer_phone') || '');
      let customerId: string | null = overridePhone ? null : localStorage.getItem('customer_id');

      if (activePhone && !skipPersistence) {
        localStorage.setItem('customer_phone', activePhone);
      }

      if (activePhone) {
        const { data: customerByPhone, error: phoneErr } = await supabase
          .from('customers')
          .select('id')
          .eq('phone', activePhone)
          .maybeSingle();

        if (phoneErr) console.error("fetchOrders: error fetching by phone", phoneErr);

        if (customerByPhone?.id) {
          const resolvedCustomerId = customerByPhone.id;
          customerId = resolvedCustomerId;
          if (!skipPersistence) {
            localStorage.setItem('customer_id', resolvedCustomerId);
            setProfileCustomerId(resolvedCustomerId);
          }
          setEditingCustomerId(resolvedCustomerId);
        }
      }

      if (!customerId) {
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
              if (!skipPersistence) {
                setProfileCustomerId(customerId);
              }
              setEditingCustomerId(customerId);
            }
          }
        } catch (fpError) {
          console.error("fetchOrders: error with fingerprint", fpError);
        }
      }

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
            activePhone
              ? supabase
                .from('device_coupons')
                .select('*')
                .eq('customer_phone', activePhone)
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
        if (!skipPersistence) {
          setProfileCustomerId(null);
          setProfileCustomer(null);
        }
        setProfileDraft((prev) => ({ ...prev, phone: activePhone || '' }));
        setLoading(false);
        return;
      }

      if (!skipPersistence) {
        setProfileCustomerId(customerId);
      }
      try {
        const { data: customerRow } = await supabase
          .from('customers')
          .select('*')
          .eq('id', customerId)
          .maybeSingle();
        if (customerRow) {
          const normalized = customerRow as Customer;
          if (!skipPersistence) {
            setProfileCustomer(normalized);
          }
          setProfileDraft({
            name: normalized.name || '',
            phone: normalized.phone || activePhone || '',
            secondary_phone: normalized.secondary_phone || '',
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
            longitude: typeof normalized.longitude === 'number' ? normalized.longitude : undefined,
            default_pickup_time: normalized.default_pickup_time || ''
          });
          // Sync shared address so checkout always reflects the currently active account
          if (!skipPersistence) {
            const syncDraft = {
              name: normalized.name || '',
              phone: normalized.phone || activePhone || '',
              secondary_phone: normalized.secondary_phone || '',
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
              longitude: typeof normalized.longitude === 'number' ? normalized.longitude : undefined,
            };
            saveSharedAddress(syncDraft);
            localStorage.setItem('customer_data', JSON.stringify(syncDraft));
          }
          const normalizedAddressType = normalized.address_type;
          const initialAddressType = (normalizedAddressType === 'house' || normalizedAddressType === 'workplace')
            ? normalizedAddressType
            : 'apartment';
          setActiveProfileAddressTabId(`builtin-${initialAddressType}`);
          setProfileAddressType(initialAddressType);
          setShowSecondaryProfilePhone(!!normalized.secondary_phone);
        } else {
          const cid = customerId;
          const { data: serverTabs } = await supabase
            .from('customer_saved_addresses')
            .select('*')
            .eq('customer_id', cid)
            .order('created_at', { ascending: false });

          if (serverTabs) {
            const mapped: SavedAddressTab[] = serverTabs.map((r: any) => ({
              id: r.id,
              label: r.label,
              data: {
                address_type: r.address_type,
                address_label: r.label,
                building_number: r.building_number || '',
                street: r.street || '',
                area: r.area || '',
                city: r.city || '',
                floor: r.floor || '',
                apartment: r.apartment || '',
                house_name: r.house_name || '',
                company_name: r.company_name || '',
                landmark: r.landmark || '',
                latitude: r.latitude,
                longitude: r.longitude
              }
            }));
            setProfileSavedAddressTabs(mapped);
            saveSharedAddressTabs(mapped);
          }
        }
      } catch (e) {
        console.error('Could not load customer profile row:', e);
      }
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

      const { data: ordersData, error: ordersErr } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false });

      if (ordersErr) console.error("fetchOrders: error fetching active orders", ordersErr);

      const { data: archivedOrdersData, error: archErr } = await supabase
        .from('archive_orders')
        .select('*')
        .eq('customer_id', customerId)
        .order('archived_at', { ascending: false });

      if (archErr) console.error("fetchOrders: error fetching archive orders", archErr);

      const allOrders: OrderWithDetails[] = [];

      if (ordersData) {
        const ordersWithDetails = await Promise.all(
          ordersData.map(async (order) => {
            const { data: items } = await supabase
              .from('order_items')
              .select('*, items:item_id (image_url)')
              .eq('order_id', order.id);

            const { data: notes } = await supabase
              .from('customer_notes')
              .select('*')
              .eq('order_id', order.id);

            return {
              ...order,
              items: items ? items.map((it: any) => ({ ...it, image_url: it.items?.image_url })) : [],
              notes: (notes || []).filter((note) => note.created_by === 'customer' || note.is_public !== false),
              isArchived: false
            } as OrderWithDetails;
          })
        );
        allOrders.push(...ordersWithDetails);
      }

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
              items: items ? items.map((it: any) => ({ ...it, image_url: it.items?.image_url })) : [],
              notes: (notes || []).filter((note) => note.created_by === 'customer' || note.is_public !== false),
              customer: customer,
              isArchived: true,
              created_at: order.original_created_at || order.created_at
            };
          })
        );
        allOrders.push(...archivedWithDetails);
      }

      allOrders.sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateB - dateA;
      });

      setOrders(allOrders);
      hasLoadedOrdersRef.current = true;

    } catch (err) {
      console.error("fetchOrders: unexpected unhandled error", err);
    } finally {
      setLoading(false);
    }
  };

  const saveProfileData = async (isSilent = false, overrides?: Record<string, any>) => {
    const name = profileDraft.name?.trim();
    const phone = profileDraft.phone?.trim();
    const secondaryPhone = profileDraft.secondary_phone?.trim();
    const targetId = editingCustomerId || profileCustomerId;

    if (!phone) {
      setProfilePhoneError(language === 'ar' ? 'رقم الهاتف مطلوب' : 'Phone is required');
      return;
    }
    if (phone.length < 10) {
      setProfilePhoneError(language === 'ar' ? 'يجب أن يكون الرقم 10 أرقام على الأقل' : 'Phone must be at least 10 digits');
      return;
    }
    if (phone.length > 15) {
      setProfilePhoneError(language === 'ar' ? 'رقم الهاتف يجب ألا يتجاوز 15 رقم' : 'Phone number must not exceed 15 digits');
      return;
    }
    if (secondaryPhone && secondaryPhone.length > 15) {
      setProfilePhoneError(language === 'ar' ? 'رقم الهاتف يجب ألا يتجاوز 15 رقم' : 'Phone number must not exceed 15 digits');
      return;
    }
    if (secondaryPhone && secondaryPhone.length < 10) {
      setProfilePhoneError(language === 'ar' ? 'يجب أن يكون الرقم 10 أرقام على الأقل' : 'Phone must be at least 10 digits');
      return;
    }
    setProfilePhoneError(null);

    setProfileSaving(true);
    try {
      const fp = getOrCreateDeviceFingerprint();
      const payload: any = {
        name,
        phone,
        secondary_phone: secondaryPhone || null,
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
        default_pickup_time: overrides?.hasOwnProperty('default_pickup_time') ? overrides.default_pickup_time : (profileDraft.default_pickup_time || null),
        device_fingerprint: fp,
        updated_at: new Date().toISOString()
      };

      // Apply any additional overrides to the payload
      if (overrides) {
        Object.assign(payload, overrides);
      }

      const isEditingActive = targetId === profileCustomerId;

      if (targetId) {
        const { data, error } = await supabase
          .from('customers')
          .update(payload)
          .eq('id', targetId)
          .select('*')
          .single();
        if (error) throw error;

        if (isEditingActive && !viewingAccountPhone) {
          if (data) setProfileCustomer(data as Customer);
        }
      } else {
        const { data, error } = await supabase
          .from('customers')
          .upsert([payload], { onConflict: 'phone' })
          .select('*')
          .single();
        if (error) throw error;

        if (!viewingAccountPhone) {
          if (data?.id) {
            setProfileCustomerId(data.id);
            localStorage.setItem('customer_id', data.id);
          }
          if (data) setProfileCustomer(data as Customer);
        }
      }

      if (!viewingAccountPhone) {
        localStorage.setItem('customer_phone', phone);
        localStorage.setItem('customer_data', JSON.stringify({
          ...profileDraft,
          phone,
          secondary_phone: secondaryPhone,
          name
        }));
        saveSharedAddress({ ...profileDraft, phone, name });
      }

      // Clear snapshot on successful save so snapshot doesn't linger
      profileDraftSnapshotRef.current = null;
      if (!isSilent) {
        setSettingsView('account');
      }

      if (!viewingAccountPhone) {
        await fetchOrders();
      } else {
        await fetchSavedAccounts();
      }
    } catch (e) {
      console.error('Failed to save profile data:', e);
    } finally {
      setProfileSaving(false);
    }
  };

  const getStatusInfo = (status: string, deliveryMethod?: string) => {
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
        return { icon: AlertTriangle, text: language === 'ar' ? 'وصل الآن' : 'Arrived', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' };
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

  const canCancel = (status: string) => {
    return ['under_review', 'preparing'].includes(status);
  };

  const getPickupTimerMeta = (order: OrderWithDetails): { text: string; className: string; expired: boolean; deadlineRaw?: string | null } | null => {
    if (order.delivery_method !== 'pickup') return null;
    if (!['under_review', 'preparing', 'arrived', 'cancellation_pending'].includes(order.status)) return null;
    const deadlineRaw = (order as any).pickup_deadline_at as string | null | undefined;
    if (!deadlineRaw) return null;
    const deadlineMs = new Date(deadlineRaw).getTime();
    if (Number.isNaN(deadlineMs)) return null;
    const diff = deadlineMs - pickupTimerNow;
    if (diff <= 0) {
      return {
        text: '00:00',
        className: 'text-red-500 font-black animate-pulse',
        expired: true,
        deadlineRaw
      } as any;
    }
    const totalSeconds = Math.floor(diff / 1000);
    const hh = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const mm = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    // Removed seconds
    const overHour = diff > 60 * 60 * 1000;
    const under15 = diff < 15 * 60 * 1000;
    return {
      text: `${hh}:${mm}`,
      className: under15 ? 'text-red-400 animate-pulse' : overHour ? 'text-green-400' : 'text-orange-300',
      expired: false,
      deadlineRaw
    };
  };

  // Returns a human-readable "متبقي X" string from a deadline timestamp
  const getRemainingLabel = (deadlineRaw: string | null | undefined, lang: 'ar' | 'en'): string | null => {
    if (!deadlineRaw) return null;
    const deadlineMs = new Date(deadlineRaw).getTime();
    if (Number.isNaN(deadlineMs)) return null;
    const diff = deadlineMs - Date.now();
    if (diff <= 0) return lang === 'ar' ? 'انتهى الوقت' : 'Time up';
    const totalMins = Math.floor(diff / 60000);
    const totalHours = Math.floor(totalMins / 60);
    if (lang === 'ar') {
      if (totalHours >= 1) {
        if (totalHours === 1) return 'متبقي ساعة';
        if (totalHours === 2) return 'متبقي ساعتان';
        if (totalHours >= 3 && totalHours <= 10) return `متبقي ${totalHours} ساعات`;
        return `متبقي ${totalHours} ساعة`;
      }
      if (totalMins <= 0) return 'انتهى الوقت';
      if (totalMins === 1) return 'متبقي دقيقة';
      if (totalMins === 2) return 'متبقي دقيقتان';
      if (totalMins >= 3 && totalMins <= 10) return `متبقي ${totalMins} دقائق`;
      return `متبقي ${totalMins} دقيقة`;
    } else {
      if (totalHours >= 1) return totalHours === 1 ? '1 hr left' : `${totalHours} hrs left`;
      if (totalMins <= 0) return 'Time up';
      if (totalMins === 1) return '1 min left';
      return `${totalMins} mins left`;
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    const reason = cancelReason.trim();
    if (!reason) return;

    try {
      const order = orders.find(o => o.id === orderId);
      const stage = order ? order.status : null;
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'cancellation_pending',
          cancellation_reason: reason,
          cancellation_stage: stage,
          updated_at: new Date().toISOString()
        } as any)
        .eq('id', orderId);

      if (error) throw error;
      setCancelOrderId(null);
      setCancelReason('');
      await fetchOrders();
    } catch (err) {
      console.error('Error requesting cancellation:', err);
    }
  };

  const handleSaveNote = async (orderId: string) => {
    try {
      const noteToSave = editedNote.trim();
      const { error } = await supabase
        .from('orders')
        .update({ order_note: noteToSave })
        .eq('id', orderId);

      if (error) throw error;
      setEditingNoteOrderId(null);
      setEditedNote('');
      await fetchOrders();
    } catch (err) {
      console.error('Error updating note:', err);
      alert(language === 'ar' ? 'حدث خطأ أثناء تحديث الملاحظة' : 'Error updating note');
    }
  };

  const displayName = (profileCustomer?.name || '').trim();
  const displayPhone = (profileCustomer?.phone || '').trim();
  const profileInitial = displayName ? displayName.charAt(0).toUpperCase() : (displayPhone ? '#' : '?');
  const hasAddressSummary = !!((profileCustomer?.street || '').trim() || (profileCustomer?.area || '').trim() || (profileCustomer?.city || '').trim());
  const mapLat = typeof profileDraft.latitude === 'number' ? profileDraft.latitude : profileCustomer?.latitude;
  const mapLng = typeof profileDraft.longitude === 'number' ? profileDraft.longitude : profileCustomer?.longitude;
  const profileAddressTypeLabel = profileAddressType === 'house'
    ? (language === 'ar' ? 'منزل' : 'House')
    : profileAddressType === 'workplace'
      ? (language === 'ar' ? 'مكان عمل' : 'Workplace')
      : (language === 'ar' ? 'شقة' : 'Apartment');

  const addProfileCustomAddressTab = async () => {
    const raw = newProfileAddressName.trim();
    if (!raw) return;
    const targetType = pendingProfileAddressType || (profileAddressType as 'apartment' | 'house' | 'workplace');

    const label = allocateUniqueSavedAddressLabel(raw, profileSavedAddressTabs);
    const tabId = `${Date.now()}`;
    const currentData: CustomerData = {
      ...profileDraft,
      address_type: targetType,
      address_label: label
    };

    const newTab: SavedAddressTab = { id: tabId, label, data: currentData };

    setProfileSavedAddressTabs((prev) => {
      const updated = [...prev, newTab];
      saveSharedAddressTabs(updated);
      return updated;
    });

    setActiveProfileAddressTabId(tabId);
    setShowProfileCustomAddressInput(false);
    setPendingProfileAddressType(null);
    setAddressNamePopoverPos(null);
    setNewProfileAddressName('');

    let cid = profileCustomerId;
    if (!cid && profileDraft.phone) {
      const foundId = await findCustomerIdByPhone(profileDraft.phone);
      if (foundId) {
        cid = foundId;
        setProfileCustomerId(cid);
      }
    }

    if (cid) {
      await supabase.from('customer_saved_addresses').upsert({
        customer_id: cid,
        label,
        address_type: targetType,
        building_number: profileDraft.building_number || null,
        street: profileDraft.street || null,
        area: profileDraft.area || null,
        city: profileDraft.city || null,
        floor: profileDraft.floor || null,
        apartment: profileDraft.apartment || null,
        house_name: profileDraft.house_name || null,
        company_name: profileDraft.company_name || null,
        landmark: profileDraft.landmark || null
      }, { onConflict: 'customer_id,label' });
    }
  };

  const switchAddressTab = useCallback((nextTabId: string, nextType: 'apartment' | 'house' | 'workplace') => {
    setActiveProfileAddressTabId(nextTabId);
    setProfileAddressType(nextType);

    if (nextTabId.startsWith('builtin-')) {
      // Shared draft handles built-ins automatically by current behavior
    } else {
      const tab = profileSavedAddressTabs.find(t => t.id === nextTabId);
      if (tab) {
        setProfileDraft(prev => {
          const updated = { ...prev, ...tab.data };
          saveSharedAddress(updated);
          return updated;
        });
      }
    }
  }, [profileSavedAddressTabs]);

  const removeProfileSavedAddressTab = async (tab: SavedAddressTab) => {
    setProfileSavedAddressTabs((prev) => {
      const updated = prev.filter((t) => t.id !== tab.id);
      saveSharedAddressTabs(updated);
      return updated;
    });
    if (profileDraft.address_label === tab.label) {
      setActiveProfileAddressTabId('builtin-apartment');
      setProfileAddressType('apartment');
      setProfileDraft((prev) => {
        const updated = { ...prev, address_type: 'apartment', address_label: '' } as CustomerData;
        saveSharedAddress(updated);
        return updated;
      });
    }
    if (profileCustomerId) {
      await supabase.from('customer_saved_addresses').delete().eq('customer_id', profileCustomerId).eq('label', tab.label);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 flex justify-center ${activeTab === 'settings' && settingsView !== 'main' ? 'z-[150]' : 'z-[115]'
        } ${phoneChrome
          ? 'items-stretch'
          : 'items-center'
        }`}
      onClick={onClose}
    >
      <div
        className={`pointer-events-auto flex flex-col overflow-hidden shadow-2xl ${phoneChrome
          ? 'profile-dropdown-phone h-full w-full max-w-none flex-1 rounded-none'
          : `profile-dropdown-desktop relative h-auto max-h-[min(88vh,860px)] w-full ${activeTab === 'orders' && !fullScreenOrderId ? 'max-w-5xl' : 'max-w-2xl'
          } rounded-[1.85rem] border-2 border-primary/45`
          }`}
        onClick={(e) => e.stopPropagation()}
        style={!phoneChrome ? { transformOrigin: `${menuPosition.left ?? window.innerWidth / 2}px ${menuPosition.top}px` } : undefined}
      >
        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-dark ${phoneChrome ? 'rounded-none border-0' : 'rounded-[1.85rem] border-2 border-primary'
            }`}
        >
          <div className={`flex h-12 items-center justify-between border-b border-white/5 bg-dark px-4 ${fullScreenOrderId ? 'relative z-20 overflow-visible' : ''}`}>
            {fullScreenOrderId ? (
              <button
                onClick={() => setFullScreenOrderId(null)}
                className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none shrink-0"
                  >
                    {language === 'ar' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  </button>
            ) : (
              <div className="w-8" />
            )}
            <h2 className="text-base font-black text-white">
              {fullScreenOrderId
                ? (language === 'ar' ? 'تفاصيل الطلب' : 'Order Details')
                : activeTab === 'orders'
                  ? (language === 'ar' ? 'طلباتي' : 'My Orders')
                  : (language === 'ar' ? 'الملف الشخصي' : 'Profile')}
            </h2>
            {fullScreenOrderId ? (
              (() => {
                const detailOrder = orders.find(o => o.id === fullScreenOrderId);
                if (!detailOrder || ['completed', 'cancelled', 'rejected'].includes(detailOrder.status)) {
                  return <div className="w-8" />;
                }
                return (
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowActionMenu(showActionMenu === detailOrder.id ? null : detailOrder.id);
                      }}
                      className="p-2 bg-primary/10 hover:bg-primary/20 rounded-xl transition-colors text-primary"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <OrderOptionsDropdown
                      order={detailOrder}
                      language={language}
                      isOpen={showActionMenu === detailOrder.id}
                      onClose={() => setShowActionMenu(null)}
                      onPickupTime={() => setShowUpdateTimePicker(detailOrder.id)}
                      onEditOrder={() => onStartOrderEdit?.(detailOrder)}
                      onCancelOrder={() => { setCancelOrderId(detailOrder.id); setCancelReason(''); }}
                      onEditNote={() => { setEditingNoteOrderId(detailOrder.id); setEditedNote(detailOrder.order_note || ''); }}
                    />
                  </div>
                );
              })()
            ) : (
              <div className="w-8" />
            )}
          </div>

          {!fullScreenOrderId && !phoneChrome && (
            <div className="px-4 pt-4 pb-2 border-b border-white/5 bg-dark shrink-0">
              <div
                className={`grid h-11 gap-2 rounded-xl border border-primary/40 bg-dark/60 p-1 ${activeTab === 'orders' ? 'grid-cols-[1.35fr_1fr]' : 'grid-cols-[1fr_1.35fr]'
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
            </div>
          )}

          <div
            className={`custom-scrollbar flex-1 overflow-y-auto px-4 pb-4 pt-2 ${phoneChrome ? 'min-h-0 max-h-none' : 'max-h-[calc(85vh-80px)]'
              }`}
          >
            {/* Order Detail View */}
            {fullScreenOrderId && (() => {
              const order = orders.find(o => o.id === fullScreenOrderId);
              if (!order) return null;
              const itemsTotal = order.items.reduce((sum, item) => sum + item.subtotal, 0);
              const discount = order.applied_coupon_discount_percent
                ? Math.round((itemsTotal * order.applied_coupon_discount_percent) / 100)
                : 0;
              const deliveryFee = order.total_amount - (itemsTotal - discount);
              return (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300" dir={language === 'ar' ? 'rtl' : 'ltr'}>
                  {/* Header Card */}
                  <div className="bg-primary/10 rounded-2xl p-4 border border-primary/20 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>
                    <p className="text-primary text-xs font-bold mb-1">{language === 'ar' ? 'رقم الطلب' : 'Order ID'}</p>
                    <p className="text-3xl font-black text-white tracking-wider">#{order.order_number}</p>
                    {(() => {
                      const timer = getPickupTimerMeta(order);
                      const remainingLabel = getRemainingLabel(timer?.deadlineRaw, language);
                      if (!timer || !remainingLabel) return null;
                      return (
                        <div className="mt-3 inline-flex items-center justify-center gap-2 bg-primary/20 px-3 py-1.5 rounded-lg border border-primary/30">
                          <Clock className={`w-4 h-4 ${timer.expired ? 'text-red-400' : 'text-primary'}`} />
                          <span className={`text-sm font-bold ${timer.expired ? 'text-red-400' : 'text-white'}`}>{remainingLabel}</span>
                        </div>
                      );
                    })()}
                  </div>
                  {/* Items */}
                  <OrderItemsSlider items={order.items} language={language} catalog={catalogLookup} />
                  {/* Timeline */}
                  <div className="bg-dark/40 rounded-2xl p-4 border border-primary/10">
                    <h3 className="text-sm font-black text-white mb-3 px-1">{language === 'ar' ? 'حالة الطلب' : 'Order Status'}</h3>
                    <OrderTimeline order={order} language={language} />
                  </div>
                  {/* Operator Note Display */}
                  {order.notes && order.notes.length > 0 && (
                    <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-3 flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-yellow-300 font-bold">{language === 'ar' ? 'ملاحظة الأوبراتور:' : 'Operator Note:'}</span>
                        <StickyNote className="w-4 h-4 text-yellow-300" />
                      </div>
                      {order.notes.map(note => (
                        <p key={note.id} className="text-xs text-yellow-200 text-start">{note.note}</p>
                      ))}
                    </div>
                  )}
                  {/* Customer Order Note Display */}
                  {order.order_note && (
                    <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 flex items-start gap-3">
                      <StickyNote className="w-4 h-4 text-primary mt-0.5" />
                      <div className="flex-1">
                        <p className="text-[10px] text-primary/60 font-bold mb-1 text-start">{language === 'ar' ? 'ملاحظة الطلب:' : 'Order Note:'}</p>
                        <p className="text-xs text-white text-start">{order.order_note}</p>
                      </div>
                    </div>
                  )}
                  {/* Totals Box */}
                  <div className="bg-primary/5 rounded-2xl p-4 border border-primary/20 space-y-3">
                    <div className="flex justify-between items-center text-sm text-gray-400">
                      <span className="font-bold text-white">{itemsTotal} <span className="text-xs">{language === 'ar' ? 'ج' : 'EG'}</span></span>
                      <span>{language === 'ar' ? 'إجمالي الأصناف' : 'Items Total'}</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex justify-between items-center text-sm text-green-400">
                        <span className="font-bold">-{discount} <span className="text-xs">{language === 'ar' ? 'ج' : 'EG'}</span></span>
                        <span>{language === 'ar' ? 'خصم الكوبون' : 'Coupon Discount'}</span>
                      </div>
                    )}
                    {(order.delivery_method === 'delivery' || deliveryFee > 0) && (
                      <div className="flex justify-between items-center text-sm text-gray-400">
                        <span className="font-bold text-white">
                          {deliveryFee > 0 ? `${deliveryFee} ${language === 'ar' ? 'ج' : 'EG'}` : (language === 'ar' ? 'مجاني' : 'Free')}
                        </span>
                        <span>{language === 'ar' ? 'رسوم التوصيل' : 'Delivery Fee'}</span>
                      </div>
                    )}
                    <div className="h-px bg-white/10 my-2"></div>
                    <div className="flex justify-between items-center pt-2">
                      <span className="font-black text-2xl text-primary">{order.total_amount} <span className="text-sm">{language === 'ar' ? 'ج' : 'EG'}</span></span>
                      <span className="font-black text-lg text-white">{language === 'ar' ? 'الإجمالي' : 'Total'}</span>
                    </div>
                  </div>
                  <div className="h-4"></div>
                </div>
              );
            })()}


            <div className={!fullScreenOrderId && activeTab === 'settings' ? 'space-y-6 block' : 'space-y-6 hidden'}>
                <div className="relative mb-2">
                  {settingsView === 'main' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {/* Header Block */}
                      {profileCustomer ? (
                        <div className="flex items-center justify-between gap-4 py-2 border-b border-white/5 pb-6">
                          <button
                            type="button"
                            onClick={() => setSettingsView('account')}
                            className="flex items-center gap-3 flex-1 text-start group"
                          >
                            <div className="relative">
                              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/20 text-xl font-black text-white border-2 border-primary/30 group-hover:bg-primary/30 transition-all">
                                {profileInitial}
                              </div>
                              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-primary rounded-full flex items-center justify-center border-2 border-surface shadow-lg">
                                <Pencil className="w-2.5 h-2.5 text-white" />
                              </div>
                            </div>
                            <div className="flex-1">
                              <p className="text-white text-lg font-black leading-tight">
                                {displayName || (language === 'ar' ? 'حساب نشط' : 'Active Account')}
                              </p>
                              <p className="text-sm text-muted mt-0.5" dir="ltr">
                                {displayPhone}
                              </p>
                            </div>
                          </button>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSettingsView(savedAccounts.length >= 2 ? 'switch_accounts' : 'add_account')}
                              className="w-10 h-10 flex items-center justify-center rounded-full bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-all relative"
                              title={language === 'ar' ? 'إضافة حساب' : 'Add account'}
                            >
                              <Plus className="w-5 h-5" />
                              {savedAccounts.length > 1 && (
                                <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-surface shadow-sm">
                                  {savedAccounts.length - 1}
                                </span>
                              )}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSettingsView(savedAccounts.length > 0 ? 'switch_accounts' : 'add_account')}
                          className="w-full rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-6 flex flex-col items-center gap-2 transition-all hover:bg-primary/10 relative overflow-hidden"
                        >
                          <div className="relative w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                            <Plus className="w-6 h-6 text-primary" />
                            {savedAccounts.length > 0 && (
                              <div className="absolute -top-1 -right-1 bg-primary text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-surface shadow-lg">
                                {savedAccounts.length}
                              </div>
                            )}
                          </div>
                          <span className="text-sm font-black text-white">
                            {savedAccounts.length > 0
                              ? (language === 'ar' ? 'عرض الحسابات' : 'View Accounts')
                              : (language === 'ar' ? 'إضافة حساب' : 'Add account')}
                          </span>
                        </button>
                      )}

                      {/* Settings List */}
                      <div className="pt-2">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-black text-white text-start">
                            {language === 'ar' ? 'الأعدادات' : 'Settings'}
                          </h3>
                        </div>

                        <div className="space-y-1">
                          {profileCustomerId && (
                            <button
                              onClick={() => setSettingsView('security')}
                              className="profile-menu-item w-full flex items-center justify-between p-3 hover:bg-white/5 transition-all rounded-xl group"
                            >
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                                  <Lock className="w-5 h-5" />
                                </div>
                                <div className="text-start">
                                  <p className="text-white font-black text-sm">{language === 'ar' ? 'أمان الحساب' : 'Account Security'}</p>
                                  <p className="text-[10px] text-muted">{language === 'ar' ? 'كلمة المرور، كود الاسترجاع' : 'Password, recovery code'}</p>
                                </div>
                              </div>
                              <ChevronLeft className={`w-4 h-4 text-muted group-hover:text-white transition-colors ${language === 'ar' ? '' : 'rotate-180'}`} />
                            </button>
                          )}

                          <button
                            onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                            className="profile-menu-item w-full flex items-center justify-between p-3 hover:bg-white/5 transition-all rounded-xl group"
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                                <Globe className="w-5 h-5" />
                              </div>
                              <div className="text-start">
                                <p className="text-white font-black text-sm">{language === 'ar' ? 'اللغة' : 'Language'}</p>
                                <p className="text-[10px] text-muted">{language === 'ar' ? 'العربية' : 'English'}</p>
                              </div>
                            </div>
                            <ChevronLeft className={`w-4 h-4 text-muted group-hover:text-white transition-colors ${language === 'ar' ? '' : 'rotate-180'}`} />
                          </button>

                          <button
                            onClick={toggleTheme}
                            className="profile-menu-item w-full flex items-center justify-between p-3 hover:bg-white/5 transition-all rounded-xl group"
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-primary/10 text-primary">
                                {theme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                              </div>
                              <div className="text-start">
                                <p className="text-white font-black text-sm">{language === 'ar' ? 'الوضع' : 'Theme'}</p>
                                <p className="text-[10px] text-muted">{theme === 'dark' ? (language === 'ar' ? 'مظلم' : 'Dark') : (language === 'ar' ? 'فاتح' : 'Light')}</p>
                              </div>
                            </div>
                            <ChevronLeft className={`w-4 h-4 text-muted group-hover:text-white transition-colors ${language === 'ar' ? '' : 'rotate-180'}`} />
                          </button>

                          <button
                            onClick={() => setSettingsView('coupons')}
                            className="profile-menu-item w-full flex items-center justify-between p-3 hover:bg-white/5 transition-all rounded-xl group"
                          >
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-green-500/10 text-green-500 relative">
                                <TicketPercent className="w-5 h-5" />
                                {customerCoupons.length > 0 && (
                                  <span className="absolute -top-1 -right-1 bg-primary text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border border-surface">
                                    {customerCoupons.length}
                                  </span>
                                )}
                              </div>
                              <div className="text-start">
                                <p className="text-white font-black text-sm">{language === 'ar' ? 'الكوبونات' : 'Coupons'}</p>
                                <p className="text-[10px] text-muted">{language === 'ar' ? 'عرض الكوبونات المتاحة' : 'View available coupons'}</p>
                              </div>
                            </div>
                            <ChevronLeft className={`w-4 h-4 text-muted group-hover:text-white transition-colors ${language === 'ar' ? '' : 'rotate-180'}`} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {settingsView === 'switch_accounts' && (
                    <div
                      className={`space-y-3 ${phoneChrome ? 'profile-mobile-push' : ''}`}
                      onClick={() => { if (accountMenuOpen) setAccountMenuOpen(null); }}
                    >
                      <button
                        type="button"
                        onClick={() => { setSettingsView('main'); setAccountMenuOpen(null); }}
                        className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none shrink-0"
                  >
                    {language === 'ar' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  </button>

                      <div className="space-y-3 mt-4">
                        {savedAccounts.map((acc) => {
                          const initial = acc.name ? acc.name.charAt(0).toUpperCase() : '#';
                          const isActive = acc.phone === profileCustomer?.phone;
                          const menuOpen = accountMenuOpen === acc.phone;
                          return (
                            <div key={acc.phone} className="relative" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (menuOpen) { setAccountMenuOpen(null); return; }
                                  if (isActive || isSwitchingAccount) return;
                                  setIsSwitchingAccount(acc.phone);
                                  try {
                                    localStorage.setItem('customer_phone', acc.phone);
                                    localStorage.removeItem('customer_id');
                                    if (onPhoneValidated) await onPhoneValidated(acc.phone);
                                    await fetchOrders(acc.phone);
                                    await fetchSavedAccounts();
                                    // Stay in list as requested
                                  } finally {
                                    setIsSwitchingAccount(null);
                                  }
                                }}
                                className={`w-full rounded-2xl border ${language === 'ar' ? 'p-4 pl-12 text-start' : 'p-4 pr-12 text-left'} transition-all ${isActive
                                  ? 'border-primary bg-primary/20 ring-1 ring-primary/30'
                                  : 'border-primary/40 bg-primary/10 hover:bg-primary/15'
                                  }`}
                                style={{ pointerEvents: isSwitchingAccount && isSwitchingAccount !== acc.phone ? 'none' : 'auto', opacity: isSwitchingAccount && isSwitchingAccount !== acc.phone ? 0.6 : 1 }}
                              >
                                <div className={`flex items-center gap-3 ${language === 'en' ? 'flex-row-reverse' : ''}`}>
                                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/25 text-lg font-black text-white shrink-0">
                                    {isSwitchingAccount === acc.phone ? (
                                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                    ) : initial}
                                  </div>
                                  <div className={`flex-1 min-w-0 ${language === 'en' ? 'text-left' : 'text-start'}`}>
                                    <div className={`flex items-center gap-2 ${language === 'en' ? 'justify-end flex-row-reverse' : 'justify-start'}`}>
                                      <p className="text-white text-base font-black truncate">{acc.name || (language === 'ar' ? 'بدون اسم' : 'No Name')}</p>
                                      {isActive && (
                                        <span className="text-[10px] font-black uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-md border border-primary/20 shrink-0">
                                          {language === 'ar' ? 'نشط' : 'Active'}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted" dir="ltr">{acc.phone}</p>
                                  </div>
                                </div>
                              </button>
                              {/* Three-dot menu button — positioned inside the card area but not overlapping content */}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setAccountMenuOpen(menuOpen ? null : acc.phone); }}
                                className={`absolute ${language === 'ar' ? 'left-2' : 'right-2'} top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-white hover:bg-white/10 transition-colors z-[5]`}
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                              {/* Dropdown menu */}
                              {menuOpen && (
                                <>
                                  {/* Invisible backdrop to catch clicks outside the menu */}
                                  <div className="fixed inset-0 z-[35]" onClick={(e) => { e.stopPropagation(); setAccountMenuOpen(null); }} />
                                  <div className={`absolute ${language === 'ar' ? 'left-2' : 'right-2'} top-full mt-1 z-[40] w-44 rounded-xl border border-primary/40 bg-[hsl(var(--color-surface))] shadow-2xl overflow-hidden`}>
                                    {isActive && (
                                      <button
                                        type="button"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          setAccountMenuOpen(null);
                                          // Clear all active-account state without triggering fetchOrders
                                          // (fetchOrders would re-select via device fingerprint fallback)
                                          localStorage.removeItem('customer_phone');
                                          localStorage.removeItem('customer_id');
                                          setProfileCustomer(null);
                                          setProfileCustomerId(null);
                                          setEditingCustomerId(null);
                                          setProfileDraft(prev => ({ ...prev, name: '', phone: '' }));
                                          if (onPhoneValidated) await onPhoneValidated('');
                                          // Refresh list but stay in switch_accounts
                                          await fetchSavedAccounts();
                                        }}
                                        className="w-full flex items-center gap-2.5 px-4 py-3 text-start text-xs font-bold text-white hover:bg-white/5 transition-colors border-b border-white/5"
                                      >
                                        <XCircle className="w-4 h-4 text-muted shrink-0" />
                                        <span>{language === 'ar' ? 'إلغاء الاختيار' : 'Deselect'}</span>
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAccountMenuOpen(null);
                                        setLogoutConfirm({ name: acc.name, phone: acc.phone });
                                      }}
                                      className="w-full flex items-center gap-2.5 px-4 py-3 text-start text-xs font-bold text-red-400 hover:bg-red-500/5 transition-colors"
                                    >
                                      <LogOut className="w-4 h-4 shrink-0" />
                                      <span>{language === 'ar' ? 'تسجيل الخروج' : 'Logout'}</span>
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}

                        {savedAccounts.length < 5 && (
                          <button
                            type="button"
                            onClick={() => { setSettingsView('add_account'); setAccountMenuOpen(null); }}
                            className="w-full rounded-2xl border border-dashed border-primary/40 bg-surface/40 p-4 text-center transition-colors hover:bg-primary/5 mt-4"
                          >
                            <span className="flex items-center justify-center gap-2 text-sm font-black text-white">
                              <Plus className="h-4 w-4 text-primary" />
                              <span>{language === 'ar' ? 'إضافة حساب جديد' : 'Add new account'}</span>
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {settingsView === 'add_account' && (
                    <AddAccountBlock
                      language={language}
                      phoneChrome={phoneChrome}
                      onBack={() => setSettingsView(savedAccounts.length >= 2 ? 'switch_accounts' : 'main')}
                      onSuccess={async (phone) => {
                        localStorage.setItem('customer_phone', phone);
                        localStorage.removeItem('customer_id');
                        if (onPhoneValidated) await onPhoneValidated(phone);
                        await fetchOrders(phone);
                        await fetchSavedAccounts();
                        setSettingsView('switch_accounts');
                      }}
                    />
                  )}

                  {settingsView === 'account' && (() => {
                    // Determine which account to display in edit view
                    const editPhone = viewingAccountPhone || profileCustomer?.phone || '';
                    const editAccount = savedAccounts.find(a => a.phone === editPhone);
                    const editName = editAccount?.name || displayName;
                    const editDisplayPhone = editAccount?.phone || displayPhone;
                    const editHasInfo = !!(editName?.trim() || editDisplayPhone?.trim());
                    return (
                      <div className={`space-y-3 flex flex-col ${phoneChrome ? 'profile-mobile-push' : ''}`}>
                        <button
                          type="button"
                          onClick={() => { setSettingsView(accountEditBackTarget); setViewingAccountPhone(null); setAccountEditBackTarget('main'); }}
                          className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none shrink-0"
                  >
                    {language === 'ar' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  </button>
                        <button
                          type="button"
                          onClick={() => {
                            // Save snapshot so Back can discard unsaved changes
                            profileDraftSnapshotRef.current = { ...profileDraft };
                            setSettingsView('data');
                          }}
                          className="w-full rounded-xl border border-primary/35 bg-dark/70 p-4 text-start hover:bg-white/5 transition-colors"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <h4 className="text-sm font-black text-white">{language === 'ar' ? 'معلومات الطلب' : 'Order Information'}</h4>
                            <div className="w-8 h-8 flex items-center justify-center rounded-full bg-primary/10 text-primary">
                              <Pencil className="w-4 h-4" />
                            </div>
                          </div>
                          {editHasInfo ? (
                            <div className="space-y-1 text-xs text-muted">
                              <p>{editName || '—'}</p>
                              <p dir="ltr">{editDisplayPhone || '—'}</p>
                            </div>
                          ) : (
                            <p className="text-xs text-muted">{language === 'ar' ? 'اضغط لتعديل البيانات' : 'Tap to edit data'}</p>
                          )}
                        </button>



                        <button
                          type="button"
                          onClick={() => {
                            // Save snapshot so Back can discard unsaved changes
                            profileDraftSnapshotRef.current = { ...profileDraft };
                            addressTypeSnapshotRef.current = profileAddressType;
                            addressTabIdSnapshotRef.current = activeProfileAddressTabId;
                            setSettingsView('addresses');
                          }}
                          className="w-full rounded-xl border border-primary/35 bg-dark/70 p-4 text-start"
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
                                  onLocationChange={() => { }}
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

                        {/* Spacer to push logout to bottom */}
                        <div className="flex-1 mt-6" />

                        {/* Logout button — pinned at bottom */}
                        {editDisplayPhone && (
                          <button
                            type="button"
                            onClick={() => setLogoutConfirm({ name: editName || '', phone: editDisplayPhone })}
                            className="w-full flex items-center justify-center gap-2 rounded-xl border border-red-500/10 bg-transparent py-3 text-sm font-black text-red-500/70 transition-all hover:bg-red-500/5 active:scale-[0.98]"
                          >
                            <LogOut className="w-4 h-4" />
                            <span>{language === 'ar' ? 'تسجيل الخروج' : 'Logout'}</span>
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {settingsView === 'data' && (
                    <div className={`space-y-3 ${phoneChrome ? 'profile-mobile-push' : ''}`}>
                      <button
                        type="button"
                        onClick={() => {
                          // Discard unsaved changes
                          if (profileDraftSnapshotRef.current) {
                            setProfileDraft(profileDraftSnapshotRef.current);
                            profileDraftSnapshotRef.current = null;
                          }
                          setSettingsView('account');
                        }}
                        className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none shrink-0"
                  >
                    {language === 'ar' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  </button>
                      <h4 className="text-sm font-black text-white text-start">{language === 'ar' ? 'معلومات الطلب' : 'Order Information'}</h4>
                      <div>
                        <label className="mb-1 block text-start text-xs text-muted">{language === 'ar' ? 'الاسم' : 'Name'}</label>
                        <input
                          value={profileDraft.name}
                          onChange={(e) => setProfileDraft((p) => ({ ...p, name: e.target.value }))}
                          placeholder={language === 'ar' ? 'الاسم' : 'Name'}
                          className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-start text-xs text-muted">{language === 'ar' ? 'رقم الهاتف' : 'Phone Number'}</label>
                        <input
                          value={profileDraft.phone}
                          maxLength={15}
                          onChange={(e) => {
                            const next = e.target.value.replace(/\D/g, '').slice(0, 15);
                            setProfileDraft((p) => ({ ...p, phone: next }));
                            if (profilePhoneError) setProfilePhoneError(null);
                          }}
                          placeholder={language === 'ar' ? 'رقم الهاتف' : 'Phone'}
                          className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
                          dir="ltr"
                        />
                      </div>
                      {showSecondaryProfilePhone ? (
                        <div className="relative">
                          <input
                            value={profileDraft.secondary_phone}
                            maxLength={15}
                            onChange={(e) => {
                              const next = e.target.value.replace(/\D/g, '').slice(0, 15);
                              setProfileDraft((p) => ({ ...p, secondary_phone: next }));
                              if (profilePhoneError) setProfilePhoneError(null);
                            }}
                            placeholder={language === 'ar' ? 'رقم إضافي (اختياري)' : 'Secondary phone (optional)'}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
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
                      {profilePhoneError && (
                        <p className="text-red-400 text-start text-sm font-bold">{profilePhoneError}</p>
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
                    <div className={`space-y-3 text-start ${phoneChrome ? 'profile-mobile-push' : ''}`}>
                      <button
                        type="button"
                        onClick={() => {
                          // Discard unsaved changes and restore full snapshot including defaultPickupTime
                          if (profileDraftSnapshotRef.current) {
                            setProfileDraft(profileDraftSnapshotRef.current);
                            setProfileAddressType(addressTypeSnapshotRef.current);
                            setActiveProfileAddressTabId(addressTabIdSnapshotRef.current);
                            // Restore defaultPickupTime state and localStorage
                            const restoredTime = (profileDraftSnapshotRef.current as any).default_pickup_time || null;
                            setDefaultPickupTime(restoredTime || null);
                            if (restoredTime) {
                              localStorage.setItem('default_pickup_time', restoredTime);
                            } else {
                              localStorage.removeItem('default_pickup_time');
                            }
                            profileDraftSnapshotRef.current = null;
                          }
                          setSettingsView('account');
                        }}
                        className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none shrink-0"
                  >
                    {language === 'ar' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  </button>
                      <h4 className="text-sm font-black text-white">{language === 'ar' ? 'العناوين' : 'Addresses'}</h4>

                      {typeof mapLat === 'number' && typeof mapLng === 'number' && (
                        <div className="overflow-hidden rounded-xl border border-primary/35 bg-dark mb-2">
                          <InteractiveMap
                            latitude={mapLat}
                            longitude={mapLng}
                            onLocationChange={() => { }}
                            isEditing={false}
                            className="!h-32 sm:!h-40"
                          />
                          <div className="px-3 py-1.5 bg-primary/5 flex justify-between items-center">
                            <p className="text-[10px] font-mono text-purple-400">{mapLat.toFixed(6)}, {mapLng.toFixed(6)}</p>
                            <span className="text-[10px] text-muted">{language === 'ar' ? 'معاينة الموقع' : 'Location Preview'}</span>
                          </div>
                        </div>
                      )}

                      {typeof mapLat === 'number' && typeof mapLng === 'number' ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              locationBackupRef.current = {
                                latitude: profileDraft.latitude,
                                longitude: profileDraft.longitude
                              };
                              setSettingsView('map');
                            }}
                            className="w-8 h-8 flex items-center justify-center rounded-lg border border-primary/35 bg-primary/10 text-primary transition-all active:scale-[0.95]"
                            title={language === 'ar' ? 'تعديل الموقع' : 'Edit Location'}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowDefaultTimePicker(true)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg border border-amber-500/35 bg-amber-500/10 text-amber-500 transition-all active:scale-[0.95]"
                            title={language === 'ar' ? 'موعد الاستلام التلقائي' : 'Default Pickup Time'}
                          >
                            <Clock className="w-4 h-4" />
                          </button>
                          <div className="text-start flex-1">
                            <p className="text-[10px] text-muted font-bold">
                              {language === 'ar' ? 'موعد الاستلام التلقائي:' : 'Default Pickup Time:'}
                            </p>
                            <p className="text-[10px] text-amber-200 font-black">
                              {defaultPickupTime || (language === 'ar' ? 'غير محدد' : 'Not set')}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            locationBackupRef.current = {
                              latitude: undefined,
                              longitude: undefined
                            };
                            setSettingsView('map');
                          }}
                          className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/35 bg-primary/5 py-3 text-sm font-black text-primary transition-all hover:bg-primary/10 active:scale-[0.98]"
                        >
                          <Plus className="w-4 h-4" />
                          <span>{language === 'ar' ? 'إضافة موقع' : 'Add Location'}</span>
                        </button>
                      )}
                      <div className="flex flex-wrap justify-end gap-2 items-center">
                        {profileSavedAddressTabs.length < 4 && (
                          <div ref={customAddressAnchorRef} className="relative inline-flex flex-col items-stretch align-top">
                            <button
                              type="button"
                              data-address-name-trigger
                              onClick={() => {
                                if (showProfileCustomAddressInput) {
                                  setShowProfileCustomAddressInput(false);
                                  setPendingProfileAddressType(null);
                                  setAddressNamePopoverPos(null);
                                  setNewProfileAddressName('');
                                  return;
                                }
                                setShowProfileCustomAddressInput(true);
                                setPendingProfileAddressType(
                                  profileAddressType === 'house' || profileAddressType === 'workplace'
                                    ? profileAddressType
                                    : 'apartment'
                                );
                                setNewProfileAddressName(profileAddressTypeLabel);
                              }}
                              className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all ${showProfileCustomAddressInput ? 'bg-red-500/20 text-red-300 border-red-400/60 rotate-180' : 'bg-dark border-primary/30 text-primary hover:bg-primary/10'
                                }`}
                              title={language === 'ar' ? 'إضافة عنوان مخصص' : 'Add custom address'}
                            >
                              {showProfileCustomAddressInput ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            switchAddressTab('builtin-apartment', 'apartment');
                            if (showProfileCustomAddressInput) setPendingProfileAddressType('apartment');
                          }}
                          className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 ${activeProfileAddressTabId === 'builtin-apartment' ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary'}`}
                        >
                          <Building className="w-3.5 h-3.5" />
                          <span>{language === 'ar' ? 'شقة' : 'Apartment'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            switchAddressTab('builtin-house', 'house');
                            if (showProfileCustomAddressInput) setPendingProfileAddressType('house');
                          }}
                          className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 ${activeProfileAddressTabId === 'builtin-house' ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary'}`}
                        >
                          <Home className="w-3.5 h-3.5" />
                          <span>{language === 'ar' ? 'منزل' : 'House'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            switchAddressTab('builtin-workplace', 'workplace');
                            if (showProfileCustomAddressInput) setPendingProfileAddressType('workplace');
                          }}
                          className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 ${activeProfileAddressTabId === 'builtin-workplace' ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary'}`}
                        >
                          <Briefcase className="w-3.5 h-3.5" />
                          <span>{language === 'ar' ? 'مكان عمل' : 'Workplace'}</span>
                        </button>
                        {profileSavedAddressTabs.map((tab) => (
                          <div key={tab.id} className="relative group">
                            <button
                              type="button"
                              onClick={() => switchAddressTab(tab.id, (tab.data.address_type as any) || 'apartment')}
                              className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-all ${activeProfileAddressTabId === tab.id ? 'bg-primary text-white border-primary' : 'bg-dark border-primary/30 text-primary hover:bg-primary/5'}`}
                            >
                              <span>{tab.label}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeProfileSavedAddressTab(tab);
                              }}
                              className="absolute -top-2 -left-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg scale-90 hover:scale-100"
                              title={language === 'ar' ? 'حذف' : 'Delete'}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                      {profileAddressType === 'apartment' && (
                        <>
                          <input
                            value={profileDraft.building_number}
                            onChange={(e) => setProfileDraft((p) => ({ ...p, building_number: e.target.value }))}
                            placeholder={language === 'ar' ? 'اسم/رقم المبنى' : 'Building Name/No.'}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              value={profileDraft.floor}
                              onChange={(e) => setProfileDraft((p) => ({ ...p, floor: e.target.value }))}
                              placeholder={language === 'ar' ? 'الطابق' : 'Floor'}
                              className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
                            />
                            <input
                              value={profileDraft.apartment}
                              onChange={(e) => setProfileDraft((p) => ({ ...p, apartment: e.target.value }))}
                              placeholder={language === 'ar' ? 'الشقة' : 'Apartment'}
                              className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
                            />
                          </div>
                        </>
                      )}
                      {profileAddressType === 'house' && (
                        <input
                          value={profileDraft.house_name}
                          onChange={(e) => setProfileDraft((p) => ({ ...p, house_name: e.target.value }))}
                          placeholder={language === 'ar' ? 'اسم/رقم المنزل' : 'House Name/No.'}
                          className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
                        />
                      )}
                      {profileAddressType === 'workplace' && (
                        <>
                          <input
                            value={profileDraft.building_number}
                            onChange={(e) => setProfileDraft((p) => ({ ...p, building_number: e.target.value }))}
                            placeholder={language === 'ar' ? 'اسم المبنى' : 'Building Name'}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
                          />
                          <input
                            value={profileDraft.company_name}
                            onChange={(e) => setProfileDraft((p) => ({ ...p, company_name: e.target.value }))}
                            placeholder={language === 'ar' ? 'اسم الشركة' : 'Company Name'}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
                          />
                          <input
                            value={profileDraft.floor}
                            onChange={(e) => setProfileDraft((p) => ({ ...p, floor: e.target.value }))}
                            placeholder={language === 'ar' ? 'الطابق' : 'Floor'}
                            className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
                          />
                        </>
                      )}
                      <input
                        value={profileDraft.street}
                        onChange={(e) => setProfileDraft((p) => ({ ...p, street: e.target.value }))}
                        placeholder={language === 'ar' ? 'الشارع' : 'Street'}
                        className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
                      />
                      <input
                        value={profileDraft.city}
                        onChange={(e) => setProfileDraft((p) => ({ ...p, city: e.target.value }))}
                        placeholder={language === 'ar' ? 'المدينة' : 'City'}
                        className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
                      />
                      <input
                        value={profileDraft.landmark}
                        onChange={(e) => setProfileDraft((p) => ({ ...p, landmark: e.target.value }))}
                        placeholder={language === 'ar' ? 'علامة مميزة' : 'Landmark'}
                        className="w-full rounded-lg border border-primary/35 bg-dark px-3 py-2 text-start text-sm text-white"
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
                  {/* Mobile map editor section removed, moved to end of file for all platforms */}
                </div>

                {/* Merged into main block above */}

                {settingsView === 'security' && (
                  <div className={`space-y-4 ${phoneChrome ? 'profile-mobile-push' : ''}`}>
                    <button
                      type="button"
                      onClick={() => setSettingsView('main')}
                      className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none shrink-0"
                  >
                    {language === 'ar' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  </button>

                    <div className="bg-dark/50 rounded-2xl p-6 border border-amber-500/25">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <Lock className="w-6 h-6 text-amber-400" />
                          <h3 className="text-lg font-black text-white">
                            {language === 'ar' ? 'أمان الحساب' : 'Account security'}
                          </h3>
                        </div>
                        {securityLoading && (
                          <span className="text-xs text-muted">{language === 'ar' ? 'جاري التحميل…' : 'Loading…'}</span>
                        )}
                      </div>

                      <p className="text-sm text-gray-400 text-start leading-relaxed mb-6">
                        {language === 'ar'
                          ? 'يمكنك إضافة كلمة مرور مرتبطة برقمك (اختياري). عند تسجيل الدخول من جهاز آخر سيُطلب إدخالها. إذا نسيتها استخدم كود الاسترجاع.'
                          : 'You can set an optional password for your phone. Other devices will be asked for it. If you forget it, use the recovery code.'}
                      </p>

                      {secErr && <p className="text-red-400 text-xs font-black text-start mb-4">{secErr}</p>}

                      {!hasPhonePassword ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 gap-3">
                            <input
                              type="password"
                              value={secPwd1}
                              onChange={(e) => {
                                setSecPwd1(e.target.value);
                                setSecErr(null);
                                setSecNewRecoveryShown(null);
                              }}
                              className="w-full bg-gray-900 border border-amber-500/35 rounded-xl px-4 py-3 text-white text-start text-sm"
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
                              className="w-full bg-gray-900 border border-amber-500/35 rounded-xl px-4 py-3 text-white text-start text-sm"
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
                            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white py-3.5 rounded-xl font-black text-sm transition-all active:scale-[0.98]"
                          >
                            {language === 'ar' ? 'حفظ كلمة المرور' : 'Save password'}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <p className="text-sm text-amber-200/90 text-start font-bold">
                            {language === 'ar' ? 'كلمة المرور مفعّلة على هذا الرقم.' : 'Password is enabled for this phone.'}
                          </p>
                          <button
                            type="button"
                            onClick={() => setSecurityDetailsOpen((v) => !v)}
                            className="w-full flex items-center justify-between rounded-xl border border-amber-500/25 bg-black/10 px-4 py-3 text-amber-200 font-black text-sm"
                          >
                            <span>{language === 'ar' ? 'إظهار التفاصيل' : 'Show details'}</span>
                            <span className="text-xs text-amber-200/70">
                              {securityDetailsOpen ? (language === 'ar' ? 'إخفاء' : 'Hide') : (language === 'ar' ? 'فتح' : 'Open')}
                            </span>
                          </button>

                          {securityDetailsOpen && (
                            <div className="rounded-xl border border-amber-500/20 bg-black/15 p-4 space-y-4">
                              <p className="text-xs text-gray-300 text-start leading-relaxed">
                                {language === 'ar'
                                  ? 'لتغيير كلمة المرور في أي وقت: أدخل كود الاسترجاع ثم ضع كلمة مرور جديدة. سيتم إنشاء كود استرجاع جديد تلقائياً.'
                                  : 'To change password anytime: enter recovery code, set a new password. A new recovery code will be generated.'}
                              </p>
                              <input
                                type="tel"
                                value={secRecoveryInput}
                                onChange={(e) => {
                                  setSecRecoveryInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                                  setSecErr(null);
                                  setSecNewRecoveryShown(null);
                                }}
                                className="w-full bg-gray-900 border border-amber-500/30 rounded-xl px-4 py-3 text-white text-start text-sm font-black"
                                placeholder={language === 'ar' ? 'كود الاسترجاع (6 أرقام)' : 'Recovery code (6 digits)'}
                                dir="ltr"
                              />
                              <div className="grid grid-cols-1 gap-3">
                                <input
                                  type="password"
                                  value={secPwd1}
                                  onChange={(e) => {
                                    setSecPwd1(e.target.value);
                                    setSecErr(null);
                                    setSecNewRecoveryShown(null);
                                  }}
                                  className="w-full bg-gray-900 border border-amber-500/30 rounded-xl px-4 py-3 text-white text-start text-sm"
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
                                  className="w-full bg-gray-900 border border-amber-500/30 rounded-xl px-4 py-3 text-white text-start text-sm"
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
                                className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white py-3.5 rounded-xl font-black text-sm transition-all active:scale-[0.98]"
                              >
                                {language === 'ar' ? 'تغيير كلمة المرور' : 'Change password'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {secNewRecoveryShown && (
                        <div className="mt-4 rounded-2xl border border-amber-500/35 bg-black/20 p-4 text-center">
                          <p className="text-xs text-amber-100/80 mb-2">
                            {language === 'ar' ? 'كود استرجاع جديد (احتفظ به):' : 'New recovery code (keep it):'}
                          </p>
                          <p className="font-mono text-3xl font-black text-amber-200 tracking-widest">{secNewRecoveryShown}</p>
                          <p className="text-[10px] text-amber-100/60 mt-2">
                            {language === 'ar'
                              ? 'الكود القديم لم يعد صالحاً.'
                              : 'Old code is no longer valid.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

            {settingsView === 'coupons' && (
              <div className={`space-y-4 ${phoneChrome ? 'profile-mobile-push' : ''}`}>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setSettingsView('main')}
                    className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none shrink-0"
                  >
                    {language === 'ar' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  </button>
                  <h3 className="text-lg font-black text-white flex items-center gap-2">
                    {language === 'ar' ? 'كوبونات الخصم' : 'Your Coupons'}
                    <TicketPercent className="w-5 h-5 text-primary" />
                  </h3>
                </div>

                <div className="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar p-1">
                  {customerCoupons.length === 0 ? (
                    <div className="py-12 text-center bg-dark/40 rounded-2xl border border-primary/20">
                      <TicketPercent className="w-16 h-16 text-primary/30 mx-auto mb-4" />
                      <p className="text-lg text-primary font-bold">
                        {language === 'ar' ? 'لا توجد كوبونات متاحة' : 'No available coupons'}
                      </p>
                    </div>
                  ) : (
                    customerCoupons.map((coupon) => {
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
                          className="bg-surface/60 rounded-2xl p-5 border border-primary/20 relative overflow-hidden group hover:border-primary/50 transition-all shadow-lg"
                        >
                          <div className="flex items-start justify-between relative z-10">
                            <div className="text-start flex-1">
                              <div className="flex items-center justify-end gap-2 mb-3">
                                <span className="bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded-full text-[10px] font-black">
                                  {language === 'ar' ? `خصم ${coupon.discount_percent}%` : `${coupon.discount_percent}% OFF`}
                                </span>
                              </div>
                              <p className="text-[11px] text-green-300 font-black text-start mb-2">
                                {language === 'ar'
                                  ? `وفّرت: ${totalSaved} ج`
                                  : `Saved: ${totalSaved} EG`}
                              </p>
                              <div className="flex items-center justify-end gap-3 mt-4 bg-black/40 p-3 rounded-xl border border-white/5">
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
                                >
                                  <span id={`copy-${coupon.id}`}>{language === 'ar' ? 'نسخ الكود' : 'Copy Code'}</span>
                                </button>
                                <span className="text-xl font-mono font-black text-white tracking-widest">{coupon.code}</span>
                              </div>
                              <div className="mt-2 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => setCouponDetailsCode(coupon.code)}
                                  className="text-[11px] bg-cyan-700/50 hover:bg-cyan-700 text-white rounded-lg px-3 py-1.5 font-black transition-colors"
                                >
                                  {language === 'ar' ? 'عرض التفاصيل' : 'View details'}
                                </button>
                              </div>
                            </div>
                          </div>
                          {expiresAt && (
                            <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-end gap-1.5 text-[10px] text-muted font-bold">
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
            )}

            {showDefaultTimePicker && (
              <TimePicker
                isOpen={showDefaultTimePicker}
                onClose={() => setShowDefaultTimePicker(false)}
                onConfirm={(h, m, ampm) => {
                  const label = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
                  setDefaultPickupTime(label);
                  localStorage.setItem('default_pickup_time', label);
                  setProfileDraft(prev => ({ ...prev, default_pickup_time: label }));
                  setShowDefaultTimePicker(false);
                  // NOTE: DB write removed — only saved when user presses main "Save" button
                }}
                onDelete={() => {
                  setDefaultPickupTime(null);
                  localStorage.removeItem('default_pickup_time');
                  setProfileDraft(prev => ({ ...prev, default_pickup_time: undefined }));
                  // NOTE: DB write removed — only committed when user presses main "Save" button
                }}
                initialHour={(() => {
                  if (!defaultPickupTime) return 3;
                  const match = defaultPickupTime.match(/^(\d+):/);
                  return match ? parseInt(match[1]) : 3;
                })()}
                initialMinute={(() => {
                  if (!defaultPickupTime) return 30;
                  const match = defaultPickupTime.match(/:(\d+)/);
                  return match ? parseInt(match[1]) : 30;
                })()}
                initialAmPm={(() => {
                  if (!defaultPickupTime) return 'PM';
                  return defaultPickupTime.includes('AM') ? 'AM' : 'PM';
                })()}
                language={language}
              />
            )}
            {couponDetailsCode && (
              <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80" onClick={() => setCouponDetailsCode(null)}>
                <div className="bg-surface w-full max-w-sm rounded-2xl border border-primary/30 p-4 text-start" onClick={(e) => e.stopPropagation()}>
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
                          className="w-full rounded-lg border border-primary/30 bg-dark/70 p-2 text-start hover:border-primary/60"
                        >
                          <p className="text-white font-black text-sm">#{(o as any).order_number}</p>
                          <p className="text-xs text-muted">{new Date(o.created_at).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}</p>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>

            {/* Orders Tab */}
            <div className={!fullScreenOrderId && activeTab === 'orders' ? 'block' : 'hidden'}>
              <>
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-white text-start mb-4">
                    {language === 'ar' ? 'طلباتي' : 'My Orders'}
                  </h3>
                </div>
                {loading && orders.length === 0 ? (
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
                            <h4 className="text-white font-bold text-start flex items-center justify-end gap-2 text-lg">
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
                                  const statusInfo = getStatusInfo(order.status, order.delivery_method);
                                  const StatusIcon = statusInfo.icon;


                                  return (
                                    <div
                                      key={order.id}
                                      id={`order-${order.id}`}
                                      className={`snap-center shrink-0 w-[85%] sm:w-[320px] bg-dark/70 border-2 rounded-2xl shadow-xl transition-all duration-500 flex flex-col hover:border-primary/50 overflow-hidden relative ${order.id === activeHighlightId ? 'order-highlight-glow border-primary' : 'border-primary/20'}`}
                                    >
                                      <div className="p-4 flex-1 flex flex-col">
                                        {/* Order number + pickup timer */}
                                        <div className="flex items-start justify-between mb-2 relative">
                                          <div className="text-start flex-1 cursor-pointer" onClick={() => setFullScreenOrderId(order.id)}>
                                            <p className="text-muted text-[10px] mb-0.5">{language === 'ar' ? 'رقم الطلب' : 'Order ID'}</p>
                                            <p className="text-white font-black text-2xl">#{order.order_number}</p>
                                          </div>

                                          {(() => {
                                            const pickupTimer = getPickupTimerMeta(order);
                                            if (!pickupTimer) return null;
                                            const formattedDeadline = (pickupTimer as any).deadlineRaw ? formatDeadline((pickupTimer as any).deadlineRaw as string, language) : '';
                                            return (
                                              <div className="flex flex-col items-end gap-1">
                                                <div className={`text-[11px] font-black px-2 py-0.5 rounded-lg bg-black/35 border border-white/10 ${pickupTimer.className} min-w-[75px] text-center relative`}>
                                                  {pickupTimer.text}
                                                  {order.pickup_deadline_updated_at && (
                                                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-pulse shadow-[0_0_5px_rgba(59,130,246,0.8)]" title={language === 'ar' ? 'تم تحديث الموعد' : 'Time updated'}></span>
                                                  )}
                                                </div>
                                                <div className="h-3 flex items-center justify-end">
                                                  {formattedDeadline && (
                                                    <span className="text-[10px] text-muted font-bold leading-none">
                                                      {formattedDeadline}
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })()}
                                        </div>

                                        {/* Status badge */}
                                        <div className="flex items-center justify-end mb-2 cursor-pointer" onClick={() => setFullScreenOrderId(order.id)}>
                                          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black ${statusInfo.bg} ${statusInfo.border} ${statusInfo.color}`}>
                                            <StatusIcon className="w-3 h-3" />
                                            <span>{statusInfo.text}</span>
                                          </div>
                                        </div>

                                        {/* Time + item count + total row */}
                                        <div
                                          className="flex items-center justify-between text-xs text-gray-400 border-b border-primary/10 pb-3 cursor-pointer"
                                          onClick={() => setFullScreenOrderId(order.id)}
                                        >
                                          <div className="flex items-center gap-1.5">
                                            <Clock className="w-3 h-3 text-primary shrink-0" />
                                            <span dir="ltr" className="font-bold">
                                              {new Date(order.created_at).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US', {
                                                hour: '2-digit',
                                                minute: '2-digit'
                                              })}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className="bg-primary/10 border border-primary/20 text-primary text-[10px] font-black px-2 py-0.5 rounded-full">
                                              {(() => { const t = order.items.reduce((s, i) => s + i.quantity, 0); return language === 'ar' ? `${t} صنف` : `${t} item${t !== 1 ? 's' : ''}`; })()}
                                            </span>
                                            <span className="text-primary font-black text-base">
                                              {order.total_amount} <span className="text-[10px] font-bold">{language === 'ar' ? 'ج' : 'EG'}</span>
                                            </span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Integrated toggle button at the bottom */}
                                      <button
                                        onClick={() => setFullScreenOrderId(order.id)}
                                        className="w-full text-primary text-xs font-bold py-3 bg-primary/10 hover:bg-primary/20 transition-all mt-auto"
                                      >
                                        {language === 'ar' ? 'عرض التفاصيل' : 'Show Details'}
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Update Pickup Time Picker */}
                          {(() => {
                            const order = orders.find(o => o.id === showUpdateTimePicker);
                            if (!order) return null;
                            const d = order.pickup_deadline_at ? new Date(order.pickup_deadline_at) : new Date();
                            let h = d.getHours();
                            const ampm = h >= 12 ? 'PM' : 'AM';
                            h = h % 12 || 12;
                            return (
                              <TimePicker
                                isOpen={!!showUpdateTimePicker}
                                onClose={() => setShowUpdateTimePicker(null)}
                                language={language}
                                initialHour={h}
                                initialMinute={d.getMinutes()}
                                initialAmPm={ampm}
                                onConfirm={async (h2, m2, ampm2) => {
                                  let finalH = h2 % 12;
                                  if (ampm2 === 'PM') finalH += 12;
                                  const newDate = new Date(); // Base on 'now' to allow moving between Today/Tomorrow correctly
                                  newDate.setHours(finalH, m2, 0, 0);

                                  // If new date is in the past, assume tomorrow
                                  const nowComp = new Date(); nowComp.setSeconds(0, 0); if (newDate.getTime() < nowComp.getTime()) {
                                    newDate.setDate(newDate.getDate() + 1);
                                  }

                                  const { error } = await supabase
                                    .from('orders')
                                    .update({
                                      delivery_method: 'pickup',
                                      pickup_deadline_at: newDate.toISOString(),
                                      pickup_deadline_updated_at: new Date().toISOString(),
                                      pickup_deadline_operator_seen: false,
                                      updated_at: new Date().toISOString()
                                    })
                                    .eq('id', order.id);

                                  if (!error) {
                                    setShowUpdateTimePicker(null);
                                    fetchOrders();
                                  }
                                }}
                              />
                            );
                          })()}

                          {/* Past Orders List */}
                          <div className="space-y-4">
                            <h4 className="text-white font-bold text-start text-lg border-t border-primary/20 pt-6">
                              {language === 'ar' ? 'الطلبات السابقة' : 'Past Orders'}
                            </h4>
                            {pastOrders.length === 0 ? (
                              <div className="text-center py-8 bg-surface rounded-2xl border border-primary/20">
                                <Package className="w-16 h-16 text-primary/50 mx-auto mb-3" />
                                <p className="text-lg text-primary font-bold">{language === 'ar' ? 'لا توجد طلبات سابقة' : 'No Past Orders'}</p>
                              </div>
                            ) : (
                              pastOrders.map(order => {
                                const statusInfo = getStatusInfo(order.status, order.delivery_method);
                                const StatusIcon = statusInfo.icon;

                                return (
                                  <div
                                    key={order.id}
                                    className="bg-dark/50 border border-primary/30 rounded-xl p-6"
                                  >
                                    <div className="flex items-start justify-between mb-4">
                                      <div className="text-start flex-1">
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

                                      <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${statusInfo.bg} ${statusInfo.border} ${statusInfo.color}`}>
                                        <span className="font-bold text-sm">{statusInfo.text}</span>
                                        <StatusIcon className="w-5 h-5" />
                                      </div>
                                    </div>

                                    <div className="border-t border-purple-500/30 pt-4 mb-4">
                                      <h4 className="text-white font-bold mb-2 text-start">{language === 'ar' ? 'الأصناف:' : 'Items:'}</h4>
                                      <div className="space-y-2">
                                        {order.items.map(item => {
                                          const { title, subtitle } = resolveOrderItemNames(item, language, catalogLookup);
                                          return (
                                          <div key={item.id} className="order-detail-item-row flex items-center justify-between text-sm p-2.5 rounded-lg">
                                            <span className="text-primary font-bold">{item.subtotal} {language === 'ar' ? 'ج' : 'EG'}</span>
                                            <div className="text-start min-w-0">
                                              <span className="text-white block">{title}</span>
                                              {subtitle && (
                                                <span className="text-gray-400 text-xs block">{subtitle}</span>
                                              )}
                                              <span className="text-gray-400 mr-2">x{item.quantity}</span>
                                            </div>
                                          </div>
                                        );})}
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
                                        <p className="text-muted text-sm text-start">
                                          {order.order_note || (language === 'ar' ? 'لا توجد ملاحظة' : 'No note')}
                                        </p>
                                      </div>
                                    )}

                                    {order.notes.length > 0 && (
                                      <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-3 mb-4">
                                        <div className="flex items-center gap-2 mb-2 justify-end">
                                          <span className="text-yellow-300 font-bold">{language === 'ar' ? 'ملاحظات' : 'Notes'}</span>
                                          <StickyNote className="w-5 h-5 text-yellow-300" />
                                        </div>
                                        {order.notes.map(note => (
                                          <p key={note.id} className="text-yellow-200 text-sm text-start">
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
                                        <p className="text-red-200 text-sm text-start">{order.cancellation_reason}</p>
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
            </div>
          </div>
        </div>
        {settingsView === 'map' && (
          <MobileMapEditor
            initialLatitude={profileDraft.latitude || 30.0444}
            initialLongitude={profileDraft.longitude || 31.2357}
            zones={deliveryZones}
            services={deliveryServices}
            onConfirm={(data) => {
              const updatedData = {
                latitude: data.latitude,
                longitude: data.longitude,
                city: data.city,
                area: data.area,
                street: data.street,
                building_number: data.buildingNumber
              };
              // Map confirmed — update draft only; DB write happens on main "Save" button press
              setProfileDraft(p => ({ ...p, ...updatedData }));
              setSettingsView('addresses');
            }}
            onCancel={() => {
              if (locationBackupRef.current) {
                setProfileDraft(p => ({
                  ...p,
                  ...locationBackupRef.current
                }));
              }
              setSettingsView('addresses');
            }}
          />
        )}
      </div>

      <style>{`
        .profile-dropdown-desktop {
          animation: profileDockSheet 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
          transition: all 320ms cubic-bezier(0.22, 1, 0.36, 1);
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

      {typeof document !== 'undefined' &&
        showProfileCustomAddressInput &&
        addressNamePopoverPos &&
        createPortal(
          <AddressNamePopover
            mode="create"
            language={language}
            value={newProfileAddressName}
            onChange={setNewProfileAddressName}
            onSave={() => void addProfileCustomAddressTab()}
            onCancel={() => {
              setShowProfileCustomAddressInput(false);
              setPendingProfileAddressType(null);
              setNewProfileAddressName('');
              setAddressNamePopoverPos(null);
            }}
            position={addressNamePopoverPos}
          />,
          document.body
        )}

      {/* Logout confirmation dialog */}
      {logoutConfirm && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setLogoutConfirm(null)}
        >
          <div
            className="w-[90vw] max-w-sm rounded-2xl border border-primary/40 bg-[hsl(var(--color-surface))] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 border border-red-500/25">
                <LogOut className="w-5 h-5 text-red-400" />
              </div>
              <h4 className="text-base font-black text-white">
                {language === 'ar' ? 'تسجيل الخروج' : 'Logout'}
              </h4>
            </div>

            <p className="text-sm text-muted text-start leading-relaxed mb-2">
              {language === 'ar'
                ? 'هل أنت متأكد من تسجيل الخروج من هذا الحساب؟'
                : 'Are you sure you want to logout from this account?'}
            </p>

            <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-start mb-5">
              <p className="text-sm font-bold text-white">{logoutConfirm.name || (language === 'ar' ? 'بدون اسم' : 'No Name')}</p>
              <p className="text-xs text-muted mt-0.5" dir="ltr">{logoutConfirm.phone}</p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLogoutConfirm(null)}
                className="flex-1 rounded-xl border border-white/20 bg-white/5 py-2.5 text-sm font-black text-white transition-colors hover:bg-white/10"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const phoneToLogout = logoutConfirm.phone;
                  setLogoutConfirm(null);
                  try {
                    // Remove device_fingerprint from this customer so they're no longer "saved" on this device
                    const fp = getOrCreateDeviceFingerprint();
                    await supabase
                      .from('customers')
                      .update({ device_fingerprint: null } as any)
                      .eq('phone', phoneToLogout)
                      .eq('device_fingerprint', fp);

                    // Clear trusted hash
                    localStorage.removeItem(trustedPhoneKey(phoneToLogout));

                    // If this was the active account, clear it
                    const currentPhone = localStorage.getItem('customer_phone');
                    if (currentPhone === phoneToLogout) {
                      localStorage.removeItem('customer_phone');
                      setProfileCustomer(null);
                      setProfileCustomerId(null);
                      setProfileDraft(prev => ({ ...prev, name: '', phone: '' }));
                      if (onPhoneValidated) await onPhoneValidated('');
                    }

                    // Refresh the saved accounts list
                    await fetchSavedAccounts();
                    if (settingsView !== 'switch_accounts') {
                      setSettingsView('main');
                    }
                  } catch (err) {
                    console.error('Logout error:', err);
                  }
                }}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-black text-white transition-colors hover:bg-red-600"
              >
                {language === 'ar' ? 'موافق' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Note Editor ── centered floating card, no backdrop overlay */}
      {editingNoteOrderId && typeof document !== 'undefined' && createPortal(
        (() => {
          const close = () => { setEditingNoteOrderId(null); setEditedNote(''); };
          return (
            <div
              className="fixed inset-0 z-[250] flex items-center justify-center p-5"
              onClick={(e) => { e.stopPropagation(); close(); }}
            >
              <div
                className="w-full max-w-sm bg-dark border border-primary/50 rounded-3xl shadow-[0_8px_60px_rgba(0,0,0,0.9)] overflow-hidden animate-in zoom-in-95 fade-in duration-200"
                onClick={(e) => e.stopPropagation()}
                dir={language === 'ar' ? 'rtl' : 'ltr'}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-3">
                  <h3 className="text-sm font-black text-white">{language === 'ar' ? 'ملاحظة الطلب' : 'Order Note'}</h3>
                </div>

                {/* Textarea */}
                <div className="px-5 pb-3">
                  <textarea
                    value={editedNote}
                    onChange={(e) => setEditedNote(e.target.value)}
                    className="w-full h-[130px] bg-white/5 border border-primary/30 rounded-2xl p-3 text-white text-start text-sm resize-none focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none leading-relaxed"
                    dir="rtl"
                    placeholder={language === 'ar' ? 'اكتب ملاحظتك هنا...' : 'Write your note here...'}
                    autoFocus
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-2 px-5 pb-5">
                  <button
                    type="button"
                    onClick={close}
                    className="flex-1 rounded-2xl border border-white/20 bg-white/5 py-2.5 text-sm font-black text-white transition-colors hover:bg-white/10 active:scale-95"
                  >
                    {language === 'ar' ? 'إلغاء' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (editingNoteOrderId) void handleSaveNote(editingNoteOrderId); }}
                    className="flex-1 rounded-2xl bg-primary py-2.5 text-sm font-black text-white transition-all hover:bg-primary/90 active:scale-95 flex items-center justify-center gap-2"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {language === 'ar' ? 'حفظ' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()
        , document.body
      )}

      {/* ── Cancel Order ── centered floating card, no backdrop overlay */}
      {cancelOrderId && typeof document !== 'undefined' && createPortal(
        (() => {
          const close = () => { setCancelOrderId(null); setCancelReason(''); };
          return (
            <div
              className="fixed inset-0 z-[250] flex items-center justify-center p-5"
              onClick={(e) => { e.stopPropagation(); close(); }}
            >
              <div
                className="w-full max-w-sm bg-dark border border-red-500/50 rounded-3xl shadow-[0_8px_60px_rgba(0,0,0,0.9)] overflow-hidden animate-in zoom-in-95 fade-in duration-200"
                onClick={(e) => e.stopPropagation()}
                dir={language === 'ar' ? 'rtl' : 'ltr'}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-3">
                  <h3 className="text-sm font-black text-red-400">{language === 'ar' ? 'إلغاء الطلب' : 'Cancel Order'}</h3>
                </div>

                {/* Hint */}
                <div className="mx-5 mb-3 bg-red-900/20 border border-red-500/20 rounded-2xl px-4 py-3 text-start">
                  <p className="text-[11px] text-red-300/80">
                    {language === 'ar' ? 'اكتب سبب الإلغاء لإرساله للمراجعة.' : 'Write the reason to send a cancellation request.'}
                  </p>
                </div>

                {/* Textarea */}
                <div className="px-5 pb-3">
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    className="w-full h-[120px] bg-white/5 border border-red-500/30 rounded-2xl p-3 text-white text-start text-sm resize-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none leading-relaxed"
                    dir="rtl"
                    placeholder={language === 'ar' ? 'اكتب سبب الإلغاء هنا...' : 'Write cancellation reason here...'}
                    autoFocus
                  />
                </div>

                {/* Actions */}
                <div className="flex gap-2 px-5 pb-5">
                  <button
                    type="button"
                    onClick={close}
                    className="flex-1 rounded-2xl border border-white/20 bg-white/5 py-2.5 text-sm font-black text-white transition-colors hover:bg-white/10 active:scale-95"
                  >
                    {language === 'ar' ? 'تراجع' : 'Back'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (cancelOrderId) void handleCancelOrder(cancelOrderId); }}
                    disabled={!cancelReason.trim()}
                    className="flex-1 rounded-2xl bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed py-2.5 text-sm font-black text-white transition-all hover:bg-red-500 active:scale-95 flex items-center justify-center gap-2"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    {language === 'ar' ? 'تأكيد' : 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()
        , document.body
      )}

      {/* Full Screen Order Details Modal */}
      {fullScreenOrderId && phoneChrome && typeof document !== 'undefined' && createPortal(
        (() => {
          const order = orders.find(o => o.id === fullScreenOrderId);
          if (!order) return null;

          const itemsTotal = order.items.reduce((sum, item) => sum + item.subtotal, 0);
          const discount = order.applied_coupon_discount_percent
            ? Math.round((itemsTotal * order.applied_coupon_discount_percent) / 100)
            : 0;
          const deliveryFee = order.total_amount - (itemsTotal - discount);

          return (
            <>
              <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[199] animate-in fade-in duration-300"
                onClick={(e) => { e.stopPropagation(); setFullScreenOrderId(null); }}
              />
              <div
                onClick={(e) => e.stopPropagation()}
                className={`fixed inset-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[450px] sm:border-l border-primary/20 z-[200] bg-dark flex flex-col shadow-2xl animate-in slide-in-from-${language === 'ar' ? 'right' : 'bottom'}-full sm:slide-in-from-right-full duration-300`}
              >
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-dark/95 shrink-0 relative z-20 overflow-visible">
                  <button
                    onClick={() => setFullScreenOrderId(null)}
                    className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none shrink-0"
                  >
                    {language === 'ar' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  </button>
                  <h2 className="text-lg font-black text-white">{language === 'ar' ? 'تفاصيل الطلب' : 'Order Details'}</h2>
                  <div className="relative">
                    {!['completed', 'cancelled', 'rejected'].includes(order.status) && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowActionMenu(showActionMenu === order.id ? null : order.id);
                          }}
                          className="p-2 bg-primary/10 hover:bg-primary/20 rounded-xl transition-colors text-primary"
                        >
                          <Edit2 className="w-5 h-5" />
                        </button>
                        <OrderOptionsDropdown
                          order={order}
                          language={language}
                          isOpen={showActionMenu === order.id}
                          onClose={() => setShowActionMenu(null)}
                          onPickupTime={() => setShowUpdateTimePicker(order.id)}
                          onEditOrder={() => onStartOrderEdit?.(order)}
                          onCancelOrder={() => { setCancelOrderId(order.id); setCancelReason(''); }}
                          onEditNote={() => { setEditingNoteOrderId(order.id); setEditedNote(order.order_note || ''); }}
                          overlayZClass="z-[205]"
                          menuZClass="z-[206]"
                        />
                      </>
                    )}
                  </div>
                </div>


                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar" dir={language === 'ar' ? 'rtl' : 'ltr'}>
                  {/* Header Card */}
                  <div className="bg-primary/10 rounded-2xl p-4 border border-primary/20 text-center relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>
                    <p className="text-primary text-xs font-bold mb-1">{language === 'ar' ? 'رقم الطلب' : 'Order ID'}</p>
                    <p className="text-3xl font-black text-white tracking-wider">#{order.order_number}</p>
                    {(() => {
                      const timer = getPickupTimerMeta(order);
                      const remainingLabel = getRemainingLabel(timer?.deadlineRaw, language);
                      if (!timer || !remainingLabel) return null;
                      return (
                        <div className="mt-3 inline-flex items-center justify-center gap-2 bg-primary/20 px-3 py-1.5 rounded-lg border border-primary/30">
                          <Clock className={`w-4 h-4 ${timer.expired ? 'text-red-400' : 'text-primary'}`} />
                          <span className={`text-sm font-bold ${timer.expired ? 'text-red-400' : 'text-white'}`}>{remainingLabel}</span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Items */}
                  <OrderItemsSlider items={order.items} language={language} catalog={catalogLookup} />
                  {/* Timeline */}
                  <div className="bg-dark/40 rounded-2xl p-4 border border-primary/10">
                    <h3 className="text-sm font-black text-white mb-3 px-1">{language === 'ar' ? 'حالة الطلب' : 'Order Status'}</h3>
                    <OrderTimeline order={order} language={language} />
                  </div>



                  {/* Operator Note Display */}
                  {order.notes && order.notes.length > 0 && (
                    <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-3 flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-yellow-300 font-bold">{language === 'ar' ? 'ملاحظة الأوبراتور:' : 'Operator Note:'}</span>
                        <StickyNote className="w-4 h-4 text-yellow-300" />
                      </div>
                      {order.notes.map(note => (
                        <p key={note.id} className="text-xs text-yellow-200 text-start">{note.note}</p>
                      ))}
                    </div>
                  )}

                  {/* Customer Order Note Display */}
                  {order.order_note && (
                    <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 flex items-start gap-3">
                      <StickyNote className="w-4 h-4 text-primary mt-0.5" />
                      <div className="flex-1">
                        <p className="text-[10px] text-primary/60 font-bold mb-1 text-start">{language === 'ar' ? 'ملاحظة الطلب:' : 'Order Note:'}</p>
                        <p className="text-xs text-white text-start">{order.order_note}</p>
                      </div>
                    </div>
                  )}



                  {/* Totals Box */}
                  <div className="bg-primary/5 rounded-2xl p-4 border border-primary/20 space-y-3">
                    <div className="flex justify-between items-center text-sm text-gray-400">
                      <span className="font-bold text-white">{itemsTotal} <span className="text-xs">{language === 'ar' ? 'ج' : 'EG'}</span></span>
                      <span>{language === 'ar' ? 'إجمالي الأصناف' : 'Items Total'}</span>
                    </div>
                    {discount > 0 && (
                      <div className="flex justify-between items-center text-sm text-green-400">
                        <span className="font-bold">-{discount} <span className="text-xs">{language === 'ar' ? 'ج' : 'EG'}</span></span>
                        <span>{language === 'ar' ? 'خصم الكوبون' : 'Coupon Discount'}</span>
                      </div>
                    )}
                    {(order.delivery_method === 'delivery' || deliveryFee > 0) && (
                      <div className="flex justify-between items-center text-sm text-gray-400">
                        <span className="font-bold text-white">
                          {deliveryFee > 0 ? `${deliveryFee} ${language === 'ar' ? 'ج' : 'EG'}` : (language === 'ar' ? 'مجاني' : 'Free')}
                        </span>
                        <span>{language === 'ar' ? 'رسوم التوصيل' : 'Delivery Fee'}</span>
                      </div>
                    )}
                    <div className="h-px bg-white/10 my-2"></div>
                    <div className="flex justify-between items-center pt-2">
                      <span className="font-black text-2xl text-primary">{order.total_amount} <span className="text-sm">{language === 'ar' ? 'ج' : 'EG'}</span></span>
                      <span className="font-black text-lg text-white">{language === 'ar' ? 'الإجمالي' : 'Total'}</span>
                    </div>
                  </div>

                  <div className="h-4"></div>
                </div>
              </div>
            </>
          );
        })(),
        document.body
      )}

    </div>
  );
}

/** Helpers for account management */

const filterDigits = (val: string) => val.replace(/\D/g, '');
const trustedPhoneKey = (phone: string) => `trusted_phone_auth:${phone}`;

interface AddAccountBlockProps {
  language: 'ar' | 'en';
  phoneChrome: boolean;
  onBack: () => void;
  onSuccess: (phone: string) => void | Promise<void>;
}

type AddAccountStep = 'phone' | 'password' | 'name';

function AddAccountBlock({ language, phoneChrome, onBack, onSuccess }: AddAccountBlockProps) {
  const [step, setStep] = useState<AddAccountStep>('phone');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');
  const [resetPwd1, setResetPwd1] = useState('');
  const [resetPwd2, setResetPwd2] = useState('');
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNewRecovery, setResetNewRecovery] = useState<string | null>(null);
  const [existingRow, setExistingRow] = useState<{
    id: string;
    phone_password_hash: string | null;
    phone_password_owner_fingerprint: string | null;
    name?: string | null;
  } | null>(null);

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = filterDigits(phone);
    if (cleanPhone.length > 15) {
      setError(language === 'ar' ? 'رقم الهاتف يجب ألا يتجاوز 15 رقم' : 'Phone number must not exceed 15 digits');
      return;
    }
    if (cleanPhone.length < 10) {
      setError(language === 'ar' ? 'أدخل رقم هاتف صحيح (10 أرقام على الأقل)' : 'Enter a valid phone number (at least 10 digits)');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const currentActivePhone = filterDigits(localStorage.getItem('customer_phone') || '');
      if (currentActivePhone && cleanPhone === currentActivePhone) {
        // Same active phone should refresh/select the account instead of hard-failing.
        await onSuccess(cleanPhone);
        setLoading(false);
        return;
      }
      const existing = await findCustomerAuthByPhone(cleanPhone);

      if (existing) {
        setExistingRow(existing);
        const fp = getOrCreateDeviceFingerprint();
        const ownerFp = (existing as any)?.phone_password_owner_fingerprint as string | null | undefined;
        const hasPwd = !!existing.phone_password_hash;
        const requireByDevice = hasPwd && (!ownerFp || ownerFp.trim() === '' || ownerFp !== fp);
        const trustedHash = hasPwd ? localStorage.getItem(trustedPhoneKey(cleanPhone)) : null;
        const trustedOnThisDevice = hasPwd && trustedHash && trustedHash === existing.phone_password_hash;
        const requirePwd = requireByDevice && !trustedOnThisDevice;

        if (requirePwd) {
          // Existing customer WITH password → show password step
          setStep('password');
        } else {
          // Existing customer WITHOUT password (or trusted device) → link this device and login directly
          const customerUpdatePayload = {
            device_fingerprint: fp,
            updated_at: new Date().toISOString()
          };
          await supabase.from('customers').update(customerUpdatePayload).eq('id', existing.id);
          await onSuccess(cleanPhone);
        }
      } else {
        // New customer → show name step
        setExistingRow(null);
        setStep('name');
      }
    } catch (err) {
      console.error('Phone lookup error:', err);
      setError(language === 'ar' ? 'حدث خطأ. حاول مرة أخرى.' : 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError(language === 'ar' ? 'أدخل كلمة المرور' : 'Enter the password');
      return;
    }

    setError(null);
    setLoading(true);
    const cleanPhone = filterDigits(phone);

    try {
      const hash = await hashPhonePassword(cleanPhone, password);
      if (hash !== existingRow?.phone_password_hash) {
        setError(language === 'ar' ? 'كلمة المرور غير صحيحة.' : 'Incorrect password.');
        setLoading(false);
        return;
      }
      // Remember this device for this phone until password changes
      if (existingRow?.phone_password_hash) {
        localStorage.setItem(trustedPhoneKey(cleanPhone), existingRow.phone_password_hash);
      }
      // Password correct — login
      const fp = getOrCreateDeviceFingerprint();
      await supabase.from('customers').update({
        device_fingerprint: fp,
        updated_at: new Date().toISOString()
      }).eq('id', existingRow!.id);
      await onSuccess(cleanPhone);
    } catch (err) {
      console.error('Password verify error:', err);
      setError(language === 'ar' ? 'حدث خطأ أثناء التحقق.' : 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(language === 'ar' ? 'أدخل اسمك' : 'Enter your name');
      return;
    }

    setError(null);
    setLoading(true);
    const cleanPhone = filterDigits(phone);
    if (cleanPhone.length > 15) {
      setError(language === 'ar' ? 'رقم الهاتف يجب ألا يتجاوز 15 رقم' : 'Phone number must not exceed 15 digits');
      setLoading(false);
      return;
    }
    if (cleanPhone.length < 10) {
      setError(language === 'ar' ? 'أدخل رقم هاتف صحيح (10 أرقام على الأقل)' : 'Enter a valid phone number (at least 10 digits)');
      setLoading(false);
      return;
    }

    try {
      const fp = getOrCreateDeviceFingerprint();
      await ensureCustomerByPhone(cleanPhone, {
        name: name.trim(),
        device_fingerprint: fp
      });
      await onSuccess(cleanPhone);
    } catch (err) {
      console.error('Create account error:', err);
      setError(language === 'ar' ? 'حدث خطأ أثناء إنشاء الحساب.' : 'Failed to create account.');
    } finally {
      setLoading(false);
    }
  };

  const handleStepBack = () => {
    if (step === 'phone') {
      onBack();
    } else {
      setStep('phone');
      setPassword('');
      setForgotMode(false);
      setRecoveryCodeInput('');
      setResetPwd1('');
      setResetPwd2('');
      setResetErr(null);
      setResetNewRecovery(null);
      setName('');
      setError(null);
      setExistingRow(null);
    }
  };

  const stepTitle = step === 'phone'
    ? (language === 'ar' ? 'إضافة حساب' : 'Add Account')
    : step === 'password'
      ? (language === 'ar' ? 'تسجيل الدخول' : 'Sign In')
      : (language === 'ar' ? 'حساب جديد' : 'New Account');

  const stepSubtitle = step === 'phone'
    ? (language === 'ar' ? 'أدخل رقم الهاتف للمتابعة' : 'Enter your phone number to continue')
    : step === 'password'
      ? (language === 'ar' ? 'هذا الرقم محمي بكلمة مرور' : 'This number is password-protected')
      : (language === 'ar' ? 'أدخل اسمك لإنشاء حساب جديد' : 'Enter your name to create a new account');

  return (
    <div className={`space-y-4 ${phoneChrome ? 'profile-mobile-push' : ''}`}>
      <button
        type="button"
        onClick={handleStepBack}
        className="h-9 w-9 flex items-center justify-center rounded-full bg-white/10 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/20 focus:outline-none shrink-0"
                  >
                    {language === 'ar' ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
                  </button>

      <div className="text-start">
        <h4 className="text-sm font-black text-white">{stepTitle}</h4>
        <p className="text-xs text-muted mt-0.5">{stepSubtitle}</p>
      </div>

      {/* Step 1: Phone number */}
      {step === 'phone' && (
        <form onSubmit={handlePhoneSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-start text-xs text-muted">
              {language === 'ar' ? 'رقم الهاتف' : 'Phone Number'}
            </label>
            <input
              required
              type="tel"
              autoFocus
              value={phone}
              maxLength={15}
              onChange={e => {
                const next = filterDigits(e.target.value).slice(0, 15);
                setPhone(next);
                if (error) setError(null);
              }}
              placeholder="01xxxxxxxxx"
              className="w-full rounded-xl border border-primary/35 bg-dark px-4 py-3 text-start text-sm text-white focus:border-primary/60 outline-none"
              dir="ltr"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-start text-xs text-red-500 border border-red-500/20">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <p className="flex-1">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || filterDigits(phone).length < 10}
            className="w-full h-12 rounded-xl bg-primary text-white font-black text-sm transition-all hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              language === 'ar' ? 'التالي' : 'Next'
            )}
          </button>
        </form>
      )}

      {/* Step 2a: Password for existing protected account */}
      {step === 'password' && (
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-start">
            <p className="text-xs text-muted">{language === 'ar' ? 'رقم الهاتف' : 'Phone Number'}</p>
            <p className="text-sm font-bold text-white mt-0.5" dir="ltr">{filterDigits(phone)}</p>
          </div>

          <div>
            <label className="mb-1 block text-start text-xs text-muted">
              {language === 'ar' ? 'كلمة المرور' : 'Password'}
            </label>
            <div className="relative">
              <input
                required
                type="password"
                autoFocus
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }}
                placeholder="••••••••"
                className="w-full rounded-xl border border-primary/35 bg-dark px-4 py-3 text-start text-sm text-white focus:border-primary/60 outline-none"
              />
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setForgotMode((v) => !v);
              setResetErr(null);
              setResetNewRecovery(null);
              setError(null);
            }}
            className="text-[11px] font-black text-amber-200/90 hover:text-amber-200 underline text-start w-full"
          >
            {language === 'ar' ? 'هل نسيت كلمة المرور؟' : 'Forgot password?'}
          </button>

          {forgotMode && (
            <div className="rounded-lg border border-amber-500/30 bg-black/20 p-2 space-y-2">
              <p className="text-[11px] text-amber-100/85 text-start leading-relaxed">
                {language === 'ar'
                  ? 'أدخل كود الاسترجاع الذي حصلت عليه عند إنشاء كلمة المرور، ثم عيّن كلمة مرور جديدة.'
                  : 'Enter your numeric recovery code, then set a new password.'}
              </p>
              <input
                type="tel"
                value={recoveryCodeInput}
                onChange={(e) => {
                  setRecoveryCodeInput(filterDigits(e.target.value).slice(0, 6));
                  setResetErr(null);
                }}
                className="w-full bg-dark border border-amber-500/35 rounded-lg px-3 py-2 text-white text-start text-sm font-black"
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
                  className="w-full bg-dark border border-amber-500/35 rounded-lg px-3 py-2 text-white text-start text-sm"
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
                  className="w-full bg-dark border border-amber-500/35 rounded-lg px-3 py-2 text-white text-start text-sm"
                  placeholder={language === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm password'}
                  dir="ltr"
                />
              </div>
              {resetErr && <p className="text-red-400 text-[11px] font-black text-start">{resetErr}</p>}
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
                  const cleanPhone = filterDigits(phone || '');
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
                      .eq('phone', cleanPhone)
                      .maybeSingle();
                    const expected = (row as any)?.phone_recovery_code_hash as string | null | undefined;
                    if (!row?.id || !expected) {
                      setResetErr(language === 'ar' ? 'لا يوجد كود استرجاع لهذا الرقم.' : 'No recovery code for this number.');
                      return;
                    }
                    const h = await hashRecoveryCode(cleanPhone, recoveryCodeInput);
                    if (h !== expected) {
                      setResetErr(language === 'ar' ? 'كود الاسترجاع غير صحيح.' : 'Invalid recovery code.');
                      return;
                    }
                    const fp = getOrCreateDeviceFingerprint();
                    const newPwdHash = await hashPhonePassword(cleanPhone, resetPwd1);
                    const oldPwdHash = (row as any)?.phone_password_hash as string | null | undefined;
                    if (oldPwdHash && newPwdHash === oldPwdHash) {
                      setResetErr(language === 'ar' ? 'لا يمكن اختيار نفس كلمة المرور السابقة.' : 'You cannot reuse the previous password.');
                      return;
                    }
                    const newRecovery = generateEasyRecoveryCode();
                    const newRecoveryHash = await hashRecoveryCode(cleanPhone, newRecovery);
                    const { error: updateErr } = await supabase
                      .from('customers')
                      .update({
                        phone_password_hash: newPwdHash,
                        phone_recovery_code_hash: newRecoveryHash,
                        phone_password_owner_fingerprint: fp,
                        updated_at: new Date().toISOString()
                      })
                      .eq('id', row.id);
                    if (updateErr) throw updateErr;
                    setExistingRow((prev) => (prev ? { ...prev, phone_password_hash: newPwdHash } : prev));
                    setPassword('');
                    setError(null);
                    setResetNewRecovery(newRecovery);
                    setResetErr(null);
                  } catch (err) {
                    console.error(err);
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

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-start text-xs text-red-500 border border-red-500/20">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <p className="flex-1">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-primary text-white font-black text-sm transition-all hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              language === 'ar' ? 'تسجيل الدخول' : 'Sign In'
            )}
          </button>
        </form>
      )}

      {/* Step 2b: Name for new customer */}
      {step === 'name' && (
        <form onSubmit={handleNameSubmit} className="space-y-4">
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-start">
            <p className="text-xs text-muted">{language === 'ar' ? 'رقم الهاتف' : 'Phone Number'}</p>
            <p className="text-sm font-bold text-white mt-0.5" dir="ltr">{filterDigits(phone)}</p>
          </div>

          <div>
            <label className="mb-1 block text-start text-xs text-muted">
              {language === 'ar' ? 'الاسم' : 'Name'}
            </label>
            <input
              required
              autoFocus
              value={name}
              onChange={e => { setName(e.target.value); setError(null); }}
              placeholder={language === 'ar' ? 'أدخل اسمك' : 'Enter your name'}
              className="w-full rounded-xl border border-primary/35 bg-dark px-4 py-3 text-start text-sm text-white focus:border-primary/60 outline-none"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-start text-xs text-red-500 border border-red-500/20">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <p className="flex-1">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-primary text-white font-black text-sm transition-all hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              language === 'ar' ? 'إنشاء الحساب' : 'Create Account'
            )}
          </button>
        </form>
      )}


    </div>
  );
}