import { useEffect, useState, useCallback } from 'react';
import { Loader2, MapPinned } from 'lucide-react';
import { supabase, DeliveryService, DeliveryZone, PolygonPoint } from '../../lib/supabase';
import { useOperatorPreferences } from '../../contexts/OperatorPreferencesContext';
import { useRealtimeRefetch } from '../../hooks/useRealtimeSubscription';
import DeliveryZonePreviewMap from './DeliveryZonePreviewMap';

function parsePolygonPoints(raw: unknown): PolygonPoint[] {
  if (!raw) return [];
  let points: unknown = raw;
  if (typeof points === 'string') {
    try {
      points = JSON.parse(points);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(points)) return [];
  return points
    .map((p: { lat?: number; lng?: number; latitude?: number; longitude?: number; label?: number }) => {
      const lat = p?.lat ?? p?.latitude;
      const lng = p?.lng ?? p?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat: Number(lat), lng: Number(lng), label: p?.label };
    })
    .filter((p): p is PolygonPoint => p !== null);
}

function parseBranchLocation(raw: unknown): PolygonPoint | null {
  if (!raw) return null;
  let loc: unknown = raw;
  if (typeof loc === 'string') {
    try {
      loc = JSON.parse(loc);
    } catch {
      return null;
    }
  }
  const point = loc as { lat?: number; lng?: number; latitude?: number; longitude?: number };
  const lat = point?.lat ?? point?.latitude;
  const lng = point?.lng ?? point?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat: Number(lat), lng: Number(lng) };
}

export default function DeliveryLayersOverview() {
  const { t } = useOperatorPreferences();
  const [services, setServices] = useState<DeliveryService[]>([]);
  const [blockerZones, setBlockerZones] = useState<DeliveryZone[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: svc }, { data: layers }, { data: zones }] = await Promise.all([
      supabase.from('delivery_services').select('*').order('name'),
      supabase.from('delivery_zone_layers').select('*'),
      supabase.from('delivery_zones').select('*'),
    ]);
    const merged = (svc || []).map((s) => ({
      ...s,
      branch_location: parseBranchLocation(s.branch_location),
      layers: (layers || [])
        .filter((l) => l.service_id === s.id)
        .map((l) => ({
          ...l,
          polygon_points: parsePolygonPoints(l.polygon_points),
        })),
    }));
    setServices(merged as DeliveryService[]);
    setBlockerZones(
      ((zones || []) as DeliveryZone[]).map((z) => ({
        ...z,
        polygon_points: parsePolygonPoints(z.polygon_points),
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useRealtimeRefetch(
    'op-delivery-overview',
    ['delivery_services', 'delivery_zone_layers', 'delivery_zones'],
    () => {
      void loadData();
    }
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black text-[var(--op-text)] text-start flex items-center gap-2">
          <MapPinned className="h-6 w-6 text-[var(--op-accent)]" />
          {t('أماكن التوصيل والطلب', 'Delivery & Pickup')}
        </h2>
        <p className="mt-1 text-sm text-[var(--op-muted)] text-start">
          {t('معاينة طبقات التوصيل — للعرض فقط', 'Delivery layer preview — read only')}
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-[var(--op-muted)]" /></div>
      ) : services.length === 0 ? (
        <div className="op-panel py-12 text-center text-[var(--op-muted)]">{t('لا توجد خدمات توصيل', 'No delivery services')}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {services.map((service) => (
            <div key={service.id} className="op-panel overflow-hidden">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-black text-[var(--op-text)]">{service.name}</h3>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${service.is_active ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-400'}`}>
                  {service.is_active ? t('فعال', 'Active') : t('معطل', 'Inactive')}
                </span>
              </div>
              <DeliveryZonePreviewMap
                branchLocation={service.branch_location}
                layers={service.layers}
                blockerZones={blockerZones}
                className="mb-3 h-56 md:h-64"
              />
              <div className="space-y-2">
                {(service.layers || []).length === 0 ? (
                  <p className="text-xs text-[var(--op-muted)]">{t('لا توجد طبقات تسعير', 'No pricing layers')}</p>
                ) : (
                  (service.layers || []).map((layer) => (
                    <div key={layer.id} className="flex items-center justify-between rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-sm">
                      <span className="font-bold text-[var(--op-text)]">{layer.name || t('طبقة', 'Layer')}</span>
                      <span className="text-yellow-300 font-black">{layer.delivery_price} {t('ج', 'EG')}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
