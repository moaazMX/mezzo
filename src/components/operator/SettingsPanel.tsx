import { useState, useEffect, useRef } from 'react';
import { supabase, DeviceCoupon, DeliveryZone, PolygonPoint, DeliveryZoneLayer, DeliveryService } from '../../lib/supabase';
import { useRealtimeRefetch } from '../../hooks/useRealtimeSubscription';
import { Lock, CreditCard, Save, Keyboard, RotateCcw, X, Upload, Loader2, Image as ImageIcon, Archive, MapPinned, Download, FolderUp, Users, MoreVertical } from 'lucide-react';
import DeliveryServiceEditor from './DeliveryServiceEditor';
import OperatorCustomerSearch from './OperatorCustomerSearch';
import { deleteSlotBlob, getSlotBlob, saveSlotBlob } from '../../lib/slotStorage';
import { buildRateArchivePayload, downloadRateArchiveJson } from '../../lib/rateArchiveJson';
import { getPolygonCenter } from '../../lib/geoUtils';

type SettingsPanelProps = {
  onNavigateToCustomerOrders?: (phone: string, name?: string) => void;
  onNavigateToOrder?: (orderId: string, kind: 'live' | 'archive') => void;
  focusCustomerPhone?: string | null;
  focusCustomerToken?: number;
};

export default function SettingsPanel({ onNavigateToCustomerOrders, onNavigateToOrder, focusCustomerPhone, focusCustomerToken }: SettingsPanelProps) {
  const zoneCreateInFlightRef = useRef(false);
  const serviceCreateInFlightRef = useRef(false);
  const [instantNumber, setInstantNumber] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [oldCheatCode, setOldCheatCode] = useState('');
  const [newCheatCode, setNewCheatCode] = useState('');
  const [confirmCheatCode, setConfirmCheatCode] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [showLogoUpload, setShowLogoUpload] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoImageUrl, setLogoImageUrl] = useState<string>('');
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isExportingArchive, setIsExportingArchive] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const [couponSecretCode, setCouponSecretCode] = useState('');
  const [couponDiscountPercent, setCouponDiscountPercent] = useState<number>(0);
  const [currentCheatCode, setCurrentCheatCode] = useState<string>('admin123123');
  const [deviceCoupons, setDeviceCoupons] = useState<DeviceCoupon[]>([]);
  const [loadingCoupons, setLoadingCoupons] = useState(false);
  const [couponUsageCounts, setCouponUsageCounts] = useState<Record<string, number>>({});
  const [couponUsedInOrderCounts, setCouponUsedInOrderCounts] = useState<Record<string, number>>({});
  const [couponRecipientsOpen, setCouponRecipientsOpen] = useState(false);
  const [couponRecipientsCode, setCouponRecipientsCode] = useState<string | null>(null);
  const [couponRecipientsRows, setCouponRecipientsRows] = useState<DeviceCoupon[]>([]);
  const [customerSearchPhone, setCustomerSearchPhone] = useState<string | null>(null);
  const [customerSearchToken, setCustomerSearchToken] = useState(0);

  useEffect(() => {
    if (!focusCustomerPhone) return;
    setCustomerSearchPhone(focusCustomerPhone);
    setCustomerSearchToken((n) => n + 1);
  }, [focusCustomerPhone, focusCustomerToken]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [deliveryServices, setDeliveryServices] = useState<DeliveryService[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [showServiceEditor, setShowServiceEditor] = useState(false);
  const [showDebugMap, setShowDebugMap] = useState(false);
  const [customerDeletePassword, setCustomerDeletePassword] = useState('');
  const [customerDeletePwdOld, setCustomerDeletePwdOld] = useState('');
  const [customerDeletePwdNew, setCustomerDeletePwdNew] = useState('');
  const [customerDeletePwdConfirm, setCustomerDeletePwdConfirm] = useState('');

  // Slots (export/import/restore)
  const [slotName, setSlotName] = useState('');
  const [isSlotBusy, setIsSlotBusy] = useState(false);
  const [slotsList, setSlotsList] = useState<{ name: string; updatedAt: number }[]>([]);
  const [selectedSlotName, setSelectedSlotName] = useState<string>('');
  const slotFileInputRef = useRef<HTMLInputElement>(null);
  const [slotImportDrag, setSlotImportDrag] = useState(false);
  const [openSlotMenu, setOpenSlotMenu] = useState<string | null>(null);
  const [slotGate, setSlotGate] = useState<null | { action: 'apply' | 'delete' | 'export'; name?: string }>(null);
  const [slotGatePassword, setSlotGatePassword] = useState('');

  const GLOBAL_COUPON_FINGERPRINT = 'GLOBAL_TEMPLATE';

  useEffect(() => {
    fetchSettings();

    const handleOpenLogoUpload = () => {
      setShowLogoUpload(true);
    };

    window.addEventListener('open-logo-upload', handleOpenLogoUpload);

    return () => {
      window.removeEventListener('open-logo-upload', handleOpenLogoUpload);
    };
  }, []);

  useRealtimeRefetch(
    'op-settings',
    ['settings', 'device_coupons', 'delivery_zones', 'delivery_services', 'delivery_zone_layers'],
    () => {
      void fetchSettings();
    }
  );

  const fetchSettings = async () => {
    const { data } = await supabase
      .from('settings')
      .select('key, value');

    if (data) {
      const instantNumberSetting = data.find(s => s.key === 'instant_transfer_number');
      if (instantNumberSetting) {
        setInstantNumber(instantNumberSetting.value);
      }

      const logoSetting = data.find(s => s.key === 'logo_image_url');
      if (logoSetting) {
        setLogoImageUrl(logoSetting.value);
        setLogoPreview(logoSetting.value);
      }

      const couponCodeSetting = data.find(s => s.key === 'coupon_secret_code');
      if (couponCodeSetting) {
        setCouponSecretCode(couponCodeSetting.value);
      }

      const couponPercentSetting = data.find(s => s.key === 'coupon_discount_percent');
      if (couponPercentSetting) {
        const parsed = parseInt(couponPercentSetting.value, 10);
        setCouponDiscountPercent(isNaN(parsed) ? 0 : parsed);
      }

      const cheatSetting = data.find(s => s.key === 'cheat_code');
      if (cheatSetting) {
        setCurrentCheatCode(cheatSetting.value);
      }

      const showDebugMapSetting = data.find(s => s.key === 'show_debug_map');
      if (showDebugMapSetting) {
        setShowDebugMap(showDebugMapSetting.value === 'true');
      }

      const customerDeletePwd = data.find(s => s.key === 'customer_delete_password');
      const delVal = (customerDeletePwd?.value && customerDeletePwd.value.trim()) || '2007';
      setCustomerDeletePassword(delVal);
    }

    await fetchDeviceCoupons();
    await fetchDeliveryZones();
    await fetchDeliveryServices();
  };

  const fetchDeviceCoupons = async () => {
    setLoadingCoupons(true);
    try {
      const { data, error } = await supabase
        .from('device_coupons')
        .select('*')
        .eq('device_fingerprint', GLOBAL_COUPON_FINGERPRINT)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        console.error('Error loading device coupons:', error);
        return;
      }

      if (data) {
        setDeviceCoupons(data);
      }

      // Fetch usage counts: count all non-template coupons grouped by code
      const { data: allUserCoupons, error: usageError } = await supabase
        .from('device_coupons')
        .select('code')
        .neq('device_fingerprint', GLOBAL_COUPON_FINGERPRINT);

      if (!usageError && allUserCoupons) {
        const counts: Record<string, number> = {};
        allUserCoupons.forEach(c => {
          counts[c.code] = (counts[c.code] || 0) + 1;
        });
        setCouponUsageCounts(counts);
      }

      const { data: usageUsedRows, error: usedErr } = await supabase
        .from('device_coupons')
        .select('code, is_used')
        .neq('device_fingerprint', GLOBAL_COUPON_FINGERPRINT);

      if (!usedErr && usageUsedRows) {
        const usedCounts: Record<string, number> = {};
        usageUsedRows.forEach((row: { code: string; is_used: boolean | null }) => {
          if (row.is_used) usedCounts[row.code] = (usedCounts[row.code] || 0) + 1;
        });
        setCouponUsedInOrderCounts(usedCounts);
      }
    } finally {
      setLoadingCoupons(false);
    }
  };

  const fetchDeliveryZones = async () => {
    setLoadingZones(true);
    try {
      const { data, error } = await supabase
        .from('delivery_zones')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading delivery zones:', error);
        return;
      }

      // Load delivery service layers (yellow inner polygons)
      const { data: layersData, error: layersError } = await supabase
        .from('delivery_zone_layers')
        .select('*')
        .order('order_index', { ascending: true });

      if (layersError) {
        console.error('Error loading delivery zone layers:', layersError);
      }

      if (data) {
        // Group layers by zone_id and ensure polygon_points are parsed
        const layersByZone: Record<string, DeliveryZoneLayer[]> = {};

        if (layersData) {
          layersData.forEach((layer: any) => {
            const zoneId = layer.zone_id;
            if (!zoneId) return;

            const parsedPoints = layer.polygon_points
              ? (typeof layer.polygon_points === 'string'
                ? JSON.parse(layer.polygon_points)
                : layer.polygon_points)
              : [];

            const normalizedLayer: DeliveryZoneLayer = {
              id: layer.id,
              zone_id: zoneId,
              name: layer.name ?? null,
              order_index: layer.order_index ?? 1,
              polygon_points: parsedPoints,
              delivery_price: Number(layer.delivery_price ?? 0),
              created_at: layer.created_at
            };

            if (!layersByZone[zoneId]) {
              layersByZone[zoneId] = [];
            }
            layersByZone[zoneId].push(normalizedLayer);
          });
        }

        // Ensure polygon_points is parsed correctly (it comes as JSON from DB)
        const zones: DeliveryZone[] = data.map((zone: any) => {
          const parsedPoints = zone.polygon_points
            ? (typeof zone.polygon_points === 'string'
              ? JSON.parse(zone.polygon_points)
              : zone.polygon_points)
            : [];

          const branch_location = zone.branch_location
            ? (typeof zone.branch_location === 'string'
              ? JSON.parse(zone.branch_location)
              : zone.branch_location)
            : null;

          return {
            ...zone,
            polygon_points: parsedPoints,
            branch_location,
            layers: layersByZone[zone.id] || []
          } as DeliveryZone;
        });

        setDeliveryZones(zones);
      }
    } finally {
      setLoadingZones(false);
    }
  };

  const fetchDeliveryServices = async () => {
    setLoadingServices(true);
    try {
      const { data: servicesData, error: servicesError } = await supabase
        .from('delivery_services')
        .select('*')
        .order('created_at', { ascending: false });

      if (servicesError) {
        console.error('Error loading delivery services:', servicesError);
        return;
      }

      const { data: layersData, error: layersError } = await supabase
        .from('delivery_zone_layers')
        .select('*')
        .order('order_index', { ascending: true });

      if (layersError) {
        console.error('Error loading delivery service layers:', layersError);
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

          return {
            id: service.id,
            name: service.name,
            branch_location,
            is_active: service.is_active,
            created_at: service.created_at,
            layers: layersByService[service.id] || []
          };
        });

        setDeliveryServices(services);
      }
    } finally {
      setLoadingServices(false);
    }
  };

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(''), 3000);
  };

  // Load slots metadata from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('op_slots_list');
      const selected = localStorage.getItem('op_slots_selected') || '';
      if (saved) setSlotsList(JSON.parse(saved));
      if (selected) setSelectedSlotName(selected);
    } catch {}
  }, []);

  const persistSlotsMeta = (next: { name: string; updatedAt: number }[], selectedName?: string) => {
    setSlotsList(next);
    localStorage.setItem('op_slots_list', JSON.stringify(next));
    if (typeof selectedName === 'string') {
      setSelectedSlotName(selectedName);
      localStorage.setItem('op_slots_selected', selectedName);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const parsePublicStorageUrl = (url: string): { bucket: string; path: string } | null => {
    try {
      const u = new URL(url);
      const idx = u.pathname.indexOf('/storage/v1/object/public/');
      if (idx === -1) return null;
      const rest = u.pathname.substring(idx + '/storage/v1/object/public/'.length);
      const parts = rest.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      const bucket = parts[0];
      const path = parts.slice(1).join('/');
      return { bucket, path };
    } catch {
      return null;
    }
  };

  const fetchAllRows = async (table: string) => {
    const pageSize = 1000;
    let from = 0;
    const all: any[] = [];
    while (true) {
      const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1);
      if (error) throw error;
      const rows = data || [];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return all;
  };

  const verifyCustomerDeletePwd = (pwd: string) => {
    const entered = pwd.trim();
    const configured = customerDeletePassword.trim();
    return entered === '2007' || (configured !== '' && entered === configured);
  };

  const performExportSlot = async () => {
    if (!slotName.trim()) {
      showMessage('اكتب اسم Slot', 'error');
      return;
    }
    setIsSlotBusy(true);
    try {
      const tablesToExport = [
        'settings',
        'categories',
        'items',
        'customers',
        'customer_saved_addresses',
        'customer_general_notes',
        'orders',
        'order_items',
        'customer_notes',
        'archive_orders',
        'archive_order_items',
        'archive_customer_notes',
        'device_coupons',
        'delivery_services',
        'delivery_zones',
        'delivery_zone_layers'
      ];

      const tables: Record<string, any[]> = {};
      for (const t of tablesToExport) {
        try {
          tables[t] = await fetchAllRows(t);
        } catch {
          tables[t] = [];
        }
      }

      const urls: string[] = [];
      for (const it of tables.items || []) if (it?.image_url) urls.push(it.image_url);
      for (const cat of tables.categories || []) if (cat?.image_url) urls.push(cat.image_url);
      const logoSetting = (tables.settings || []).find((s: any) => s.key === 'logo_image_url');
      if (logoSetting?.value) urls.push(logoSetting.value);
      const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));

      const slotJson = {
        meta: { name: slotName.trim(), createdAt: new Date().toISOString(), version: 2 },
        tables,
        storageManifest: uniqueUrls.map((url) => {
          const parsed = parsePublicStorageUrl(url);
          return parsed
            ? { url, bucket: parsed.bucket, path: parsed.path }
            : { url };
        })
      };

      const jsonText = JSON.stringify(slotJson);
      const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
      await saveSlotBlob(slotName.trim(), blob);

      const nextMeta = [
        ...slotsList.filter((s) => s.name !== slotName.trim()),
        { name: slotName.trim(), updatedAt: Date.now() }
      ].sort((a, b) => b.updatedAt - a.updatedAt);

      persistSlotsMeta(nextMeta, slotName.trim());
      downloadBlob(blob, `slot-${slotName.trim()}.json`);
      showMessage('تم تصدير Slot بنجاح', 'success');
      setSlotName('');
    } catch (e: any) {
      console.error(e);
      showMessage('فشل تصدير Slot: ' + (e?.message || 'خطأ غير معروف'), 'error');
    } finally {
      setIsSlotBusy(false);
    }
  };

  const importSlotFile = async (file: File) => {
    setIsSlotBusy(true);
    try {
      const text = await file.text();
      const slotJson = JSON.parse(text);
      if (!slotJson || typeof slotJson !== 'object') throw new Error('ملف JSON غير صالح');
      if (!slotJson.tables && !slotJson.meta) throw new Error('ملف الحفظ لا يحتوي بيانات slot');

      const name = String(slotJson?.meta?.name || '').trim() || file.name.replace(/\.json$/i, '');
      if (!name) throw new Error('تعذر تحديد اسم الـ Slot');

      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      await saveSlotBlob(name, blob);

      const nextMeta = [...slotsList.filter((s) => s.name !== name), { name, updatedAt: Date.now() }].sort(
        (a, b) => b.updatedAt - a.updatedAt
      );

      persistSlotsMeta(nextMeta, name);
      showMessage('تم استيراد Slot بنجاح', 'success');
      if (slotFileInputRef.current) slotFileInputRef.current.value = '';
    } catch (e: any) {
      console.error(e);
      showMessage('فشل استيراد Slot: ' + (e?.message || 'خطأ غير معروف'), 'error');
    } finally {
      setIsSlotBusy(false);
    }
  };

  const performApplySlot = async (name: string) => {
    setIsSlotBusy(true);
    try {
      const blob = await getSlotBlob(name);
      if (!blob) throw new Error('ملف الـ Slot غير موجود محلياً');

      const slotJson = JSON.parse(await blob.text());
      const { error } = await supabase.rpc('restore_slot_unprotected', { payload: slotJson });
      if (error) throw error;

      persistSlotsMeta(slotsList, name);
      showMessage('تم تطبيق Slot بنجاح! سيتم إعادة تحميل الصفحة...', 'success');
      setTimeout(() => window.location.reload(), 1000);
    } catch (e: any) {
      console.error(e);
      showMessage('فشل تطبيق Slot: ' + (e?.message || 'خطأ غير معروف'), 'error');
    } finally {
      setIsSlotBusy(false);
    }
  };

  const performDeleteSlotArchive = async (name: string) => {
    try {
      await deleteSlotBlob(name);
      const next = slotsList.filter((s) => s.name !== name);
      const nextSelected = selectedSlotName === name ? '' : selectedSlotName;
      persistSlotsMeta(next, nextSelected);
      showMessage('تم حذف أرشيف Slot', 'success');
    } catch (e: any) {
      showMessage(e?.message || 'فشل حذف Slot', 'error');
    }
  };

  const handleExportExistingSlotFile = async (name: string) => {
    try {
      const blob = await getSlotBlob(name);
      if (!blob) throw new Error('ملف الـ Slot غير موجود محلياً');
      downloadBlob(blob, `slot-${name}.json`);
    } catch (e: any) {
      showMessage(e?.message || 'فشل تصدير الملف', 'error');
    }
  };

  const confirmSlotPasswordGate = async () => {
    if (!verifyCustomerDeletePwd(slotGatePassword)) {
      showMessage('كلمة المرور غير صحيحة', 'error');
      return;
    }
    const g = slotGate;
    setSlotGate(null);
    setSlotGatePassword('');
    if (!g) return;
    if (g.action === 'export') await performExportSlot();
    else if (g.action === 'apply' && g.name) await performApplySlot(g.name);
    else if (g.action === 'delete' && g.name) await performDeleteSlotArchive(g.name);
  };

  const handleUpdateInstantNumber = async () => {
    if (!instantNumber.trim()) {
      showMessage('الرجاء إدخال رقم صحيح', 'error');
      return;
    }

    await supabase
      .from('settings')
      .update({ value: instantNumber, updated_at: new Date().toISOString() })
      .eq('key', 'instant_transfer_number');

    showMessage('تم تحديث رقم التحويل الفوري بنجاح', 'success');
  };

  const handleToggleDebugMap = async (enabled: boolean) => {
    try {
      const { data: existing } = await supabase
        .from('settings')
        .select('key')
        .eq('key', 'show_debug_map')
        .maybeSingle();

      if (existing) {
        await supabase
          .from('settings')
          .update({ value: enabled.toString(), updated_at: new Date().toISOString() })
          .eq('key', 'show_debug_map');
      } else {
        await supabase
          .from('settings')
          .insert({ key: 'show_debug_map', value: enabled.toString() });
      }

      setShowDebugMap(enabled);
      showMessage(enabled ? 'تم تفعيل وضع المعاينة للعملاء' : 'تم تعطيل وضع المعاينة للعملاء', 'success');
    } catch (error) {
      console.error('Error updating debug map setting:', error);
      showMessage('حدث خطأ أثناء تحديث إعدادات الخريطة', 'error');
    }
  };

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      showMessage('الرجاء ملء جميع الحقول', 'error');
      return;
    }

    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'admin_password')
      .maybeSingle();

    if (data?.value !== oldPassword) {
      showMessage('كلمة المرور القديمة غير صحيحة', 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      showMessage('كلمة المرور الجديدة غير متطابقة', 'error');
      return;
    }

    if (newPassword.length < 8) {
      showMessage('كلمة المرور يجب أن تكون 8 أحرف على الأقل', 'error');
      return;
    }

    await supabase
      .from('settings')
      .update({ value: newPassword, updated_at: new Date().toISOString() })
      .eq('key', 'admin_password');

    showMessage('تم تغيير كلمة المرور بنجاح', 'success');
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleChangeCheatCode = async () => {
    if (!oldCheatCode || !newCheatCode || !confirmCheatCode) {
      showMessage('الرجاء ملء جميع الحقول', 'error');
      return;
    }

    if (oldCheatCode !== currentCheatCode) {
      showMessage('الشفرة القديمة غير صحيحة', 'error');
      return;
    }

    if (newCheatCode !== confirmCheatCode) {
      showMessage('الشفرة الجديدة غير متطابقة', 'error');
      return;
    }

    if (newCheatCode.length < 5) {
      showMessage('الشفرة يجب أن تكون 5 أحرف على الأقل', 'error');
      return;
    }

    await supabase
      .from('settings')
      .update({ value: newCheatCode, updated_at: new Date().toISOString() })
      .eq('key', 'cheat_code');

    showMessage('تم تغيير الشفرة السرية بنجاح', 'success');
    setOldCheatCode('');
    setNewCheatCode('');
    setConfirmCheatCode('');
    setCurrentCheatCode(newCheatCode);
  };

  const handleUpdateCouponSettings = async () => {
    const trimmedCode = couponSecretCode.trim();
    if (!trimmedCode) {
      showMessage('الرجاء إدخال الشفرة السرية للكوبون', 'error');
      return;
    }

    if (!couponDiscountPercent || couponDiscountPercent <= 0 || couponDiscountPercent > 100) {
      showMessage('نسبة الخصم يجب أن تكون بين 1 و 100', 'error');
      return;
    }

    try {
      const updates = [
        {
          key: 'coupon_secret_code',
          value: trimmedCode,
          updated_at: new Date().toISOString()
        },
        {
          key: 'coupon_discount_percent',
          value: couponDiscountPercent.toString(),
          updated_at: new Date().toISOString()
        }
      ];

      const { error } = await supabase
        .from('settings')
        .upsert(updates, { onConflict: 'key' });

      if (error) throw error;

      const { data: existingTemplate, error: templateError } = await supabase
        .from('device_coupons')
        .select('id')
        .eq('device_fingerprint', GLOBAL_COUPON_FINGERPRINT)
        .eq('code', trimmedCode)
        .maybeSingle();

      if (templateError) throw templateError;

      if (existingTemplate) {
        const { error: updateTemplateError } = await supabase
          .from('device_coupons')
          .update({
            discount_percent: couponDiscountPercent,
            is_disabled: false
          })
          .eq('id', existingTemplate.id);

        if (updateTemplateError) throw updateTemplateError;
      } else {
        const { error: insertTemplateError } = await supabase
          .from('device_coupons')
          .insert([
            {
              device_fingerprint: GLOBAL_COUPON_FINGERPRINT,
              code: trimmedCode,
              discount_percent: couponDiscountPercent,
              is_used: false,
              is_disabled: false
            }
          ]);

        if (insertTemplateError) throw insertTemplateError;
      }

      await fetchDeviceCoupons();
      showMessage('تم تحديث إعدادات الكوبونات السرية بنجاح', 'success');
    } catch (error) {
      console.error('Error updating coupon settings:', error);
      showMessage('حدث خطأ أثناء حفظ إعدادات الكوبونات', 'error');
    }
  };

  const handleUpdateSingleCoupon = async (coupon: DeviceCoupon, changes: Partial<DeviceCoupon>) => {
    try {
      const { error } = await supabase
        .from('device_coupons')
        .update(changes)
        .eq('id', coupon.id);

      if (error) throw error;

      // إذا تم تعطيل/تفعيل كوبون أساسي، طبّق نفس الحالة على كل الكوبونات بنفس الكود
      if (coupon.device_fingerprint === GLOBAL_COUPON_FINGERPRINT && typeof changes.is_disabled === 'boolean') {
        const { error: propagateError } = await supabase
          .from('device_coupons')
          .update({ is_disabled: changes.is_disabled })
          .eq('code', coupon.code);

        if (propagateError) {
          console.error('Error propagating coupon disable state:', propagateError);
        }
      }

      showMessage('تم تحديث بيانات الكوبون', 'success');
      await fetchDeviceCoupons();
    } catch (error) {
      console.error('Error updating coupon:', error);
      showMessage('حدث خطأ أثناء تحديث الكوبون', 'error');
    }
  };

  const handleSaveZoneFromMap = async (zoneData: {
    name: string;
    polygon_points: PolygonPoint[];
    is_active: boolean;
    base_delivery_price?: number;
    branch_location?: PolygonPoint | null;
  }) => {
    if (zoneCreateInFlightRef.current) return;
    zoneCreateInFlightRef.current = true;
    setLoadingZones(true);
    try {
      // Validate polygon_points
      if (!zoneData.polygon_points || zoneData.polygon_points.length < 3) {
        throw new Error('يجب أن يحتوي الزون على 3 نقاط على الأقل');
      }

      // Ensure polygon_points is properly formatted for JSONB
      const polygonData = zoneData.polygon_points.map(p => ({
        lat: Number(p.lat),
        lng: Number(p.lng)
      }));

      // Calculate min/max from polygon_points for backward compatibility
      const bounds = polygonData.reduce(
        (acc, point) => {
          acc.minLat = Math.min(acc.minLat, point.lat);
          acc.maxLat = Math.max(acc.maxLat, point.lat);
          acc.minLng = Math.min(acc.minLng, point.lng);
          acc.maxLng = Math.max(acc.maxLng, point.lng);
          return acc;
        },
        {
          minLat: polygonData[0].lat,
          maxLat: polygonData[0].lat,
          minLng: polygonData[0].lng,
          maxLng: polygonData[0].lng
        }
      );

      const { error, data } = await supabase
        .from('delivery_zones')
        .insert([
          {
            name: zoneData.name.trim(),
            polygon_points: polygonData, // Supabase will automatically convert to JSONB
            min_lat: bounds.minLat,
            max_lat: bounds.maxLat,
            min_lng: bounds.minLng,
            max_lng: bounds.maxLng,
            is_active: zoneData.is_active,
            base_delivery_price: zoneData.base_delivery_price ?? 0
          }
        ])
        .select();

      if (error) {
        console.error('Supabase insert error:', error);
        throw new Error(error.message || 'حدث خطأ أثناء حفظ الزون في قاعدة البيانات');
      }

      showMessage('تم إنشاء الزون بنجاح', 'success');
      await fetchDeliveryZones();
    } catch (error: any) {
      console.error('Error creating zone:', error);
      const errorMessage = error?.message || 'حدث خطأ أثناء إنشاء الزون';
      showMessage(errorMessage, 'error');
      throw error;
    } finally {
      zoneCreateInFlightRef.current = false;
      setLoadingZones(false);
    }
  };

  const handleUpdateZone = async (zoneId: string, updates: Partial<DeliveryZone>) => {
    setLoadingZones(true);
    try {
      // If updating polygon_points, validate and format them
      if (updates.polygon_points) {
        if (!Array.isArray(updates.polygon_points) || updates.polygon_points.length < 3) {
          throw new Error('يجب أن يحتوي الزون على 3 نقاط على الأقل');
        }

        const formattedPoints = updates.polygon_points.map(p => ({
          lat: Number(p.lat),
          lng: Number(p.lng)
        }));

        // Validate all points are valid numbers
        if (formattedPoints.some(p => isNaN(p.lat) || isNaN(p.lng))) {
          throw new Error('يجب أن تكون جميع الإحداثيات أرقام صحيحة');
        }

        // Calculate min/max from polygon_points for backward compatibility
        const bounds = formattedPoints.reduce(
          (acc, point) => {
            acc.minLat = Math.min(acc.minLat, point.lat);
            acc.maxLat = Math.max(acc.maxLat, point.lat);
            acc.minLng = Math.min(acc.minLng, point.lng);
            acc.maxLng = Math.max(acc.maxLng, point.lng);
            return acc;
          },
          {
            minLat: formattedPoints[0].lat,
            maxLat: formattedPoints[0].lat,
            minLng: formattedPoints[0].lng,
            maxLng: formattedPoints[0].lng
          }
        );

        updates.polygon_points = formattedPoints as any;
        updates.min_lat = bounds.minLat;
        updates.max_lat = bounds.maxLat;
        updates.min_lng = bounds.minLng;
        updates.max_lng = bounds.maxLng;
      }

      // Strip branch_location from DB payload (stored in localStorage instead)
      const { branch_location: _bl, ...dbUpdates } = updates as any;

      const { error } = await supabase
        .from('delivery_zones')
        .update(dbUpdates)
        .eq('id', zoneId);

      if (error) {
        console.error('Supabase update error:', error);
        throw new Error(error.message || 'حدث خطأ أثناء تحديث الزون في قاعدة البيانات');
      }

      showMessage('تم تحديث الزون بنجاح', 'success');
      await fetchDeliveryZones();
    } catch (error: any) {
      console.error('Error updating zone:', error);
      const errorMessage = error?.message || 'حدث خطأ أثناء تحديث الزون';
      showMessage(errorMessage, 'error');
      throw error;
    } finally {
      setLoadingZones(false);
    }
  };

  const handleCreateZoneLayer = async (
    zoneId: string,
    layerData: {
      polygon_points: PolygonPoint[];
      delivery_price: number;
      name?: string | null;
      order_index?: number;
    }
  ) => {
    setLoadingZones(true);
    try {
      if (!layerData.polygon_points || layerData.polygon_points.length < 3) {
        throw new Error('يجب أن تحتوي طبقة خدمة التوصيل على 3 نقاط على الأقل');
      }

      const polygonData = layerData.polygon_points.map(p => ({
        lat: Number(p.lat),
        lng: Number(p.lng)
      }));

      const sanitizedPrice = Number(layerData.delivery_price || 0);

      const { error } = await supabase
        .from('delivery_zone_layers')
        .insert([
          {
            zone_id: zoneId,
            name: layerData.name ?? null,
            order_index: layerData.order_index ?? 1,
            polygon_points: polygonData,
            delivery_price: sanitizedPrice
          }
        ]);

      if (error) {
        console.error('Supabase insert error (layer):', error);
        throw new Error(error.message || 'حدث خطأ أثناء حفظ طبقة خدمة التوصيل');
      }

      showMessage('تم إنشاء طبقة خدمة التوصيل بنجاح', 'success');
      await fetchDeliveryZones();
    } catch (error: any) {
      console.error('Error creating delivery zone layer:', error);
      const errorMessage = error?.message || 'حدث خطأ أثناء إنشاء طبقة خدمة التوصيل';
      showMessage(errorMessage, 'error');
      throw error;
    } finally {
      setLoadingZones(false);
    }
  };

  const handleUpdateZoneLayer = async (
    layerId: string,
    updates: Partial<DeliveryZoneLayer> & { polygon_points?: PolygonPoint[] }
  ) => {
    setLoadingZones(true);
    try {
      const payload: any = { ...updates };

      if (updates.polygon_points) {
        if (!Array.isArray(updates.polygon_points) || updates.polygon_points.length < 3) {
          throw new Error('يجب أن تحتوي طبقة خدمة التوصيل على 3 نقاط على الأقل');
        }

        const formattedPoints = updates.polygon_points.map(p => ({
          lat: Number(p.lat),
          lng: Number(p.lng)
        }));

        if (formattedPoints.some(p => isNaN(p.lat) || isNaN(p.lng))) {
          throw new Error('يجب أن تكون جميع إحداثيات طبقة التوصيل أرقام صحيحة');
        }

        payload.polygon_points = formattedPoints;
      }

      if (payload.delivery_price !== undefined) {
        payload.delivery_price = Number(payload.delivery_price || 0);
      }

      const { error } = await supabase
        .from('delivery_zone_layers')
        .update(payload)
        .eq('id', layerId);

      if (error) {
        console.error('Supabase update error (layer):', error);
        throw new Error(error.message || 'حدث خطأ أثناء تحديث طبقة خدمة التوصيل');
      }

      showMessage('تم تحديث طبقة خدمة التوصيل بنجاح', 'success');
      await fetchDeliveryZones();
    } catch (error: any) {
      console.error('Error updating delivery zone layer:', error);
      const errorMessage = error?.message || 'حدث خطأ أثناء تحديث طبقة خدمة التوصيل';
      showMessage(errorMessage, 'error');
      throw error;
    } finally {
      setLoadingZones(false);
    }
  };

  const handleDeleteZoneLayer = async (layerId: string) => {
    setLoadingZones(true);
    try {
      const { error } = await supabase
        .from('delivery_zone_layers')
        .delete()
        .eq('id', layerId);

      if (error) {
        console.error('Supabase delete error (layer):', error);
        throw new Error(error.message || 'حدث خطأ أثناء حذف طبقة خدمة التوصيل');
      }

      showMessage('تم حذف طبقة خدمة التوصيل', 'success');
      await fetchDeliveryZones();
    } catch (error: any) {
      console.error('Error deleting delivery zone layer:', error);
      const errorMessage = error?.message || 'حدث خطأ أثناء حذف طبقة خدمة التوصيل';
      showMessage(errorMessage, 'error');
      throw error;
    } finally {
      setLoadingZones(false);
    }
  };

  const handleCreateDeliveryService = async (serviceData: {
    name: string;
    branch_location: PolygonPoint | null;
    is_active: boolean;
    initialLayer?: {
      polygon_points: PolygonPoint[];
      delivery_price: number;
    };
    initialLayers?: {
      polygon_points: PolygonPoint[];
      delivery_price: number;
      name?: string | null;
      order_index?: number;
    }[];
  }) => {
    if (serviceCreateInFlightRef.current) return;
    serviceCreateInFlightRef.current = true;
    setLoadingServices(true);
    try {
      if (!serviceData.name.trim()) {
        throw new Error('يجب إدخال اسم خدمة التوصيل');
      }

      const payload: any = {
        name: serviceData.name.trim(),
        is_active: serviceData.is_active
      };

      let branchLocation = serviceData.branch_location;
      const layersToCreate = [];
      if (serviceData.initialLayers && serviceData.initialLayers.length > 0) {
        layersToCreate.push(...serviceData.initialLayers.filter(l => l.polygon_points.length >= 3));
      } else if (serviceData.initialLayer && serviceData.initialLayer.polygon_points.length >= 3) {
        layersToCreate.push(serviceData.initialLayer);
      }

      if (!branchLocation && layersToCreate.length > 0) {
        const pts = layersToCreate[0].polygon_points;
        if (pts.length >= 3) {
          branchLocation = getPolygonCenter(pts);
        }
      }

      if (!branchLocation) {
        throw new Error('يجب تحديد موقع الفرع (دبوس المركز) أو رسم طبقة تحتوي على 3 نقاط على الأقل');
      }

      payload.branch_location = {
        lat: Number(branchLocation.lat),
        lng: Number(branchLocation.lng)
      };

      const { data: created, error } = await supabase
        .from('delivery_services')
        .insert([payload])
        .select('id')
        .single();

      if (error || !created) {
        console.error('Supabase insert error (delivery_service):', error);
        throw new Error(error?.message || 'حدث خطأ أثناء حفظ خدمة التوصيل');
      }

      if (layersToCreate.length > 0) {
        const layersPayload = layersToCreate.map((layer: any, idx: number) => ({
          service_id: created.id,
          zone_id: null,
          name: layer.name ?? null,
          order_index: layer.order_index ?? (idx + 1),
          polygon_points: layer.polygon_points.map((p: any) => ({
            lat: Number(p.lat),
            lng: Number(p.lng)
          })),
          delivery_price: Number(layer.delivery_price || 0)
        }));

        const { error: layerError } = await supabase
          .from('delivery_zone_layers')
          .insert(layersPayload);

        if (layerError) {
          console.error('Supabase insert error (initial service layers):', layerError);
          throw new Error(layerError.message || 'تم إنشاء خدمة التوصيل لكن حدث خطأ أثناء حفظ طبقات التسعير');
        }
      }

      showMessage('تم إنشاء خدمة التوصيل بنجاح', 'success');
      await fetchDeliveryServices();
    } catch (error: any) {
      console.error('Error creating delivery service:', error);
      const errorMessage = error?.message || 'حدث خطأ أثناء إنشاء خدمة التوصيل';
      showMessage(errorMessage, 'error');
      throw error;
    } finally {
      serviceCreateInFlightRef.current = false;
      setLoadingServices(false);
    }
  };

  const handleUpdateDeliveryService = async (
    serviceId: string,
    updates: Partial<DeliveryService> & { branch_location?: PolygonPoint | null }
  ) => {
    setLoadingServices(true);
    try {
      const payload: any = { ...updates };

      if (updates.branch_location !== undefined) {
        payload.branch_location = updates.branch_location
          ? {
            lat: Number(updates.branch_location.lat),
            lng: Number(updates.branch_location.lng)
          }
          : null;
      }

      if (payload.name) {
        payload.name = String(payload.name).trim();
      }

      const { error } = await supabase
        .from('delivery_services')
        .update(payload)
        .eq('id', serviceId);

      if (error) {
        console.error('Supabase update error (delivery_service):', error);
        throw new Error(error.message || 'حدث خطأ أثناء تحديث خدمة التوصيل');
      }

      showMessage('تم تحديث خدمة التوصيل بنجاح', 'success');
      await fetchDeliveryServices();
    } catch (error: any) {
      console.error('Error updating delivery service:', error);
      const errorMessage = error?.message || 'حدث خطأ أثناء تحديث خدمة التوصيل';
      showMessage(errorMessage, 'error');
      throw error;
    } finally {
      setLoadingServices(false);
    }
  };

  const handleDeleteDeliveryService = async (serviceId: string) => {
    if (!window.confirm('هل أنت متأكد من حذف خدمة التوصيل هذه؟ سيتم حذف طبقاتها أيضاً.')) return;

    setLoadingServices(true);
    try {
      const { error } = await supabase
        .from('delivery_services')
        .delete()
        .eq('id', serviceId);

      if (error) {
        console.error('Supabase delete error (delivery_service):', error);
        throw new Error(error.message || 'حدث خطأ أثناء حذف خدمة التوصيل');
      }

      showMessage('تم حذف خدمة التوصيل', 'success');
      await fetchDeliveryServices();
    } catch (error: any) {
      console.error('Error deleting delivery service:', error);
      const errorMessage = error?.message || 'حدث خطأ أثناء حذف خدمة التوصيل';
      showMessage(errorMessage, 'error');
      throw error;
    } finally {
      setLoadingServices(false);
    }
  };

  const handleCreateServiceLayer = async (
    serviceId: string,
    layerData: {
      polygon_points: PolygonPoint[];
      delivery_price: number;
      name?: string | null;
      order_index?: number;
    }
  ) => {
    setLoadingServices(true);
    try {
      if (!layerData.polygon_points || layerData.polygon_points.length < 3) {
        throw new Error('يجب أن تحتوي طبقة خدمة التوصيل على 3 نقاط على الأقل');
      }

      const polygonData = layerData.polygon_points.map(p => ({
        lat: Number(p.lat),
        lng: Number(p.lng)
      }));

      const sanitizedPrice = Number(layerData.delivery_price || 0);

      const { error } = await supabase
        .from('delivery_zone_layers')
        .insert([
          {
            service_id: serviceId,
            zone_id: null,
            name: layerData.name ?? null,
            order_index: layerData.order_index ?? 1,
            polygon_points: polygonData,
            delivery_price: sanitizedPrice
          }
        ]);

      if (error) {
        console.error('Supabase insert error (service layer):', error);
        throw new Error(error.message || 'حدث خطأ أثناء حفظ طبقة خدمة التوصيل');
      }

      showMessage('تم إنشاء طبقة خدمة التوصيل بنجاح', 'success');
      await fetchDeliveryServices();
    } catch (error: any) {
      console.error('Error creating delivery service layer:', error);
      const errorMessage = error?.message || 'حدث خطأ أثناء إنشاء طبقة خدمة التوصيل';
      showMessage(errorMessage, 'error');
      throw error;
    } finally {
      setLoadingServices(false);
    }
  };

  const handleUpdateServiceLayer = async (
    layerId: string,
    updates: Partial<DeliveryZoneLayer> & { polygon_points?: PolygonPoint[] }
  ) => {
    setLoadingServices(true);
    try {
      const payload: any = { ...updates };

      if (updates.polygon_points) {
        if (!Array.isArray(updates.polygon_points) || updates.polygon_points.length < 3) {
          throw new Error('يجب أن تحتوي طبقة خدمة التوصيل على 3 نقاط على الأقل');
        }

        const formattedPoints = updates.polygon_points.map(p => ({
          lat: Number(p.lat),
          lng: Number(p.lng)
        }));

        if (formattedPoints.some(p => isNaN(p.lat) || isNaN(p.lng))) {
          throw new Error('يجب أن تكون جميع إحداثيات طبقة التوصيل أرقام صحيحة');
        }

        payload.polygon_points = formattedPoints;
      }

      if (payload.delivery_price !== undefined) {
        payload.delivery_price = Number(payload.delivery_price || 0);
      }

      const { error } = await supabase
        .from('delivery_zone_layers')
        .update(payload)
        .eq('id', layerId);

      if (error) {
        console.error('Supabase update error (service layer):', error);
        throw new Error(error.message || 'حدث خطأ أثناء تحديث طبقة خدمة التوصيل');
      }

      showMessage('تم تحديث طبقة خدمة التوصيل بنجاح', 'success');
      await fetchDeliveryServices();
    } catch (error: any) {
      console.error('Error updating delivery service layer:', error);
      const errorMessage = error?.message || 'حدث خطأ أثناء تحديث طبقة خدمة التوصيل';
      showMessage(errorMessage, 'error');
      throw error;
    } finally {
      setLoadingServices(false);
    }
  };

  const handleDeleteServiceLayer = async (layerId: string) => {
    setLoadingServices(true);
    try {
      const { error } = await supabase
        .from('delivery_zone_layers')
        .delete()
        .eq('id', layerId);

      if (error) {
        console.error('Supabase delete error (service layer):', error);
        throw new Error(error.message || 'حدث خطأ أثناء حذف طبقة خدمة التوصيل');
      }

      showMessage('تم حذف طبقة خدمة التوصيل', 'success');
      await fetchDeliveryServices();
    } catch (error: any) {
      console.error('Error deleting delivery service layer:', error);
      const errorMessage = error?.message || 'حدث خطأ أثناء حذف طبقة خدمة التوصيل';
      showMessage(errorMessage, 'error');
      throw error;
    } finally {
      setLoadingServices(false);
    }
  };

  const handleToggleZone = async (zone: DeliveryZone) => {
    try {
      const { error } = await supabase
        .from('delivery_zones')
        .update({ is_active: !zone.is_active })
        .eq('id', zone.id);

      if (error) throw error;

      showMessage('تم تحديث حالة الزون', 'success');
      await fetchDeliveryZones();
    } catch (error) {
      console.error('Error updating delivery zone:', error);
      showMessage('حدث خطأ أثناء تحديث حالة الزون', 'error');
    }
  };

  const handleDeleteZone = async (zoneId: string) => {
    try {
      const { error } = await supabase
        .from('delivery_zones')
        .delete()
        .eq('id', zoneId);

      if (error) throw error;

      showMessage('تم حذف الزون بنجاح', 'success');
      await fetchDeliveryZones();
    } catch (error) {
      console.error('Error deleting zone:', error);
      showMessage('حدث خطأ أثناء حذف الزون', 'error');
      throw error;
    }
  };

  const handleDeleteCoupon = async (coupon: DeviceCoupon) => {
    const isTemplate = coupon.device_fingerprint === GLOBAL_COUPON_FINGERPRINT;
    const confirmMsg = isTemplate
      ? `حذف القالب "${coupon.code}" سيحذف نهائياً من قاعدة البيانات كل نسخ هذا الكوبون لدى جميع العملاء. متابعة؟`
      : `هل أنت متأكد من حذف هذا الكوبون (${coupon.code})؟`;
    if (!window.confirm(confirmMsg)) return;

    try {
      if (isTemplate) {
        const { error: delAll } = await supabase
          .from('device_coupons')
          .delete()
          .eq('code', coupon.code);
        if (delAll) throw delAll;

        const { data: secretRow } = await supabase
          .from('settings')
          .select('value')
          .eq('key', 'coupon_secret_code')
          .maybeSingle();
        if (secretRow?.value?.trim() === coupon.code) {
          await supabase
            .from('settings')
            .upsert(
              { key: 'coupon_secret_code', value: '', updated_at: new Date().toISOString() },
              { onConflict: 'key' }
            );
          setCouponSecretCode('');
        }

        if (couponRecipientsOpen && couponRecipientsCode === coupon.code) {
          setCouponRecipientsOpen(false);
          setCouponRecipientsCode(null);
        }
        showMessage('تم حذف الكوبون وجميع نسخ العملاء من قاعدة البيانات', 'success');
      } else {
        const { error } = await supabase.from('device_coupons').delete().eq('id', coupon.id);
        if (error) throw error;
        showMessage('تم حذف الكوبون بنجاح', 'success');
      }
      await fetchDeviceCoupons();
    } catch (error) {
      console.error('Error deleting coupon:', error);
      showMessage('حدث خطأ أثناء حذف الكوبون', 'error');
    }
  };

  const openCouponRecipients = async (code: string) => {
    setCouponRecipientsCode(code);
    setCouponRecipientsOpen(true);
    setLoadingRecipients(true);
    setCouponRecipientsRows([]);
    try {
      const { data, error } = await supabase
        .from('device_coupons')
        .select('*')
        .eq('code', code)
        .neq('device_fingerprint', GLOBAL_COUPON_FINGERPRINT)
        .order('created_at', { ascending: false });
      if (error) throw error;
      let rows = data || [];

      const cids = [...new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[])];
      const byId: Record<string, { name: string; phone: string }> = {};
      if (cids.length > 0) {
        const { data: idRows, error: idErr } = await supabase
          .from('customers')
          .select('id, name, phone')
          .in('id', cids);
        if (!idErr && idRows) {
          for (const c of idRows) {
            byId[c.id] = { name: c.name, phone: c.phone };
          }
        }
      }

      const fps = [...new Set(rows.map((r) => r.device_fingerprint).filter(Boolean))];
      const byFp: Record<string, { name: string; phone: string }> = {};
      if (fps.length > 0) {
        const { data: custRows, error: custErr } = await supabase
          .from('customers')
          .select('device_fingerprint, name, phone')
          .in('device_fingerprint', fps);
        if (!custErr && custRows) {
          for (const c of custRows) {
            const fp = c.device_fingerprint;
            if (fp && !byFp[fp]) {
              byFp[fp] = { name: c.name, phone: c.phone };
            }
          }
        }
      }

      const normalizePhone = (p?: string | null) => (p || '').replace(/\D/g, '').replace(/^0+/, '');
      const phoneCandidates = new Set<string>();
      for (const r of rows) {
        const raw = (r.customer_phone || '').trim();
        if (!raw) continue;
        const norm = normalizePhone(raw);
        if (!norm) continue;
        phoneCandidates.add(raw);
        phoneCandidates.add(norm);
        phoneCandidates.add(`0${norm}`);
      }
      const byPhone: Record<string, { name: string; phone: string }> = {};
      if (phoneCandidates.size > 0) {
        const { data: byPhoneRows, error: byPhoneErr } = await supabase
          .from('customers')
          .select('name, phone')
          .in('phone', Array.from(phoneCandidates));
        if (!byPhoneErr && byPhoneRows) {
          for (const c of byPhoneRows) {
            const key = normalizePhone((c as any).phone);
            if (key && !byPhone[key]) {
              byPhone[key] = { name: (c as any).name, phone: (c as any).phone };
            }
          }
        }
      }

      rows = rows.map((r) => {
        const fromId = r.customer_id ? byId[r.customer_id] : undefined;
        const fromFp = r.device_fingerprint ? byFp[r.device_fingerprint] : undefined;
        const fromPhone = byPhone[normalizePhone((r as any).customer_phone)];
        return {
          ...r,
          // Always prefer latest customer table data when available
          customer_name: fromId?.name || fromPhone?.name || r.customer_name || fromFp?.name || r.customer_name,
          customer_phone: fromId?.phone || fromPhone?.phone || r.customer_phone || fromFp?.phone || r.customer_phone
        };
      });
      const dedup = new Map<string, DeviceCoupon>();
      for (const r of rows) {
        const k =
          (r.customer_id && `cid:${r.customer_id}`) ||
          (normalizePhone((r as any).customer_phone) && `ph:${normalizePhone((r as any).customer_phone)}`) ||
          `fp:${r.device_fingerprint}`;
        if (!dedup.has(k)) {
          dedup.set(k, r as DeviceCoupon);
          continue;
        }
        const prev = dedup.get(k)!;
        const prevTs = new Date((prev as any).created_at || 0).getTime();
        const curTs = new Date((r as any).created_at || 0).getTime();
        // Keep the latest row for that customer in UI list
        if (curTs > prevTs) dedup.set(k, r as DeviceCoupon);
      }

      setCouponRecipientsRows(Array.from(dedup.values()).sort((a, b) => new Date((b as any).created_at).getTime() - new Date((a as any).created_at).getTime()));
    } catch (e) {
      console.error(e);
      showMessage('تعذر تحميل قائمة المستفيدين', 'error');
    } finally {
      setLoadingRecipients(false);
    }
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        showMessage('الرجاء اختيار ملف صورة صحيح', 'error');
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        showMessage('حجم الصورة يجب أن يكون أقل من 2 ميجابايت', 'error');
        return;
      }

      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview(logoImageUrl || null);
    if (logoFileInputRef.current) {
      logoFileInputRef.current.value = '';
    }
  };

  const uploadLogoImage = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `logo_${Date.now()}.${fileExt}`;
    const filePath = `logo/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('item-images')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage
      .from('item-images')
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  const handleSaveLogo = async () => {
    setIsUploadingLogo(true);
    let imageUrl = logoImageUrl;

    try {
      if (logoFile) {
        imageUrl = await uploadLogoImage(logoFile);
      }

      const { error } = await supabase
        .from('settings')
        .upsert({
          key: 'logo_image_url',
          value: imageUrl,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'key'
        });

      if (error) throw error;

      setLogoImageUrl(imageUrl);
      setLogoFile(null);
      setShowLogoUpload(false);
      showMessage('تم حفظ صورة الشعار بنجاح!', 'success');

      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Error saving logo:', error);
      showMessage('حدث خطأ أثناء رفع صورة الشعار', 'error');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleEndOfDay = async () => {
    setIsArchiving(true);

    try {
      const archiveBatchAt = new Date().toISOString();
      // First, check if there are any active orders (not completed or cancelled)
      const { data: activeOrders, error: activeOrdersError } = await supabase
        .from('orders')
        .select('id, order_number, status')
        .not('status', 'in', '(completed,cancelled)');

      if (activeOrdersError) {
        console.error('Error checking active orders:', activeOrdersError);
        throw activeOrdersError;
      }

      if (activeOrders && activeOrders.length > 0) {
        const activeOrdersList = activeOrders.map(o => `${o.order_number} (${o.status})`).join('\n');
        showMessage(
          `لا يمكن إنهاء اليوم!\n\nيوجد ${activeOrders.length} طلب نشط:\n${activeOrdersList}\n\nالرجاء إكمال أو إلغاء جميع الطلبات النشطة أولاً.`,
          'error'
        );
        setIsArchiving(false);
        setShowArchiveModal(false);
        return;
      }

      // Get all completed and cancelled orders
      const { data: ordersToArchive, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .in('status', ['completed', 'cancelled']);

      if (ordersError) {
        console.error('Error fetching orders to archive:', ordersError);
        throw ordersError;
      }

      if (!ordersToArchive || ordersToArchive.length === 0) {
        showMessage('لا توجد طلبات لنقلها إلى الأرشيف', 'error');
        setIsArchiving(false);
        setShowArchiveModal(false);
        return;
      }

      console.log(`Found ${ordersToArchive.length} orders to archive`);

      // Archive each order
      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const order of ordersToArchive) {
        try {
          console.log(`Archiving order ${order.order_number}...`);

          // Use the customer snapshot already saved on the order itself.
          // Fallback to current customer profile only if old records are missing snapshot fields.
          let customerData = {
            customer_name: (order as any).customer_name || '',
            customer_phone: (order as any).customer_phone || '',
            customer_secondary_phone: (order as any).customer_secondary_phone || '',
            customer_street: (order as any).customer_street || '',
            customer_area: (order as any).customer_area || '',
            customer_city: (order as any).customer_city || '',
            customer_address_type: (order as any).customer_address_type || '',
            customer_address_label: (order as any).customer_address_label || '',
            customer_apartment: (order as any).customer_apartment || '',
            customer_floor: (order as any).customer_floor || '',
            customer_building_number: (order as any).customer_building_number || '',
            customer_house_name: (order as any).customer_house_name || '',
            customer_company_name: (order as any).customer_company_name || '',
            customer_landmark: (order as any).customer_landmark || ''
          };

          let customerLatitude: number | null = (order as any).customer_latitude || null;
          let customerLongitude: number | null = (order as any).customer_longitude || null;

          if ((!customerData.customer_name || !customerData.customer_phone || !customerData.customer_street) && order.customer_id) {
            const { data: customer } = await supabase
              .from('customers')
              .select('name, phone, secondary_phone, street, area, city, address_type, address_label, apartment, floor, building_number, house_name, company_name, landmark, latitude, longitude')
              .eq('id', order.customer_id)
              .maybeSingle();

            if (customer) {
              customerData = {
                customer_name: customerData.customer_name || customer.name || '',
                customer_phone: customerData.customer_phone || customer.phone || '',
                customer_secondary_phone: customerData.customer_secondary_phone || (customer as any).secondary_phone || '',
                customer_street: customerData.customer_street || customer.street || '',
                customer_area: customerData.customer_area || customer.area || '',
                customer_city: customerData.customer_city || customer.city || '',
                customer_address_type: customerData.customer_address_type || (customer as any).address_type || '',
                customer_address_label: customerData.customer_address_label || (customer as any).address_label || '',
                customer_apartment: customerData.customer_apartment || (customer as any).apartment || '',
                customer_floor: customerData.customer_floor || (customer as any).floor || '',
                customer_building_number: customerData.customer_building_number || (customer as any).building_number || '',
                customer_house_name: customerData.customer_house_name || (customer as any).house_name || '',
                customer_company_name: customerData.customer_company_name || (customer as any).company_name || '',
                customer_landmark: customerData.customer_landmark || (customer as any).landmark || ''
              };
              customerLatitude = customerLatitude ?? customer.latitude ?? null;
              customerLongitude = customerLongitude ?? customer.longitude ?? null;
            }
          }

          // Create archive order data
          const archiveOrderData: any = {
            original_order_id: order.id,
            customer_id: order.customer_id,
            order_number: order.order_number,
            status: order.status,
            payment_method: order.payment_method,
            total_amount: order.total_amount,
            cancellation_reason: order.cancellation_reason || '',
            cancelled_by: order.cancelled_by || '',
            cancellation_stage: order.cancellation_stage || '',
            original_created_at: order.created_at,
            original_updated_at: order.updated_at,
            customer_name: customerData.customer_name,
            customer_phone: customerData.customer_phone,
            customer_street: customerData.customer_street,
            customer_area: customerData.customer_area,
            customer_city: customerData.customer_city,
            customer_latitude: customerLatitude,
            customer_longitude: customerLongitude,
            archived_at: archiveBatchAt
          };

          // Add order_note if it exists
          if (order.order_note !== undefined && order.order_note !== null) {
            archiveOrderData.order_note = order.order_note;
          } else {
            archiveOrderData.order_note = '';
          }

          // Create archive order
          const { data: archiveOrder, error: archiveError } = await supabase
            .from('archive_orders')
            .insert([archiveOrderData])
            .select()
            .single();

          if (archiveError) {
            console.error(`Error archiving order ${order.order_number}:`, archiveError);
            errors.push(`خطأ في أرشفة الطلب ${order.order_number}: ${archiveError.message}`);
            errorCount++;
            continue;
          }

          if (!archiveOrder) {
            console.error(`Failed to create archive order for ${order.order_number}`);
            errors.push(`فشل في إنشاء سجل الأرشيف للطلب ${order.order_number}`);
            errorCount++;
            continue;
          }

          console.log(`Archive order created: ${archiveOrder.id}`);

          // Archive order items
          const { data: orderItems, error: itemsError } = await supabase
            .from('order_items')
            .select('*')
            .eq('order_id', order.id);

          if (itemsError) {
            console.error(`Error fetching items for order ${order.order_number}:`, itemsError);
            errors.push(`خطأ في جلب أصناف الطلب ${order.order_number}`);
          } else if (orderItems && orderItems.length > 0) {
            const archiveItems = orderItems.map(item => ({
              archive_order_id: archiveOrder.id,
              item_id: item.item_id,
              item_name: item.item_name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              subtotal: item.subtotal,
              rate_discount_percent: item.rate_discount_percent ?? null,
            }));

            const { error: itemsInsertError } = await supabase
              .from('archive_order_items')
              .insert(archiveItems);

            if (itemsInsertError) {
              console.error(`Error archiving items for order ${order.order_number}:`, itemsInsertError);
              errors.push(`خطأ في أرشفة أصناف الطلب ${order.order_number}`);
            } else {
              console.log(`Archived ${orderItems.length} items for order ${order.order_number}`);
            }
          }

          // Archive customer notes
          const { data: notes, error: notesError } = await supabase
            .from('customer_notes')
            .select('*')
            .eq('order_id', order.id);

          if (notesError) {
            console.error(`Error fetching notes for order ${order.order_number}:`, notesError);
            errors.push(`خطأ في جلب ملاحظات الطلب ${order.order_number}`);
          } else if (notes && notes.length > 0) {
            const archiveNotes = notes.map(note => ({
              archive_order_id: archiveOrder.id,
              customer_id: note.customer_id,
              note: note.note,
              created_by: note.created_by || 'operator',
              created_at: note.created_at
            }));

            const { error: notesInsertError } = await supabase
              .from('archive_customer_notes')
              .insert(archiveNotes);

            if (notesInsertError) {
              console.error(`Error archiving notes for order ${order.order_number}:`, notesInsertError);
              errors.push(`خطأ في أرشفة ملاحظات الطلب ${order.order_number}`);
            } else {
              console.log(`Archived ${notes.length} notes for order ${order.order_number}`);
            }
          }

          // Delete original order (cascade will delete items and notes)
          const { error: deleteError } = await supabase
            .from('orders')
            .delete()
            .eq('id', order.id);

          if (deleteError) {
            console.error(`Error deleting order ${order.order_number}:`, deleteError);
            errors.push(`خطأ في حذف الطلب الأصلي ${order.order_number}`);
          } else {
            console.log(`Successfully archived and deleted order ${order.order_number}`);
            successCount++;
          }
        } catch (error: any) {
          console.error(`Unexpected error archiving order ${order.order_number}:`, error);
          errors.push(`خطأ غير متوقع في الطلب ${order.order_number}: ${error.message || 'خطأ غير معروف'}`);
          errorCount++;
        }
      }

      // Show results
      if (errorCount === 0) {
        showMessage(`تم نقل ${successCount} طلب إلى الأرشيف بنجاح!`, 'success');
        setShowArchiveModal(false);

        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else if (successCount > 0) {
        const errorMessage = errors.slice(0, 5).join('\n');
        const moreErrors = errors.length > 5 ? `\n... و ${errors.length - 5} أخطاء أخرى` : '';
        showMessage(
          `تم نقل ${successCount} طلب بنجاح، لكن حدثت ${errorCount} أخطاء:\n\n${errorMessage}${moreErrors}`,
          'error'
        );
        setIsArchiving(false);
      } else {
        const errorMessage = errors.slice(0, 5).join('\n');
        const moreErrors = errors.length > 5 ? `\n... و ${errors.length - 5} أخطاء أخرى` : '';
        showMessage(
          `فشل في نقل الطلبات إلى الأرشيف:\n\n${errorMessage}${moreErrors}`,
          'error'
        );
        setIsArchiving(false);
      }
    } catch (error) {
      console.error('Error archiving orders:', error);
      showMessage(
        'حدث خطأ أثناء نقل الطلبات إلى الأرشيف: ' + (error instanceof Error ? error.message : 'خطأ غير معروف'),
        'error'
      );
      setIsArchiving(false);
    }
  };

  const handleExportArchiveJson = async () => {
    setIsExportingArchive(true);
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const payload = await buildRateArchivePayload(`archive-${stamp}`);
      downloadRateArchiveJson(payload, payload.meta.name);
      showMessage(`تم تصدير ${payload.tables.archive_orders.length} طلب من الأرشيف`, 'success');
    } catch (error) {
      console.error('Error exporting archive JSON:', error);
      showMessage('تعذر تصدير الأرشيف', 'error');
    } finally {
      setIsExportingArchive(false);
    }
  };

  const handleResetSystem = async () => {
    const entered = resetPassword.trim();
    const configured = customerDeletePassword.trim();
    if (entered !== '2007' && (configured === '' || entered !== configured)) {
      showMessage('كلمة المرور غير صحيحة!', 'error');
      return;
    }

    const confirmMessage = 'هل أنت متأكد من إعادة تعيين النظام؟\n\nسيتم حذف:\n- جميع الطلبات\n- جميع بيانات العملاء\n- جميع الملاحظات\n- جميع الأرشيف\n- الأصناف المضافة حديثاً\n- الأقسام المضافة حديثاً\n\nلن يتم حذف:\n- الأصناف الأصلية\n- الأقسام الأصلية\n\nلا يمكن التراجع عن هذا الإجراء!';

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setIsResetting(true);

    try {
      const originalCategoryNames = ['BOSS BURGERS', 'LOOT BOX - SIDES', 'RUSH SHAWERMA', 'MANA & POTIONS'];
      const originalItemNames = [
        'Noob Burger', 'Double Damage', 'Sniper Chicken', 'The Tank',
        'Golden Fries', 'Magma Fries', 'Mozzarella Sticks', 'Sonic Rings',
        'Quick Scope', 'Open World Fatteh', 'Combo Rocket', 'Squad Meal',
        'Purple Potion', 'XP Boost', 'Dark Matter', 'Soft Drinks'
      ];

      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id');

      if (ordersError) throw ordersError;

      if (orders && orders.length > 0) {
        const orderIds = orders.map(o => o.id);

        await supabase.from('order_items').delete().in('order_id', orderIds);
        await supabase.from('customer_notes').delete().in('order_id', orderIds);

        for (const orderId of orderIds) {
          await supabase.from('orders').delete().eq('id', orderId);
        }
      }

      // Delete archive data - delete in correct order (child tables first)
      console.log('Deleting archive data...');

      let archiveDeleteErrors: string[] = [];
      // deletedCount removed as unused

      // Try to delete all archive data using direct SQL-like approach
      // First, delete all archive_order_items (CASCADE will handle if needed, but we delete explicitly)
      console.log('Deleting archive_order_items...');
      let itemsDeleted = false;
      let attempts = 0;
      while (!itemsDeleted && attempts < 3) {
        const { error: deleteItemsError } = await supabase
          .from('archive_order_items')
          .delete()
          .gt('id', '00000000-0000-0000-0000-000000000000'); // Delete all by checking id is not zero UUID

        if (deleteItemsError) {
          console.error(`Attempt ${attempts + 1} - Error deleting archive items:`, deleteItemsError);
          attempts++;
          if (attempts >= 3) {
            archiveDeleteErrors.push(`خطأ في حذف أصناف الأرشيف بعد 3 محاولات: ${deleteItemsError.message}`);
          } else {
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
          }
        } else {
          itemsDeleted = true;
          console.log('Successfully deleted all archive_order_items');
        }
      }

      // Second, delete all archive_customer_notes
      console.log('Deleting archive_customer_notes...');
      let notesDeleted = false;
      attempts = 0;
      while (!notesDeleted && attempts < 3) {
        const { error: deleteNotesError } = await supabase
          .from('archive_customer_notes')
          .delete()
          .gt('id', '00000000-0000-0000-0000-000000000000');

        if (deleteNotesError) {
          console.error(`Attempt ${attempts + 1} - Error deleting archive notes:`, deleteNotesError);
          attempts++;
          if (attempts >= 3) {
            archiveDeleteErrors.push(`خطأ في حذف ملاحظات الأرشيف بعد 3 محاولات: ${deleteNotesError.message}`);
          } else {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } else {
          notesDeleted = true;
          console.log('Successfully deleted all archive_customer_notes');
        }
      }

      // Finally, delete all archive_orders
      console.log('Deleting archive_orders...');
      let ordersDeleted = false;
      attempts = 0;
      while (!ordersDeleted && attempts < 3) {
        const { error: deleteOrdersError } = await supabase
          .from('archive_orders')
          .delete()
          .gt('id', '00000000-0000-0000-0000-000000000000');

        if (deleteOrdersError) {
          console.error(`Attempt ${attempts + 1} - Error deleting archive orders:`, deleteOrdersError);
          attempts++;
          if (attempts >= 3) {
            archiveDeleteErrors.push(`خطأ في حذف طلبات الأرشيف بعد 3 محاولات: ${deleteOrdersError.message}`);
          } else {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } else {
          ordersDeleted = true;
          console.log('Successfully deleted all archive_orders');
        }
      }

      // Verify deletion by checking if any records remain
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for database to update

      const { count: ordersCount } = await supabase
        .from('archive_orders')
        .select('id', { count: 'exact', head: true });

      const { count: itemsCount } = await supabase
        .from('archive_order_items')
        .select('id', { count: 'exact', head: true });

      const { count: notesCount } = await supabase
        .from('archive_customer_notes')
        .select('id', { count: 'exact', head: true });

      if (ordersCount && ordersCount > 0) {
        archiveDeleteErrors.push(`تحذير: لا تزال هناك ${ordersCount} طلبات في الأرشيف بعد الحذف. قد تحتاج إلى حذفها يدوياً من قاعدة البيانات.`);
        console.error(`Archive orders still exist: ${ordersCount} remaining`);
      }

      if (itemsCount && itemsCount > 0) {
        archiveDeleteErrors.push(`تحذير: لا تزال هناك ${itemsCount} أصناف في الأرشيف بعد الحذف.`);
        console.error(`Archive items still exist: ${itemsCount} remaining`);
      }

      if (notesCount && notesCount > 0) {
        archiveDeleteErrors.push(`تحذير: لا تزال هناك ${notesCount} ملاحظات في الأرشيف بعد الحذف.`);
        console.error(`Archive notes still exist: ${notesCount} remaining`);
      }

      // If there were errors, show them but continue with other deletions
      if (archiveDeleteErrors.length > 0) {
        console.error('Archive deletion errors:', archiveDeleteErrors);
        showMessage(
          `تحذير: حدثت أخطاء أثناء حذف الأرشيف:\n${archiveDeleteErrors.join('\n')}\n\nيرجى التحقق من RLS policies أو حذف البيانات يدوياً من قاعدة البيانات.`,
          'error'
        );
      } else {
        console.log('Archive deletion completed successfully');
        showMessage('تم حذف جميع بيانات الأرشيف بنجاح!', 'success');
      }

      // Delete general customer notes (without order_id)
      await supabase.from('customer_notes').delete().is('order_id', null);

      // Delete all customer_general_notes
      const { data: generalNotes } = await supabase
        .from('customer_general_notes')
        .select('id');
      if (generalNotes && generalNotes.length > 0) {
        await supabase.from('customer_general_notes').delete().in('id', generalNotes.map(n => n.id));
      }

      const { data: customers, error: customersFetchError } = await supabase
        .from('customers')
        .select('id');

      if (customersFetchError) throw customersFetchError;

      if (customers && customers.length > 0) {
        for (const customerId of customers.map(c => c.id)) {
          await supabase.from('customers').delete().eq('id', customerId);
        }
      }

      // Delete all device coupons (cheat-code coupons)
      await supabase
        .from('device_coupons')
        .delete()
        .gt('created_at', '1970-01-01T00:00:00Z');

      const { data: allItems, error: itemsFetchError } = await supabase
        .from('items')
        .select('id, name_en');

      if (itemsFetchError) throw itemsFetchError;

      if (allItems) {
        const itemsToDelete = allItems.filter(item =>
          !originalItemNames.includes(item.name_en)
        );

        if (itemsToDelete.length > 0) {
          const itemIdsToDelete = itemsToDelete.map(item => item.id);
          await supabase.from('items').delete().in('id', itemIdsToDelete);
        }
      }

      const { data: allCategories, error: categoriesFetchError } = await supabase
        .from('categories')
        .select('id, name_en');

      if (categoriesFetchError) throw categoriesFetchError;

      if (allCategories) {
        const categoriesToDelete = allCategories.filter(category =>
          !originalCategoryNames.includes(category.name_en)
        );

        if (categoriesToDelete.length > 0) {
          const categoryIdsToDelete = categoriesToDelete.map(category => category.id);

          await supabase.from('items').delete().in('category_id', categoryIdsToDelete);
          await supabase.from('categories').delete().in('id', categoryIdsToDelete);
        }
      }

      // Keep slot archives, but clear current selected slot after full reset.
      persistSlotsMeta(slotsList, '');
      showMessage('تم إعادة تعيين النظام بنجاح!', 'success');
      setShowResetModal(false);
      setResetPassword('');

      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error('Error resetting system:', error);
      showMessage('حدث خطأ أثناء حذف البيانات: ' + (error instanceof Error ? error.message : 'خطأ غير معروف'), 'error');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-black text-white text-right mb-6">الإعدادات</h2>

      {message && (
        <div className="fixed inset-x-0 bottom-4 z-[120] flex justify-center px-4 pointer-events-none">
          <div
            className={`pointer-events-auto max-w-2xl w-full md:w-auto p-4 rounded-xl border-2 text-center font-bold shadow-2xl ${
              messageType === 'success'
                ? 'bg-green-900/90 border-green-500 text-green-100'
                : 'bg-red-900/90 border-red-500 text-red-100'
            }`}
          >
            {message}
          </div>
        </div>
      )}

      {onNavigateToOrder && (
        <OperatorCustomerSearch
          onNavigateToOrder={onNavigateToOrder}
          onFocusOrdersByPhone={(phone) => onNavigateToCustomerOrders?.(phone)}
          customerDeletePassword={customerDeletePassword}
          focusPhone={customerSearchPhone}
          focusToken={customerSearchToken}
        />
      )}

      {/* Logo Upload Section */}
      <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-6">
        <div className="flex items-center justify-end gap-2 mb-6">
          <h3 className="text-2xl font-bold text-white">صورة الشعار</h3>
          <ImageIcon className="w-6 h-6 text-purple-400" />
        </div>

        <div className="space-y-4">
          {logoPreview && (
            <div className="relative h-32 bg-gray-800 rounded-lg overflow-hidden border-2 border-purple-500/50">
              <img
                src={logoPreview}
                alt="Logo Preview"
                className="w-full h-full object-contain"
              />
              {logoFile && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="absolute top-2 right-2 bg-red-600 hover:bg-red-500 text-white p-2 rounded-full transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          <div>
            <input
              ref={logoFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoSelect}
              className="hidden"
              id="logo-upload"
            />
            <label
              htmlFor="logo-upload"
              className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-3 rounded-lg cursor-pointer transition-colors font-bold"
            >
              <Upload className="w-5 h-5" />
              <span>{logoImageUrl ? 'تغيير صورة الشعار' : 'رفع صورة الشعار'}</span>
            </label>
          </div>

          {logoFile && (
            <button
              onClick={handleSaveLogo}
              disabled={isUploadingLogo}
              className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
            >
              {isUploadingLogo ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  <span>حفظ صورة الشعار</span>
                </>
              )}
            </button>
          )}

          {logoImageUrl && !logoFile && (
            <button
              onClick={() => {
                setLogoImageUrl('');
                setLogoPreview(null);
                supabase
                  .from('settings')
                  .delete()
                  .eq('key', 'logo_image_url')
                  .then(() => {
                    showMessage('تم حذف صورة الشعار', 'success');
                    setTimeout(() => window.location.reload(), 1000);
                  });
              }}
              className="w-full bg-red-600 hover:bg-red-500 text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
            >
              <X className="w-5 h-5" />
              <span>حذف صورة الشعار</span>
            </button>
          )}

          <p className="text-sm text-gray-400 text-right">
            💡 نصيحة: اضغط 5 مرات متتالية على شعار MEZZO في الصفحة الرئيسية لفتح نافذة رفع الصورة
          </p>
        </div>
      </div>

      {/* Secret Coupon Settings */}
      <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-6">
        <div className="flex items-center justify-end gap-2 mb-6">
          <h3 className="text-2xl font-bold text-white">الشفرات السرية للكوبونات</h3>
          <Keyboard className="w-6 h-6 text-purple-400" />
        </div>

        <div className="space-y-4">
          <p className="text-sm text-gray-300 text-right mb-2">
            هذه الشفرة يكتبها العميل في واجهة الطلب (الحروف الراقصة)، وعند إدخالها بشكل صحيح يحصل على كوبون خصم يتم حفظه على جهازه.
          </p>

          <div>
            <label className="block text-purple-300 mb-2 text-right">كلمة الشفرة السرية للكوبون</label>
            <input
              type="text"
              value={couponSecretCode}
              onChange={(e) => setCouponSecretCode(e.target.value)}
              className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
              placeholder="مثال: GGMAX أو MX2026"
              dir="rtl"
            />
            <p className="text-[11px] text-amber-200/90 text-right mt-2">
              الأحرف الكبيرة والصغيرة مهمة: مثلاً <span className="font-mono">mx</span> و <span className="font-mono">MX</span> كوبونان مختلفان، وعلى العميل كتابة الشفرة بنفس الشكل ليحصل على الكوبون.
            </p>
          </div>

          <div>
            <label className="block text-purple-300 mb-2 text-right">نسبة الخصم (%)</label>
            <input
              type="number"
              min={1}
              max={100}
              value={couponDiscountPercent}
              onChange={(e) => setCouponDiscountPercent(parseInt(e.target.value, 10) || 0)}
              className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
              placeholder="مثال: 10"
              dir="ltr"
            />
          </div>

          <button
            onClick={handleUpdateCouponSettings}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5" />
            حفظ إعدادات الكوبونات السرية
          </button>

          {/* Existing device coupons list */}
          <div className="mt-6">
            <h4 className="text-xl font-bold text-white text-right mb-3">
              الكوبونات الحالية
            </h4>
            <p className="text-xs text-gray-400 text-right mb-3">
              يمكنك تعديل نسبة الخصم، تحديد تاريخ انتهاء، تعطيل الكوبون فوراً أو حذفه.
            </p>
            <div className="bg-gray-950/40 border border-purple-500/30 rounded-lg max-h-80 overflow-y-auto custom-scrollbar">
              {loadingCoupons ? (
                <div className="py-6 text-center text-gray-300 text-sm">
                  جاري تحميل الكوبونات...
                </div>
              ) : deviceCoupons.length === 0 ? (
                <div className="py-6 text-center text-gray-400 text-sm">
                  لا توجد كوبونات حتى الآن
                </div>
              ) : (
                <table className="w-full text-xs text-gray-200">
                  <thead className="bg-gray-900/70 sticky top-0">
                    <tr>
                      <th className="py-2 px-2 text-right">الكود</th>
                      <th className="py-2 px-2 text-right">% خصم</th>
                      <th className="py-2 px-2 text-right">انتهاء</th>
                      <th className="py-2 px-2 text-center">المستخدمين</th>
                      <th className="py-2 px-2 text-right">الحالة</th>
                      <th className="py-2 px-2 text-center">المستفيدون</th>
                      <th className="py-2 px-2 text-center">تحكم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deviceCoupons.map(coupon => {
                      const expiresAt = coupon.expires_at ? coupon.expires_at.substring(0, 10) : '';
                      const disabled = coupon.is_disabled;
                      const usedInOrders = couponUsedInOrderCounts[coupon.code] || 0;
                      return (
                        <tr key={coupon.id} className="border-t border-gray-800/60">
                          <td className="py-2 px-2 text-right">
                            <div className="font-mono text-[11px] break-all">{coupon.code}</div>
                            {coupon.customer_phone && (
                              <div className="text-[10px] text-gray-400">
                                {coupon.customer_name || ''} {coupon.customer_phone}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="number"
                              min={1}
                              max={100}
                              defaultValue={coupon.discount_percent}
                              className="w-16 bg-gray-900 border border-purple-500/40 rounded px-1 py-0.5 text-center"
                              onBlur={(e) => {
                                const value = parseInt(e.target.value || '0', 10);
                                if (!value || value <= 0 || value > 100 || value === coupon.discount_percent) return;
                                handleUpdateSingleCoupon(coupon, { discount_percent: value });
                              }}
                            />
                          </td>
                          <td className="py-2 px-2">
                            <input
                              type="date"
                              defaultValue={expiresAt}
                              className="bg-gray-900 border border-purple-500/40 rounded px-1 py-0.5 text-[11px] w-28"
                              onChange={(e) => {
                                const val = e.target.value;
                                const newDate = val ? new Date(val + 'T23:59:59').toISOString() : null;
                                handleUpdateSingleCoupon(coupon, { expires_at: newDate });
                              }}
                            />
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="bg-purple-700/50 text-purple-100 px-2 py-0.5 rounded-full text-[10px] font-bold">
                              {couponUsageCounts[coupon.code] || 0}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right">
                            <div className="space-y-0.5">
                              <span className="inline-block px-2 py-0.5 rounded-full text-[10px] bg-slate-700 text-slate-100">
                                نسخ للعملاء: {couponUsageCounts[coupon.code] || 0}
                              </span>
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] ${usedInOrders > 0 ? 'bg-amber-900/90 text-amber-100' : 'bg-slate-600 text-slate-300'}`}>
                                مُستخدم في طلب: {usedInOrders}
                              </span>
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] ${disabled ? 'bg-red-700 text-red-100' : 'bg-blue-700 text-blue-100'}`}>
                                {disabled ? 'معطل' : 'فعال'}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => openCouponRecipients(coupon.code)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-[10px] font-bold"
                            >
                              <Users className="w-3 h-3 shrink-0" />
                              القائمة
                            </button>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleUpdateSingleCoupon(coupon, { is_disabled: !disabled })}
                                className={`px-2 py-1 rounded text-[10px] ${disabled ? 'bg-green-600 hover:bg-green-500' : 'bg-yellow-600 hover:bg-yellow-500'}`}
                              >
                                {disabled ? 'تفعيل' : 'تعطيل'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCoupon(coupon)}
                                className="px-2 py-1 rounded text-[10px] bg-red-700 hover:bg-red-600"
                              >
                                حذف
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {couponRecipientsOpen && couponRecipientsCode && (
              <div
                className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/75"
                onClick={() => {
                  setCouponRecipientsOpen(false);
                  setCouponRecipientsCode(null);
                }}
              >
                <div
                  className="bg-gray-900 border-2 border-purple-500 rounded-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-purple-500/40 bg-gray-950/80">
                    <button
                      type="button"
                      onClick={() => {
                        setCouponRecipientsOpen(false);
                        setCouponRecipientsCode(null);
                      }}
                      className="text-gray-400 hover:text-white p-1"
                    >
                      <X className="w-5 h-5" />
                    </button>
                    <h4 className="text-white font-black text-sm text-right flex-1 px-2">
                      مستفيدو الكوبون: <span className="text-purple-300 font-mono">{couponRecipientsCode}</span>
                    </h4>
                  </div>
                  <p className="text-[10px] text-gray-500 text-right px-3 py-1 border-b border-gray-800/80">
                    تُعرض فقط النسخ التي يطابق فيها الكود هذا القالب تماماً (بما فيه حالة الأحرف). العدد: {couponRecipientsRows.length}
                  </p>
                  <div className="overflow-y-auto flex-1 p-3 space-y-2 custom-scrollbar">
                    {loadingRecipients ? (
                      <p className="text-center text-gray-400 text-sm py-6">جاري التحميل...</p>
                    ) : couponRecipientsRows.length === 0 ? (
                      <p className="text-center text-gray-500 text-sm py-6">لا توجد نسخ مسجّلة للعملاء بعد</p>
                    ) : (
                      couponRecipientsRows.map((row) => {
                        const exp = row.expires_at ? row.expires_at.substring(0, 10) : '';
                        const rowDisabled = row.is_disabled;
                        return (
                          <div
                            key={row.id}
                            className="rounded-lg border border-purple-500/30 bg-gray-950/60 p-3 space-y-2 text-right"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-[11px] text-gray-400 font-mono truncate max-w-[120px]">{row.id.slice(0, 8)}…</div>
                              <div className="flex flex-wrap gap-1 justify-end">
                                {row.is_used && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-800 text-amber-100">مستخدم في طلب</span>
                                )}
                                <span className={`text-[10px] px-2 py-0.5 rounded-full ${rowDisabled ? 'bg-red-800 text-red-100' : 'bg-green-800 text-green-100'}`}>
                                  {rowDisabled ? 'معطّل لهذا العميل' : 'نشط'}
                                </span>
                              </div>
                            </div>
                            <p className="text-white font-bold text-sm">{row.customer_name || '—'}</p>
                            <p className="text-purple-200 text-xs" dir="ltr">{row.customer_phone || '—'}</p>
                            {row.device_fingerprint && (!row.customer_name || !row.customer_phone) && (
                              <p className="text-[10px] text-gray-500 font-mono text-right" dir="ltr">
                                بصمة الجهاز: {row.device_fingerprint.length > 24 ? `${row.device_fingerprint.slice(0, 24)}…` : row.device_fingerprint}
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 justify-end">
                              <input
                                type="date"
                                defaultValue={exp}
                                className="bg-gray-900 border border-purple-500/40 rounded px-2 py-1 text-[11px] text-white"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const newDate = val ? new Date(val + 'T23:59:59').toISOString() : null;
                                  void handleUpdateSingleCoupon(row, { expires_at: newDate });
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => void handleUpdateSingleCoupon(row, { is_disabled: !rowDisabled })}
                                className={`text-[10px] px-2 py-1 rounded font-bold ${rowDisabled ? 'bg-green-600' : 'bg-yellow-600'}`}
                              >
                                {rowDisabled ? 'تفعيل' : 'تعطيل'}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!window.confirm('حذف هذه النسخة من كوبون هذا العميل؟')) return;
                                  await handleDeleteCoupon(row);
                                  setCouponRecipientsRows((prev) => prev.filter((r) => r.id !== row.id));
                                  await fetchDeviceCoupons();
                                }}
                                className="text-[10px] px-2 py-1 rounded font-bold bg-red-700 hover:bg-red-600"
                              >
                                حذف
                              </button>
                              <button
                                type="button"
                                disabled={!row.customer_phone}
                                onClick={() => {
                                  const phone = row.customer_phone || '';
                                  if (!phone) return;
                                  setCustomerSearchPhone(phone);
                                  setCustomerSearchToken((n) => n + 1);
                                  setCouponRecipientsOpen(false);
                                }}
                                className="text-[10px] px-2 py-1 rounded font-bold bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40"
                              >
                                عرض المزيد
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delivery Services Settings */}
      <div className="bg-gray-900/50 border-2 border-yellow-500/40 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4 border-b border-yellow-500/20 pb-4">
          <label className="flex items-center gap-3 cursor-pointer group">
            <div className="relative">
              <input
                type="checkbox"
                checked={showDebugMap}
                onChange={(e) => handleToggleDebugMap(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yellow-500"></div>
            </div>
            <span className="text-sm font-bold text-yellow-100 group-hover:text-yellow-300 transition-colors">
              إظهار طبقات وأسعار التوصيل للعملاء (للاختبار)
            </span>
          </label>
          <div className="text-xs text-gray-400 text-right">
            هذا الخيار يظهر مناطق التوصيل والطبقات الملونة للعملاء في صفحة الطلب.
          </div>
        </div>

        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => setShowServiceEditor(true)}
            className="bg-yellow-500 hover:bg-yellow-400 text-black px-6 py-3 rounded-lg flex items-center gap-2 transition-colors font-bold"
          >
            <MapPinned className="w-5 h-5" />
            <span>فتح محرر خدمات التوصيل</span>
          </button>
          <div className="flex items-center justify-end gap-2">
            <h3 className="text-2xl font-bold text-white">خدمات التوصيل (Delivery Services)</h3>
            <MapPinned className="w-6 h-6 text-yellow-400" />
          </div>
        </div>

        <p className="text-sm text-gray-300 text-right mb-4">
          هنا تقوم بتعريف فروع / خدمات التوصيل وطبقات التسعير (بوليجونات صفراء) حول كل فرع.
          يمكنك أيضاً إضافة زونات تعطيل (حمراء) من داخل محرر الخريطة لمنع الطلب في مناطق محددة حتى لو كانت داخل طبقة تسعير.
        </p>

        <div className="bg-gray-950/40 border border-yellow-500/40 rounded-lg max-h-72 overflow-y-auto custom-scrollbar">
          {loadingServices ? (
            <div className="py-4 text-center text-gray-300 text-sm">
              جاري تحميل خدمات التوصيل...
            </div>
          ) : deliveryServices.length === 0 ? (
            <div className="py-4 text-center text-gray-400 text-sm">
              لا توجد خدمات توصيل بعد. استخدم زر "محرر خدمات التوصيل" لإنشاء أول فرع.
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {deliveryServices.map(service => (
                <div
                  key={service.id}
                  className="bg-gray-900/50 border border-yellow-500/40 rounded-lg p-3 flex items-center justify-between"
                >
                  <div className="flex-1 text-right">
                    <div className="font-bold text-white">{service.name}</div>
                    <div className="text-xs text-gray-400 mt-1">
                      {service.branch_location
                        ? `${service.branch_location.lat.toFixed(5)}, ${service.branch_location.lng.toFixed(5)}`
                        : 'لم يتم تعيين موقع الفرع بعد'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-yellow-700 text-yellow-100">
                      {service.layers?.length || 0} طبقات
                    </span>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold ${service.is_active ? 'bg-green-700 text-green-100' : 'bg-gray-700 text-gray-200'
                        }`}
                    >
                      {service.is_active ? 'فعال' : 'معطل'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delivery Service Editor Modal */}
      {showServiceEditor && (
        <DeliveryServiceEditor
          services={deliveryServices}
          zones={deliveryZones}
          onServiceCreate={handleCreateDeliveryService}
          onServiceUpdate={handleUpdateDeliveryService}
          onServiceDelete={handleDeleteDeliveryService}
          onLayerCreate={handleCreateServiceLayer}
          onLayerUpdate={handleUpdateServiceLayer}
          onLayerDelete={handleDeleteServiceLayer}
          onZoneCreate={handleSaveZoneFromMap}
          onZoneUpdate={handleUpdateZone}
          onZoneDelete={handleDeleteZone}
          onClose={() => {
            setShowServiceEditor(false);
            void fetchDeliveryZones();
          }}
        />
      )}

      <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-6">
        <div className="flex items-center justify-end gap-2 mb-6">
          <h3 className="text-2xl font-bold text-white">رقم التحويل الفوري</h3>
          <CreditCard className="w-6 h-6 text-purple-400" />
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-purple-300 mb-2 text-right">رقم الهاتف للتحويل الفوري</label>
            <input
              type="text"
              value={instantNumber}
              onChange={(e) => setInstantNumber(e.target.value)}
              className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
              placeholder="01000000000"
              dir="ltr"
            />
          </div>

          <button
            onClick={handleUpdateInstantNumber}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5" />
            حفظ التغييرات
          </button>
        </div>
      </div>

      <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-6">
        <div className="flex items-center justify-end gap-2 mb-6">
          <h3 className="text-2xl font-bold text-white">تغيير كلمة المرور</h3>
          <Lock className="w-6 h-6 text-purple-400" />
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-purple-300 mb-2 text-right">كلمة المرور القديمة</label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
              placeholder="أدخل كلمة المرور القديمة"
              dir="rtl"
            />
          </div>

          <div>
            <label className="block text-purple-300 mb-2 text-right">كلمة المرور الجديدة</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
              placeholder="أدخل كلمة المرور الجديدة"
              dir="rtl"
            />
          </div>

          <div>
            <label className="block text-purple-300 mb-2 text-right">تأكيد كلمة المرور الجديدة</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
              placeholder="أعد إدخال كلمة المرور الجديدة"
              dir="rtl"
            />
          </div>

          <button
            onClick={handleChangePassword}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
          >
            <Lock className="w-5 h-5" />
            تغيير كلمة المرور
          </button>
        </div>
      </div>

      <div className="bg-gray-900/50 border-2 border-orange-500/35 rounded-xl p-6">
        <div className="flex items-center justify-end gap-2 mb-4">
          <h3 className="text-2xl font-bold text-white">كلمة مرور حذف العميل</h3>
          <Lock className="w-6 h-6 text-orange-400" />
        </div>
        <p className="text-xs text-gray-400 text-right mb-4 leading-relaxed">
          تُطلب عند حذف بيانات عميل من قائمة «العملاء الذين قدّموا طلبات» في الأعلى، وعند تطبيق Slot أو حذف أرشيفه
          أو تصديره، وعند إعادة تعيين البيانات. يمكن تغييرها هنا بعد إدخال كلمة المرور الحالية والجديدة.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-orange-200/90 mb-1 text-right text-sm">كلمة المرور الحالية</label>
            <input
              type="password"
              value={customerDeletePwdOld}
              onChange={(e) => setCustomerDeletePwdOld(e.target.value)}
              className="w-full bg-gray-800 border-2 border-orange-500/40 rounded-lg px-4 py-3 text-white text-right"
              placeholder="أدخل كلمة المرور الحالية"
              dir="rtl"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-orange-200/90 mb-1 text-right text-sm">كلمة المرور الجديدة</label>
            <input
              type="password"
              value={customerDeletePwdNew}
              onChange={(e) => setCustomerDeletePwdNew(e.target.value)}
              className="w-full bg-gray-800 border-2 border-orange-500/40 rounded-lg px-4 py-3 text-white text-right"
              placeholder="أدخل كلمة المرور الجديدة"
              dir="rtl"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-orange-200/90 mb-1 text-right text-sm">تأكيد كلمة المرور الجديدة</label>
            <input
              type="password"
              value={customerDeletePwdConfirm}
              onChange={(e) => setCustomerDeletePwdConfirm(e.target.value)}
              className="w-full bg-gray-800 border-2 border-orange-500/40 rounded-lg px-4 py-3 text-white text-right"
              placeholder="أعد إدخال كلمة المرور الجديدة"
              dir="rtl"
              autoComplete="new-password"
            />
          </div>
          <button
            type="button"
            onClick={async () => {
              const oldP = customerDeletePwdOld.trim();
              const newP = customerDeletePwdNew.trim();
              const cfm = customerDeletePwdConfirm.trim();
              if (!oldP || !newP || !cfm) {
                showMessage('املأ جميع الحقول', 'error');
                return;
              }
              if (oldP !== customerDeletePassword) {
                showMessage('كلمة المرور الحالية غير صحيحة', 'error');
                return;
              }
              if (newP !== cfm) {
                showMessage('تأكيد كلمة المرور الجديدة غير مطابق', 'error');
                return;
              }
              try {
                const { error } = await supabase.from('settings').upsert(
                  {
                    key: 'customer_delete_password',
                    value: newP,
                    updated_at: new Date().toISOString()
                  },
                  { onConflict: 'key' }
                );
                if (error) throw error;
                setCustomerDeletePassword(newP);
                setCustomerDeletePwdOld('');
                setCustomerDeletePwdNew('');
                setCustomerDeletePwdConfirm('');
                showMessage('تم حفظ كلمة مرور حذف العميل', 'success');
              } catch (e) {
                console.error(e);
                showMessage('تعذر حفظ الإعداد', 'error');
              }
            }}
            className="w-full bg-orange-600 hover:bg-orange-500 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2"
          >
            <Save className="w-5 h-5" />
            حفظ كلمة مرور الحذف
          </button>
        </div>
      </div>

      <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-6">
        <div className="flex items-center justify-end gap-2 mb-6">
          <h3 className="text-2xl font-bold text-white">تغيير الشفرة السرية</h3>
          <Keyboard className="w-6 h-6 text-purple-400" />
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-purple-300 mb-2 text-right">الشفرة القديمة</label>
            <input
              type="password"
              value={oldCheatCode}
              onChange={(e) => setOldCheatCode(e.target.value)}
              className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
              placeholder="أدخل الشفرة القديمة"
              dir="rtl"
            />
          </div>

          <div>
            <label className="block text-purple-300 mb-2 text-right">الشفرة الجديدة</label>
            <input
              type="password"
              value={newCheatCode}
              onChange={(e) => setNewCheatCode(e.target.value)}
              className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
              placeholder="أدخل الشفرة الجديدة"
              dir="rtl"
            />
          </div>

          <div>
            <label className="block text-purple-300 mb-2 text-right">تأكيد الشفرة الجديدة</label>
            <input
              type="password"
              value={confirmCheatCode}
              onChange={(e) => setConfirmCheatCode(e.target.value)}
              className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-right"
              placeholder="أعد إدخال الشفرة الجديدة"
              dir="rtl"
            />
          </div>

          <button
            onClick={handleChangeCheatCode}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
          >
            <Keyboard className="w-5 h-5" />
            تغيير الشفرة السرية
          </button>
        </div>
      </div>

      {/* Slots (Export/Import/Restore) */}
      <div className="bg-gray-900/50 border-2 border-purple-500/30 rounded-xl p-6">
        <div className="flex items-center justify-end gap-2 mb-6">
          <h3 className="text-2xl font-bold text-white">Slots (حفظ/استرجاع النظام)</h3>
          <Lock className="w-6 h-6 text-purple-400" />
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-gray-800/40 border border-purple-500/20 rounded-xl p-4 space-y-3">
              <p className="text-sm text-gray-300 text-right">
                تصدير Slot كملف JSON واحد: الجداول كاملة وروابط الصور داخل الحقول فقط (دون تضمين ملفات الصور).
              </p>
              <input
                type="text"
                value={slotName}
                onChange={(e) => setSlotName(e.target.value)}
                className="w-full bg-gray-800 border-2 border-purple-500/30 rounded-lg px-4 py-3 text-white text-right"
                placeholder="اسم Slot"
              />
              <button
                type="button"
                onClick={() => {
                  setSlotGate({ action: 'export' });
                  setSlotGatePassword('');
                }}
                disabled={isSlotBusy}
                className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
              >
                {isSlotBusy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                حفظ Slot (تنزيل JSON)
              </button>
              <p className="text-xs text-gray-400 text-right">
                يُطلب إدخال كلمة مرور حذف العميل قبل التصدير أو التطبيق أو حذف الأرشيف.
              </p>
            </div>

            <div className="bg-gray-800/40 border border-purple-500/20 rounded-xl p-4 space-y-3">
              <p className="text-sm text-gray-300 text-right">
                اسحب ملف JSON إلى المنطقة أدناه، أو انقر المنطقة لاختيار ملف — يُحفظ فوراً في القائمة.
              </p>
              <input
                ref={slotFileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importSlotFile(f);
                }}
              />
              <div
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    slotFileInputRef.current?.click();
                  }
                }}
                onClick={() => !isSlotBusy && slotFileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSlotImportDrag(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSlotImportDrag(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSlotImportDrag(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f && !isSlotBusy) void importSlotFile(f);
                }}
                className={`w-full min-h-[120px] border-2 border-dashed rounded-xl px-4 py-6 text-center transition-colors flex flex-col items-center justify-center gap-2 font-bold text-sm cursor-pointer select-none ${
                  slotImportDrag
                    ? 'border-primary bg-primary/15 text-white'
                    : 'border-purple-500/40 bg-gray-900/40 text-purple-200 hover:border-purple-400/60'
                } ${isSlotBusy ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {isSlotBusy ? <Loader2 className="w-8 h-8 animate-spin text-primary" /> : <FolderUp className="w-8 h-8 text-purple-400" />}
                <span>اسحب الملف هنا أو انقر للاستيراد</span>
                <span className="text-xs text-gray-500 font-normal">JSON فقط</span>
              </div>
            </div>
          </div>

          {slotsList.length > 0 && (
            <div className="bg-gray-800/30 border border-purple-500/20 rounded-xl p-4 space-y-3">
              <h4 className="text-white font-black text-right">Slots الموجودة على هذا الجهاز</h4>
              <div className="space-y-2">
                {slotsList.map((s) => (
                  <div
                    key={s.name}
                    className={`flex flex-col md:flex-row md:items-center md:justify-between gap-2 rounded-xl p-3 border ${
                      selectedSlotName === s.name
                        ? 'bg-purple-950/50 border-purple-400/60'
                        : 'bg-gray-900/40 border-purple-500/20'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => persistSlotsMeta(slotsList, s.name)}
                      className="flex flex-1 items-center justify-end gap-3 text-right min-w-0"
                    >
                      <div className="min-w-0">
                        <p className="text-white font-bold truncate" dir="ltr">
                          {s.name}
                        </p>
                        <p className="text-xs text-gray-400">{new Date(s.updatedAt).toLocaleString('ar-EG')}</p>
                      </div>
                      {selectedSlotName === s.name && (
                        <span className="shrink-0 text-xs font-black text-purple-200 bg-purple-700/60 px-2 py-0.5 rounded">
                          محدد
                        </span>
                      )}
                    </button>

                    <div className="relative flex justify-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenSlotMenu((open) => (open === s.name ? null : s.name));
                        }}
                        className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-purple-500/30 text-white"
                        aria-label="خيارات"
                      >
                        <MoreVertical className="w-5 h-5" />
                      </button>
                      {openSlotMenu === s.name && (
                        <div
                          className="absolute left-0 top-full mt-1 z-50 min-w-[200px] rounded-xl border border-purple-500/40 bg-gray-900 shadow-xl py-1 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-sm text-white hover:bg-purple-800/50"
                            onClick={() => {
                              setOpenSlotMenu(null);
                              setSlotGate({ action: 'apply', name: s.name });
                              setSlotGatePassword('');
                            }}
                          >
                            تطبيق الحفظ
                          </button>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-sm text-white hover:bg-purple-800/50"
                            onClick={() => {
                              setOpenSlotMenu(null);
                              persistSlotsMeta(slotsList, '');
                            }}
                          >
                            إلغاء التحديد
                          </button>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-sm text-amber-200 hover:bg-amber-900/40"
                            onClick={() => {
                              setOpenSlotMenu(null);
                              void handleExportExistingSlotFile(s.name);
                            }}
                          >
                            تنزيل نسخة (JSON)
                          </button>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-sm text-red-300 hover:bg-red-900/40"
                            onClick={() => {
                              setOpenSlotMenu(null);
                              setSlotGate({ action: 'delete', name: s.name });
                              setSlotGatePassword('');
                            }}
                          >
                            حذف الأرشيف
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {slotGate && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div
            className="bg-dark rounded-2xl border-2 border-purple-500 max-w-md w-full shadow-2xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-black text-white text-right">
              {slotGate.action === 'export'
                ? 'تأكيد تصدير Slot'
                : slotGate.action === 'apply'
                  ? 'تأكيد تطبيق Slot'
                  : 'تأكيد حذف أرشيف Slot'}
            </h3>
            <p className="text-sm text-gray-400 text-right">أدخل كلمة مرور حذف العميل للمتابعة.</p>
            <input
              type="password"
              value={slotGatePassword}
              onChange={(e) => setSlotGatePassword(e.target.value)}
              className="w-full bg-gray-800 border-2 border-purple-500/50 rounded-lg px-4 py-3 text-white text-center font-mono"
              placeholder="••••••"
              dir="ltr"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setSlotGate(null);
                  setSlotGatePassword('');
                }}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg font-bold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void confirmSlotPasswordGate()}
                className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-lg font-bold"
              >
                تأكيد
              </button>
            </div>
          </div>
        </div>
      )}

      {/* End of Day / Archive */}
      <div className="bg-blue-900/20 border-2 border-blue-500/50 rounded-xl p-6">
        <div className="flex items-center justify-end gap-2 mb-6">
          <h3 className="text-2xl font-bold text-white">إنهاء اليوم - نقل إلى الأرشيف</h3>
          <Archive className="w-6 h-6 text-blue-400" />
        </div>

        <div className="space-y-4">
          <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-4">
            <p className="text-blue-200 text-sm text-right whitespace-pre-line">
              هذه الوظيفة تقوم بنقل جميع الطلبات السابقة (المكتملة والملغاة) إلى الأرشيف.

              سيتم نقل:
              • جميع الطلبات المكتملة
              • جميع الطلبات الملغاة
              • جميع أصناف الطلبات
              • جميع الملاحظات

              البيانات في الأرشيف محمية ولن يتم حذفها إلا عند إعادة ضبط الموقع.
            </p>
          </div>

          <button
            onClick={() => setShowArchiveModal(true)}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
          >
            <Archive className="w-5 h-5" />
            إنهاء اليوم ونقل إلى الأرشيف
          </button>

          <button
            type="button"
            onClick={() => void handleExportArchiveJson()}
            disabled={isExportingArchive}
            className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
          >
            {isExportingArchive ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            تصدير الأرشيف (JSON)
          </button>
        </div>
      </div>

      {/* Reset System */}
      <div className="bg-red-900/20 border-2 border-red-500/50 rounded-xl p-6">
        <div className="flex items-center justify-end gap-2 mb-6">
          <h3 className="text-2xl font-bold text-white">إعادة تعيين البيانات</h3>
          <RotateCcw className="w-6 h-6 text-red-400" />
        </div>

        <div className="space-y-4">
          <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg p-4">
            <p className="text-yellow-200 text-sm text-right whitespace-pre-line">
              تحذير: هذا الإجراء سيحذف جميع بيانات العملاء والطلبات والأصناف والأقسام المضافة حديثاً.

              سيتم حذف:
              • جميع الطلبات
              • جميع بيانات العملاء
              • جميع الملاحظات
              • الأصناف المضافة حديثاً
              • الأقسام المضافة حديثاً

              لن يتم حذف:
              • الأصناف الأصلية
              • الأقسام الأصلية

              لا يمكن التراجع عن هذا الإجراء!
            </p>
          </div>

          <button
            onClick={() => setShowResetModal(true)}
            className="w-full bg-red-600 hover:bg-red-500 text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-5 h-5" />
            إعادة تعيين البيانات
          </button>
        </div>
      </div>

      {/* Archive Modal */}
      {showArchiveModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-dark rounded-2xl border-2 border-blue-500 max-w-md w-full shadow-2xl">
            <div className="bg-blue-800/50 p-4 flex items-center justify-between border-b-2 border-blue-500">
              <div className="w-10"></div>
              <h2 className="text-2xl font-black text-white">إنهاء اليوم</h2>
              <button
                onClick={() => {
                  setShowArchiveModal(false);
                }}
                className="bg-red-600 hover:bg-red-500 p-2 rounded-lg transition-colors"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-blue-900/30 border border-blue-500/50 rounded-lg p-4">
                <p className="text-blue-200 text-sm text-right">
                  هل أنت متأكد من إنهاء اليوم ونقل جميع الطلبات المكتملة والملغاة إلى الأرشيف؟
                </p>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  onClick={() => {
                    setShowArchiveModal(false);
                  }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg transition-colors font-bold"
                  disabled={isArchiving}
                >
                  إلغاء
                </button>
                <button
                  onClick={handleEndOfDay}
                  disabled={isArchiving}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
                >
                  {isArchiving ? (
                    <>
                      <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                      <span>جاري النقل...</span>
                    </>
                  ) : (
                    <>
                      <Archive className="w-5 h-5" />
                      <span>تأكيد النقل</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-dark rounded-2xl border-2 border-red-500 max-w-md w-full shadow-2xl">
            <div className="bg-red-800/50 p-4 flex items-center justify-between border-b-2 border-red-500">
              <div className="w-10"></div>
              <h2 className="text-2xl font-black text-white">إعادة تعيين البيانات</h2>
              <button
                onClick={() => {
                  setShowResetModal(false);
                  setResetPassword('');
                }}
                className="bg-red-600 hover:bg-red-500 p-2 rounded-lg transition-colors"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-white mb-2 text-right font-bold">
                  كلمة المرور
                </label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className="w-full bg-gray-800 border-2 border-red-500/50 rounded-lg px-4 py-3 text-white text-center font-mono text-xl tracking-widest"
                  placeholder="أدخل كلمة المرور"
                  dir="ltr"
                  autoFocus
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  onClick={() => {
                    setShowResetModal(false);
                    setResetPassword('');
                  }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg transition-colors font-bold"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleResetSystem}
                  disabled={
                    (resetPassword.trim() !== '2007' && resetPassword.trim() !== customerDeletePassword.trim()) || isResetting
                  }
                  className="flex-1 bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
                >
                  {isResetting ? (
                    <>
                      <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                      <span>جاري الحذف...</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-5 h-5" />
                      <span>تأكيد الحذف</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Logo Upload Modal */}
      {showLogoUpload && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-dark rounded-2xl border-2 border-primary max-w-md w-full shadow-2xl">
            <div className="bg-purple-800/50 p-4 flex items-center justify-between border-b-2 border-purple-500">
              <div className="w-10"></div>
              <h2 className="text-2xl font-black text-white">رفع صورة الشعار</h2>
              <button
                onClick={() => {
                  setShowLogoUpload(false);
                  setLogoFile(null);
                  setLogoPreview(logoImageUrl || null);
                }}
                className="bg-red-600 hover:bg-red-500 p-2 rounded-lg transition-colors"
              >
                <X className="w-6 h-6 text-white" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {logoPreview && (
                <div className="relative h-48 bg-gray-800 rounded-lg overflow-hidden border-2 border-purple-500/50">
                  <img
                    src={logoPreview}
                    alt="Logo Preview"
                    className="w-full h-full object-contain"
                  />
                  {logoFile && (
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      className="absolute top-2 right-2 bg-red-600 hover:bg-red-500 text-white p-2 rounded-full transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              <div>
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoSelect}
                  className="hidden"
                  id="logo-upload-modal"
                />
                <label
                  htmlFor="logo-upload-modal"
                  className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-4 py-3 rounded-lg cursor-pointer transition-colors font-bold w-full"
                >
                  <Upload className="w-5 h-5" />
                  <span>اختر صورة الشعار</span>
                </label>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  onClick={() => {
                    setShowLogoUpload(false);
                    setLogoFile(null);
                    setLogoPreview(logoImageUrl || null);
                  }}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg transition-colors font-bold"
                  disabled={isUploadingLogo}
                >
                  إلغاء
                </button>
                <button
                  onClick={handleSaveLogo}
                  disabled={!logoFile || isUploadingLogo}
                  className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
                >
                  {isUploadingLogo ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>جاري الحفظ...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-5 h-5" />
                      <span>حفظ</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
