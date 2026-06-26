import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAllRateOrders, type RateOrderView } from '../lib/rateArchiveJson';
import { useRealtimeRefetch } from '../hooks/useRealtimeSubscription';
import {
  deleteRateArchiveImport,
  getSelectedRateArchiveImportName,
  importRateArchiveFile,
  listRateArchiveImports,
  loadRateArchiveImportOrders,
  setSelectedRateArchiveImportName,
  type RateArchiveImportMeta,
} from '../lib/rateArchiveStorage';
interface RateArchiveContextType {
  imports: RateArchiveImportMeta[];
  selectedImportName: string;
  importOrders: RateOrderView[];
  allOrders: RateOrderView[];
  loadingOrders: boolean;
  importing: boolean;
  refreshImports: () => void;
  refreshOrders: () => Promise<void>;
  selectImport: (name: string) => void;
  importJsonFile: (file: File) => Promise<{ ok: boolean; error?: string }>;
  removeImport: (name: string) => Promise<void>;
}

const RateArchiveContext = createContext<RateArchiveContextType | undefined>(undefined);

export function RateArchiveProvider({ children }: { children: React.ReactNode }) {
  const [imports, setImports] = useState<RateArchiveImportMeta[]>([]);
  const [selectedImportName, setSelectedImportNameState] = useState(getSelectedRateArchiveImportName());
  const [importOrders, setImportOrders] = useState<RateOrderView[]>([]);
  const [allOrders, setAllOrders] = useState<RateOrderView[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [importing, setImporting] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  const refreshImports = useCallback(() => {
    setImports(listRateArchiveImports());
    setSelectedImportNameState(getSelectedRateArchiveImportName());
  }, []);

  const refreshOrders = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? hasLoadedOnceRef.current;
    if (!silent) setLoadingOrders(true);
    try {
      const selected = getSelectedRateArchiveImportName();
      const imported = selected ? await loadRateArchiveImportOrders(selected) : [];
      setImportOrders(imported);
      const merged = await fetchAllRateOrders(imported);
      setAllOrders(merged);
      hasLoadedOnceRef.current = true;
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  const refreshOrdersRef = useRef(refreshOrders);
  refreshOrdersRef.current = refreshOrders;

  const { isConnected: isRealtimeConnected } = useRealtimeRefetch(
    'rate-all-orders-realtime',
    ['orders', 'order_items', 'archive_orders', 'archive_order_items', 'settings'],
    () => {
      void refreshOrdersRef.current({ silent: true });
    }
  );

  // Fallback polling when Supabase Realtime is unavailable
  useEffect(() => {
    const intervalMs = isRealtimeConnected ? 60000 : 15000;
    const id = window.setInterval(() => {
      void refreshOrdersRef.current({ silent: true });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [isRealtimeConnected]);
  useEffect(() => {
    refreshImports();
  }, [refreshImports]);

  useEffect(() => {
    void refreshOrders();
  }, [selectedImportName, refreshOrders]);

  const selectImport = useCallback((name: string) => {
    setSelectedRateArchiveImportName(name);
    setSelectedImportNameState(name);
  }, []);

  const importJsonFile = useCallback(async (file: File) => {
    setImporting(true);
    try {
      await importRateArchiveFile(file);
      refreshImports();
      await refreshOrders();
      return { ok: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'تعذر استيراد الملف';
      return { ok: false, error: message };
    } finally {
      setImporting(false);
    }
  }, [refreshImports, refreshOrders]);

  const removeImport = useCallback(async (name: string) => {
    await deleteRateArchiveImport(name);
    refreshImports();
    await refreshOrders();
  }, [refreshImports, refreshOrders]);

  const value = useMemo(
    () => ({
      imports,
      selectedImportName,
      importOrders,
      allOrders,
      loadingOrders,
      importing,
      refreshImports,
      refreshOrders,
      selectImport,
      importJsonFile,
      removeImport,
    }),
    [
      imports,
      selectedImportName,
      importOrders,
      allOrders,
      loadingOrders,
      importing,
      refreshImports,
      refreshOrders,
      selectImport,
      importJsonFile,
      removeImport,
    ]
  );

  return <RateArchiveContext.Provider value={value}>{children}</RateArchiveContext.Provider>;
}

export function useRateArchive() {
  const context = useContext(RateArchiveContext);
  if (!context) {
    throw new Error('useRateArchive must be used within RateArchiveProvider');
  }
  return context;
}
