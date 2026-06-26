import { supabase, OrderItem } from './supabase';

export const RATE_ARCHIVE_JSON_TYPE = 'rate-archive';

export interface RateArchiveTables {
  archive_orders: Record<string, unknown>[];
  archive_order_items: Record<string, unknown>[];
  archive_customer_notes: Record<string, unknown>[];
}

export interface RateArchivePayload {
  meta: {
    type: string;
    version: number;
    name: string;
    createdAt: string;
  };
  tables: RateArchiveTables;
}

export type RateOrderSource = 'live' | 'archive-db' | 'archive-import';

export interface RateOrderView {
  id: string;
  order_number: string;
  status: string;
  total_amount: number;
  created_at: string;
  updated_at: string;
  customer_name?: string;
  customer_phone?: string;
  customer_street?: string;
  customer_area?: string;
  customer_city?: string;
  delivery_method?: 'delivery' | 'pickup';
  items: OrderItem[];
  source: RateOrderSource;
  archived_at?: string;
  importFileName?: string;
  isArchived?: boolean;
}

const ARCHIVE_TABLE_KEYS = ['archive_orders', 'archive_order_items', 'archive_customer_notes'] as const;

export async function fetchAllTableRows(table: string): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  let from = 0;
  const all: Record<string, unknown>[] = [];

  while (true) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data || []) as Record<string, unknown>[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function buildRateArchivePayload(name?: string): Promise<RateArchivePayload> {
  const tables: RateArchiveTables = {
    archive_orders: [],
    archive_order_items: [],
    archive_customer_notes: [],
  };

  for (const key of ARCHIVE_TABLE_KEYS) {
    try {
      tables[key] = await fetchAllTableRows(key);
    } catch {
      tables[key] = [];
    }
  }

  return {
    meta: {
      type: RATE_ARCHIVE_JSON_TYPE,
      version: 1,
      name: name || `rate-archive-${new Date().toISOString().slice(0, 10)}`,
      createdAt: new Date().toISOString(),
    },
    tables,
  };
}

export function downloadRateArchiveJson(payload: RateArchivePayload, fileName?: string): void {
  const safeName = (fileName || payload.meta.name || 'rate-archive')
    .replace(/[^\w\u0600-\u06FF.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeName}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function emptyTables(): RateArchiveTables {
  return {
    archive_orders: [],
    archive_order_items: [],
    archive_customer_notes: [],
  };
}

function normalizeTablesFromUnknown(parsed: unknown): RateArchiveTables {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('ملف JSON غير صالح');
  }

  const root = parsed as Record<string, unknown>;
  const tablesSource = (root.tables && typeof root.tables === 'object'
    ? root.tables
    : root) as Record<string, unknown>;

  const tables = emptyTables();
  for (const key of ARCHIVE_TABLE_KEYS) {
    const rows = tablesSource[key];
    tables[key] = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
  }

  if (tables.archive_orders.length === 0) {
    throw new Error('الملف لا يحتوي على طلبات أرشيف');
  }

  return tables;
}

export function parseRateArchiveJson(text: string, fallbackName: string): RateArchivePayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('تعذر قراءة ملف JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('ملف JSON غير صالح');
  }

  const root = parsed as Record<string, unknown>;
  const tables = normalizeTablesFromUnknown(parsed);
  const metaObj = (root.meta && typeof root.meta === 'object' ? root.meta : {}) as Record<string, unknown>;

  return {
    meta: {
      type: typeof metaObj.type === 'string' ? metaObj.type : RATE_ARCHIVE_JSON_TYPE,
      version: Number(metaObj.version) || 1,
      name: typeof metaObj.name === 'string' && metaObj.name.trim()
        ? metaObj.name.trim()
        : fallbackName.replace(/\.json$/i, ''),
      createdAt: typeof metaObj.createdAt === 'string' ? metaObj.createdAt : new Date().toISOString(),
    },
    tables,
  };
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeArchiveItem(
  raw: Record<string, unknown>,
  archiveOrderId: string,
  index: number,
  importFileName: string
): OrderItem {
  return {
    id: asString(raw.id, `import-item-${importFileName}-${archiveOrderId}-${index}`),
    order_id: archiveOrderId,
    item_id: asString(raw.item_id),
    item_name: asString(raw.item_name, 'صنف'),
    quantity: asNumber(raw.quantity, 1),
    unit_price: asNumber(raw.unit_price),
    subtotal: asNumber(raw.subtotal),
    rate_discount_percent: raw.rate_discount_percent == null ? null : asNumber(raw.rate_discount_percent),
  };
}

export function rateArchiveTablesToOrders(
  tables: RateArchiveTables,
  source: RateOrderSource,
  importFileName?: string
): RateOrderView[] {
  const itemsByArchiveOrder = new Map<string, OrderItem[]>();

  tables.archive_order_items.forEach((raw, index) => {
    const archiveOrderId = asString(raw.archive_order_id);
    if (!archiveOrderId) return;
    const list = itemsByArchiveOrder.get(archiveOrderId) || [];
    list.push(normalizeArchiveItem(raw, archiveOrderId, index, importFileName || 'import'));
    itemsByArchiveOrder.set(archiveOrderId, list);
  });

  return tables.archive_orders.map((raw) => {
    const id = asString(raw.id);
    const prefix = source === 'archive-import' && importFileName ? `import:${importFileName}:` : '';
    return {
      id: `${prefix}${id}`,
      order_number: asString(raw.order_number),
      status: asString(raw.status, 'completed'),
      total_amount: asNumber(raw.total_amount),
      created_at: asString(raw.original_created_at, asString(raw.created_at)),
      updated_at: asString(raw.original_updated_at, asString(raw.archived_at, asString(raw.updated_at, asString(raw.created_at)))),
      customer_name: asString(raw.customer_name) || undefined,
      customer_phone: asString(raw.customer_phone) || undefined,
      customer_street: asString(raw.customer_street) || undefined,
      customer_area: asString(raw.customer_area) || undefined,
      customer_city: asString(raw.customer_city) || undefined,
      delivery_method: raw.delivery_method === 'pickup' ? 'pickup' : raw.delivery_method === 'delivery' ? 'delivery' : undefined,
      items: itemsByArchiveOrder.get(id) || [],
      source,
      archived_at: asString(raw.archived_at) || undefined,
      importFileName,
      isArchived: true,
    };
  });
}

export function dbArchiveRowToRateOrder(raw: Record<string, unknown>, items: OrderItem[]): RateOrderView {
  const id = asString(raw.id);
  return {
    id: `archive-db:${id}`,
    order_number: asString(raw.order_number),
    status: asString(raw.status, 'completed'),
    total_amount: asNumber(raw.total_amount),
    created_at: asString(raw.original_created_at, asString(raw.created_at)),
    updated_at: asString(raw.original_updated_at, asString(raw.archived_at, asString(raw.updated_at, asString(raw.created_at)))),
    customer_name: asString(raw.customer_name) || undefined,
    customer_phone: asString(raw.customer_phone) || undefined,
    customer_street: asString(raw.customer_street) || undefined,
    customer_area: asString(raw.customer_area) || undefined,
    customer_city: asString(raw.customer_city) || undefined,
    delivery_method: raw.delivery_method === 'pickup' ? 'pickup' : raw.delivery_method === 'delivery' ? 'delivery' : undefined,
    items,
    source: 'archive-db',
    archived_at: asString(raw.archived_at) || undefined,
    isArchived: true,
  };
}

export function liveOrderToRateOrder(order: Record<string, unknown>, items: OrderItem[]): RateOrderView {
  return {
    id: asString(order.id),
    order_number: asString(order.order_number),
    status: asString(order.status, 'completed'),
    total_amount: asNumber(order.total_amount),
    created_at: asString(order.created_at),
    updated_at: asString(order.updated_at, asString(order.created_at)),
    customer_name: asString(order.customer_name) || undefined,
    customer_phone: asString(order.customer_phone) || undefined,
    customer_street: asString(order.customer_street) || undefined,
    customer_area: asString(order.customer_area) || undefined,
    customer_city: asString(order.customer_city) || undefined,
    delivery_method: order.delivery_method === 'pickup' ? 'pickup' : order.delivery_method === 'delivery' ? 'delivery' : undefined,
    items,
    source: 'live',
    isArchived: false,
  };
}

export function mergeRateOrders(lists: RateOrderView[][]): RateOrderView[] {
  const map = new Map<string, RateOrderView>();
  for (const list of lists) {
    for (const order of list) {
      map.set(order.id, order);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
  );
}

export async function fetchDbArchiveRateOrders(): Promise<RateOrderView[]> {
  const archiveOrders = await fetchAllTableRows('archive_orders');
  if (archiveOrders.length === 0) return [];

  const archiveItems = await fetchAllTableRows('archive_order_items');
  const itemsByArchiveOrder = new Map<string, OrderItem[]>();

  archiveItems.forEach((raw, index) => {
    const archiveOrderId = asString(raw.archive_order_id);
    if (!archiveOrderId) return;
    const list = itemsByArchiveOrder.get(archiveOrderId) || [];
    list.push(normalizeArchiveItem(raw, archiveOrderId, index, 'db'));
    itemsByArchiveOrder.set(archiveOrderId, list);
  });

  return archiveOrders.map((raw) => {
    const id = asString(raw.id);
    return dbArchiveRowToRateOrder(raw, itemsByArchiveOrder.get(id) || []);
  });
}

export async function fetchLiveCompletedRateOrders(): Promise<RateOrderView[]> {
  const orders = await fetchAllTableRows('orders');
  const completed = orders.filter((o) => asString(o.status) === 'completed');
  if (completed.length === 0) return [];

  const orderIds = completed.map((o) => asString(o.id)).filter(Boolean);
  const allItems: Record<string, unknown>[] = [];

  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500);
    const { data } = await supabase.from('order_items').select('*').in('order_id', chunk);
    if (data) allItems.push(...(data as Record<string, unknown>[]));
  }

  const itemsByOrder = new Map<string, OrderItem[]>();
  allItems.forEach((raw) => {
    const orderId = asString(raw.order_id);
    if (!orderId) return;
    const list = itemsByOrder.get(orderId) || [];
    list.push(raw as unknown as OrderItem);
    itemsByOrder.set(orderId, list);
  });

  return completed.map((raw) => liveOrderToRateOrder(raw, itemsByOrder.get(asString(raw.id)) || []));
}

export async function fetchAllRateOrders(importOrders: RateOrderView[] = []): Promise<RateOrderView[]> {
  const [live, archiveDb] = await Promise.all([
    fetchLiveCompletedRateOrders(),
    fetchDbArchiveRateOrders(),
  ]);
  return mergeRateOrders([live, archiveDb, importOrders]);
}
