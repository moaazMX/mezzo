import { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import { supabase, Order, OrderItem, Customer, CustomerNote } from '../../lib/supabase';
import { Clock, Package, Truck, CheckCircle, XCircle, AlertTriangle, StickyNote, User, Phone, MapPin, Archive, Edit2, X, Navigation, TicketPercent, List } from 'lucide-react';
import MapView from '../MapView';

interface OrderWithDetails extends Order {
  items: OrderItem[];
  customer: Customer | null;
  notes: CustomerNote[];
  building_number?: string;
  landmark?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_secondary_phone?: string;
  customer_address_type?: 'apartment' | 'house' | 'workplace' | 'custom';
  customer_address_label?: string;
  customer_street?: string;
  customer_area?: string;
  customer_city?: string;
  customer_apartment?: string;
  customer_floor?: string;
  customer_building_number?: string;
  customer_house_name?: string;
  customer_company_name?: string;
  customer_landmark?: string;
  customer_latitude?: number;
  customer_longitude?: number;
  customer_update_flag?: boolean;
}

interface ArchiveOrderWithDetails {
  id: string;
  original_order_id: string;
  customer_id: string;
  order_number: string;
  status: string;
  payment_method: string;
  total_amount: number;
  cancellation_reason: string;
  cancelled_by: string;
  cancellation_stage: string;
  order_note: string;
  archived_at: string;
  original_created_at: string;
  original_updated_at: string;
  created_at: string;
  customer_latitude?: number;
  customer_longitude?: number;
  applied_coupon_id?: string | null;
  applied_coupon_code?: string | null;
  applied_coupon_discount_percent?: number | null;
  delivery_method?: 'delivery' | 'pickup';
  items: OrderItem[];
  customer: Customer | null;
  notes: CustomerNote[];
  building_number?: string;
  landmark?: string;
  customer_name?: string;
  customer_phone?: string;
  customer_secondary_phone?: string;
  customer_address_type?: 'apartment' | 'house' | 'workplace' | 'custom';
  customer_address_label?: string;
  customer_street?: string;
  customer_area?: string;
  customer_city?: string;
  customer_apartment?: string;
  customer_floor?: string;
  customer_building_number?: string;
  customer_house_name?: string;
  customer_company_name?: string;
  customer_landmark?: string;
}

export type OrdersManagementHandle = {
  focusCustomerByPhone: (phone: string) => void;
  revealOrder: (orderId: string, kind: 'live' | 'archive') => void;
};

const OrdersManagement = forwardRef<OrdersManagementHandle, Record<string, never>>(function OrdersManagement(_props, ref) {
  const language = 'ar';
  const [activeOrders, setActiveOrders] = useState<OrderWithDetails[]>([]);
  const [completedOrders, setCompletedOrders] = useState<OrderWithDetails[]>([]);
  const [archiveOrders, setArchiveOrders] = useState<ArchiveOrderWithDetails[]>([]);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);
  const [selectedArchiveOrder, setSelectedArchiveOrder] = useState<ArchiveOrderWithDetails | null>(null);
  const [noteText, setNoteText] = useState('');
  const [operatorNotePublic, setOperatorNotePublic] = useState(true);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [modalPosition, setModalPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const modalPositionRef = useRef({ x: 0, y: 0 });
  const [searchName, setSearchName] = useState('');
  const [searchPhone, setSearchPhone] = useState('');
  const [searchOrderNumber, setSearchOrderNumber] = useState('');
  const [searchAddress, setSearchAddress] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [mapLocation, setMapLocation] = useState<{ latitude: number; longitude: number; name?: string; address?: string } | null>(null);
  const [searchDate, setSearchDate] = useState('');
  const [expandedArchiveGroups, setExpandedArchiveGroups] = useState<Set<string>>(new Set());
  const [pendingArchiveRevealOrderId, setPendingArchiveRevealOrderId] = useState<string | null>(null);
  const datePickerRef = useRef<HTMLInputElement | null>(null);

  const [readOrders, setReadOrders] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('op_read_orders');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [readNotes, setReadNotes] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('op_read_notes');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  useEffect(() => {
    localStorage.setItem('op_read_orders', JSON.stringify(Array.from(readOrders)));
  }, [readOrders]);

  useEffect(() => {
    localStorage.setItem('op_read_notes', JSON.stringify(Array.from(readNotes)));
  }, [readNotes]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const orderNotesRef = useRef<Record<string, string>>({});
  const activeOrdersRef = useRef<OrderWithDetails[]>([]);
  const completedOrdersRef = useRef<OrderWithDetails[]>([]);
  const archiveOrdersRef = useRef<ArchiveOrderWithDetails[]>([]);

  const playBeepFallback = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.07, ctx.currentTime);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + 0.14);
      void ctx.close();
    } catch {
      /* ignore */
    }
  };

  const playNotificationSound = () => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio('/notification.wav');
      }
      void audioRef.current.play().catch(() => playBeepFallback());
    } catch {
      playBeepFallback();
    }
  };

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editedNoteText, setEditedNoteText] = useState('');
  const [customerNoteFlashOrderIds, setCustomerNoteFlashOrderIds] = useState<Set<string>>(() => new Set());
  const [pulseOrderBarId, setPulseOrderBarId] = useState<string | null>(null);
  const [quickCustomerMenuOrderId, setQuickCustomerMenuOrderId] = useState<string | null>(null);
  const [archiveCurrentNames, setArchiveCurrentNames] = useState<Record<string, string>>({});
  const [updatingStatusOrderId, setUpdatingStatusOrderId] = useState<string | null>(null);

  const syncOrderNoteRefs = useCallback((list: OrderWithDetails[]) => {
    list.forEach(o => {
      orderNotesRef.current[o.id] = o.order_note ?? '';
    });
  }, []);

  useEffect(() => {
    activeOrdersRef.current = activeOrders;
    completedOrdersRef.current = completedOrders;
    archiveOrdersRef.current = archiveOrders;
  }, [activeOrders, completedOrders, archiveOrders]);

  const fetchOrders = async () => {
    const { data: ordersData } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (ordersData) {
      const ordersWithDetails = await Promise.all(
        ordersData.map(async (order) => {
          const [{ data: items }, { data: customer }, { data: notes }] = await Promise.all([
            supabase.from('order_items').select('*').eq('order_id', order.id),
            supabase.from('customers').select('*').eq('id', order.customer_id).maybeSingle(),
            supabase.from('customer_notes').select('*').eq('order_id', order.id)
          ]);

          return {
            ...order,
            items: items || [],
            customer: customer || null,
            notes: notes || []
          };
        })
      );

      setActiveOrders(ordersWithDetails.filter(o => !['completed', 'cancelled'].includes(o.status)));
      setCompletedOrders(ordersWithDetails.filter(o => ['completed', 'cancelled'].includes(o.status)));
      syncOrderNoteRefs(ordersWithDetails);
      // Refresh selectedOrder if it's open so receipt stays updated
      setSelectedOrder(prev => {
        if (!prev) return null;
        const refreshed = ordersWithDetails.find(o => o.id === prev.id);
        if (refreshed) {
          // If modal is open, we mark it and its current notes as read
          setReadOrders(prevSet => new Set(prevSet).add(refreshed.id));
          setReadNotes(prevSet => {
            const next = new Set(prevSet);
            refreshed.notes.forEach((anyNote: any) => next.add(anyNote.id));
            if (refreshed.order_note) next.add(`order-note-${refreshed.id}`);
            return next;
          });
        }
        return refreshed || prev;
      });
    }
  };

  const fetchArchiveOrders = async () => {
    try {
      const { data: archiveData, error: archiveError } = await supabase
        .from('archive_orders')
        .select('*')
        .order('archived_at', { ascending: false });

      if (archiveError) {
        console.error('Error fetching archive orders:', archiveError);
        setArchiveOrders([]);
        return;
      }

      if (archiveData && archiveData.length > 0) {
        const archiveWithDetails = await Promise.all(
          archiveData.map(async (order) => {
            try {
              const [{ data: items }, { data: notes }] = await Promise.all([
                supabase.from('archive_order_items').select('*').eq('archive_order_id', order.id),
                supabase.from('archive_customer_notes').select('*').eq('archive_order_id', order.id)
              ]);

              const customer = buildArchivedCustomerSnapshot(order);

              return {
                ...order,
                customer_latitude: order.customer_latitude || undefined,
                customer_longitude: order.customer_longitude || undefined,
                items: items || [],
                customer: customer || null,
                notes: notes || []
              };
            } catch (error) {
              console.error('Error processing archive order:', error);
              const customer = buildArchivedCustomerSnapshot(order);
              return {
                ...order,
                items: [],
                customer: customer,
                notes: []
              };
            }
          })
        );

        setArchiveOrders(archiveWithDetails);
      } else {
        setArchiveOrders([]);
      }
    } catch (error) {
      console.error('Error in fetchArchiveOrders:', error);
      setArchiveOrders([]);
    }
  };

  // Convert Arabic numerals to English
  const convertArabicToEnglish = (text: string): string => {
    const arabicToEnglish: { [key: string]: string } = {
      '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
      '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
    };

    return text.split('').map(char => arabicToEnglish[char] || char).join('');
  };

  const formatDateLabel = (raw: string): string => {
    if (!raw) return language === 'ar' ? 'التاريخ' : 'Date';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString('ar-EG');
  };

  const formatDateTimeLabel = (raw: string): string => {
    if (!raw) return language === 'ar' ? 'التاريخ' : 'Date';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const parseDateQuery = (query: string): { year?: number; month?: number; day?: number } => {
    const result: { year?: number; month?: number; day?: number } = {};

    // Convert Arabic numerals to English first
    const normalizedQuery = convertArabicToEnglish(query);

    // Date picker value format: YYYY-MM-DD
    const iso = normalizedQuery.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) {
      result.year = parseInt(iso[1], 10);
      result.month = parseInt(iso[2], 10);
      result.day = parseInt(iso[3], 10);
      return result;
    }

    // Try to match year (4 digits) - can be at start or anywhere
    const yearMatch = normalizedQuery.match(/(?:^|\D)(20\d{2})(?:\D|$)/);
    if (yearMatch) {
      result.year = parseInt(yearMatch[1]);
    }

    // Try to match month (1-12) - but not if it's part of a year
    const monthMatch = normalizedQuery.match(/(?:^|\D)([1-9]|1[0-2])(?:\D|$)/);
    if (monthMatch && !yearMatch) {
      const num = parseInt(monthMatch[1]);
      if (num >= 1 && num <= 12) {
        result.month = num;
      }
    } else if (monthMatch && yearMatch) {
      // If year exists, check if month is separate
      const monthIndex = normalizedQuery.indexOf(monthMatch[1]);
      const yearIndex = normalizedQuery.indexOf(yearMatch[1]);
      if (Math.abs(monthIndex - yearIndex) > 2) {
        const num = parseInt(monthMatch[1]);
        if (num >= 1 && num <= 12) {
          result.month = num;
        }
      }
    }

    // Try to match day (1-31)
    const dayMatch = normalizedQuery.match(/(?:^|\D)([1-9]|[12][0-9]|3[01])(?:\D|$)/);
    if (dayMatch) {
      const num = parseInt(dayMatch[1]);
      if (num >= 1 && num <= 31) {
        // Make sure it's not the year or month
        if (!yearMatch || dayMatch[1] !== yearMatch[1]) {
          if (!result.month || dayMatch[1] !== monthMatch?.[1]) {
            result.day = num;
          }
        }
      }
    }

    return result;
  };

  const buildArchivedCustomerSnapshot = (order: any): Customer | null => {
    if (!order?.customer_name && !order?.customer_phone) return null;
    return {
      id: order.customer_id || '',
      name: order.customer_name || '',
      phone: order.customer_phone || '',
      secondary_phone: order.customer_secondary_phone || '',
      street: order.customer_street || '',
      area: order.customer_area || '',
      city: order.customer_city || '',
      apartment: order.customer_apartment || '',
      floor: order.customer_floor || '',
      building_number: order.customer_building_number || '',
      house_name: order.customer_house_name || '',
      company_name: order.customer_company_name || '',
      landmark: order.customer_landmark || '',
      latitude: order.customer_latitude || null,
      longitude: order.customer_longitude || null,
      created_at: order.original_created_at || order.created_at || new Date().toISOString(),
      updated_at: order.original_updated_at || order.updated_at || new Date().toISOString()
    } as Customer;
  };

  const loadArchiveCurrentCustomerName = async (order: ArchiveOrderWithDetails): Promise<void> => {
    if (archiveCurrentNames[order.id]) return;
    let currentName = '';
    if (order.customer_id) {
      const { data } = await supabase
        .from('customers')
        .select('name')
        .eq('id', order.customer_id)
        .maybeSingle();
      currentName = data?.name || '';
    }
    if (!currentName && (order.customer_phone || order.customer?.phone)) {
      const { data } = await supabase
        .from('customers')
        .select('name')
        .eq('phone', order.customer_phone || order.customer?.phone || '')
        .maybeSingle();
      currentName = data?.name || '';
    }
    setArchiveCurrentNames((prev) => ({ ...prev, [order.id]: currentName || (language === 'ar' ? 'غير متاح' : 'N/A') }));
  };

  const archiveGroups = useMemo(() => {
    const sorted = [...archiveOrders].sort((a, b) => +new Date(b.archived_at || b.created_at) - +new Date(a.archived_at || a.created_at));
    if (sorted.length === 0) return [];

    // One section per archive run (batch): orders archived close in time belong together.
    // This avoids splitting a single "End of Day" run into many sections when DB times differ by seconds.
    const groups: Array<{ key: string; archivedAt: string; orders: ArchiveOrderWithDetails[] }> = [];
    const BATCH_GAP_MS = 20 * 60 * 1000;
    for (const order of sorted) {
      const archivedAt = order.archived_at || order.created_at;
      const ts = +new Date(archivedAt);
      const last = groups[groups.length - 1];
      if (!last) {
        groups.push({ key: `archive-run-${order.id}`, archivedAt, orders: [order] });
        continue;
      }
      const lastTs = +new Date(last.archivedAt);
      if (Math.abs(lastTs - ts) <= BATCH_GAP_MS) {
        last.orders.push(order);
      } else {
        groups.push({ key: `archive-run-${order.id}`, archivedAt, orders: [order] });
      }
    }

    return groups.map((group, idx) => {
      const previousGroup = groups[idx + 1];
      let startIso = previousGroup?.archivedAt || '';
      if (!startIso) {
        const firstOrderCreated = group.orders
          .map((o) => o.original_created_at || o.created_at)
          .filter(Boolean)
          .sort()[0];
        startIso = firstOrderCreated || group.archivedAt;
      }
      const endIso = group.archivedAt;
      const title = `${formatDateTimeLabel(startIso)} ← ${formatDateTimeLabel(endIso)}`;
      return { key: group.key, title, archivedAt: group.archivedAt, orders: group.orders };
    });
  }, [archiveOrders]);

  const searchOrders = async () => {
    const hasSearch = searchName.trim() || searchPhone.trim() || searchOrderNumber.trim() || searchAddress.trim() || searchDate.trim();
    if (!hasSearch) {

      // Fetch all orders when search is cleared
      const { data: ordersData } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (ordersData) {
        const ordersWithDetails = await Promise.all(
          ordersData.map(async (order) => {
            const [{ data: items }, { data: customer }, { data: notes }] = await Promise.all([
              supabase.from('order_items').select('*').eq('order_id', order.id),
              supabase.from('customers').select('*').eq('id', order.customer_id).maybeSingle(),
              supabase.from('customer_notes').select('*').eq('order_id', order.id)
            ]);

            return {
              ...order,
              items: items || [],
              customer: customer || null,
              notes: notes || []
            };
          })
        );

        setActiveOrders(ordersWithDetails.filter(o => !['completed', 'cancelled'].includes(o.status)));
        setCompletedOrders(ordersWithDetails.filter(o => ['completed', 'cancelled'].includes(o.status)));
      }

      // Fetch archive orders
      try {
        const { data: archiveData } = await supabase
          .from('archive_orders')
          .select('*')
          .order('archived_at', { ascending: false });

        if (archiveData && archiveData.length > 0) {
          const archiveWithDetails = await Promise.all(
            archiveData.map(async (order) => {
              try {
                const [{ data: items }, { data: notes }] = await Promise.all([
                  supabase.from('archive_order_items').select('*').eq('archive_order_id', order.id),
                  supabase.from('archive_customer_notes').select('*').eq('archive_order_id', order.id)
                ]);

                const customer = buildArchivedCustomerSnapshot(order);

                return {
                  ...order,
                  items: items || [],
                  customer: customer || null,
                  notes: notes || []
                };
              } catch (error) {
                console.error('Error processing archive order:', error);
                const customer = buildArchivedCustomerSnapshot(order);
                return {
                  ...order,
                  items: [],
                  customer: customer,
                  notes: []
                };
              }
            })
          );
          setArchiveOrders(archiveWithDetails);
        } else {
          setArchiveOrders([]);
        }
      } catch (error) {
        console.error('Error in fetchArchiveOrders:', error);
        setArchiveOrders([]);
      }
      return;
    }


    const nameQuery = searchName.trim().toLowerCase();
    const phoneQuery = searchPhone.trim().toLowerCase();
    const orderNumberQuery = searchOrderNumber.trim().toLowerCase();
    const addressQuery = searchAddress.trim().toLowerCase();
    const dateQuery = parseDateQuery(searchDate.trim());

    // Search in active orders
    const { data: allOrders } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    // Search in archive
    const { data: allArchiveOrders } = await supabase
      .from('archive_orders')
      .select('*')
      .order('archived_at', { ascending: false });

    let filteredOrders: OrderWithDetails[] = [];
    let filteredCompleted: OrderWithDetails[] = [];
    let filteredArchive: ArchiveOrderWithDetails[] = [];

    if (allOrders) {
      const ordersWithDetails = await Promise.all(
        allOrders.map(async (order) => {
          const [{ data: items }, { data: customer }, { data: notes }] = await Promise.all([
            supabase.from('order_items').select('*').eq('order_id', order.id),
            supabase.from('customers').select('*').eq('id', order.customer_id).maybeSingle(),
            supabase.from('customer_notes').select('*').eq('order_id', order.id)
          ]);

          return {
            ...order,
            items: items || [],
            customer: customer || null,
            notes: notes || []
          };
        })
      );

      syncOrderNoteRefs(ordersWithDetails);

      filteredOrders = ordersWithDetails.filter(order => {
        const orderDate = new Date(order.created_at);
        const matchesDate = !dateQuery.year || orderDate.getFullYear() === dateQuery.year;
        const matchesMonth = !dateQuery.month || orderDate.getMonth() + 1 === dateQuery.month;
        const matchesDay = !dateQuery.day || orderDate.getDate() === dateQuery.day;

        // Check each search field separately - search by whole words
        const matchesOrderNumber = !orderNumberQuery || order.order_number.toLowerCase() === orderNumberQuery || order.order_number.toLowerCase().includes(orderNumberQuery);

        // For name, phone, and address: search by whole words (split by spaces)
        let matchesCustomerName = true;
        if (nameQuery) {
          const customerName = (order.customer?.name || '').toLowerCase();
          const nameWords = nameQuery.trim().split(/\s+/).filter(w => w.length > 0);
          // All search words must be found in the customer name
          matchesCustomerName = nameWords.every(word => {
            // Check if word exists as a complete word or at word boundaries
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
            return regex.test(customerName) || customerName === word;
          });
        }

        const matchesPhone = !phoneQuery || (order.customer?.phone?.includes(phoneQuery) || false);

        let matchesAddress = true;
        if (addressQuery) {
          const fullAddress = `${order.customer?.street || ''} ${order.customer?.area || ''} ${order.customer?.city || ''}`.toLowerCase();
          const addressWords = addressQuery.trim().split(/\s+/).filter(w => w.length > 0);
          // All search words must be found in the address
          matchesAddress = addressWords.every(word => {
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
            return regex.test(fullAddress) || fullAddress.includes(word);
          });
        }

        const matchesDateFilter = !dateQuery.year && !dateQuery.month && !dateQuery.day || (matchesDate && matchesMonth && matchesDay);

        // All specified search criteria must match
        return matchesOrderNumber && matchesCustomerName && matchesPhone && matchesAddress && matchesDateFilter;
      });

      filteredCompleted = filteredOrders.filter(o => ['completed', 'cancelled'].includes(o.status));
      filteredOrders = filteredOrders.filter(o => !['completed', 'cancelled'].includes(o.status));
    }

    if (allArchiveOrders) {
      const archiveWithDetails = await Promise.all(
        allArchiveOrders.map(async (order) => {
          const [{ data: items }, { data: notes }] = await Promise.all([
            supabase.from('archive_order_items').select('*').eq('archive_order_id', order.id),
            supabase.from('archive_customer_notes').select('*').eq('archive_order_id', order.id)
          ]);
          const customer = buildArchivedCustomerSnapshot(order);

          return {
            ...order,
            items: items || [],
            customer: customer || null,
            notes: notes || []
          };
        })
      );

      filteredArchive = archiveWithDetails.filter(order => {
        const orderDate = new Date(order.original_created_at || order.created_at);
        const matchesDate = !dateQuery.year || orderDate.getFullYear() === dateQuery.year;
        const matchesMonth = !dateQuery.month || orderDate.getMonth() + 1 === dateQuery.month;
        const matchesDay = !dateQuery.day || orderDate.getDate() === dateQuery.day;

        // Check each search field separately - search by whole words
        const matchesOrderNumber = !orderNumberQuery || order.order_number.toLowerCase() === orderNumberQuery || order.order_number.toLowerCase().includes(orderNumberQuery);

        // For name, phone, and address: search by whole words (split by spaces)
        let matchesCustomerName = true;
        if (nameQuery) {
          const customerName = (order.customer?.name || '').toLowerCase();
          const nameWords = nameQuery.trim().split(/\s+/).filter(w => w.length > 0);
          // All search words must be found in the customer name
          matchesCustomerName = nameWords.every(word => {
            // Check if word exists as a complete word or at word boundaries
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
            return regex.test(customerName) || customerName === word;
          });
        }

        const matchesPhone = !phoneQuery || (order.customer?.phone?.includes(phoneQuery) || false);

        let matchesAddress = true;
        if (addressQuery) {
          const fullAddress = `${order.customer?.street || ''} ${order.customer?.area || ''} ${order.customer?.city || ''}`.toLowerCase();
          const addressWords = addressQuery.trim().split(/\s+/).filter(w => w.length > 0);
          // All search words must be found in the address
          matchesAddress = addressWords.every(word => {
            const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
            return regex.test(fullAddress) || fullAddress.includes(word);
          });
        }

        const matchesDateFilter = !dateQuery.year && !dateQuery.month && !dateQuery.day || (matchesDate && matchesMonth && matchesDay);

        // All specified search criteria must match
        return matchesOrderNumber && matchesCustomerName && matchesPhone && matchesAddress && matchesDateFilter;
      });
    }

    setActiveOrders(filteredOrders);
    setCompletedOrders(filteredCompleted);
    setArchiveOrders(filteredArchive);

  };

  // Initialize and setup real-time subscriptions
  useEffect(() => {
    fetchOrders();
    fetchArchiveOrders();

    // Real-time subscription for orders
    const ordersChannel = supabase
      .channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        const { eventType, new: newOrder, old: oldOrder } = payload;
        
        // Play sound for:
        // 1. New orders
        if (eventType === 'INSERT') {
          playNotificationSound();
        }
        // 2. Cancellation requests
        else if (eventType === 'UPDATE' && newOrder.status === 'cancellation_pending' && oldOrder.status !== 'cancellation_pending') {
          playNotificationSound();
        }
        // 3. تعديل ملاحظة العميل على الطلب (order_note) — مقارنة بالقيمة المحلية لأن قد لا يأتي السجل القديم كاملاً من Realtime
        else if (eventType === 'UPDATE' && newOrder && typeof (newOrder as any).id === 'string') {
          const id = (newOrder as any).id as string;
          if (Object.prototype.hasOwnProperty.call(newOrder, 'order_note')) {
            const prev = orderNotesRef.current[id] ?? '';
            const next = String((newOrder as any).order_note ?? '');
            if (prev !== next) {
              orderNotesRef.current[id] = next;
              playNotificationSound();
              setReadNotes(prevSet => {
                const n = new Set(prevSet);
                n.delete(`order-note-${id}`);
                return n;
              });
              setCustomerNoteFlashOrderIds(prev => new Set(prev).add(id));
              window.setTimeout(() => {
                setCustomerNoteFlashOrderIds(prev => {
                  const n = new Set(prev);
                  n.delete(id);
                  return n;
                });
              }, 4500);
            }
          }
        }

        fetchOrders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        fetchOrders();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
        fetchOrders();
      })
      .subscribe();

    return () => {
      ordersChannel.unsubscribe();
    };
  }, []);

  // Refresh archive when archive tab is opened
  useEffect(() => {
    if (showArchive) {
      fetchArchiveOrders();
    }
  }, [showArchive]);

  // If an archive order was requested before groups were ready, open its group once loaded.
  useEffect(() => {
    if (!showArchive || !pendingArchiveRevealOrderId) return;
    const ownerGroup = archiveGroups.find((g) => g.orders.some((o) => o.id === pendingArchiveRevealOrderId));
    if (!ownerGroup) return;
    setExpandedArchiveGroups((prev) => {
      const next = new Set(prev);
      next.add(ownerGroup.key);
      return next;
    });
    setPendingArchiveRevealOrderId(null);
  }, [showArchive, pendingArchiveRevealOrderId, archiveGroups]);

  useImperativeHandle(ref, () => ({
    focusCustomerByPhone: (phone: string) => {
      setSearchPhone(phone.trim());
      setSearchName('');
      setSearchOrderNumber('');
      setSearchAddress('');
      setSearchDate('');
    },
    revealOrder: (orderId: string, kind: 'live' | 'archive') => {
      if (kind === 'archive') {
        setShowArchive(true);
        setShowCompleted(false);
        setPendingArchiveRevealOrderId(orderId);
        const ownerGroup = archiveGroups.find((g) => g.orders.some((o) => o.id === orderId));
        if (ownerGroup) {
          setExpandedArchiveGroups((prev) => {
            const next = new Set(prev);
            next.add(ownerGroup.key);
            return next;
          });
        }
      } else {
        setShowArchive(false);
        const inActive = activeOrdersRef.current.some((o) => o.id === orderId);
        const inCompleted = completedOrdersRef.current.some((o) => o.id === orderId);
        if (inCompleted) {
          setShowCompleted(true);
        } else if (inActive) {
          setShowCompleted(false);
        } else {
          // If the order isn't in the active list, it's most likely completed/cancelled,
          // or filtered by current UI state — default to completed view so it can be found.
          setShowCompleted(true);
        }
      }
      setPulseOrderBarId(orderId);
      const domId = kind === 'archive' ? `order-bar-archive-${orderId}` : `order-bar-${orderId}`;
      const tryScroll = (attempt = 0) => {
        const el = document.getElementById(domId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        if (attempt < 8) {
          window.setTimeout(() => tryScroll(attempt + 1), 180);
        }
      };
      window.setTimeout(() => tryScroll(0), 280);
      window.setTimeout(() => setPulseOrderBarId(null), 2800);
    }
  }), [archiveGroups]);

  // Auto-search when any search field changes
  useEffect(() => {
    const hasSearch = searchName.trim() || searchPhone.trim() || searchOrderNumber.trim() || searchAddress.trim() || searchDate.trim();
    if (hasSearch) {
      const timeoutId = setTimeout(() => {
        searchOrders();
      }, 300); // Debounce: wait 300ms after user stops typing
      return () => clearTimeout(timeoutId);
    } else {
      // If all fields are empty, reset to show all orders

      fetchOrders();
      fetchArchiveOrders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchName, searchPhone, searchOrderNumber, searchAddress, searchDate]);

  const updateOrderStatus = async (orderId: string, status: Order['status']) => {
    setUpdatingStatusOrderId(orderId);
    await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', orderId);

    // Update selectedOrder if it's the same order
    if (selectedOrder && selectedOrder.id === orderId) {
      const updatedOrder = { ...selectedOrder, status } as OrderWithDetails;
      setSelectedOrder(updatedOrder);
    }

    fetchOrders();
    setUpdatingStatusOrderId(null);
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!cancelReason.trim()) {
      alert('الرجاء إدخال سبب الإلغاء');
      return;
    }
    setUpdatingStatusOrderId(orderId);
    const previousStatus = selectedOrder?.id === orderId ? selectedOrder.status : '';

    await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        cancellation_stage: previousStatus || null,
        cancellation_reason: cancelReason,
        cancelled_by: 'operator',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    // Update selectedOrder if it's the same order
    if (selectedOrder && selectedOrder.id === orderId) {
      const updatedOrder = {
        ...selectedOrder,
        status: 'cancelled' as const,
        cancellation_stage: previousStatus || selectedOrder.cancellation_stage,
        cancellation_reason: cancelReason,
        cancelled_by: 'operator'
      } as OrderWithDetails;
      setSelectedOrder(updatedOrder);
    }

    setShowCancelModal(false);
    setCancelReason('');
    fetchOrders();
    setUpdatingStatusOrderId(null);
  };

  const handleCancellationRequest = async (orderId: string, approve: boolean) => {
    if (approve) {
      await supabase
        .from('orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', orderId);

      // Update selectedOrder if it's the same order
      if (selectedOrder && selectedOrder.id === orderId) {
        const updatedOrder = {
          ...selectedOrder,
          status: 'cancelled' as const
        } as OrderWithDetails;
        setSelectedOrder(updatedOrder);
      }
    } else {
      await supabase
        .from('orders')
        .update({
          status: 'under_review',
          cancellation_reason: '',
          cancelled_by: '',
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId);

      // Update selectedOrder if it's the same order
      if (selectedOrder && selectedOrder.id === orderId) {
        const updatedOrder = {
          ...selectedOrder,
          status: 'under_review' as const,
          cancellation_reason: '',
          cancelled_by: ''
        } as OrderWithDetails;
        setSelectedOrder(updatedOrder);
      }
    }

    fetchOrders();
  };

  const addCustomerNote = async () => {
    if (!selectedOrder || !noteText.trim() || !selectedOrder.customer) return;

    const trimmed = noteText.trim();

    // Always add as general note (appears on all future orders)
    const { data: generalNoteRow, error: generalNoteError } = await supabase
      .from('customer_general_notes')
      .insert([{
        customer_phone: selectedOrder.customer.phone,
        customer_name: selectedOrder.customer.name,
        note: trimmed,
        created_by: 'operator',
        is_public: operatorNotePublic
      }])
      .select('id,general_note_id')
      .single();

    if (generalNoteError) {
      console.error('Error adding general note:', generalNoteError);
      alert('حدث خطأ أثناء إضافة الملاحظة');
      return;
    }

    const generalNoteId = (generalNoteRow?.general_note_id || generalNoteRow?.id) as string | undefined;

    // Also add to current order
    const { data: insertedNoteRow, error: insertedErr } = await supabase.from('customer_notes').insert([{
      customer_id: selectedOrder.customer_id,
      order_id: selectedOrder.id,
      general_note_id: generalNoteId || null,
      note: trimmed,
      created_by: 'operator',
      is_public: operatorNotePublic
    }]).select('*').single();
    if (insertedErr) {
      console.error('Error adding order note row:', insertedErr);
      alert('حدث خطأ أثناء إضافة الملاحظة');
      return;
    }

    setNoteText('');
    setOperatorNotePublic(true);
    
    // Update local state for immediate feedback
    if (selectedOrder) {
      const newNote = {
        id: (insertedNoteRow as any)?.id || Math.random().toString(36).substring(7),
        customer_id: selectedOrder.customer_id,
        order_id: selectedOrder.id,
        general_note_id: generalNoteId || null,
        note: trimmed,
        created_by: 'operator',
        is_public: operatorNotePublic,
        created_at: new Date().toISOString()
      };
      setSelectedOrder({
        ...selectedOrder,
        notes: [...(selectedOrder.notes || []), newNote]
      });
      // Make it "unread" again until receipt is opened (so it pulses)
      setReadNotes(prev => {
        const next = new Set(prev);
        next.delete(newNote.id);
        return next;
      });
    }
    
    fetchOrders();
  };

  const updateCustomerNote = async (noteId: string) => {
    if (!selectedOrder || !selectedOrder.customer) return;

    const note = selectedOrder.notes.find(n => n.id === noteId);
    if (!note) return;

    const trimmed = editedNoteText.trim();
    const orderId = selectedOrder.id;
    const customerPhone = selectedOrder.customer.phone;
    const customerName = selectedOrder.customer.name;
    const customerId = selectedOrder.customer_id;
    const generalNoteId = (note as any).general_note_id as string | null | undefined;

    try {
      // Ensure we have a stable id to update all notes across orders + archive
      let gnid: string | null = generalNoteId || null;
      if (!gnid) {
        const { data: fallbackGeneral } = await supabase
          .from('customer_general_notes')
          .select('id,general_note_id')
          .eq('customer_phone', customerPhone)
          .eq('customer_name', customerName)
          .eq('note', note.note)
          .maybeSingle();
        gnid = (fallbackGeneral?.general_note_id || fallbackGeneral?.id) || null;
      }

      if (!trimmed) {
        // Delete from general notes (source of truth)
        if (gnid) {
          const { error: deleteGeneralError } = await supabase
            .from('customer_general_notes')
            .delete()
            .eq('general_note_id', gnid);
          if (deleteGeneralError) throw deleteGeneralError;
        } else {
          const { error: deleteGeneralError } = await supabase
            .from('customer_general_notes')
            .delete()
            .eq('customer_phone', customerPhone)
            .eq('customer_name', customerName)
            .eq('note', note.note);
          if (deleteGeneralError) throw deleteGeneralError;
        }

        // Delete from ALL orders' notes for this customer
        if (gnid) {
          const { error: deleteAllOrderNotesErr } = await supabase
            .from('customer_notes')
            .delete()
            .eq('customer_id', customerId)
            .eq('general_note_id', gnid);
          if (deleteAllOrderNotesErr) throw deleteAllOrderNotesErr;
        } else {
          const { error: deleteAllOrderNotesErr } = await supabase
            .from('customer_notes')
            .delete()
            .eq('customer_id', customerId)
            .eq('note', note.note);
          if (deleteAllOrderNotesErr) throw deleteAllOrderNotesErr;
        }

        // Delete from archive notes for this customer
        if (gnid) {
          const { error: deleteArchiveErr } = await supabase
            .from('archive_customer_notes')
            .delete()
            .eq('customer_id', customerId)
            .eq('general_note_id', gnid);
          if (deleteArchiveErr) throw deleteArchiveErr;
        } else {
          const { error: deleteArchiveErr } = await supabase
            .from('archive_customer_notes')
            .delete()
            .eq('customer_id', customerId)
            .eq('note', note.note);
          if (deleteArchiveErr) throw deleteArchiveErr;
        }
      } else {
        // Update general note (source of truth)
        if (gnid) {
          const { error: updateGeneralError } = await supabase
            .from('customer_general_notes')
            .update({ note: trimmed, updated_at: new Date().toISOString() })
            .eq('general_note_id', gnid);
          if (updateGeneralError) throw updateGeneralError;
        } else {
          const { error: updateGeneralError } = await supabase
            .from('customer_general_notes')
            .update({ note: trimmed, updated_at: new Date().toISOString() })
            .eq('customer_phone', customerPhone)
            .eq('customer_name', customerName)
            .eq('note', note.note);
          if (updateGeneralError) throw updateGeneralError;
        }

        // Update ALL order notes for this customer
        if (gnid) {
          const { error: updateAllOrderNotesErr } = await supabase
            .from('customer_notes')
            .update({ note: trimmed })
            .eq('customer_id', customerId)
            .eq('general_note_id', gnid);
          if (updateAllOrderNotesErr) throw updateAllOrderNotesErr;
        } else {
          const { error: updateAllOrderNotesErr } = await supabase
            .from('customer_notes')
            .update({ note: trimmed })
            .eq('customer_id', customerId)
            .eq('note', note.note);
          if (updateAllOrderNotesErr) throw updateAllOrderNotesErr;
        }

        // Update archive notes for this customer
        if (gnid) {
          const { error: updateArchiveErr } = await supabase
            .from('archive_customer_notes')
            .update({ note: trimmed })
            .eq('customer_id', customerId)
            .eq('general_note_id', gnid);
          if (updateArchiveErr) throw updateArchiveErr;
        } else {
          const { error: updateArchiveErr } = await supabase
            .from('archive_customer_notes')
            .update({ note: trimmed })
            .eq('customer_id', customerId)
            .eq('note', note.note);
          if (updateArchiveErr) throw updateArchiveErr;
        }
      }

      // Clear editor only after DB success
      setEditingNoteId(null);
      setEditedNoteText('');

      // Optimistic UI for current modal
      setSelectedOrder(prev => {
        if (!prev) return prev;
        if (!trimmed) {
          return { ...prev, notes: (prev.notes || []).filter(n => n.id !== noteId) };
        }
        return {
          ...prev,
          notes: (prev.notes || []).map(n => n.id === noteId ? { ...n, note: trimmed } : n)
        };
      });
      // Mark as unread again until receipt is opened
      setReadNotes(prevSet => {
        const n = new Set(prevSet);
        n.delete(noteId);
        return n;
      });

      // Re-fetch only notes for this order (avoid fetchOrders() race)
      const { data: notesFromDb, error: notesErr } = await supabase
        .from('customer_notes')
        .select('*')
        .eq('order_id', orderId);
      if (notesErr) throw notesErr;

      setSelectedOrder(prev => {
        if (!prev) return prev;
        return { ...prev, notes: notesFromDb || [] };
      });
    } catch (err) {
      console.error('Error updating customer note:', err);
      alert('حدث خطأ أثناء تحديث الملاحظة');
    }
  };

  const openMap = (order: OrderWithDetails | ArchiveOrderWithDetails) => {
    // Always prefer immutable snapshot fields saved with the order
    const latitude = (order as any).customer_latitude || order.customer?.latitude;
    const longitude = (order as any).customer_longitude || order.customer?.longitude;

    if (!latitude || !longitude) {
      alert('لا يوجد موقع GPS محفوظ لهذا العميل');
      return;
    }

    const address = (order as any).customer_street && (order as any).customer_area && (order as any).customer_city
      ? `${(order as any).customer_street}, ${(order as any).customer_area}, ${(order as any).customer_city}`
      : undefined;

    setMapLocation({
      latitude,
      longitude,
      name: (order as any).customer_name || order.customer?.name || 'عميل',
      address
    });
    setShowMap(true);
  };

  const deleteCustomerNote = async (noteId: string) => {
    if (!selectedOrder || !selectedOrder.customer) return;

    if (!window.confirm('هل أنت متأكد من حذف هذه الملاحظة؟\n\nسيتم حذفها من هذا الطلب ومن جميع الطلبات القادمة.')) {
      return;
    }

    const note = selectedOrder.notes.find(n => n.id === noteId);
    if (!note) return;

    const customerId = selectedOrder.customer_id;
    const gnid = ((note as any).general_note_id as string | null | undefined) || null;

    // Delete from general notes (source of truth) so it won't appear on future orders
    if (gnid) {
      await supabase
        .from('customer_general_notes')
        .delete()
        .eq('general_note_id', gnid);
    } else {
      await supabase
        .from('customer_general_notes')
        .delete()
        .eq('customer_phone', selectedOrder.customer.phone)
        .eq('customer_name', selectedOrder.customer.name)
        .eq('note', note.note);
    }

    // Delete from ALL customer order notes
    if (gnid) {
      await supabase
        .from('customer_notes')
        .delete()
        .eq('customer_id', customerId)
        .eq('general_note_id', gnid);
    } else {
      await supabase
        .from('customer_notes')
        .delete()
        .eq('customer_id', customerId)
        .eq('note', note.note);
    }

    // Delete from archive notes
    if (gnid) {
      await supabase
        .from('archive_customer_notes')
        .delete()
        .eq('customer_id', customerId)
        .eq('general_note_id', gnid);
    } else {
      await supabase
        .from('archive_customer_notes')
        .delete()
        .eq('customer_id', customerId)
        .eq('note', note.note);
    }

    fetchOrders();
  };

  const deleteAllCustomerNotes = async () => {
    if (!selectedOrder || !selectedOrder.customer) return;
    if (!window.confirm('حذف كل ملاحظات الأوبراتور لهذا العميل دفعة واحدة؟')) return;

    const customerId = selectedOrder.customer_id;
    try {
      await supabase
        .from('customer_general_notes')
        .delete()
        .eq('customer_phone', selectedOrder.customer.phone)
        .eq('customer_name', selectedOrder.customer.name);

      await supabase.from('customer_notes').delete().eq('customer_id', customerId).eq('created_by', 'operator');
      await supabase
        .from('archive_customer_notes')
        .delete()
        .eq('customer_id', customerId)
        .eq('created_by', 'operator');

      setSelectedOrder((prev) => (prev ? { ...prev, notes: [] } : prev));
      fetchOrders();
    } catch (err) {
      console.error('Error deleting all customer notes:', err);
      alert('حدث خطأ أثناء حذف كل الملاحظات');
    }
  };

  const toggleCustomerNoteVisibility = async (noteId: string, isPublic: boolean) => {
    if (!selectedOrder || !selectedOrder.customer) return;

    const note = selectedOrder.notes.find(n => n.id === noteId);
    if (!note) return;

    const customerId = selectedOrder.customer_id;
    const gnid = ((note as any).general_note_id as string | null | undefined) || null;
    const customerPhone = selectedOrder.customer.phone;
    const customerName = selectedOrder.customer.name;

    try {
      if (gnid) {
        const { error: generalErr } = await supabase
          .from('customer_general_notes')
          .update({ is_public: isPublic, updated_at: new Date().toISOString() })
          .eq('general_note_id', gnid);
        if (generalErr) throw generalErr;

        const { error: notesErr } = await supabase
          .from('customer_notes')
          .update({ is_public: isPublic })
          .eq('customer_id', customerId)
          .eq('general_note_id', gnid);
        if (notesErr) throw notesErr;

        const { error: archiveErr } = await supabase
          .from('archive_customer_notes')
          .update({ is_public: isPublic })
          .eq('customer_id', customerId)
          .eq('general_note_id', gnid);
        if (archiveErr) throw archiveErr;
      } else {
        const { error: generalErr } = await supabase
          .from('customer_general_notes')
          .update({ is_public: isPublic, updated_at: new Date().toISOString() })
          .eq('customer_phone', customerPhone)
          .eq('customer_name', customerName)
          .eq('note', note.note);
        if (generalErr) throw generalErr;

        const { error: notesErr } = await supabase
          .from('customer_notes')
          .update({ is_public: isPublic })
          .eq('customer_id', customerId)
          .eq('note', note.note);
        if (notesErr) throw notesErr;

        const { error: archiveErr } = await supabase
          .from('archive_customer_notes')
          .update({ is_public: isPublic })
          .eq('customer_id', customerId)
          .eq('note', note.note);
        if (archiveErr) throw archiveErr;
      }

      setSelectedOrder(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          notes: (prev.notes || []).map(n => n.id === noteId ? { ...n, is_public: isPublic } : n)
        };
      });
    } catch (err) {
      console.error('Error toggling note visibility:', err);
      alert('حدث خطأ أثناء تحديث حالة النشر');
    }
  };

  const getStatusInfo = (status: string, cancelledBy?: string) => {
    switch (status) {
      case 'under_review':
        return { icon: Clock, text: 'قيد المعاينة', color: 'bg-yellow-600', textColor: 'text-yellow-400' };
      case 'preparing':
        return { icon: Package, text: 'قيد التحضير', color: 'bg-blue-600', textColor: 'text-blue-400' };
      case 'on_way':
        return { icon: Truck, text: 'في الطريق', color: 'bg-purple-600', textColor: 'text-purple-400' };
      case 'arrived':
        return { icon: AlertTriangle, text: 'وصل الآن', color: 'bg-orange-600', textColor: 'text-orange-400' };
      case 'completed':
        return { icon: CheckCircle, text: 'مكتمل', color: 'bg-green-600', textColor: 'text-green-400' };
      case 'cancelled':
        if (cancelledBy === 'customer') {
          return { icon: XCircle, text: 'ملغي عميل', color: 'bg-red-600', textColor: 'text-red-400' };
        } else if (cancelledBy === 'operator') {
          return { icon: XCircle, text: 'ملغي op', color: 'bg-red-600', textColor: 'text-red-400' };
        }
        return { icon: XCircle, text: 'ملغي', color: 'bg-red-600', textColor: 'text-red-400' };
      case 'cancellation_pending':
        return { icon: Clock, text: 'طلب إلغاء', color: 'bg-yellow-600', textColor: 'text-yellow-400' };
      default:
        return { icon: Package, text: status, color: 'bg-gray-600', textColor: 'text-gray-400' };
    }
  };

  // Drag handlers for modal
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('.modal-drag-handle')) {
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX - modalPositionRef.current.x,
        y: e.clientY - modalPositionRef.current.y
      };
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newPos = {
          x: e.clientX - dragStartRef.current.x,
          y: e.clientY - dragStartRef.current.y
        };
        modalPositionRef.current = newPos;
        setModalPosition(newPos);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging]);

  // Reset modal position when order changes
  useEffect(() => {
    if (selectedOrder || selectedArchiveOrder) {
      const resetPos = { x: 0, y: 0 };
      modalPositionRef.current = resetPos;
      setModalPosition(resetPos);
    }
  }, [selectedOrder, selectedArchiveOrder]);

  const renderOrderBar = (order: OrderWithDetails) => {
    const statusInfo = getStatusInfo(order.status, order.cancelled_by);
    const StatusIcon = statusInfo.icon;

    const customerName = order.customer_name || order.customer?.name || 'عميل';
    const customerPhone = order.customer_phone || order.customer?.phone || '';
    const secondaryPhone = order.customer_secondary_phone || (order.customer as any)?.secondary_phone;
    const buildingNo = order.customer_building_number || order.building_number;
    const address = `${order.customer_street || order.customer?.street || ''}, ${order.customer_area || order.customer?.area || ''}, ${order.customer_city || order.customer?.city || ''}`;

    const noteFlash = customerNoteFlashOrderIds.has(order.id);
    const noteUnread = order.order_note && !readNotes.has(`order-note-${order.id}`);

    return (
      <div
        key={order.id}
        id={`order-bar-${order.id}`}
        onClick={async () => {
          setSelectedOrder(order);
          setReadOrders(prev => new Set(prev).add(order.id));
          // Mark notes as read too
          setReadNotes(prev => {
            const next = new Set(prev);
            order.notes.forEach(n => next.add(n.id));
            if (order.order_note) next.add(`order-note-${order.id}`);
            return next;
          });
          
          if (order.customer_update_flag) {
            await supabase.from('orders').update({ customer_update_flag: false }).eq('id', order.id);
          }
        }}
        className={`bg-gray-900/50 border-2 rounded-lg p-4 hover:border-purple-400 transition-all cursor-pointer relative overflow-hidden ${
          pulseOrderBarId === order.id ? 'order-bar-pulse' : ''
        } ${order.customer_update_flag ? 'border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'border-purple-500/30'}`}
      >
        {order.customer_update_flag && (
          <div className="absolute top-0 right-0 left-0 h-1 bg-yellow-500 animate-pulse"></div>
        )}
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1">
            <div className={`${statusInfo.color} text-white px-3 py-1.5 rounded-lg flex items-center gap-2`}>
              <StatusIcon className="w-4 h-4" />
              <span className="font-bold text-sm">{statusInfo.text}</span>
            </div>

            <div className="flex-1 text-right">
              <div className="flex items-center justify-end gap-3">
                {order.customer_update_flag && (
                  <span className="bg-yellow-500 text-black text-[10px] px-2 py-0.5 rounded-full font-black animate-bounce">
                    تحديث من العميل!
                  </span>
                )}
                {order.order_note && (
                  <span className={`px-2 py-0.5 rounded-full font-bold flex items-center gap-1 border text-[10px] transition-shadow duration-300 ${
                    noteFlash
                      ? 'bg-cyan-600 text-white border-cyan-300 shadow-[0_0_22px_rgba(34,211,238,0.95)] animate-pulse ring-2 ring-cyan-300'
                      : noteUnread
                        ? 'bg-blue-600 text-white border-blue-400 animate-pulse'
                        : 'bg-blue-600/50 text-blue-200 border-blue-500/30'
                  }`}>
                    <StickyNote className="w-3 h-3" />
                    {language === 'ar' ? 'ملاحظة عميل' : 'Customer Note'}
                  </span>
                )}
                {order.notes.length > 0 && (
                  <span className={`px-2 py-0.5 rounded-full font-bold flex items-center gap-1 border ${
                    order.notes.some(n => !readNotes.has(n.id))
                    ? 'bg-yellow-600 text-white border-yellow-400 animate-pulse'
                    : 'bg-yellow-600/50 text-yellow-200 border-yellow-500/30'
                  } text-[10px]`}>
                    <StickyNote className="w-3 h-3" />
                    {language === 'ar' ? 'ملاحظة أوبراتور' : 'Op Note'}
                  </span>
                )}
                <h3 className="text-lg font-bold text-white">#{order.order_number}</h3>
              </div>
              <p className="text-gray-400 text-[10px] mt-1">
                {new Date(order.created_at).toLocaleDateString('ar-EG', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
          </div>

          <div className={`flex items-center gap-6 ${language === 'ar' ? 'text-right' : 'text-left'}`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
            <div className={`${language === 'ar' ? 'text-right' : 'text-left'}`}>
              <div className="flex items-center justify-start gap-2 text-green-400 font-bold">
                <User className="w-4 h-4" />
                <span>{customerName}</span>
              </div>
              <div className={`flex flex-col ${language === 'ar' ? 'items-start' : 'items-start'} gap-0.5 mt-1`}>
                <div className="flex items-center justify-start gap-2 text-green-400/80 text-xs font-bold">
                  <Phone className="w-3.5 h-3.5" />
                  <span dir="ltr">{customerPhone}</span>
                </div>
                {secondaryPhone && (
                  <div className="flex items-center justify-start gap-2 text-green-400/60 text-[10px] font-bold">
                    <Phone className="w-3 h-3" />
                    <span dir="ltr">{secondaryPhone}</span>
                  </div>
                )}
              </div>
            </div>
            <div className={`${language === 'ar' ? 'text-right' : 'text-left'}`}>
              <div className="flex items-center justify-start gap-2 text-green-400/80 text-xs text-nowrap">
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="max-w-[200px] truncate font-bold">
                  {buildingNo && <span>{language === 'ar' ? 'عمارة ' : 'Bldg '} {buildingNo} - </span>}
                  {address}
                </span>
              </div>
              <div className="text-white font-black text-xl mt-1">{order.total_amount} <span className="text-xs">{language === 'ar' ? 'ج' : 'EG'}</span></div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderOrderModal = () => {
    if (!selectedOrder) return null;

    const order = selectedOrder;
    const statusInfo = getStatusInfo(order.status, order.cancelled_by);
    const StatusIcon = statusInfo.icon;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedOrder(null);
          }
        }}
      >
        <div
          className="bg-gray-900 border-2 border-purple-500/30 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          style={{
            transform: `translate(${modalPosition.x}px, ${modalPosition.y}px)`,
            transition: isDragging ? 'none' : 'transform 0.2s'
          }}
        >
          {/* Drag Handle - Sticky */}
          <div
            className="modal-drag-handle cursor-move bg-purple-600/30 hover:bg-purple-600/50 rounded-t-lg p-2 flex items-center justify-between sticky top-0 z-10"
            onMouseDown={handleMouseDown}
          >
            <button
              onClick={() => setSelectedOrder(null)}
              className="text-white hover:text-red-400 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-white">
              <span className="text-sm">اسحب للتحريك</span>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 p-6 custom-scrollbar">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 text-right">
                <div className="flex items-center justify-end gap-2 mb-2">
                  <h3 className="text-xl font-bold text-white">{order.order_number}</h3>
                </div>
                <p className="text-gray-400 text-sm">
                  {new Date(order.created_at).toLocaleDateString('ar-EG', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className={`${statusInfo.color} text-white px-4 py-2 rounded-lg flex items-center gap-2 w-fit`}>
                  <span className="font-bold">{statusInfo.text}</span>
                  <StatusIcon className="w-5 h-5" />
                </div>

                {order.delivery_method && (
                  <div className={`px-3 py-1 rounded-lg flex items-center gap-2 text-sm font-bold ${order.delivery_method === 'pickup'
                    ? 'bg-orange-600/30 text-orange-400 border border-purple-500/30'
                    : 'bg-green-600/30 text-green-400 border border-purple-500/30'
                    }`}>
                    <span>{order.delivery_method === 'pickup' ? (language === 'ar' ? 'استلام من الفرع' : 'Pickup') : (language === 'ar' ? 'توصيل للمنزل' : 'Delivery')}</span>
                    {order.delivery_method === 'pickup' ? <Package className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                  </div>
                )}
              </div>
            </div>

            {(order.customer || order.customer_name || order.customer_phone) && (
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-4 mb-4" dir={language === 'ar' ? 'rtl' : 'ltr'}>
                <div className={`space-y-2 ${language === 'ar' ? 'text-right' : 'text-left'}`}>
                  <div className="flex items-center justify-start gap-3 text-green-400">
                    <User className="w-5 h-5 text-green-400" />
                    <span className="text-xl font-black">{order.customer_name || order.customer?.name}</span>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setQuickCustomerMenuOrderId((prev) => (prev === order.id ? null : order.id));
                        }}
                        className="w-5 h-5 rounded-full border border-green-500/35 text-[10px] leading-none flex items-center justify-center hover:border-green-300"
                        title="بيانات العميل"
                      >
                        +
                      </button>
                      {quickCustomerMenuOrderId === order.id && (
                        <div
                          className="absolute top-6 right-0 z-20 min-w-[180px] rounded-lg border border-green-500/40 bg-gray-950/95 p-2 text-right shadow-xl"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <p className="text-[10px] text-gray-400 mb-1">الاسم الحالي</p>
                          <p className="text-green-300 font-bold text-xs mb-2 truncate">{order.customer?.name || order.customer_name || 'عميل'}</p>
                          <button
                            type="button"
                            className="w-full text-[10px] px-2 py-1 rounded font-bold bg-cyan-700 hover:bg-cyan-600"
                            onClick={() => {
                              setQuickCustomerMenuOrderId(null);
                              window.dispatchEvent(
                                new CustomEvent('operator-focus-customer', {
                                  detail: { phone: order.customer_phone || order.customer?.phone || '' }
                                })
                              );
                            }}
                          >
                            عرض المزيد
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-start gap-3 text-green-400 font-bold">
                    <Phone className="w-5 h-5 text-green-400" />
                    <span className="text-lg" dir="ltr">{order.customer_phone || order.customer?.phone}</span>
                  </div>
                  {(order.customer_secondary_phone || (order.customer as any)?.secondary_phone) && (
                    <div className="flex items-center justify-start gap-3 text-green-400/70 font-bold text-sm">
                      <Phone className="w-4 h-4 text-green-400" />
                      <span dir="ltr">{order.customer_secondary_phone || (order.customer as any)?.secondary_phone}</span>
                    </div>
                  )}
                  <div className="flex items-start justify-start gap-3 text-green-400">
                    <MapPin className="w-6 h-6 text-green-400 shrink-0 mt-1" />
                    <div className={`${language === 'ar' ? 'text-right' : 'text-left'} flex-1`}>
                      {order.customer_address_type && (
                        <p className="text-primary font-bold text-sm mb-1">
                          {(order.customer_address_type === 'house'
                            ? (language === 'ar' ? 'منزل' : 'House')
                            : order.customer_address_type === 'workplace'
                              ? (language === 'ar' ? 'مكان عمل' : 'Workplace')
                              : (language === 'ar' ? 'شقة' : 'Apartment'))}
                        </p>
                      )}
                      {(order.customer_building_number || order.building_number) && (
                        <p className="text-green-400 font-black text-lg mb-1">
                          {language === 'ar' ? 'مبنى / منزل' : 'Building/House'}: {order.customer_building_number || order.building_number}
                        </p>
                      )}
                      {order.customer_house_name && (
                        <p className="text-sm text-green-400 font-bold mb-1">
                          {language === 'ar' ? 'اسم المنزل' : 'House'}: {order.customer_house_name}
                        </p>
                      )}
                      {order.customer_company_name && (
                        <p className="text-sm text-green-400 font-bold mb-1">
                          {language === 'ar' ? 'اسم الشركة' : 'Company'}: {order.customer_company_name}
                        </p>
                      )}
                      <p className="font-bold text-green-400">
                        {order.customer_street || order.customer?.street}, {order.customer_area || order.customer?.area}, {order.customer_city || order.customer?.city}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                        {order.customer_apartment && (
                          <p className="text-sm text-green-400 font-bold">
                            {language === 'ar' ? 'الشقة' : 'Apt'}: {order.customer_apartment}
                          </p>
                        )}
                        {order.customer_floor && (
                          <p className="text-sm text-green-400 font-bold">
                            {language === 'ar' ? 'الطابق' : 'Floor'}: {order.customer_floor}
                          </p>
                        )}
                      </div>
                      {(order.customer_landmark || order.landmark) && (
                        <p className="text-sm text-yellow-400 mt-2 font-bold">
                          {language === 'ar' ? 'العلامة المميزة' : 'Landmark'}: {order.customer_landmark || order.landmark}
                        </p>
                      )}
                    </div>
                  </div>
                  {(order.customer_latitude || (order.customer?.latitude && order.customer?.longitude)) && (
                    <div className="flex justify-start pt-2">
                      <button
                        onClick={() => openMap(order)}
                        className="bg-green-600 hover:bg-green-500 text-white px-6 py-2.5 rounded-xl flex items-center gap-2 transition-all font-black text-sm shadow-lg shadow-green-900/40"
                      >
                        <Navigation className="w-4 h-4" />
                        <span>{language === 'ar' ? 'فتح الخريطة' : 'Open Map'}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="border-t border-purple-500/30 pt-4 mb-4">
              <h4 className="text-white font-bold mb-2 text-right">الأصناف:</h4>
              <div className="space-y-2">
                {order.items.map(item => (
                  <div key={item.id} className="flex items-center justify-between text-sm bg-gray-800/50 p-2 rounded">
                    <span className="text-purple-400 font-bold">{item.subtotal} ج</span>
                    <div className="text-right">
                      <span className="text-white">{item.item_name}</span>
                      <span className="text-gray-400 mr-2">x{item.quantity}</span>
                    </div>
                  </div>
                ))}
              </div>
              {order.applied_coupon_code && (
                <div className="flex items-center justify-between mt-3 bg-green-900/20 border border-green-500/40 rounded-lg p-2">
                  <div className="flex items-center gap-2 text-green-300">
                    <TicketPercent className="w-4 h-4" />
                    <span className="text-sm font-bold">كوبون: {order.applied_coupon_code}</span>
                  </div>
                  <span className="text-green-200 text-sm font-bold">خصم {order.applied_coupon_discount_percent}%</span>
                </div>
              )}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-purple-500/30">
                <span className="text-2xl font-black text-white">{order.total_amount} ج</span>
                <span className="text-purple-300 font-bold">المجموع</span>
              </div>
            </div>

            {order.notes.length > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-3 mb-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <button
                    type="button"
                    onClick={deleteAllCustomerNotes}
                    className="text-[11px] px-2 py-1 rounded-md bg-red-800/90 hover:bg-red-700 text-white font-bold"
                    title="حذف كل الملاحظات"
                  >
                    حذف الكل
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-300 font-bold">ملاحظات الأوبراتور</span>
                    <StickyNote className="w-5 h-5 text-yellow-300" />
                  </div>
                </div>
                {order.notes.map(note => (
                  <div key={note.id} className="mb-2 last:mb-0">
                    {editingNoteId === note.id && selectedOrder?.id === order.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editedNoteText}
                          onChange={(e) => setEditedNoteText(e.target.value)}
                          className="w-full bg-gray-800 border border-yellow-500 rounded-lg p-2 text-white text-right resize-none"
                          rows={2}
                          dir="rtl"
                          placeholder="اكتب ملاحظة..."
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setEditingNoteId(null);
                              setEditedNoteText('');
                            }}
                            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-1 rounded-lg transition-colors text-sm"
                          >
                            إلغاء
                          </button>
                          <button
                            onClick={() => updateCustomerNote(note.id)}
                            className="flex-1 bg-green-600 hover:bg-green-500 text-white py-1 rounded-lg transition-colors font-bold text-sm"
                          >
                            حفظ
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col items-end gap-1">
                          {selectedOrder?.id === order.id && (
                            <>
                              <label className="flex items-center gap-1 text-[10px] text-yellow-200">
                                <span>pub</span>
                                <input
                                  type="checkbox"
                                  checked={note.is_public !== false}
                                  onChange={(e) => toggleCustomerNoteVisibility(note.id, e.target.checked)}
                                  className="w-3 h-3 accent-yellow-500"
                                  title="إظهار للعميل"
                                />
                              </label>
                              <button
                                onClick={() => deleteCustomerNote(note.id)}
                                className="text-red-400 hover:text-red-300 transition-colors"
                                title="حذف"
                              >
                                <X className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingNoteId(note.id);
                                  setEditedNoteText(note.note);
                                }}
                                className="text-yellow-400 hover:text-yellow-300 transition-colors"
                                title="تعديل"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                         <p className="text-yellow-200 text-sm text-right flex-1 flex items-center justify-end gap-2">
                          {!readNotes.has(note.id) && (
                            <span className="bg-yellow-500 text-black text-[8px] px-1 rounded-full font-bold animate-pulse">جديد</span>
                          )}
                          • {note.note}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {order.order_note && (
              <div className="bg-purple-900/20 border border-purple-500/50 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 mb-2 justify-end">
                  <span className="text-purple-300 font-bold">ملاحظة العميل</span>
                  <StickyNote className="w-5 h-5 text-purple-300" />
                </div>
                <p className="text-purple-200 text-sm text-right">{order.order_note}</p>
              </div>
            )}

            {order.status === 'cancelled' && order.cancellation_reason && (
              <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 mb-2 justify-end">
                  <span className="text-red-300 font-bold">سبب الإلغاء</span>
                </div>
                <p className="text-red-200 text-sm text-right">{order.cancellation_reason}</p>
              </div>
            )}

            {order.status === 'cancellation_pending' && (
              <div className="bg-red-900/20 border border-red-500 rounded-lg p-4 mb-4">
                <p className="text-red-300 text-right mb-2 font-bold">العميل يريد إلغاء الطلب</p>
                <p className="text-red-200 text-right text-sm mb-3">السبب: {order.cancellation_reason}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCancellationRequest(order.id, false)}
                    className="flex-1 bg-green-600 hover:bg-green-500 text-white py-2 rounded-lg transition-colors font-bold"
                  >
                    رفض الإلغاء
                  </button>
                  <button
                    onClick={() => handleCancellationRequest(order.id, true)}
                    className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-lg transition-colors font-bold"
                  >
                    موافقة على الإلغاء
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {order.status === 'under_review' && (
                <>
                  <button
                    onClick={() => updateOrderStatus(order.id, 'preparing')}
                    disabled={updatingStatusOrderId === order.id}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg transition-colors font-bold"
                  >
                    قيد التحضير
                  </button>
                </>
              )}

              {order.status === 'preparing' && (
                <>
                  <button
                    onClick={() => updateOrderStatus(order.id, 'on_way')}
                    disabled={updatingStatusOrderId === order.id}
                    className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-2 rounded-lg transition-colors font-bold"
                  >
                    في الطريق
                  </button>
                </>
              )}

              {order.status === 'on_way' && (
                <button
                  onClick={() => updateOrderStatus(order.id, 'arrived')}
                  disabled={updatingStatusOrderId === order.id}
                  className="flex-1 bg-orange-600 hover:bg-orange-500 text-white py-2 rounded-lg transition-colors font-bold"
                >
                  وصل الآن
                </button>
              )}

              {order.status === 'arrived' && (
                <button
                  onClick={() => updateOrderStatus(order.id, 'completed')}
                  disabled={updatingStatusOrderId === order.id}
                  className="flex-1 bg-green-600 hover:bg-green-500 text-white py-2 rounded-lg transition-colors font-bold"
                >
                  تم التسليم والدفع
                </button>
              )}

              {order.status !== 'cancelled' && (
                <button
                  onClick={() => {
                    setSelectedOrder(order);
                    setShowCancelModal(true);
                  }}
                  disabled={updatingStatusOrderId === order.id}
                  className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg transition-colors font-bold"
                >
                  إلغاء
                </button>
              )}

            </div>

            {selectedOrder && (
              <div className="mt-4 border-t border-purple-500/30 pt-4">
                <div className="flex items-center gap-2 mb-2 justify-end">
                  <span className="text-yellow-300 font-bold">إضافة ملاحظة</span>
                  <StickyNote className="w-5 h-5 text-yellow-300" />
                </div>
                <label className="flex items-center justify-end gap-2 mb-2 text-xs text-yellow-200">
                  <span>pub</span>
                  <input
                    type="checkbox"
                    checked={operatorNotePublic}
                    onChange={(e) => setOperatorNotePublic(e.target.checked)}
                    className="w-3.5 h-3.5 accent-yellow-500"
                  />
                </label>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  className="w-full bg-gray-800 border border-yellow-500 rounded-lg p-3 text-white text-right resize-none mb-2"
                  rows={3}
                  dir="rtl"
                  placeholder="اكتب ملاحظة عامة للعميل..."
                />
                <button
                  onClick={addCustomerNote}
                  className="w-full bg-yellow-600 hover:bg-yellow-500 text-white py-2 rounded-lg transition-colors font-bold"
                >
                  حفظ الملاحظة
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderOrderCard = (order: OrderWithDetails) => {
    return renderOrderBar(order);
  };

  const renderArchiveOrderBar = (order: ArchiveOrderWithDetails) => {
    const statusInfo = getStatusInfo(order.status, order.cancelled_by);
    const StatusIcon = statusInfo.icon;

    return (
      <div
        key={order.id}
        id={`order-bar-archive-${order.id}`}
        onClick={() => setSelectedArchiveOrder(order)}
        className={`bg-gray-900/50 border-2 border-blue-500/30 rounded-lg p-4 hover:border-blue-400 transition-all cursor-pointer ${
          pulseOrderBarId === order.id ? 'order-bar-pulse' : ''
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1">
            <div className={`${statusInfo.color} text-white px-3 py-1.5 rounded-lg flex items-center gap-2`}>
              <StatusIcon className="w-4 h-4" />
              <span className="font-bold text-sm">{statusInfo.text}</span>
            </div>

            <div className="flex-1 text-right">
              <div className="flex items-center justify-end gap-3">
                <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full font-bold">أرشيف</span>
                <h3 className="text-lg font-bold text-white">{order.order_number}</h3>
              </div>
              <p className="text-gray-400 text-xs mt-1">
                {new Date(order.original_created_at || order.created_at).toLocaleDateString('ar-EG', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
              <p className="text-blue-400 text-xs mt-1">
                تم الأرشفة: {new Date(order.archived_at).toLocaleDateString('ar-EG')}
              </p>
            </div>
          </div>

          {order.customer && (
            <div className="flex items-center gap-6 text-right" dir={language === 'ar' ? 'rtl' : 'ltr'}>
              <div className={`${language === 'ar' ? 'text-right' : 'text-left'}`}>
                <div className="flex items-center justify-start gap-2 text-white">
                  <User className="w-4 h-4 text-blue-400" />
                  <span className="font-bold">{order.customer.name}</span>
                </div>
                <div className="flex items-center justify-start gap-2 text-blue-300 text-sm mt-1">
                  <Phone className="w-4 h-4 text-blue-400" />
                  <span dir="ltr">{order.customer.phone}</span>
                </div>
              </div>
              <div className={`${language === 'ar' ? 'text-right' : 'text-left'}`}>
                <div className="flex items-center justify-start gap-2 text-blue-300 text-sm">
                  <MapPin className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="max-w-xs truncate">
                    {(order.customer_building_number || order.building_number) && <span className="text-green-400 font-bold">{language === 'ar' ? 'بناية ' : 'Bldg '} {order.customer_building_number || order.building_number} - </span>}
                    {order.customer_street || order.customer?.street || 'N/A'}, {order.customer_area || order.customer?.area || ''}, {order.customer_city || order.customer?.city || ''}
                  </span>
                </div>
                <div className="text-white font-bold text-lg mt-1">{order.total_amount} {language === 'ar' ? 'ج' : 'EG'}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderArchiveOrderModal = () => {
    if (!selectedArchiveOrder) return null;

    const order = selectedArchiveOrder;
    const statusInfo = getStatusInfo(order.status, order.cancelled_by);
    const StatusIcon = statusInfo.icon;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedArchiveOrder(null);
          }
        }}
      >
        <div
          className="bg-gray-900 border-2 border-blue-500/30 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          style={{
            transform: `translate(${modalPosition.x}px, ${modalPosition.y}px)`,
            transition: isDragging ? 'none' : 'transform 0.2s'
          }}
        >
          {/* Drag Handle - Sticky */}
          <div
            className="modal-drag-handle cursor-move bg-blue-600/30 hover:bg-blue-600/50 rounded-t-lg p-2 flex items-center justify-between sticky top-0 z-10"
            onMouseDown={handleMouseDown}
          >
            <button
              onClick={() => setSelectedArchiveOrder(null)}
              className="text-white hover:text-red-400 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-white">
              <span className="text-sm">اسحب للتحريك</span>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 p-6 custom-scrollbar">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 text-right">
                <div className="flex items-center justify-end gap-2 mb-2">
                  <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full font-bold">أرشيف</span>
                  <h3 className="text-xl font-bold text-white">{order.order_number}</h3>
                </div>
                <p className="text-gray-400 text-sm">
                  {new Date(order.original_created_at || order.created_at).toLocaleDateString('ar-EG', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
                <p className="text-blue-400 text-xs mt-1">
                  تم الأرشفة: {new Date(order.archived_at).toLocaleDateString('ar-EG')}
                </p>
              </div>

              <div className="flex flex-col items-end gap-2">
                <div className={`${statusInfo.color} text-white px-4 py-2 rounded-lg flex items-center gap-2 w-fit`}>
                  <span className="font-bold">{statusInfo.text}</span>
                  <StatusIcon className="w-5 h-5" />
                </div>

                {order.delivery_method && (
                  <div className={`px-3 py-1 rounded-lg flex items-center gap-2 text-sm font-bold ${order.delivery_method === 'pickup'
                    ? 'bg-orange-600/30 text-orange-400 border border-blue-500/30'
                    : 'bg-green-600/30 text-green-400 border border-blue-500/30'
                    }`}>
                    <span>{order.delivery_method === 'pickup' ? 'استلام من الفرع' : 'توصيل للمنزل'}</span>
                    {order.delivery_method === 'pickup' ? <Package className="w-4 h-4" /> : <Truck className="w-4 h-4" />}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-green-900/10 border border-green-500/30 rounded-xl p-4 mb-4" dir={language === 'ar' ? 'rtl' : 'ltr'}>
              <div className={`space-y-3 ${language === 'ar' ? 'text-right' : 'text-left'}`}>
                <div className={`flex items-center justify-start gap-3 pb-2 border-b border-green-500/20`}>
                  <User className="w-6 h-6 text-green-400" />
                  <span className="text-xl font-black text-green-400">{order.customer_name || order.customer?.name}</span>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await loadArchiveCurrentCustomerName(order);
                        setQuickCustomerMenuOrderId((prev) => (prev === order.id ? null : order.id));
                      }}
                      className="w-5 h-5 rounded-full border border-green-500/35 text-[10px] leading-none flex items-center justify-center hover:border-green-300"
                      title="بيانات العميل"
                    >
                      +
                    </button>
                    {quickCustomerMenuOrderId === order.id && (
                      <div
                        className="absolute top-6 right-0 z-20 min-w-[180px] rounded-lg border border-green-500/40 bg-gray-950/95 p-2 text-right shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="text-[10px] text-gray-400 mb-1">الاسم الحالي</p>
                        <p className="text-green-300 font-bold text-xs mb-2 truncate">{archiveCurrentNames[order.id] || '...'}</p>
                        <button
                          type="button"
                          className="w-full text-[10px] px-2 py-1 rounded font-bold bg-cyan-700 hover:bg-cyan-600"
                          onClick={() => {
                            setQuickCustomerMenuOrderId(null);
                            window.dispatchEvent(
                              new CustomEvent('operator-focus-customer', {
                                detail: { phone: order.customer_phone || order.customer?.phone || '' }
                              })
                            );
                          }}
                        >
                          عرض المزيد
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-start gap-3 text-green-400 font-bold">
                    <Phone className="w-5 h-5 text-green-400" />
                    <span className="text-lg" dir="ltr">{order.customer_phone || order.customer?.phone}</span>
                  </div>
                  {(order.customer_secondary_phone || (order.customer as any)?.secondary_phone) && (
                    <div className="flex items-center justify-start gap-3 text-green-400/70 font-bold text-sm">
                      <Phone className="w-4 h-4 text-green-400" />
                      <span dir="ltr">{order.customer_secondary_phone || (order.customer as any)?.secondary_phone}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-start justify-start gap-3 pt-1">
                  <MapPin className="w-6 h-6 text-green-400 shrink-0 mt-1" />
                  <div className={`${language === 'ar' ? 'text-right' : 'text-left'} flex-1`}>
                    {order.customer_address_type && (
                      <p className="text-primary font-bold text-sm mb-1">
                        {(order.customer_address_type === 'house'
                          ? (language === 'ar' ? 'منزل' : 'House')
                          : order.customer_address_type === 'workplace'
                            ? (language === 'ar' ? 'مكان عمل' : 'Workplace')
                            : (language === 'ar' ? 'شقة' : 'Apartment'))}
                      </p>
                    )}
                    {(order.customer_building_number || order.building_number) && (
                      <p className="text-green-400 font-black text-lg mb-1">
                        {language === 'ar' ? 'مبنى / منزل' : 'Building/House'}: {order.customer_building_number || order.building_number}
                      </p>
                    )}
                    {order.customer_house_name && (
                      <p className="text-sm text-green-400 font-bold mb-1">
                        {language === 'ar' ? 'اسم المنزل' : 'House'}: {order.customer_house_name}
                      </p>
                    )}
                    {order.customer_company_name && (
                      <p className="text-sm text-green-400 font-bold mb-1">
                        {language === 'ar' ? 'اسم الشركة' : 'Company'}: {order.customer_company_name}
                      </p>
                    )}
                    <p className="text-green-400/90 font-bold">
                      {order.customer_street || order.customer?.street || 'N/A'}, {order.customer_area || order.customer?.area || ''}, {order.customer_city || order.customer?.city || ''}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                      {order.customer_apartment && (
                        <p className="text-sm text-green-400 font-bold">
                          {language === 'ar' ? 'الشقة' : 'Apt'}: {order.customer_apartment}
                        </p>
                      )}
                      {order.customer_floor && (
                        <p className="text-sm text-green-400 font-bold">
                          {language === 'ar' ? 'الطابق' : 'Floor'}: {order.customer_floor}
                        </p>
                      )}
                    </div>
                    {(order.customer_landmark || order.landmark) && (
                      <p className="text-sm text-yellow-400 mt-2 font-bold">
                        {language === 'ar' ? 'العلامة المميزة' : 'Landmark'}: {order.customer_landmark || order.landmark}
                      </p>
                    )}
                  </div>
                </div>

                {(order.customer_latitude || order.customer?.latitude) && (
                  <div className="flex justify-start pt-2">
                    <button
                      onClick={() => openMap(order)}
                      className="bg-green-600 hover:bg-green-500 text-white px-6 py-2.5 rounded-xl flex items-center gap-2 transition-all font-black text-sm shadow-lg shadow-green-900/40"
                    >
                      <Navigation className="w-4 h-4" />
                      <span>{language === 'ar' ? 'فتح الخريطة' : 'Open Map'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-blue-500/30 pt-4 mb-4">
              <h4 className="text-white font-bold mb-2 text-right">الأصناف:</h4>
              <div className="space-y-2">
                {order.items.map(item => (
                  <div key={item.id} className="flex items-center justify-between text-sm bg-gray-800/50 p-2 rounded">
                    <span className="text-blue-400 font-bold">{item.subtotal} ج</span>
                    <div className="text-right">
                      <span className="text-white">{item.item_name}</span>
                      <span className="text-gray-400 mr-2">x{item.quantity}</span>
                    </div>
                  </div>
                ))}
              </div>
              {order.applied_coupon_code && (
                <div className="flex items-center justify-between mt-3 bg-green-900/20 border border-green-500/40 rounded-lg p-2">
                  <div className="flex items-center gap-2 text-green-300">
                    <TicketPercent className="w-4 h-4" />
                    <span className="text-sm font-bold">كوبون: {order.applied_coupon_code}</span>
                  </div>
                  <span className="text-green-200 text-sm font-bold">خصم {order.applied_coupon_discount_percent}%</span>
                </div>
              )}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-blue-500/30">
                <span className="text-2xl font-black text-white">{order.total_amount} ج</span>
                <span className="text-blue-300 font-bold">المجموع</span>
              </div>
            </div>

            {order.notes.length > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 mb-2 justify-end">
                  <span className="text-yellow-300 font-bold">الملاحظات</span>
                  <StickyNote className="w-5 h-5 text-yellow-300" />
                </div>
                {order.notes.map(note => (
                  <p key={note.id} className="text-yellow-200 text-sm text-right mb-1">
                    • {note.note}
                  </p>
                ))}
              </div>
            )}

            {order.order_note && (
              <div className="bg-purple-900/20 border border-purple-500/50 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 mb-2 justify-end">
                  <span className="text-purple-300 font-bold">ملاحظة العميل</span>
                  <StickyNote className="w-5 h-5 text-purple-300" />
                </div>
                <p className="text-purple-200 text-sm text-right">{order.order_note}</p>
              </div>
            )}

            {order.status === 'cancelled' && order.cancellation_reason && (
              <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2 mb-2 justify-end">
                  <span className="text-red-300 font-bold">سبب الإلغاء</span>
                </div>
                <p className="text-red-200 text-sm text-right">{order.cancellation_reason}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderArchiveOrderCard = (order: ArchiveOrderWithDetails) => {
    return renderArchiveOrderBar(order);
  };

  return (
    <>
    <div className="space-y-6">
      <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white text-right">
            إدارة الطلبات
          </h2>
        </div>

        <div className="grid grid-cols-5 gap-3">
          {/* الاسم */}
          <div className="relative">
            <input
              type="text"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder={language === 'ar' ? 'الاسم' : 'Name'}
              className={`w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-400 ${language === 'ar' ? 'text-right' : 'text-left'}`}
              dir={language === 'ar' ? 'rtl' : 'ltr'}
            />
          </div>

          {/* الهاتف */}
          <div className="relative">
            <input
              type="text"
              value={searchPhone}
              onChange={(e) => setSearchPhone(e.target.value)}
              placeholder={language === 'ar' ? 'الهاتف' : 'Phone'}
              className={`w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-400 ${language === 'ar' ? 'text-right' : 'text-left'}`}
              dir={language === 'ar' ? 'rtl' : 'ltr'}
            />
          </div>

          {/* البون */}
          <div className="relative">
            <input
              type="text"
              value={searchOrderNumber}
              onChange={(e) => setSearchOrderNumber(e.target.value)}
              placeholder={language === 'ar' ? 'البون' : 'Order #'}
              className={`w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-400 ${language === 'ar' ? 'text-right' : 'text-left'}`}
              dir={language === 'ar' ? 'rtl' : 'ltr'}
            />
          </div>

          {/* العنوان */}
          <div className="relative">
            <input
              type="text"
              value={searchAddress}
              onChange={(e) => setSearchAddress(e.target.value)}
              placeholder={language === 'ar' ? 'العنوان' : 'Address'}
              className={`w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-400 ${language === 'ar' ? 'text-right' : 'text-left'}`}
              dir={language === 'ar' ? 'rtl' : 'ltr'}
            />
          </div>

          {/* التاريخ */}
          <div className="relative">
            <input
              ref={datePickerRef}
              type="date"
              value={searchDate}
              onChange={(e) => setSearchDate(e.target.value)}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
            <button
              type="button"
              onClick={() => {
                const picker = datePickerRef.current;
                if (!picker) return;
                // Chrome/Edge support showPicker(); fallback to click for other browsers.
                if (typeof (picker as any).showPicker === 'function') (picker as any).showPicker();
                else picker.click();
              }}
              className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-2 text-white text-right focus:outline-none focus:border-purple-400"
            >
              {formatDateLabel(searchDate)}
            </button>
          </div>
        </div>

        {/* Clear button */}
        {(searchName || searchPhone || searchOrderNumber || searchAddress || searchDate) && (
          <div className="mt-3 flex justify-end">
            <button
              onClick={() => {
                setSearchName('');
                setSearchPhone('');
                setSearchOrderNumber('');
                setSearchAddress('');
                setSearchDate('');
              }}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors font-bold text-sm"
            >
              إلغاء البحث
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShowCompleted(false);
              setShowArchive(false);
            }}
            className={`px-6 py-3 rounded-lg font-bold transition-all ${!showCompleted && !showArchive
              ? 'bg-purple-600 text-white shadow-lg'
              : 'bg-gray-700 text-purple-300 hover:bg-gray-600'
              }`}
          >
            الطلبات الحالية ({activeOrders.length})
          </button>
          <button
            onClick={() => {
              setShowCompleted(true);
              setShowArchive(false);
            }}
            className={`px-6 py-3 rounded-lg font-bold transition-all ${showCompleted && !showArchive
              ? 'bg-purple-600 text-white shadow-lg'
              : 'bg-gray-700 text-purple-300 hover:bg-gray-600'
              }`}
          >
            الطلبات السابقة ({completedOrders.length})
          </button>
          <button
            onClick={() => {
              setShowCompleted(false);
              setShowArchive(true);
              setExpandedArchiveGroups((prev) => {
                if (prev.size > 0) return prev;
                const next = new Set<string>();
                if (archiveGroups.length > 0) next.add(archiveGroups[0].key);
                return next;
              });
            }}
            className={`px-6 py-3 rounded-lg font-bold transition-all flex items-center gap-2 ${showArchive
              ? 'bg-blue-600 text-white shadow-lg'
              : 'bg-gray-700 text-blue-300 hover:bg-gray-600'
              }`}
          >
            <Archive className="w-5 h-5" />
            الأرشيف ({archiveOrders.length})
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {showArchive
          ? (
            archiveGroups.length === 0 ? (
              <div className="text-center text-blue-200/70 py-8 border border-blue-500/20 rounded-xl bg-blue-950/10">
                لا توجد بيانات أرشيف
              </div>
            ) : (
              archiveGroups.map((group) => {
                const expanded = expandedArchiveGroups.has(group.key);
                return (
                  <div key={group.key} className="border border-blue-500/30 rounded-xl overflow-hidden bg-blue-950/10">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedArchiveGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.key)) next.delete(group.key);
                          else next.add(group.key);
                          return next;
                        })
                      }
                      className="w-full px-4 py-3 flex items-center justify-between bg-blue-900/30 hover:bg-blue-900/45 transition-colors"
                    >
                      <div className="flex items-center gap-2 text-blue-200 text-sm font-bold">
                        <List className="w-4 h-4" />
                        <span>{expanded ? 'إخفاء القائمة' : 'فتح القائمة'}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-white font-black text-sm">{group.title}</p>
                        <p className="text-blue-300 text-xs">{group.orders.length} طلب</p>
                      </div>
                    </button>
                    {expanded && (
                      <div className="p-3 space-y-2">
                        {group.orders.map(renderArchiveOrderCard)}
                      </div>
                    )}
                  </div>
                );
              })
            )
          )
          : (showCompleted ? completedOrders : activeOrders).map(renderOrderCard)}
      </div>

      {/* Order Modal */}
      {selectedOrder && renderOrderModal()}

      {/* Archive Order Modal */}
      {selectedArchiveOrder && renderArchiveOrderModal()}

      {showCancelModal && selectedOrder && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowCancelModal(false)}
        >
          <div
            className="bg-gray-900 rounded-xl border-2 border-red-500 p-6 max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-white mb-4 text-right">إلغاء الطلب</h3>
            <label className="block text-red-300 mb-2 text-right">سبب الإلغاء</label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full bg-gray-800 border border-red-500 rounded-lg p-3 text-white text-right resize-none mb-4"
              rows={4}
              placeholder="اكتب سبب الإلغاء..."
              dir="rtl"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCancelModal(false);
                  setCancelReason('');
                  setSelectedOrder(null);
                }}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={() => handleCancelOrder(selectedOrder.id)}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-lg transition-colors font-bold"
              >
                تأكيد الإلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Map View */}
      {showMap && mapLocation && (
        <MapView
          isOpen={showMap}
          onClose={() => {
            setShowMap(false);
            setMapLocation(null);
          }}
          latitude={mapLocation.latitude}
          longitude={mapLocation.longitude}
          customerName={mapLocation.name}
          address={mapLocation.address}
        />
      )}
    </div>
      <style>{`
        @keyframes orderBarPulse {
          0% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0); }
          30% { box-shadow: 0 0 28px 8px rgba(34, 211, 238, 0.55); }
          100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0); }
        }
        .order-bar-pulse {
          animation: orderBarPulse 2.6s ease-out;
        }
      `}</style>
    </>
  );
});

OrdersManagement.displayName = 'OrdersManagement';

export default OrdersManagement;