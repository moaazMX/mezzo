import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Search,
  User,
  Phone,
  MapPin,
  X,
  Plus,
  Lock,
  CreditCard,
  Trash2,
  StickyNote,
  Loader2,
  Users,
  Pencil,
  BarChart3
} from 'lucide-react';
import { supabase, Customer, Order, DeviceCoupon, CustomerGeneralNote } from '../../lib/supabase';
import CustomerMiniMap from './CustomerMiniMap';
import { generateEasyRecoveryCode, hashPhonePassword, hashRecoveryCode } from '../../lib/phonePassword';
import { getOrCreateDeviceFingerprint } from '../../lib/deviceFingerprint';

type ArchiveRow = {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  archived_at: string;
  original_created_at?: string;
};

const GLOBAL_COUPON_TEMPLATE_FP = 'GLOBAL_TEMPLATE';
const TERMINAL_ORDER_STATUSES = ['completed', 'cancelled'];

type Props = {
  onNavigateToOrder: (orderId: string, kind: 'live' | 'archive') => void;
  onFocusOrdersByPhone: (phone: string) => void;
  customerDeletePassword: string;
  focusPhone?: string | null;
  focusToken?: number;
};

type PanelState = {
  customer: Customer;
  orders: Order[];
  archive: ArchiveRow[];
  coupons: DeviceCoupon[];
  generalNotes: CustomerGeneralNote[];
};

type CustomerCardSummary = {
  activeCount: number;
  totalOrders: number;
  activeSnippets: string[];
  topAreas: { name: string; count: number }[];
  topItems: { name: string; count: number }[];
  topCategories: { name: string; count: number }[];
  orderRateLabel: string;
};

function receiptAddressLines(c: Customer): string[] {
  const lines: string[] = [];
  const streetParts = [c.street, c.area, c.city].filter(Boolean);
  if (streetParts.length) lines.push(streetParts.join('، '));
  const aptFloor: string[] = [];
  if (c.apartment) aptFloor.push(`الشقة: ${c.apartment}`);
  if (c.floor) aptFloor.push(`الطابق: ${c.floor}`);
  if (c.building_number) aptFloor.push(`المبنى: ${c.building_number}`);
  if (aptFloor.length) lines.push(aptFloor.join(' — '));
  if (c.landmark) lines.push(`علامة: ${c.landmark}`);
  if ((c as any).secondary_phone) lines.push(`رقم احتياطي: ${(c as any).secondary_phone}`);
  return lines.length ? lines : ['—'];
}

function topFromMap(map: Map<string, number>, n: number) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

type StatsLiveOrder = {
  id: string;
  customer_id: string;
  status: string;
  created_at: string;
  customer_area?: string;
  customer_city?: string;
  order_number: string;
};

type StatsArchOrder = {
  id: string;
  customer_id: string | null;
  created_at?: string;
  archived_at?: string;
  original_created_at?: string;
  customer_area?: string;
  customer_city?: string;
  order_number: string;
};

async function fetchCustomerCardSummaries(customerIds: string[]): Promise<Record<string, CustomerCardSummary>> {
  const empty = (): CustomerCardSummary => ({
    activeCount: 0,
    totalOrders: 0,
    activeSnippets: [],
    topAreas: [],
    topItems: [],
    topCategories: [],
    orderRateLabel: '—'
  });

  const out: Record<string, CustomerCardSummary> = {};
  customerIds.forEach((id) => {
    out[id] = empty();
  });
  if (!customerIds.length) return out;

  const [{ data: orders }, { data: archOrders }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, customer_id, status, created_at, customer_area, customer_city, order_number')
      .in('customer_id', customerIds),
    supabase
      .from('archive_orders')
      .select('id, customer_id, created_at, archived_at, original_created_at, customer_area, customer_city, order_number')
      .in('customer_id', customerIds)
  ]);

  const liveRows = (orders || []) as StatsLiveOrder[];
  const archRows = (archOrders || []) as StatsArchOrder[];

  const liveIds = liveRows.map((o) => o.id);
  const archIds = archRows.map((o) => o.id);

  const [{ data: liveItems }, { data: archItems }] = await Promise.all([
    liveIds.length
      ? supabase.from('order_items').select('order_id, item_name, quantity, item_id').in('order_id', liveIds)
      : Promise.resolve({ data: [] as any[] }),
    archIds.length
      ? supabase
          .from('archive_order_items')
          .select('archive_order_id, item_name, quantity, item_id')
          .in('archive_order_id', archIds)
      : Promise.resolve({ data: [] as any[] })
  ]);

  const orderIdToCustomer = new Map<string, string>();
  liveRows.forEach((o) => orderIdToCustomer.set(o.id, o.customer_id));
  const archToCustomer = new Map<string, string>();
  archRows.forEach((o) => {
    if (o.customer_id) archToCustomer.set(o.id, o.customer_id);
  });

  const itemIds = new Set<string>();
  (liveItems || []).forEach((r: { item_id?: string }) => {
    if (r.item_id) itemIds.add(r.item_id);
  });
  (archItems || []).forEach((r: { item_id?: string }) => {
    if (r.item_id) itemIds.add(r.item_id);
  });

  const itemList = Array.from(itemIds);
  const { data: itemsRows } = itemList.length
    ? await supabase.from('items').select('id, category_id, name').in('id', itemList)
    : { data: [] as { id: string; category_id: string; name: string }[] };

  const catIds = [...new Set((itemsRows || []).map((i) => i.category_id).filter(Boolean))];
  const { data: cats } = catIds.length
    ? await supabase.from('categories').select('id, name').in('id', catIds)
    : { data: [] as { id: string; name: string }[] };

  const itemMeta = new Map<string, { name: string; category: string }>();
  (itemsRows || []).forEach((it) => {
    const cat = (cats || []).find((c) => c.id === it.category_id);
    itemMeta.set(it.id, { name: it.name, category: cat?.name || '—' });
  });

  function addStatsForCustomer(cid: string) {
    const s = out[cid];
    if (!s) return;

    const custLive = liveRows.filter((o) => o.customer_id === cid);
    const custArch = archRows.filter((o) => o.customer_id === cid);
    s.totalOrders = custLive.length + custArch.length;

    const active = custLive.filter((o) => !TERMINAL_ORDER_STATUSES.includes(o.status));
    s.activeCount = active.length;
    s.activeSnippets = active
      .slice(0, 2)
      .map((o) => `#${o.order_number}`);

    const areaMap = new Map<string, number>();
    [...custLive, ...custArch].forEach((row: any) => {
      const a = (row.customer_area || '').trim();
      const city = (row.customer_city || '').trim();
      const key = [a, city].filter(Boolean).join('، ') || 'غير محدد';
      areaMap.set(key, (areaMap.get(key) || 0) + 1);
    });
    s.topAreas = topFromMap(areaMap, 3);

    const itemCounts = new Map<string, number>();
    const catCounts = new Map<string, number>();

    (liveItems || []).forEach((row: { order_id: string; item_name: string; quantity: number; item_id?: string }) => {
      const oc = orderIdToCustomer.get(row.order_id);
      if (oc !== cid) return;
      const q = row.quantity || 1;
      const label = row.item_name || '—';
      itemCounts.set(label, (itemCounts.get(label) || 0) + q);
      if (row.item_id && itemMeta.has(row.item_id)) {
        const cat = itemMeta.get(row.item_id)!.category;
        catCounts.set(cat, (catCounts.get(cat) || 0) + q);
      }
    });

    (archItems || []).forEach(
      (row: { archive_order_id: string; item_name: string; quantity: number; item_id?: string }) => {
        const oc = archToCustomer.get(row.archive_order_id);
        if (oc !== cid) return;
        const q = row.quantity || 1;
        const label = row.item_name || '—';
        itemCounts.set(label, (itemCounts.get(label) || 0) + q);
        if (row.item_id && itemMeta.has(row.item_id)) {
          const cat = itemMeta.get(row.item_id)!.category;
          catCounts.set(cat, (catCounts.get(cat) || 0) + q);
        }
      }
    );

    s.topItems = topFromMap(itemCounts, 5);
    s.topCategories = topFromMap(catCounts, 4);

    const dates = [...custLive, ...custArch]
      .map((r: any) => new Date(r.created_at || r.archived_at || r.original_created_at).getTime())
      .filter((t) => !Number.isNaN(t));
    if (dates.length >= 2) {
      const min = Math.min(...dates);
      const max = Math.max(...dates);
      const months = Math.max(1, (max - min) / (30.44 * 24 * 3600 * 1000));
      const rate = s.totalOrders / months;
      s.orderRateLabel = `~${rate.toFixed(1)} طلب / شهر`;
    } else if (dates.length === 1) {
      s.orderRateLabel = `${s.totalOrders} طلب`;
    } else {
      s.orderRateLabel = '—';
    }
  }

  customerIds.forEach(addStatsForCustomer);
  return out;
}

export default function OperatorCustomerSearch({
  onNavigateToOrder,
  onFocusOrdersByPhone,
  customerDeletePassword,
  focusPhone,
  focusToken
}: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Customer[]>([]);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [orderedCustomers, setOrderedCustomers] = useState<Customer[]>([]);
  const [loadingOrdered, setLoadingOrdered] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, CustomerCardSummary>>({});
  const [loadingSummaries, setLoadingSummaries] = useState(false);
  const [highlightCustomerId, setHighlightCustomerId] = useState<string | null>(null);

  const [newNoteText, setNewNoteText] = useState('');
  const [newNotePublic, setNewNotePublic] = useState(true);
  /** صف `customer_general_notes` أثناء التعديل — نفس منطق الطلبات */
  const [editingNoteRowId, setEditingNoteRowId] = useState<string | null>(null);
  const [editingNoteOriginalText, setEditingNoteOriginalText] = useState<string | null>(null);
  const [addingNote, setAddingNote] = useState(false);
  const [deletePasswordInput, setDeletePasswordInput] = useState('');
  const [deletingCustomer, setDeletingCustomer] = useState(false);

  const [couponEdit, setCouponEdit] = useState<DeviceCoupon | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [securityUnlocked, setSecurityUnlocked] = useState(false);
  const [securityGatePwd, setSecurityGatePwd] = useState('');
  const [securityPwd1, setSecurityPwd1] = useState('');
  const [securityPwd2, setSecurityPwd2] = useState('');
  const [securityResetBusy, setSecurityResetBusy] = useState(false);
  const [securityResetErr, setSecurityResetErr] = useState<string | null>(null);
  const [securityNewRecovery, setSecurityNewRecovery] = useState<string | null>(null);

  const loadOrderedCustomers = useCallback(async () => {
    setLoadingOrdered(true);
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1200);
      if (error) {
        console.error('load customers:', error);
        setOrderedCustomers([]);
        return;
      }
      setOrderedCustomers((data || []) as Customer[]);
    } finally {
      setLoadingOrdered(false);
    }
  }, []);

  useEffect(() => {
    void loadOrderedCustomers();
  }, [loadOrderedCustomers]);

  useEffect(() => {
    const ids = orderedCustomers.map((c) => c.id);
    if (!ids.length) {
      setSummaries({});
      return;
    }
    let cancelled = false;
    setLoadingSummaries(true);
    void (async () => {
      const s = await fetchCustomerCardSummaries(ids);
      if (!cancelled) {
        setSummaries(s);
        setLoadingSummaries(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderedCustomers]);

  const normalizedQ = q.trim().toLowerCase();
  const visibleCustomers = useMemo(() => {
    if (!normalizedQ) return orderedCustomers;
    return orderedCustomers.filter((c) => {
      const hay = `${c.name || ''} ${c.phone || ''} ${c.street || ''} ${c.area || ''} ${c.city || ''}`.toLowerCase();
      return hay.includes(normalizedQ);
    });
  }, [orderedCustomers, normalizedQ]);

  useEffect(() => {
    if (!focusPhone) return;
    const customer = orderedCustomers.find((c) => (c.phone || '').trim() === focusPhone.trim());
    if (!customer) return;
    setQ(focusPhone);
    setHighlightCustomerId(customer.id);
    void openPanel(customer);
    const t = window.setTimeout(() => setHighlightCustomerId(null), 2800);
    return () => clearTimeout(t);
  }, [focusPhone, focusToken, orderedCustomers]);

  const runLookup = useCallback(async (raw: string) => {
    const t = raw.trim();
    if (t.length < 2) {
      setResults([]);
      return;
    }
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .or(`name.ilike.%${t}%,phone.ilike.%${t}%`)
      .limit(12);
    if (!error) setResults(data || []);
  }, []);

  const mergeCoupons = (a: DeviceCoupon[], b: DeviceCoupon[]) => {
    const m = new Map<string, DeviceCoupon>();
    [...a, ...b].forEach((row) => m.set(row.id, row));
    return Array.from(m.values()).sort(
      (x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime()
    );
  };

  const openPanel = async (c: Customer) => {
    setOpen(false);
    setPanelLoading(true);
    setNewNoteText('');
    setEditingNoteRowId(null);
    setEditingNoteOriginalText(null);
    setDeletePasswordInput('');
    setSecurityOpen(false);
    setSecurityUnlocked(false);
    setSecurityGatePwd('');
    setSecurityPwd1('');
    setSecurityPwd2('');
    setSecurityResetErr(null);
    setSecurityNewRecovery(null);
    setPanel({
      customer: c,
      orders: [],
      archive: [],
      coupons: [],
      generalNotes: []
    });

    const [ordRes, archRes, couponsByCust, couponsByIdentity, notesRes] = await Promise.all([
      supabase.from('orders').select('*').eq('customer_id', c.id).order('created_at', { ascending: false }),
      supabase
        .from('archive_orders')
        .select('id, order_number, status, total_amount, archived_at, original_created_at, customer_id')
        .eq('customer_id', c.id)
        .order('archived_at', { ascending: false }),
      supabase
        .from('device_coupons')
        .select('*')
        .neq('device_fingerprint', GLOBAL_COUPON_TEMPLATE_FP)
        .eq('customer_id', c.id)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('device_coupons')
        .select('*')
        .neq('device_fingerprint', GLOBAL_COUPON_TEMPLATE_FP)
        .eq('customer_phone', c.phone)
        .eq('customer_name', c.name)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('customer_general_notes')
        .select('*')
        .eq('customer_phone', c.phone)
        .eq('customer_name', c.name)
        .order('created_at', { ascending: false })
    ]);

    const mergedCoupons = mergeCoupons(
      (couponsByCust.data || []) as DeviceCoupon[],
      (couponsByIdentity.data || []) as DeviceCoupon[]
    );
    const latestOrder = ((ordRes.data || []) as any[])[0];
    const enrichedCustomer = {
      ...c,
      secondary_phone:
        (c as any).secondary_phone ||
        latestOrder?.customer_secondary_phone ||
        null
    } as Customer;

    setPanel({
      customer: enrichedCustomer,
      orders: (ordRes.data || []) as Order[],
      archive: (archRes.data || []) as ArchiveRow[],
      coupons: mergedCoupons,
      generalNotes: (notesRes.data || []) as CustomerGeneralNote[]
    });
    if (couponsByCust.error) console.warn('coupons by customer:', couponsByCust.error);
    if (couponsByIdentity.error) console.warn('coupons by identity:', couponsByIdentity.error);
    setPanelLoading(false);
  };

  const refreshPanelData = async (c: Customer) => {
    const [ordRes, archRes, couponsByCust, couponsByIdentity, notesRes] = await Promise.all([
      supabase.from('orders').select('*').eq('customer_id', c.id).order('created_at', { ascending: false }),
      supabase
        .from('archive_orders')
        .select('id, order_number, status, total_amount, archived_at, original_created_at, customer_id')
        .eq('customer_id', c.id)
        .order('archived_at', { ascending: false }),
      supabase
        .from('device_coupons')
        .select('*')
        .neq('device_fingerprint', GLOBAL_COUPON_TEMPLATE_FP)
        .eq('customer_id', c.id)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('device_coupons')
        .select('*')
        .neq('device_fingerprint', GLOBAL_COUPON_TEMPLATE_FP)
        .eq('customer_phone', c.phone)
        .eq('customer_name', c.name)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('customer_general_notes')
        .select('*')
        .eq('customer_phone', c.phone)
        .eq('customer_name', c.name)
        .order('created_at', { ascending: false })
    ]);

    const mergedCoupons = mergeCoupons(
      (couponsByCust.data || []) as DeviceCoupon[],
      (couponsByIdentity.data || []) as DeviceCoupon[]
    );
    const latestOrder = ((ordRes.data || []) as any[])[0];
    const enrichedCustomer = {
      ...c,
      secondary_phone:
        (c as any).secondary_phone ||
        latestOrder?.customer_secondary_phone ||
        null
    } as Customer;

    setPanel((prev) =>
      prev && prev.customer.id === c.id
        ? {
            customer: enrichedCustomer,
            orders: (ordRes.data || []) as Order[],
            archive: (archRes.data || []) as ArchiveRow[],
            coupons: mergedCoupons,
            generalNotes: (notesRes.data || []) as CustomerGeneralNote[]
          }
        : prev
    );
  };

  const applyCouponUpdate = async (coupon: DeviceCoupon, changes: Partial<DeviceCoupon>) => {
    setCouponBusy(true);
    try {
      const { error } = await supabase.from('device_coupons').update(changes).eq('id', coupon.id);
      if (error) throw error;
      if (coupon.device_fingerprint === GLOBAL_COUPON_TEMPLATE_FP && typeof changes.is_disabled === 'boolean') {
        await supabase.from('device_coupons').update({ is_disabled: changes.is_disabled }).eq('code', coupon.code);
      }
      if (panel) await refreshPanelData(panel.customer);
      setCouponEdit((prev) => (prev && prev.id === coupon.id ? { ...prev, ...changes } : prev));
    } catch (e) {
      console.error(e);
      alert('تعذر تحديث الكوبون.');
    } finally {
      setCouponBusy(false);
    }
  };

  const handleDeleteCouponRow = async (coupon: DeviceCoupon) => {
    if (!window.confirm('حذف هذه النسخة من الكوبون لهذا العميل؟')) return;
    setCouponBusy(true);
    try {
      const { error } = await supabase.from('device_coupons').delete().eq('id', coupon.id);
      if (error) throw error;
      setCouponEdit(null);
      if (panel) await refreshPanelData(panel.customer);
    } catch (e) {
      console.error(e);
      alert('تعذر حذف الكوبون.');
    } finally {
      setCouponBusy(false);
    }
  };

  /** نفس منطق OrdersManagement: تحديث المصدر ثم كل الطلبات + الأرشيف */
  const handleSaveNote = async () => {
    if (!panel || !newNoteText.trim()) return;
    const trimmed = newNoteText.trim();
    const cid = panel.customer.id;
    const customerPhone = panel.customer.phone;
    const customerName = panel.customer.name;
    setAddingNote(true);
    try {
      if (editingNoteRowId) {
        const noteRow = panel.generalNotes.find((n) => n.id === editingNoteRowId);
        if (!noteRow) throw new Error('ملاحظة غير موجودة');

        const originalNote = editingNoteOriginalText ?? noteRow.note;
        let gnid: string | null = (noteRow as CustomerGeneralNote).general_note_id ?? null;
        if (!gnid) {
          const { data: fallbackGeneral } = await supabase
            .from('customer_general_notes')
            .select('id, general_note_id')
            .eq('customer_phone', customerPhone)
            .eq('customer_name', customerName)
            .eq('note', originalNote)
            .maybeSingle();
          gnid = (fallbackGeneral?.general_note_id || fallbackGeneral?.id) || null;
        }

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
            .eq('note', originalNote);
          if (updateGeneralError) throw updateGeneralError;
        }

        if (gnid) {
          const { error: updateAllOrderNotesErr } = await supabase
            .from('customer_notes')
            .update({ note: trimmed })
            .eq('customer_id', cid)
            .eq('general_note_id', gnid);
          if (updateAllOrderNotesErr) throw updateAllOrderNotesErr;
        } else {
          const { error: updateAllOrderNotesErr } = await supabase
            .from('customer_notes')
            .update({ note: trimmed })
            .eq('customer_id', cid)
            .eq('note', originalNote);
          if (updateAllOrderNotesErr) throw updateAllOrderNotesErr;
        }

        if (gnid) {
          const { error: updateArchiveErr } = await supabase
            .from('archive_customer_notes')
            .update({ note: trimmed })
            .eq('customer_id', cid)
            .eq('general_note_id', gnid);
          if (updateArchiveErr) throw updateArchiveErr;
        } else {
          const { error: updateArchiveErr } = await supabase
            .from('archive_customer_notes')
            .update({ note: trimmed })
            .eq('customer_id', cid)
            .eq('note', originalNote);
          if (updateArchiveErr) throw updateArchiveErr;
        }
      } else {
        const { data: generalNoteRow, error: generalNoteError } = await supabase
          .from('customer_general_notes')
          .insert([
            {
              customer_phone: customerPhone,
              customer_name: customerName,
              note: trimmed,
              created_by: 'operator',
              is_public: newNotePublic
            }
          ])
          .select('id, general_note_id')
          .single();

        if (generalNoteError) throw generalNoteError;

        let generalNoteId = (generalNoteRow?.general_note_id || generalNoteRow?.id) as string | undefined;
        if (generalNoteRow?.id && !generalNoteRow.general_note_id) {
          await supabase
            .from('customer_general_notes')
            .update({ general_note_id: generalNoteRow.id })
            .eq('id', generalNoteRow.id);
          generalNoteId = generalNoteRow.id;
        }

        const liveRows = panel.orders.map((o) => ({
          customer_id: cid,
          order_id: o.id,
          general_note_id: generalNoteId || null,
          note: trimmed,
          created_by: 'operator',
          is_public: newNotePublic
        }));

        const archRows = panel.archive.map((a) => ({
          archive_order_id: a.id,
          customer_id: cid,
          note: trimmed,
          created_by: 'operator',
          general_note_id: generalNoteId || null,
          is_public: newNotePublic,
          created_at: new Date().toISOString()
        }));

        const chunk = 50;
        for (let i = 0; i < liveRows.length; i += chunk) {
          const batch = liveRows.slice(i, i + chunk);
          if (batch.length) {
            const { error } = await supabase.from('customer_notes').insert(batch);
            if (error) throw error;
          }
        }
        for (let i = 0; i < archRows.length; i += chunk) {
          const batch = archRows.slice(i, i + chunk);
          if (batch.length) {
            const { error } = await supabase.from('archive_customer_notes').insert(batch);
            if (error) throw error;
          }
        }
      }

      setNewNoteText('');
      setNewNotePublic(true);
      setEditingNoteRowId(null);
      setEditingNoteOriginalText(null);
      await refreshPanelData(panel.customer);
    } catch (e) {
      console.error(e);
      alert('تعذر حفظ الملاحظة.');
    } finally {
      setAddingNote(false);
    }
  };

  const startEditNote = (n: CustomerGeneralNote) => {
    setEditingNoteRowId(n.id);
    setEditingNoteOriginalText(n.note);
    setNewNoteText(n.note);
  };

  const cancelEditNote = () => {
    setEditingNoteRowId(null);
    setEditingNoteOriginalText(null);
    setNewNoteText('');
  };

  const handleDeleteGeneralNote = async (n: CustomerGeneralNote) => {
    if (!panel) return;
    if (!window.confirm('حذف هذه الملاحظة من جميع الطلبات المستقبلية والسجلات المرتبطة؟')) return;
    const cid = panel.customer.id;
    const gnid = ((n as CustomerGeneralNote).general_note_id as string | null | undefined) || null;

    try {
      if (gnid) {
        await supabase.from('customer_general_notes').delete().eq('general_note_id', gnid);
      } else {
        await supabase
          .from('customer_general_notes')
          .delete()
          .eq('customer_phone', panel.customer.phone)
          .eq('customer_name', panel.customer.name)
          .eq('note', n.note);
      }

      if (gnid) {
        await supabase.from('customer_notes').delete().eq('customer_id', cid).eq('general_note_id', gnid);
      } else {
        await supabase.from('customer_notes').delete().eq('customer_id', cid).eq('note', n.note);
      }

      if (gnid) {
        await supabase.from('archive_customer_notes').delete().eq('customer_id', cid).eq('general_note_id', gnid);
      } else {
        await supabase.from('archive_customer_notes').delete().eq('customer_id', cid).eq('note', n.note);
      }

      cancelEditNote();
      await refreshPanelData(panel.customer);
    } catch (e) {
      console.error(e);
      alert('تعذر حذف الملاحظة.');
    }
  };

  const handleDeleteAllGeneralNotes = async () => {
    if (!panel) return;
    if (!window.confirm('حذف جميع ملاحظات الأوبراتور لهذا العميل دفعة واحدة؟')) return;

    const cid = panel.customer.id;
    try {
      await supabase
        .from('customer_general_notes')
        .delete()
        .eq('customer_phone', panel.customer.phone)
        .eq('customer_name', panel.customer.name);

      await supabase.from('customer_notes').delete().eq('customer_id', cid).eq('created_by', 'operator');
      await supabase.from('archive_customer_notes').delete().eq('customer_id', cid).eq('created_by', 'operator');

      cancelEditNote();
      await refreshPanelData(panel.customer);
    } catch (e) {
      console.error(e);
      alert('تعذر حذف كل الملاحظات.');
    }
  };

  const toggleGeneralNoteVisibility = async (n: CustomerGeneralNote, isPublic: boolean) => {
    if (!panel) return;
    const cid = panel.customer.id;
    const gnid = ((n as CustomerGeneralNote).general_note_id as string | null | undefined) || null;

    try {
      if (gnid) {
        await supabase
          .from('customer_general_notes')
          .update({ is_public: isPublic, updated_at: new Date().toISOString() })
          .eq('general_note_id', gnid);
        await supabase
          .from('customer_notes')
          .update({ is_public: isPublic })
          .eq('customer_id', cid)
          .eq('general_note_id', gnid);
        await supabase
          .from('archive_customer_notes')
          .update({ is_public: isPublic })
          .eq('customer_id', cid)
          .eq('general_note_id', gnid);
      } else {
        await supabase
          .from('customer_general_notes')
          .update({ is_public: isPublic, updated_at: new Date().toISOString() })
          .eq('customer_phone', panel.customer.phone)
          .eq('customer_name', panel.customer.name)
          .eq('note', n.note);
        await supabase
          .from('customer_notes')
          .update({ is_public: isPublic })
          .eq('customer_id', cid)
          .eq('note', n.note);
        await supabase
          .from('archive_customer_notes')
          .update({ is_public: isPublic })
          .eq('customer_id', cid)
          .eq('note', n.note);
      }
      await refreshPanelData(panel.customer);
    } catch (e) {
      console.error(e);
      alert('تعذر تحديث حالة نشر الملاحظة.');
    }
  };

  const handleDeleteCustomer = async () => {
    if (!panel) return;
    const nonTerminal = panel.orders.filter((o) => !TERMINAL_ORDER_STATUSES.includes(o.status));
    if (nonTerminal.length > 0) {
      alert('لا يمكن حذف العميل طالما يوجد طلب حالي غير منتهٍ (بانتظار التسليم أو الإلغاء النهائي).');
      return;
    }
    const enteredDeletePwd = deletePasswordInput.trim();
    const configuredDeletePwd = customerDeletePassword.trim();
    if (enteredDeletePwd !== '2007' && (configuredDeletePwd === '' || enteredDeletePwd !== configuredDeletePwd)) {
      alert('كلمة مرور الحذف غير صحيحة.');
      return;
    }
    if (
      !window.confirm(
        'سيتم حذف سجل العميل من النظام، والملاحظات العامة، والكوبونات المرتبطة به.\nالطلبات السابقة تبقى محفوظة دون ربط لهذا السجل.\n\nهل تريد المتابعة؟'
      )
    ) {
      return;
    }

    setDeletingCustomer(true);
    try {
      const { id: cid, phone, name } = panel.customer;
      await supabase.from('customer_general_notes').delete().eq('customer_phone', phone).eq('customer_name', name);
      const { error: dcErr } = await supabase.from('device_coupons').delete().eq('customer_id', cid);
      if (dcErr) console.warn('device_coupons delete:', dcErr);
      const { error: delErr } = await supabase.from('customers').delete().eq('id', cid);
      if (delErr) throw delErr;

      setPanel(null);
      await loadOrderedCustomers();
    } catch (e) {
      console.error(e);
      alert('تعذر حذف العميل. تحقق من الصلاحيات أو وجود بيانات مرتبطة.');
    } finally {
      setDeletingCustomer(false);
    }
  };

  const handleUnlockSecurity = () => {
    const enteredSecurityPwd = securityGatePwd.trim();
    const configuredSecurityPwd = customerDeletePassword.trim();
    if (enteredSecurityPwd !== '2007' && (configuredSecurityPwd === '' || enteredSecurityPwd !== configuredSecurityPwd)) {
      alert('كلمة المرور غير صحيحة');
      return;
    }
    setSecurityUnlocked(true);
  };

  const handleResetCustomerSecurity = async () => {
    if (!panel) return;
    if (securityPwd1.trim().length < 4) {
      setSecurityResetErr('كلمة المرور 4 أحرف على الأقل');
      return;
    }
    if (securityPwd1 !== securityPwd2) {
      setSecurityResetErr('تأكيد كلمة المرور غير مطابق');
      return;
    }
    setSecurityResetBusy(true);
    setSecurityResetErr(null);
    try {
      const phone = panel.customer.phone;
      const pwdHash = await hashPhonePassword(phone, securityPwd1.trim());
      const existingHash =
        ((panel.customer as any).phone_password_hash as string | null | undefined) ?? null;
      if (existingHash && pwdHash === existingHash) {
        setSecurityResetErr('لا يمكن اختيار نفس كلمة المرور السابقة');
        return;
      }
      const recovery = generateEasyRecoveryCode();
      const recHash = await hashRecoveryCode(phone, recovery);
      const fp = getOrCreateDeviceFingerprint();
      const { error } = await supabase
        .from('customers')
        .update({
          phone_password_hash: pwdHash,
          phone_recovery_code_hash: recHash,
          phone_password_owner_fingerprint: fp,
          updated_at: new Date().toISOString()
        })
        .eq('id', panel.customer.id);
      if (error) throw error;
      setSecurityNewRecovery(recovery);
      setSecurityPwd1('');
      setSecurityPwd2('');
      await refreshPanelData(panel.customer);
    } catch (e) {
      console.error(e);
      setSecurityResetErr('تعذر تحديث كلمة المرور');
    } finally {
      setSecurityResetBusy(false);
    }
  };

  const handleClearCustomerSecurity = async () => {
    if (!panel) return;
    if (!window.confirm('مسح كلمة المرور وكود الاسترجاع لهذا العميل؟')) return;
    setSecurityResetBusy(true);
    setSecurityResetErr(null);
    try {
      const { error } = await supabase
        .from('customers')
        .update({
          phone_password_hash: null,
          phone_recovery_code_hash: null,
          phone_password_owner_fingerprint: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', panel.customer.id);
      if (error) throw error;
      setSecurityNewRecovery(null);
      await refreshPanelData(panel.customer);
    } catch (e) {
      console.error(e);
      setSecurityResetErr('تعذر مسح بيانات الأمان');
    } finally {
      setSecurityResetBusy(false);
    }
  };

  const activeOrders = panel ? panel.orders.filter((o) => !TERMINAL_ORDER_STATUSES.includes(o.status)) : [];
  const canDeleteCustomer = panel && activeOrders.length === 0;

  const panelCoords = useMemo(() => {
    if (!panel?.customer) return null;
    const lat = panel.customer.latitude;
    const lng = panel.customer.longitude;
    if (lat == null || lng == null) return null;
    return { lat: Number(lat), lng: Number(lng) };
  }, [panel?.customer]);
  const customerHasPhonePassword = !!((panel?.customer as any)?.phone_password_hash);

  return (
    <>
      <div className="bg-gray-900/50 border-2 border-cyan-500/35 rounded-xl p-4 mb-6">
        <div className="flex items-center justify-end gap-2 mb-3">
          <h3 className="text-xl font-bold text-white">بحث عن عميل</h3>
          <Search className="w-6 h-6 text-cyan-400" />
        </div>
        <p className="text-xs text-gray-400 text-right mb-3">
          ابحث بالاسم أو رقم الهاتف، ثم اختر العميل لعرض التفاصيل الكاملة والكوبونات والإحصائيات.
        </p>
        <div className="relative max-w-xl mr-auto">
          <div className="flex items-center gap-2 bg-gray-950/80 border-2 border-cyan-500/40 rounded-lg px-3 py-2">
            <Search className="w-5 h-5 text-cyan-400 shrink-0" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                const v = e.target.value;
                setQ(v);
                void runLookup(v);
                setOpen(false);
              }}
              onFocus={() => setOpen(false)}
              placeholder="اسم أو هاتف…"
              className="flex-1 bg-transparent text-white text-sm text-right outline-none placeholder:text-gray-500"
              dir="rtl"
            />
            {q && (
              <button
                type="button"
                onClick={() => {
                  setQ('');
                  setResults([]);
                  setOpen(false);
                }}
                className="text-gray-500 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {false && open && results.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 rounded-lg border border-cyan-500/40 bg-gray-950 shadow-xl z-[60] max-h-64 overflow-y-auto">
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => void openPanel(c)}
                  className="w-full text-right px-3 py-2.5 hover:bg-cyan-900/30 border-b border-gray-800/80 flex flex-col gap-0.5"
                >
                  <span className="text-white font-bold text-sm flex items-center justify-end gap-2">
                    <User className="w-4 h-4 text-cyan-400 shrink-0" />
                    {c.name}
                  </span>
                  <span className="text-xs text-cyan-200" dir="ltr">
                    {c.phone}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-cyan-500/25">
          <div className="flex items-center justify-end gap-2 mb-3">
            <h4 className="text-lg font-black text-white">العملاء الذين قدّموا طلبات</h4>
            <Users className="w-5 h-5 text-cyan-400" />
          </div>
          {loadingOrdered || loadingSummaries ? (
            <div className="flex justify-center py-8 text-cyan-300 gap-2 items-center">
              <Loader2 className="w-5 h-5 animate-spin" />
              جاري التحميل…
            </div>
          ) : visibleCustomers.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6">لا توجد نتائج مطابقة للبحث.</p>
          ) : (
            <div className="max-h-[78vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleCustomers.map((c) => {
                const s = summaries[c.id];
                const lines = receiptAddressLines(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void openPanel(c)}
                    className={`text-right rounded-2xl border-2 border-cyan-500/45 bg-gradient-to-b from-gray-950 to-gray-900/95 p-4 hover:border-cyan-400 hover:shadow-[0_0_20px_rgba(34,211,238,0.12)] transition-all min-h-[220px] flex flex-col gap-3 ${
                      highlightCustomerId === c.id ? 'ring-2 ring-amber-400 animate-pulse' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 border-b border-cyan-500/20 pb-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openPanel(c);
                        }}
                        className="w-5 h-5 rounded-full border border-cyan-500/35 text-cyan-300 text-[11px] font-black leading-none flex items-center justify-center opacity-70 hover:opacity-100"
                        title="تفاصيل"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <span className="text-white font-black text-base leading-snug flex-1">{c.name}</span>
                    </div>

                    <div className="space-y-1 font-mono" dir="rtl">
                      <div
                        className="text-cyan-300 font-black text-lg tracking-wide flex items-center justify-end gap-2"
                        dir="ltr"
                      >
                        <Phone className="w-5 h-5 shrink-0 text-cyan-400" />
                        {c.phone}
                      </div>
                      {lines.map((line, i) => (
                        <div
                          key={i}
                          className={`flex items-start justify-end gap-2 ${i === 0 ? 'text-gray-200 text-sm font-bold' : 'text-gray-400 text-xs'}`}
                        >
                          {i === 0 && <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-cyan-500/80" />}
                          <span className={i === 0 ? '' : 'pr-6'}>{line}</span>
                        </div>
                      ))}
                    </div>

                    {s && s.activeCount > 0 && (
                      <div className="rounded-xl bg-amber-500/15 border border-amber-500/40 px-3 py-2">
                        <p className="text-amber-200 text-xs font-black mb-1">طلبات حالية ({s.activeCount})</p>
                        <p className="text-amber-100/90 text-[11px] font-bold">{s.activeSnippets.join('، ') || '—'}</p>
                      </div>
                    )}

                    {s && (
                      <div className="flex items-center justify-end gap-1 text-[10px] text-gray-500 mt-auto pt-1">
                        <BarChart3 className="w-3.5 h-3.5" />
                        <span>
                          {s.totalOrders} طلب — {s.orderRateLabel}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
              </div>
            </div>
          )}
        </div>
      </div>

      {panel && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center p-3 sm:p-4 bg-black/75"
          onClick={() => setPanel(null)}
        >
          <div
            className="bg-gray-900 border-2 border-cyan-500/40 rounded-xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-500/30 bg-gray-950/90">
              <button type="button" onClick={() => setPanel(null)} className="text-gray-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
              <h3 className="text-white font-black text-sm text-right flex-1 px-2">بيانات العميل</h3>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-4 text-right">
              {panelLoading ? (
                <p className="text-center text-gray-400 py-8">جاري التحميل…</p>
              ) : (
                <>
                  {/* Receipt-style header */}
                  <div
                    className="rounded-2xl border-2 border-dashed border-cyan-500/50 bg-gray-950/80 p-5 space-y-3 font-mono shadow-inner"
                    dir="rtl"
                  >
                    <div className="flex items-center justify-end gap-2 text-white font-black text-xl border-b border-white/10 pb-3">
                      <User className="w-7 h-7 text-cyan-400" />
                      {panel.customer.name}
                    </div>
                    <div className="flex items-center justify-end gap-3 text-cyan-300 font-black text-2xl tracking-wide" dir="ltr">
                      <Phone className="w-7 h-7 text-cyan-400 shrink-0" />
                      {panel.customer.phone}
                    </div>
                    {(panel.customer as any).secondary_phone && (
                      <div className="flex items-center justify-end gap-2 text-cyan-200/80 font-black text-base tracking-wide" dir="ltr">
                        <Phone className="w-5 h-5 text-cyan-400/80 shrink-0" />
                        {(panel.customer as any).secondary_phone}
                      </div>
                    )}
                    <div className="space-y-2 text-gray-100">
                      {receiptAddressLines(panel.customer).map((line, i) => (
                        <div key={i} className={`flex items-start justify-end gap-2 ${i === 0 ? 'text-lg font-bold' : 'text-sm text-gray-300'}`}>
                          <MapPin className={`w-5 h-5 shrink-0 ${i === 0 ? 'text-cyan-400' : 'text-gray-500'} mt-0.5`} />
                          <span>{line}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {customerHasPhonePassword && (
                    <div className="rounded-xl border border-amber-500/35 bg-amber-950/10 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-amber-200 text-xs font-black inline-flex items-center gap-2">
                          <Lock className="w-4 h-4" />
                          أمان الرقم
                        </span>
                        <button
                          type="button"
                          onClick={() => setSecurityOpen((v) => !v)}
                          className="w-6 h-6 rounded-full border border-amber-500/35 text-amber-200/80 hover:text-amber-100 hover:border-amber-400 flex items-center justify-center"
                          title="تفاصيل"
                        >
                          <Plus className={`w-3.5 h-3.5 transition-transform ${securityOpen ? 'rotate-45' : ''}`} />
                        </button>
                      </div>

                      {securityOpen && !securityUnlocked && (
                        <div className="mt-3 space-y-2">
                          <input
                            type="password"
                            value={securityGatePwd}
                            onChange={(e) => setSecurityGatePwd(e.target.value)}
                            placeholder="ادخل كلمة مرور حذف العميل (من الإعدادات)"
                            className="w-full bg-gray-900 border border-amber-500/40 rounded-lg px-3 py-2 text-white text-sm text-right"
                            dir="rtl"
                          />
                          <button
                            type="button"
                            onClick={handleUnlockSecurity}
                            className="w-full bg-amber-700 hover:bg-amber-600 text-white rounded-lg py-2 text-sm font-black"
                          >
                            إظهار التفاصيل
                          </button>
                        </div>
                      )}

                      {securityOpen && securityUnlocked && (
                        <div className="mt-3 space-y-2 text-right">
                          <p className="text-[11px] text-amber-100/90">
                            كلمة المرور الحالية لا يمكن عرضها (مشفرة)، لكن يمكنك إعادة ضبطها أو مسحها.
                          </p>
                          {securityNewRecovery && (
                            <div className="rounded-lg border border-amber-500/35 bg-black/25 p-2 text-center">
                              <p className="text-[11px] text-amber-100/80 mb-1">كود استرجاع جديد:</p>
                              <p className="font-mono text-xl font-black text-amber-200 tracking-widest">{securityNewRecovery}</p>
                            </div>
                          )}
                          <div className="grid grid-cols-1 gap-2">
                            <input
                              type="password"
                              value={securityPwd1}
                              onChange={(e) => {
                                setSecurityPwd1(e.target.value);
                                setSecurityResetErr(null);
                              }}
                              className="w-full bg-gray-900 border border-amber-500/35 rounded-lg px-3 py-2 text-white text-sm"
                              placeholder="كلمة مرور جديدة"
                              dir="ltr"
                            />
                            <input
                              type="password"
                              value={securityPwd2}
                              onChange={(e) => {
                                setSecurityPwd2(e.target.value);
                                setSecurityResetErr(null);
                              }}
                              className="w-full bg-gray-900 border border-amber-500/35 rounded-lg px-3 py-2 text-white text-sm"
                              placeholder="تأكيد كلمة المرور"
                              dir="ltr"
                            />
                          </div>
                          {securityResetErr && <p className="text-red-400 text-xs font-bold">{securityResetErr}</p>}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={securityResetBusy}
                              onClick={() => void handleClearCustomerSecurity()}
                              className="flex-1 bg-red-700 hover:bg-red-600 text-white rounded-lg py-2 text-xs font-black"
                            >
                              مسح الأمان
                            </button>
                            <button
                              type="button"
                              disabled={securityResetBusy}
                              onClick={() => void handleResetCustomerSecurity()}
                              className="flex-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg py-2 text-xs font-black"
                            >
                              إعادة ضبط
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {panelCoords && <CustomerMiniMap latitude={panelCoords.lat} longitude={panelCoords.lng} />}

                  {summaries[panel.customer.id] && (
                    <div className="rounded-xl border border-indigo-500/35 bg-indigo-950/20 p-4 space-y-3">
                      <p className="text-indigo-200 text-xs font-black flex items-center justify-end gap-2">
                        <BarChart3 className="w-4 h-4" />
                        إحصائيات الطلبات
                      </p>
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-200">
                        <div className="rounded-lg bg-black/30 p-2 text-right">
                          <span className="text-gray-500 block mb-0.5">إجمالي الطلبات</span>
                          <span className="font-black text-indigo-200">{summaries[panel.customer.id].totalOrders}</span>
                        </div>
                        <div className="rounded-lg bg-black/30 p-2 text-right">
                          <span className="text-gray-500 block mb-0.5">معدل تقريبي</span>
                          <span className="font-black text-indigo-200">{summaries[panel.customer.id].orderRateLabel}</span>
                        </div>
                      </div>
                      {summaries[panel.customer.id].topAreas.length > 0 && (
                        <div>
                          <span className="text-[10px] text-gray-500 font-bold">أكثر المناطق</span>
                          <ul className="mt-1 space-y-0.5 text-xs text-gray-300">
                            {summaries[panel.customer.id].topAreas.map((a) => (
                              <li key={a.name}>
                                {a.name} <span className="text-indigo-400">({a.count})</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {summaries[panel.customer.id].topItems.length > 0 && (
                        <div>
                          <span className="text-[10px] text-gray-500 font-bold">أكثر الأصناف</span>
                          <ul className="mt-1 space-y-0.5 text-xs text-gray-300">
                            {summaries[panel.customer.id].topItems.map((it) => (
                              <li key={it.name}>
                                {it.name} <span className="text-indigo-400">×{it.count}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {summaries[panel.customer.id].topCategories.length > 0 && (
                        <div>
                          <span className="text-[10px] text-gray-500 font-bold">أكثر الأقسام</span>
                          <ul className="mt-1 space-y-0.5 text-xs text-gray-300">
                            {summaries[panel.customer.id].topCategories.map((cat) => (
                              <li key={cat.name}>
                                {cat.name} <span className="text-indigo-400">×{cat.count}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <p className="text-gray-400 text-xs font-bold mb-2 flex items-center justify-end gap-2">
                      <CreditCard className="w-4 h-4" />
                      الكوبونات المرتبطة (اضغط للتعديل)
                    </p>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {panel.coupons.length === 0 ? (
                        <p className="text-gray-600 text-xs">لا كوبونات مسجلة لهذا العميل.</p>
                      ) : (
                        panel.coupons.map((cp) => (
                          <button
                            key={cp.id}
                            type="button"
                            onClick={() => setCouponEdit(cp)}
                            className="w-full text-right rounded-lg border-2 border-purple-500/50 bg-purple-950/25 px-3 py-2.5 text-xs text-purple-100 hover:bg-purple-900/40 transition-colors"
                          >
                            <span className="font-black">{cp.discount_percent}%</span> — {cp.code}
                            {cp.is_disabled && <span className="text-red-400 mr-2">(معطل)</span>}
                            {cp.is_used && <span className="text-amber-300 mr-2">(مستخدم)</span>}
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-gray-400 text-xs font-bold mb-2">طلبات حالية</p>
                    <div className="space-y-2">
                      {activeOrders.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() => {
                            setPanel(null);
                            onNavigateToOrder(o.id, 'live');
                          }}
                          className="w-full text-right rounded-lg border border-yellow-500/50 bg-yellow-900/20 px-3 py-2 hover:bg-yellow-900/40 transition-colors shadow-[0_0_12px_rgba(234,179,8,0.25)]"
                        >
                          <span className="text-yellow-200 font-bold text-sm block">طلب حالي — #{o.order_number}</span>
                          <span className="text-yellow-100/80 text-xs">{o.status}</span>
                        </button>
                      ))}
                      {activeOrders.length === 0 && <p className="text-gray-600 text-xs">لا توجد طلبات حالية</p>}
                    </div>
                  </div>

                  <div>
                    <p className="text-gray-400 text-xs font-bold mb-2">طلبات مكتملة / ملغاة (غير مؤرشفة)</p>
                    <div className="space-y-1 max-h-28 overflow-y-auto">
                      {panel.orders
                        .filter((o) => TERMINAL_ORDER_STATUSES.includes(o.status))
                        .map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => {
                              setPanel(null);
                              onNavigateToOrder(o.id, 'live');
                            }}
                            className="w-full text-right rounded border border-gray-700 px-2 py-1.5 text-xs text-gray-200 hover:bg-gray-800"
                          >
                            #{o.order_number} — {o.status} — {o.total_amount} ج
                          </button>
                        ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-gray-400 text-xs font-bold mb-2">أرشيف الطلبات</p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {panel.archive.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            setPanel(null);
                            onNavigateToOrder(a.id, 'archive');
                          }}
                          className="w-full text-right rounded border border-blue-800/60 px-2 py-1.5 text-xs text-blue-200 hover:bg-blue-950/50"
                        >
                          #{a.order_number} — أرشيف — {a.total_amount} ج
                        </button>
                      ))}
                      {panel.archive.length === 0 && <p className="text-gray-600 text-xs">لا سجلات أرشيف</p>}
                    </div>
                  </div>

                  {/* Notes — aligned with receipt style */}
                  <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-3 mb-1">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => void handleDeleteAllGeneralNotes()}
                        disabled={panel.generalNotes.length === 0}
                        className="text-[11px] px-2 py-1 rounded-md bg-red-800/90 hover:bg-red-700 disabled:opacity-45 text-white font-bold"
                        title="حذف كل الملاحظات"
                      >
                        حذف الكل
                      </button>
                      <div className="flex items-center gap-2 text-yellow-300">
                        <span className="font-bold">ملاحظات الأوبراتور</span>
                        <StickyNote className="w-5 h-5 text-yellow-300" />
                      </div>
                    </div>

                    {panel.generalNotes.length > 0 && (
                      <div className="space-y-2 max-h-36 overflow-y-auto mb-3">
                        {panel.generalNotes.map((n) => (
                          <div key={n.id} className="mb-2 last:mb-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex flex-col items-end gap-1">
                                <label className="text-[11px] px-2 py-1 rounded-lg border border-amber-500/50 text-amber-200 inline-flex items-center gap-1">
                                  <span>pub</span>
                                  <input
                                    type="checkbox"
                                    checked={n.is_public !== false}
                                    onChange={(e) => void toggleGeneralNoteVisibility(n, e.target.checked)}
                                    className="w-3 h-3 accent-amber-500"
                                    title="إظهار للعميل"
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteGeneralNote(n)}
                                  className="text-red-400 hover:text-red-300 transition-colors"
                                  title="حذف"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startEditNote(n)}
                                  className="text-yellow-400 hover:text-yellow-300 transition-colors"
                                  title="تعديل"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                              </div>
                              <p className="text-yellow-200 text-sm text-right flex-1">
                                • {n.note}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2 mb-2 justify-end">
                      <span className="text-yellow-300 font-bold">إضافة ملاحظة</span>
                      <StickyNote className="w-5 h-5 text-yellow-300" />
                    </div>

                    <textarea
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      placeholder="اكتب ملاحظة عامة للعميل..."
                      rows={3}
                      className="w-full bg-gray-900/90 border border-yellow-500/50 rounded-lg px-3 py-3 text-white text-sm text-right resize-none placeholder:text-gray-500 focus:outline-none focus:border-yellow-400"
                      dir="rtl"
                    />
                    <label className="flex items-center justify-end gap-2 text-xs text-amber-200">
                      <span>pub</span>
                      <input
                        type="checkbox"
                        checked={newNotePublic}
                        onChange={(e) => setNewNotePublic(e.target.checked)}
                        className="w-3.5 h-3.5 accent-amber-500"
                      />
                    </label>

                    <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                      {editingNoteRowId && (
                        <button
                          type="button"
                          onClick={cancelEditNote}
                          className="w-full sm:w-auto py-2.5 px-4 rounded-xl border border-gray-600 text-gray-300 text-sm font-bold hover:bg-gray-800"
                        >
                          إلغاء التعديل
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={addingNote || !newNoteText.trim()}
                        onClick={() => void handleSaveNote()}
                        className="w-full sm:flex-1 py-2.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 disabled:opacity-45 text-white text-sm font-bold"
                      >
                        {addingNote ? 'جاري الحفظ…' : 'حفظ الملاحظة'}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-red-500/35 bg-red-950/15 p-3 space-y-2">
                    <p className="text-red-300 text-xs font-bold flex items-center justify-end gap-2">
                      <Trash2 className="w-4 h-4" />
                      حذف بيانات العميل
                    </p>
                    {!canDeleteCustomer && (
                      <p className="text-amber-200/90 text-[11px] leading-relaxed">
                        يمكن الحذف فقط بعد انتهاء جميع الطلبات الحالية (لا يوجد طلب قيد المعاينة أو التحضير أو التوصيل).
                      </p>
                    )}
                    <input
                      type="password"
                      value={deletePasswordInput}
                      onChange={(e) => setDeletePasswordInput(e.target.value)}
                      placeholder="كلمة مرور الحذف (من الإعدادات)"
                      disabled={!canDeleteCustomer}
                      className="w-full bg-gray-900 border border-red-500/30 rounded-lg px-2 py-2 text-white text-sm text-right disabled:opacity-40"
                      dir="rtl"
                    />
                    <button
                      type="button"
                      disabled={!canDeleteCustomer || deletingCustomer}
                      onClick={() => void handleDeleteCustomer()}
                      className="w-full py-2 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold"
                    >
                      {deletingCustomer ? 'جاري الحذف…' : 'حذف العميل نهائياً'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onFocusOrdersByPhone(panel.customer.phone);
                      setPanel(null);
                    }}
                    className="hidden md:block w-full py-2 rounded-lg bg-primary text-white font-bold text-sm"
                  >
                    فتح بحث الطلبات بهذا الهاتف
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {couponEdit && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80"
          onClick={() => !couponBusy && setCouponEdit(null)}
        >
          <div
            className="bg-gray-900 border-2 border-purple-500/50 rounded-xl max-w-md w-full p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <button type="button" disabled={couponBusy} onClick={() => setCouponEdit(null)} className="text-gray-400">
                <X className="w-5 h-5" />
              </button>
              <h4 className="text-white font-black">تعديل الكوبون</h4>
            </div>
            <p className="text-purple-200 text-sm font-mono text-right mb-4 break-all">{couponEdit.code}</p>

            <label className="block text-xs text-gray-400 mb-1 text-right">نسبة الخصم %</label>
            <input
              type="number"
              min={1}
              max={100}
              defaultValue={couponEdit.discount_percent}
              disabled={couponBusy}
              className="w-full bg-gray-800 border border-purple-500/40 rounded-lg px-3 py-2 text-white mb-3 text-right"
              onBlur={(e) => {
                const v = parseInt(e.target.value || '0', 10);
                if (v > 0 && v <= 100 && v !== couponEdit.discount_percent) {
                  void applyCouponUpdate(couponEdit, { discount_percent: v });
                }
              }}
            />

            <label className="block text-xs text-gray-400 mb-1 text-right">تاريخ الانتهاء</label>
            <input
              type="date"
              defaultValue={couponEdit.expires_at ? couponEdit.expires_at.substring(0, 10) : ''}
              disabled={couponBusy}
              className="w-full bg-gray-800 border border-purple-500/40 rounded-lg px-3 py-2 text-white mb-3"
              onChange={(e) => {
                const val = e.target.value;
                const iso = val ? new Date(val + 'T23:59:59').toISOString() : null;
                void applyCouponUpdate(couponEdit, { expires_at: iso });
              }}
            />

            <div className="flex gap-2 mb-3">
              <button
                type="button"
                disabled={couponBusy}
                onClick={() => void applyCouponUpdate(couponEdit, { is_disabled: !couponEdit.is_disabled })}
                className={`flex-1 py-2 rounded-lg text-sm font-bold ${couponEdit.is_disabled ? 'bg-green-600' : 'bg-yellow-600'} text-white`}
              >
                {couponEdit.is_disabled ? 'تفعيل' : 'تعطيل'}
              </button>
            </div>

            <button
              type="button"
              disabled={couponBusy}
              onClick={() => void handleDeleteCouponRow(couponEdit)}
              className="w-full py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-bold"
            >
              حذف هذه النسخة
            </button>
          </div>
        </div>
      )}
    </>
  );
}
