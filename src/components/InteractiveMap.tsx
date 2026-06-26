import { useState, useEffect, useRef } from 'react';
import { MapPin, Navigation, ZoomIn, ZoomOut, Search } from 'lucide-react';
import { MapContainer, TileLayer, Polygon, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useLanguage } from '../contexts/LanguageContext';
import { DeliveryZone, DeliveryService } from '../lib/supabase';

// Fix Leaflet icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

L.Marker.prototype.options.icon = DefaultIcon;

/** Injected for both preview and edit modes so tile darkening always applies */
const LEAFLET_DARK_TILE_CSS = `
  .interactive-map-dark .leaflet-tile-pane {
    filter: invert(0.96) hue-rotate(180deg) brightness(0.72) contrast(0.9) saturate(0.7);
  }
  .interactive-map-dark.leaflet-container {
    background: #111827 !important;
  }
`;

interface InteractiveMapProps {
  latitude: number;
  longitude: number;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onLocationChange: (lat: number, lng: number) => void;
  onAddressChange?: (address: { street: string; area: string; city: string; buildingNumber: string }) => void;
  onDragStateChange?: (isDragging: boolean) => void;
  className?: string;
  containerHeight?: string | number;
  isEditing?: boolean;
  zones?: DeliveryZone[];
  services?: DeliveryService[];
  mapType?: 'streets' | 'satellite';
  hideInternalUI?: boolean;
  hideFixedMarker?: boolean;
}

// Helper component to sync map center and zoom
function MapController({ center, zoom }: { center: [number, number], zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center[0], center[1], zoom, map]);
  return null;
}

function MapSizeInvalidator() {
  const map = useMap();
  useEffect(() => {
    const refresh = () => map.invalidateSize();
    const t1 = window.setTimeout(refresh, 80);
    const t2 = window.setTimeout(refresh, 260);
    const t3 = window.setTimeout(refresh, 520);

    const container = map.getContainer();
    const observer = new ResizeObserver(() => refresh());
    observer.observe(container);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      observer.disconnect();
    };
  }, [map]);
  return null;
}

function MapEventsHandler({
  onLocationChange,
  onDragStart,
  onDragEnd,
  onZoomChange,
  isEditing
}: {
  onLocationChange: (lat: number, lng: number) => void,
  onDragStart?: () => void,
  onDragEnd: (lat: number, lng: number) => void,
  onZoomChange: (zoom: number) => void,
  isEditing: boolean
}) {
  const map = useMapEvents({
    dragstart: () => {
      if (!isEditing) return;
      onDragStart?.();
    },
    dragend: () => {
      if (!isEditing) return;
      const center = map.getCenter();
      onDragEnd(center.lat, center.lng);
    },
    moveend: () => {
      if (!isEditing) return;
      const center = map.getCenter();
      onLocationChange(center.lat, center.lng);
    },
    zoomend: () => {
      if (!isEditing) return;
      onZoomChange(map.getZoom());
    }
  });
  return null;
}

export default function InteractiveMap({
  latitude,
  longitude,
  zoom,
  onZoomChange,
  onLocationChange,
  onAddressChange,
  onDragStateChange,
  className = '',
  containerHeight = '400px',
  isEditing = false,
  zones = [],
  services = [],
  mapType = 'streets',
  hideInternalUI = false,
  hideFixedMarker = false
}: InteractiveMapProps) {
  const { language } = useLanguage();
  const [mapCenter, setMapCenter] = useState<[number, number]>([latitude, longitude]);
  const [zoomLevel, setZoomLevel] = useState(zoom ?? 15);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [recenterLoading, setRecenterLoading] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const moveToFirstResultRef = useRef(false);
  const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  // Sync center/zoom from parent when controlled externally (e.g. MobileMapEditor)
  useEffect(() => {
    if (!isEditing) return;
    setMapCenter([latitude, longitude]);
  }, [latitude, longitude, isEditing]);

  useEffect(() => {
    if (zoom !== undefined) {
      setZoomLevel(zoom);
    }
  }, [zoom]);

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=ar`,
        {
          headers: {
            'User-Agent': 'MezzoApp/1.0',
            'Accept-Language': 'ar'
          }
        }
      );

      const data = await response.json();

      if (data && data.address && onAddressChange) {
        const preciseHouseNumber = !!(data.address.house_number && data.osm_type === 'node');
        const address = {
          street: data.address.road || '',
          area: data.address.suburb || data.address.neighbourhood || data.address.quarter || '',
          city: data.address.city || data.address.town || data.address.village || data.address.state || '',
          buildingNumber: preciseHouseNumber ? (data.address.house_number || '') : ''
        };
        onAddressChange(address);
      }
    } catch (error) {
      console.error('Reverse geocoding error:', error);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim().length > 2) {
        performAutocomplete(searchQuery.trim());
      } else {
        setSearchResults([]);
        setShowResults(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (!searchBoxRef.current) return;
      const target = e.target as Node | null;
      if (target && !searchBoxRef.current.contains(target)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, []);

  const performAutocomplete = async (query: string) => {
    try {
      setSearchLoading(true);
      const encoded = encodeURIComponent(query);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encoded}%20Egypt&limit=10&addressdetails=1&accept-language=ar&countrycodes=eg`,
        { headers: { 'User-Agent': 'MezzoApp/1.0', 'Accept-Language': 'ar' } }
      );
      const results = await response.json();
      setSearchResults(results || []);
      setShowResults(true);
    } catch (error) {
      console.error('Autocomplete error:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  const selectResult = (result: any) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (!isNaN(lat) && !isNaN(lng)) {
      setMapCenter([lat, lng]);
      onLocationChange(lat, lng);
      // Construct address from nominatim parts
      if (onAddressChange && result.address) {
        const preciseHouseNumber = !!(result.address.house_number && result.osm_type === 'node');
        onAddressChange({
          street: result.address.road || '',
          area: result.address.suburb || result.address.neighbourhood || result.address.quarter || '',
          city: result.address.city || result.address.town || result.address.village || result.address.state || '',
          buildingNumber: preciseHouseNumber ? (result.address.house_number || '') : ''
        });
      } else {
        reverseGeocode(lat, lng);
      }
      setSearchQuery(result.display_name);
      setShowResults(true);
    }
  };

  const runSearchAndMove = async () => {
    const query = searchQuery.trim();
    if (!query) return;
    moveToFirstResultRef.current = true;
    await performAutocomplete(query);
  };

  useEffect(() => {
    if (moveToFirstResultRef.current && showResults && searchResults.length > 0) {
      // Move to first result after pressing search/enter, while keeping list visible.
      selectResult(searchResults[0]);
      moveToFirstResultRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchResults]);


  const handleRecenter = () => {
    if (!navigator.geolocation) {
      setSearchError(
        language === 'ar'
          ? 'المتصفح لا يدعم تحديد الموقع'
          : 'Geolocation is not supported by your browser'
      );
      return;
    }

    setRecenterLoading(true);
    setSearchError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude: lat, longitude: lng } = position.coords;
        setMapCenter([lat, lng]);
        onLocationChange(lat, lng);
        if (onAddressChange) reverseGeocode(lat, lng);
        setRecenterLoading(false);
      },
      (error) => {
        setRecenterLoading(false);
        let msg = language === 'ar' ? 'تعذر الحصول على موقعك الحالي' : 'Could not get your current location';
        if (error.code === error.PERMISSION_DENIED) {
          msg = language === 'ar' ? 'تم رفض إذن الوصول للموقع' : 'Location permission denied';
        }
        setSearchError(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 1, 18));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 1, 1));
  };

  if (!isEditing) {
    return (
      <>
        <div className={`relative ${className}`} style={{ height: containerHeight }}>
          <MapContainer
            center={[latitude, longitude]}
            zoom={16}
            className="interactive-map-dark w-full h-full rounded-lg overflow-hidden bg-gray-800 pointer-events-none"
            zoomControl={false}
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            touchZoom={false}
            boxZoom={false}
            keyboard={false}
          >
            <TileLayer url={tileUrl} />
            <MapSizeInvalidator />
          </MapContainer>
          <div
            className="absolute top-1/2 left-1/2 z-[400] pointer-events-none"
            style={{ transform: 'translate(-50%, -100%)' }}
          >
            <div className="relative mb-[2px]">
              <MapPin className="w-9 h-9 text-red-600 drop-shadow-2xl" fill="currentColor" />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-800 rounded-full blur-[1px]" />
            </div>
          </div>
        </div>
        <style dangerouslySetInnerHTML={{ __html: LEAFLET_DARK_TILE_CSS }} />
      </>
    );
  }

  return (
    <div className={`relative ${className}`} style={{ height: containerHeight }}>
      <MapContainer
        center={mapCenter}
        zoom={zoomLevel}
        className="w-full h-full rounded-lg overflow-hidden bg-gray-800 interactive-map-dark"
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer
          url={tileUrl}
        />

        <MapController center={mapCenter} zoom={zoomLevel} />
        <MapSizeInvalidator />
        <MapEventsHandler
          onLocationChange={(lat, lng) => {
            setMapCenter([lat, lng]);
            onLocationChange(lat, lng);
          }}
          onDragStart={() => onDragStateChange?.(true)}
          onDragEnd={(lat, lng) => {
            onDragStateChange?.(false);
            reverseGeocode(lat, lng);
          }}
          onZoomChange={(newZoom) => {
            setZoomLevel(newZoom);
            onZoomChange?.(newZoom);
          }}
          isEditing={isEditing}
        />

        {/* Zones */}
        {zones.map(zone => {
          const positions = (zone.polygon_points || []).map(p => [p.lat, p.lng] as [number, number]);
          if (positions.length < 3) return null;
          return (
            <Polygon
              key={zone.id}
              positions={positions}
              pathOptions={{
                fillColor: '#4b5563',
                fillOpacity: 0.15,
                color: '#4b5563',
                weight: 1,
                opacity: 0.4
              }}
            />
          );
        })}

        {/* Service Layers */}
        {services.flatMap(service => (service.layers || []).map(layer => {
          const positions = (layer.polygon_points || []).map(p => [p.lat, p.lng] as [number, number]);
          if (positions.length < 3) return null;
          return (
            <Polygon
              key={layer.id}
              positions={positions}
              pathOptions={{
                fillColor: '#eab308',
                fillOpacity: 0.1,
                color: '#eab308',
                weight: 2,
                opacity: 0.5,
                dashArray: '5, 5'
              }}
            />
          );
        }))}

        {/* Fixed Marker logic in Leaflet typically uses a real marker that stays at center if map moves */}
        {/* But for this UI, we might want the marker fixed in center of the viewport CSS-wise like before */}
      </MapContainer>

      {/* Fixed Marker perfectly centered */}
      {!hideFixedMarker && (
        <div
          className="absolute top-1/2 left-1/2 z-[400] pointer-events-none"
          style={{ transform: 'translate(-50%, -100%)' }}
        >
          <div className="relative mb-[2px]">
            <MapPin className="w-9 h-9 text-red-600 drop-shadow-2xl" fill="currentColor" />
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-800 rounded-full blur-[1px]"></div>
          </div>
        </div>
      )}

      {/* Search bar */}
      {!hideInternalUI && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] w-[92%] max-w-xl" ref={searchBoxRef}>
        <div className="relative">
          <div className="flex items-center bg-[#1e1e1e] rounded-2xl border border-white/10 shadow-2xl overflow-hidden backdrop-blur-xl">
            <button
              type="button"
              onClick={() => void runSearchAndMove()}
              className="w-12 h-12 flex-shrink-0 bg-primary hover:bg-primary/90 text-white flex items-center justify-center transition-all active:scale-95"
              disabled={searchLoading}
            >
              <Search className={`w-5 h-5 ${searchLoading ? 'animate-spin' : ''}`} />
            </button>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runSearchAndMove();
                }
              }}
              onFocus={() => setShowResults(searchResults.length > 0)}
              className="flex-1 bg-transparent text-white px-3 py-3 outline-none placeholder-gray-400 font-bold"
              placeholder={
                language === 'ar'
                  ? 'أدخل الموقع (شارع، منطقة، مدينة...)'
                  : 'Search for a place (street, area, city...)'
              }
              dir={language === 'ar' ? 'rtl' : 'ltr'}
            />
          </div>

          {/* Results Dropdown */}
          {showResults && searchResults.length > 0 && (
            <div 
              className="absolute top-full left-0 right-0 mt-2 bg-[#1e1e1e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-200"
              style={{ maxHeight: '300px', overflowY: 'auto' }}
            >
              {searchResults.map((result, idx) => (
                <button
                  key={idx}
                  onClick={() => selectResult(result)}
                  className="w-full flex items-start gap-3 p-4 hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors text-right group"
                  dir={language === 'ar' ? 'rtl' : 'ltr'}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {result.type === 'house' || result.type === 'postcode' ? (
                      <MapPin className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                    ) : (
                      <Search className="w-5 h-5 text-gray-400 group-hover:text-primary transition-colors" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-bold truncate">
                      {result.display_name.split(',')[0]}
                    </p>
                    <p className="text-gray-400 text-xs truncate mt-0.5">
                      {result.display_name}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {searchError && (
          <p className="mt-2 text-xs text-red-400 text-right bg-black/60 inline-block px-3 py-1 rounded-full shadow-lg">{searchError}</p>
        )}
      </div>
      )}

      {!hideInternalUI && (
        <>
      {/* Zoom Controls */}
      <div className="absolute top-1/2 -translate-y-1/2 right-2 flex flex-col gap-2 z-[500]">
        <button
          type="button"
          onClick={handleZoomIn}
          disabled={zoomLevel >= 18}
          className="bg-black/70 hover:bg-black/90 text-white p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          title={language === 'ar' ? 'تكبير' : 'Zoom In'}
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          disabled={zoomLevel <= 1}
          className="bg-black/70 hover:bg-black/90 text-white p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          title={language === 'ar' ? 'تصغير' : 'Zoom Out'}
        >
          <ZoomOut className="w-5 h-5" />
        </button>
      </div>

      {/* Recenter button */}
      <button
        type="button"
        onClick={handleRecenter}
        className="absolute bottom-3 right-3 z-[500] bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-full shadow-lg transition-colors flex items-center justify-center"
        title={language === 'ar' ? 'العودة لموقعي' : 'Back to my location'}
      >
        <Navigation className={`w-5 h-5 ${recenterLoading ? 'animate-spin' : ''}`} />
      </button>

      <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded z-[500]">
        {language === 'ar' ? 'اسحب الخريطة لتغيير الموقع' : 'Drag map to change location'}
      </div>
        </>
      )}

      <style dangerouslySetInnerHTML={{
        __html: `
        ${LEAFLET_DARK_TILE_CSS}
        .animate-in {
          animation: animateIn 0.2s ease-out forwards;
        }
        @keyframes animateIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}} />
    </div>
  );
}
