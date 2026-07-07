import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DeliveryZoneLayer, PolygonPoint } from '../../lib/supabase';

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

const LIGHT_TILE = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

const LAYER_COLORS = [
  { stroke: '#ca8a04', fill: '#eab308' },
  { stroke: '#d97706', fill: '#fbbf24' },
  { stroke: '#65a30d', fill: '#a3e635' },
  { stroke: '#0891b2', fill: '#22d3ee' },
];

type Props = {
  branchLocation?: PolygonPoint | null | unknown;
  layers?: DeliveryZoneLayer[];
  blockerZones?: { polygon_points: unknown }[];
  className?: string;
};

function toLatLngs(points: unknown): [number, number][] {
  return parsePolygonPoints(points).map((p) => [p.lat, p.lng] as [number, number]);
}

function FitAllBounds({
  layers,
  blockerZones,
}: {
  layers?: DeliveryZoneLayer[];
  blockerZones?: { polygon_points: unknown }[];
}) {
  const map = useMap();
  const allPoints = useMemo(() => {
    const pts: [number, number][] = [];
    for (const layer of layers || []) {
      pts.push(...toLatLngs(layer.polygon_points));
    }
    for (const zone of blockerZones || []) {
      pts.push(...toLatLngs(zone.polygon_points));
    }
    return pts;
  }, [layers, blockerZones]);

  useEffect(() => {
    if (allPoints.length >= 2) {
      map.fitBounds(L.latLngBounds(allPoints), { padding: [28, 28], maxZoom: 14 });
    } else if (allPoints.length === 1) {
      map.setView(allPoints[0], 14);
    }
  }, [map, allPoints]);

  return null;
}

export default function DeliveryZonePreviewMap({
  branchLocation,
  layers = [],
  blockerZones = [],
  className = '',
}: Props) {
  const branch = useMemo(() => parseBranchLocation(branchLocation), [branchLocation]);

  const defaultCenter = useMemo((): [number, number] => {
    const firstLayer = layers.find((l) => parsePolygonPoints(l.polygon_points).length >= 3);
    if (firstLayer) {
      const pts = toLatLngs(firstLayer.polygon_points);
      if (pts.length) return pts[0];
    }
    if (branch) return [branch.lat, branch.lng];
    return [30.0444, 31.2357];
  }, [branch, layers]);

  const hasGeometry =
    layers.some((l) => parsePolygonPoints(l.polygon_points).length >= 3) ||
    blockerZones.some((z) => parsePolygonPoints(z.polygon_points).length >= 3);

  if (!hasGeometry) {
    return (
      <div className={`flex h-56 items-center justify-center rounded-xl border border-[var(--op-border)] bg-[#f8fafc] text-sm text-[var(--op-muted)] ${className}`}>
        —
      </div>
    );
  }

  return (
    <div className={`delivery-zone-preview-map overflow-hidden rounded-xl border border-yellow-500/40 bg-[#f1f5f9] ${className}`}>
      <MapContainer
        center={defaultCenter}
        zoom={13}
        className="h-full w-full z-0 pointer-events-none"
        style={{ height: '100%', minHeight: '14rem' }}
        scrollWheelZoom={false}
        dragging={false}
        zoomControl={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        keyboard={false}
        attributionControl={false}
      >
        <TileLayer url={LIGHT_TILE} />
        <FitAllBounds layers={layers} blockerZones={blockerZones} />

        {blockerZones.map((zone, idx) => {
          const positions = toLatLngs(zone.polygon_points);
          if (positions.length < 3) return null;
          return (
            <Polygon
              key={`blocker-${idx}`}
              positions={positions}
              pathOptions={{
                color: '#dc2626',
                fillColor: '#ef4444',
                fillOpacity: 0.2,
                weight: 2,
                dashArray: '6 4',
              }}
            />
          );
        })}

        {layers.map((layer, idx) => {
          const positions = toLatLngs(layer.polygon_points);
          if (positions.length < 3) return null;
          const color = LAYER_COLORS[idx % LAYER_COLORS.length];
          return (
            <Polygon
              key={layer.id}
              positions={positions}
              pathOptions={{
                color: color.stroke,
                fillColor: color.fill,
                fillOpacity: 0.28,
                weight: 2.5,
              }}
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
