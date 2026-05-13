import { supabase } from './supabase';
import type { DeliveryService, DeliveryZone, DeliveryZoneLayer } from './supabase';
import { isPointInPolygon } from './geoUtils';

export type DeliveryMatchResult = {
  isInGreen: boolean;
  isInYellow: boolean;
  price: number;
  service?: DeliveryService;
  layer?: DeliveryZoneLayer | null;
  activeZone?: DeliveryZone;
};

/**
 * Shared delivery zone + service-layer matching for checkout UI and order confirmation.
 */
export function getDeliveryMatch(
  lat: number,
  lng: number,
  services: DeliveryService[],
  zones: DeliveryZone[]
): DeliveryMatchResult {
  const point = { lat, lng };
  let isInYellow = false;
  let bestLayerMatch: { service: DeliveryService; layer: DeliveryZoneLayer; price: number; order: number } | null = null;
  let matchedGreenZone: DeliveryZone | undefined;

  if (zones && zones.length > 0) {
    for (const zone of zones) {
      if (!zone.is_active) continue;
      if (zone.polygon_points && zone.polygon_points.length >= 3) {
        if (isPointInPolygon(point, zone.polygon_points)) {
          matchedGreenZone = zone;
          break;
        }
      }
    }
  }

  if (services && services.length > 0) {
    services.forEach((service) => {
      if (!service.is_active) return;
      const layers = (service.layers || []).slice();
      layers.forEach((layer) => {
        if (!layer.polygon_points || layer.polygon_points.length < 3) return;
        if (isPointInPolygon(point, layer.polygon_points)) {
          isInYellow = true;
          const price = Number(layer.delivery_price || 0);
          const order = layer.order_index || 0;
          if (!bestLayerMatch || order < bestLayerMatch.order) {
            bestLayerMatch = { service, layer, price, order };
          }
        }
      });
    });
  }

  if (isInYellow && bestLayerMatch) {
    const match = bestLayerMatch as { service: DeliveryService; layer: DeliveryZoneLayer; price: number; order: number };
    return {
      isInGreen: true,
      isInYellow: true,
      price: match.price,
      service: match.service,
      layer: match.layer,
      activeZone: matchedGreenZone
    };
  }

  if (matchedGreenZone) {
    return {
      isInGreen: true,
      isInYellow: false,
      price: Number(matchedGreenZone.base_delivery_price || 0),
      activeZone: matchedGreenZone
    };
  }

  return {
    isInGreen: false,
    isInYellow: false,
    price: 0
  };
}

/** Loads the same zone/service geometry the checkout uses — for authoritative order validation. */
export async function fetchDeliveryZonesAndServices(): Promise<{
  zones: DeliveryZone[];
  services: DeliveryService[];
}> {
  const { data: rawZones, error: zoneError } = await supabase
    .from('delivery_zones')
    .select('*')
    .eq('is_active', true);

  if (zoneError) {
    console.error('fetchDeliveryZonesAndServices zones:', zoneError);
  }

  const zones: DeliveryZone[] = (rawZones || []).map((zone: any) => {
    const parsedPoints = zone.polygon_points
      ? typeof zone.polygon_points === 'string'
        ? JSON.parse(zone.polygon_points)
        : zone.polygon_points
      : [];
    return {
      ...zone,
      polygon_points: parsedPoints
    };
  });

  const { data: servicesData, error: servicesError } = await supabase
    .from('delivery_services')
    .select('*')
    .eq('is_active', true);

  if (servicesError) {
    console.error('fetchDeliveryZonesAndServices services:', servicesError);
  }

  const { data: layersData, error: layersError } = await supabase.from('delivery_zone_layers').select('*');

  if (layersError) {
    console.error('fetchDeliveryZonesAndServices layers:', layersError);
  }

  const layersByService: Record<string, DeliveryZoneLayer[]> = {};

  if (layersData) {
    layersData.forEach((layer: any) => {
      const serviceId = layer.service_id;
      if (!serviceId) return;

      const parsedPoints = layer.polygon_points
        ? typeof layer.polygon_points === 'string'
          ? JSON.parse(layer.polygon_points)
          : layer.polygon_points
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

  const services: DeliveryService[] = (servicesData || []).map((service: any) => {
    const rawBranch = service.branch_location;
    const branch_location = rawBranch
      ? typeof rawBranch === 'string'
        ? JSON.parse(rawBranch)
        : rawBranch
      : null;

    const layers = (layersByService[service.id] || []).slice().sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    return {
      id: service.id,
      name: service.name,
      branch_location,
      is_active: service.is_active,
      created_at: service.created_at,
      layers
    } as DeliveryService;
  });

  return { zones, services };
}
