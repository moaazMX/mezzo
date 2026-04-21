import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const pinIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34]
});

/** خريطة داكنة (Carto Dark Matter) — متناسقة مع الواجهة الليلية */
const DARK_TILE =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

type Props = {
  latitude: number;
  longitude: number;
  className?: string;
};

export default function CustomerMiniMap({ latitude, longitude, className = '' }: Props) {
  const center = useMemo(() => [latitude, longitude] as [number, number], [latitude, longitude]);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return (
      <div
        className={`rounded-xl bg-gray-950 border border-cyan-500/30 flex items-center justify-center text-gray-500 text-sm h-48 ${className}`}
      >
        لا يوجد موقع محفوظ
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl overflow-hidden border border-cyan-500/40 h-48 bg-[#0a0a0f] shadow-inner customer-mini-map-wrap ${className}`}
    >
      <MapContainer
        center={center}
        zoom={16}
        className="h-full w-full z-0 customer-mini-map-container"
        scrollWheelZoom
        attributionControl={false}
      >
        <TileLayer url={DARK_TILE} />
        <Marker position={center} icon={pinIcon} />
      </MapContainer>
      <style>{`
        .customer-mini-map-wrap .customer-mini-map-container {
          background: #0a0a0f !important;
        }
        .customer-mini-map-wrap .leaflet-tile-pane {
          filter: brightness(0.72) contrast(1.08) saturate(0.85);
        }
        .customer-mini-map-wrap .leaflet-control-attribution { display: none; }
      `}</style>
    </div>
  );
}
