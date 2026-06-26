import { parseRateArchiveJson, type RateArchivePayload, rateArchiveTablesToOrders, type RateOrderView } from './rateArchiveJson';

type RateArchiveRecord = {
  name: string;
  blob: Blob;
  updatedAt: number;
  orderCount: number;
};

export interface RateArchiveImportMeta {
  name: string;
  updatedAt: number;
  orderCount: number;
}

const DB_NAME = 'mx-rate-archive-db';
const DB_VERSION = 1;
const STORE = 'imports';
const META_KEY = 'rate_archive_imports_meta';
const SELECTED_KEY = 'rate_archive_selected_import';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readMetaList(): RateArchiveImportMeta[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMetaList(list: RateArchiveImportMeta[]): void {
  localStorage.setItem(META_KEY, JSON.stringify(list));
}

export function getSelectedRateArchiveImportName(): string {
  return localStorage.getItem(SELECTED_KEY) || '';
}

export function setSelectedRateArchiveImportName(name: string): void {
  if (name) {
    localStorage.setItem(SELECTED_KEY, name);
  } else {
    localStorage.removeItem(SELECTED_KEY);
  }
}

export function listRateArchiveImports(): RateArchiveImportMeta[] {
  return readMetaList().sort((a, b) => b.updatedAt - a.updatedAt);
}

async function saveRecord(record: RateArchiveRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function saveRateArchiveImport(name: string, payload: RateArchivePayload): Promise<RateArchiveImportMeta> {
  const safeName = name.trim() || payload.meta.name || `import-${Date.now()}`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const orderCount = payload.tables.archive_orders.length;
  const updatedAt = Date.now();
  await saveRecord({ name: safeName, blob, updatedAt, orderCount });
  const nextMeta = [
    ...readMetaList().filter((item) => item.name !== safeName),
    { name: safeName, updatedAt, orderCount },
  ];
  writeMetaList(nextMeta);
  setSelectedRateArchiveImportName(safeName);
  return { name: safeName, updatedAt, orderCount };
}

export async function importRateArchiveFile(file: File): Promise<RateArchiveImportMeta> {
  const text = await file.text();
  const fallbackName = file.name.replace(/\.json$/i, '') || `import-${Date.now()}`;
  const payload = parseRateArchiveJson(text, fallbackName);
  const name = payload.meta.name || fallbackName;
  return saveRateArchiveImport(name, payload);
}

export async function getRateArchiveImportBlob(name: string): Promise<Blob | null> {
  const db = await openDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(name);
    req.onsuccess = () => resolve((req.result as RateArchiveRecord | undefined)?.blob || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}

export async function loadRateArchiveImportOrders(name: string): Promise<RateOrderView[]> {
  const blob = await getRateArchiveImportBlob(name);
  if (!blob) return [];
  const text = await blob.text();
  const payload = parseRateArchiveJson(text, name);
  return rateArchiveTablesToOrders(payload.tables, 'archive-import', name);
}

export async function deleteRateArchiveImport(name: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  const nextMeta = readMetaList().filter((item) => item.name !== name);
  writeMetaList(nextMeta);

  if (getSelectedRateArchiveImportName() === name) {
    setSelectedRateArchiveImportName(nextMeta[0]?.name || '');
  }
}

function extractImportRawOrderId(rateOrderId: string, importName: string): string | null {
  const prefix = `import:${importName}:`;
  if (!rateOrderId.startsWith(prefix)) return null;
  return rateOrderId.slice(prefix.length);
}

/** Update discount % for orders inside an imported JSON file (stored locally). */
export async function updateImportDiscountInWindow(
  importName: string,
  rateOrderIds: string[],
  percent: number
): Promise<number> {
  const blob = await getRateArchiveImportBlob(importName);
  if (!blob) return 0;

  const text = await blob.text();
  const payload = parseRateArchiveJson(text, importName);
  const targetRawIds = new Set(
    rateOrderIds
      .map((id) => extractImportRawOrderId(id, importName))
      .filter((id): id is string => Boolean(id))
  );

  if (targetRawIds.size === 0) return 0;

  for (const item of payload.tables.archive_order_items) {
    const archiveOrderId = String(item.archive_order_id ?? '');
    if (targetRawIds.has(archiveOrderId)) {
      item.rate_discount_percent = percent;
    }
  }

  await saveRateArchiveImport(importName, payload);
  return targetRawIds.size;
}
