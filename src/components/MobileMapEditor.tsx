import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, Search, X, Navigation, ChevronRight, Plus, Minus } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import InteractiveMap from './InteractiveMap';
import { DeliveryZone, DeliveryService } from '../lib/supabase';
import { getDeliveryMatch } from '../lib/deliveryMatch';

interface MobileMapEditorProps {
  initialLatitude?: number;
  initialLongitude?: number;
  onConfirm: (data: {
    latitude: number;
    longitude: number;
    city: string;
    area: string;
    street: string;
    buildingNumber: string;
  }) => void;
  onCancel: () => void;
  zones?: DeliveryZone[];
  services?: DeliveryService[];
  showVisualZones?: boolean;
  title?: string;
}

export default function MobileMapEditor({
  initialLatitude,
  initialLongitude,
  onConfirm,
  onCancel,
  zones = [],
  services = [],
  showVisualZones = false,
  title
}: MobileMapEditorProps) {
  const { language } = useLanguage();
  const [currentLat, setCurrentLat] = useState(initialLatitude ?? 30.0444);
  const [currentLng, setCurrentLng] = useState(initialLongitude ?? 31.2357);
  const [isMapDragging, setIsMapDragging] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [zoom, setZoom] = useState(15);

  const [addressData, setAddressData] = useState({
    city: '',
    area: '',
    street: '',
    buildingNumber: ''
  });

  // Lock body scroll when map is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const match = getDeliveryMatch(currentLat, currentLng, services, zones);
  const isInsideZone = match.isInGreen;

  // Reverse geocode when position stabilizes
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

      if (data && data.address) {
        const preciseHouseNumber = !!(data.address.house_number && data.osm_type === 'node');
        setAddressData({
          street: data.address.road || '',
          area: data.address.suburb || data.address.neighbourhood || data.address.quarter || '',
          city: data.address.city || data.address.town || data.address.village || data.address.state || '',
          buildingNumber: preciseHouseNumber ? (data.address.house_number || '') : ''
        });
      }
    } catch (error) {
      console.error('Reverse geocoding error:', error);
    }
  };

  const performSearch = async (query: string) => {
    if (query.trim().length < 3) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    try {
      setSearchLoading(true);
      const encoded = encodeURIComponent(query);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encoded}%20Egypt&limit=15&addressdetails=1&accept-language=ar&countrycodes=eg`,
        { headers: { 'User-Agent': 'MezzoApp/1.0', 'Accept-Language': 'ar' } }
      );
      const results = await response.json();
      setSearchResults(results || []);
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchResultClick = (result: any) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    if (!isNaN(lat) && !isNaN(lng)) {
      setCurrentLat(lat);
      setCurrentLng(lng);

      // Update address data from result if available
      if (result.address) {
        const preciseHouseNumber = !!(result.address.house_number && result.osm_type === 'node');
        setAddressData({
          street: result.address.road || '',
          area: result.address.suburb || result.address.neighbourhood || result.address.quarter || '',
          city: result.address.city || result.address.town || result.address.village || result.address.state || '',
          buildingNumber: preciseHouseNumber ? (result.address.house_number || '') : ''
        });
      } else {
        reverseGeocode(lat, lng);
      }

      setIsSearching(false);
      setSearchQuery('');
      setSearchResults([]);
    }
  };

  // Initial reverse geocode
  useEffect(() => {
    reverseGeocode(currentLat, currentLng);
  }, []);

  if (isSearching) {
    return createPortal(
      <div className="fixed inset-0 z-[10000] bg-dark flex flex-col animate-in fade-in duration-200">
        <div className="flex items-center gap-3 bg-surface/95 backdrop-blur-xl px-4 h-16 shrink-0 border-b border-white/5">
          <button
            onClick={() => {
              setIsSearching(false);
              setSearchQuery('');
              setSearchResults([]);
            }}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white active:scale-95 transition-all"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          <div className="flex-1 relative">
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                performSearch(e.target.value);
              }}
              placeholder={language === 'ar' ? 'بحث عن موقع...' : 'Search for location...'}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-primary/50 transition-all text-right"
              dir="rtl"
            />
            {searchLoading && (
              <div className="absolute left-3 top-1/2 -translate-y-1/2">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 custom-scrollbar">
          {searchResults.length === 0 && searchQuery.length >= 3 && !searchLoading && (
            <div className="py-12 text-center text-muted">
              {language === 'ar' ? 'لا توجد نتائج' : 'No results found'}
            </div>
          )}

          {searchResults.map((result, idx) => (
            <button
              key={idx}
              onClick={() => handleSearchResultClick(result)}
              className="w-full flex items-start gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-transparent active:border-primary/30 transition-all text-right group"
              dir="rtl"
            >
              <div className="p-3 rounded-xl bg-primary/10 text-primary group-active:scale-90 transition-transform">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-black truncate text-lg">
                  {result.display_name.split(',')[0]}
                </p>
                <p className="text-muted text-sm truncate mt-0.5 font-bold">
                  {result.display_name}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-md flex items-center justify-center p-0 md:p-8">
      <div className="bg-dark w-full h-full md:max-w-5xl md:h-[90vh] flex flex-col shadow-2xl overflow-hidden md:rounded-3xl animate-in zoom-in-95 duration-300">
        {/* Header Bar */}
        <div className="flex items-center justify-between bg-surface/95 backdrop-blur-xl px-4 h-14 shrink-0 border-b border-white/5 z-[1501] relative">
          <div className="flex items-center gap-4 flex-1">
            {/* Mobile Search Button */}
            <button
              type="button"
              onClick={() => setIsSearching(true)}
              className="md:hidden w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white active:scale-90 transition-all touch-manipulation"
            >
              <Search className="w-5 h-5" />
            </button>

            {/* Desktop Search Field */}
            <div className="hidden md:flex items-center relative w-full max-w-xs">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  performSearch(e.target.value);
                }}
                placeholder={language === 'ar' ? 'بحث عن موقع...' : 'Search for location...'}
                className="w-full bg-white/10 border border-white/10 rounded-xl px-4 py-1.5 text-xs text-white outline-none focus:border-primary/50 transition-all text-right pr-9"
                dir="rtl"
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />

              {/* Desktop Search Results Dropdown */}
              {searchQuery.length >= 3 && searchResults.length > 0 && (
                <div className="absolute top-full right-0 mt-2 w-72 bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[2000] max-h-60 overflow-y-auto custom-scrollbar">
                  {searchResults.map((result, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSearchResultClick(result)}
                      className="w-full p-3 text-right hover:bg-primary/20 border-b border-white/5 last:border-0 transition-colors"
                    >
                      <p className="text-white text-[11px] font-black truncate">{result.display_name.split(',')[0]}</p>
                      <p className="text-gray-400 text-[9px] truncate">{result.display_name}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-center px-4">
            <h3 className="text-sm font-black text-white/90 whitespace-nowrap">
              {title || (language === 'ar' ? 'تحديد الموقع' : 'Select location')}
            </h3>
          </div>

          <div className="flex justify-end flex-1">
            <button
              type="button"
              onClick={onCancel}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 text-white active:scale-90 transition-all touch-manipulation"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 relative overflow-hidden bg-dark">
          <InteractiveMap
            latitude={currentLat}
            longitude={currentLng}
            zoom={zoom}
            onZoomChange={setZoom}
            onLocationChange={(lat, lng) => {
              setCurrentLat(lat);
              setCurrentLng(lng);
            }}
            onAddressChange={(data) => {
              setAddressData(prev => ({
                ...prev,
                street: data.street || prev.street,
                area: data.area || prev.area,
                city: data.city || prev.city,
                buildingNumber: data.buildingNumber || prev.buildingNumber
              }));
            }}
            isEditing={true}
            zones={showVisualZones ? zones : []}
            services={showVisualZones ? services : []}
            className="h-full w-full"
            containerHeight="100%"
            onDragStateChange={setIsMapDragging}
            hideInternalUI={true}
            hideFixedMarker={true}
            mapType="streets"
          />

          {/* Centered Pin with Tooltip */}
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center z-[1502]">
            <div
              className={`mb-6 bg-[#4B4B4B] text-white text-[11px] font-black px-4 py-2 rounded-xl shadow-2xl relative z-10 transition-all duration-300 transform-gpu ${isMapDragging ? 'opacity-0 scale-90 translate-y-2' : 'opacity-100 scale-100 translate-y-0'}`}
            >
              {language === 'ar' ? 'سيتم إرسال الطلبات إلى هذا المكان' : 'Orders will be delivered here'}
              {/* Tooltip arrow */}
              <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#4B4B4B] rotate-45" />
            </div>
            <div className="relative pointer-events-none -translate-y-5">
              <MapPin className={`w-10 h-10 text-primary drop-shadow-[0_10px_10px_rgba(0,0,0,0.5)] transition-transform duration-200 ${isMapDragging ? 'scale-110 -translate-y-4' : 'scale-100'}`} fill="currentColor" />
              <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-1 bg-black/40 rounded-full blur-[2px] transition-all duration-200 ${isMapDragging ? 'scale-150 opacity-100' : 'scale-100 opacity-50'}`} />
            </div>
          </div>

          {/* Floating Action Buttons */}
          <div className="absolute bottom-44 left-4 flex flex-col gap-3 z-[1502]">
            {/* Zoom Controls */}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setZoom(prev => Math.min(prev + 1, 18))}
                className="w-12 h-12 flex items-center justify-center rounded-2xl bg-surface/90 backdrop-blur-xl text-white border border-white/10 shadow-2xl active:scale-95 transition-all"
              >
                <Plus className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(prev => Math.max(prev - 1, 1))}
                className="w-12 h-12 flex items-center justify-center rounded-2xl bg-surface/90 backdrop-blur-xl text-white border border-white/10 shadow-2xl active:scale-95 transition-all"
              >
                <Minus className="w-5 h-5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                if (navigator.geolocation) {
                  navigator.geolocation.getCurrentPosition((pos) => {
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    setCurrentLat(lat);
                    setCurrentLng(lng);
                    // Immediately trigger reverse geocode for new center
                    reverseGeocode(lat, lng);
                  }, (err) => {
                    console.error(err);
                  }, { enableHighAccuracy: true });
                }
              }}
              className="w-12 h-12 flex items-center justify-center rounded-2xl bg-primary text-white shadow-2xl shadow-primary/40 active:scale-95 transition-all touch-manipulation relative overflow-hidden group"
            >
              <Navigation className="w-6 h-6 group-active:translate-x-1 group-active:-translate-y-1 transition-transform" />
              <div className="absolute inset-0 bg-white/10 opacity-0 group-active:opacity-100 transition-opacity" />
            </button>
          </div>

          {/* Address Bottom Sheet */}
          <div className="absolute bottom-0 inset-x-0 bg-surface/95 backdrop-blur-2xl border-t border-white/5 rounded-t-[2rem] p-4 pb-6 z-[1503]">
            <div className="flex items-start gap-4 mb-4" dir={language === 'ar' ? 'rtl' : 'ltr'}>
              <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-lg font-black text-white truncate leading-none mb-1 text-right">
                  {addressData.city || (language === 'ar' ? 'موقع غير معروف' : 'Unknown location')}
                </h4>
                <p className="text-muted text-[11px] font-bold truncate text-right">
                  {addressData.area || ''} {addressData.street || ''}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={!isInsideZone || isMapDragging}
              onClick={() => {
                onConfirm({
                  latitude: currentLat,
                  longitude: currentLng,
                  ...addressData
                });
              }}
              className={`w-full py-4 rounded-2xl font-black text-lg shadow-xl transition-all flex items-center justify-center gap-2 ${isInsideZone
                  ? 'bg-primary hover:bg-primary/90 text-white shadow-primary/20 active:scale-[0.98]'
                  : 'bg-gray-600 text-white/50 cursor-not-allowed opacity-80'
                }`}
            >
              {isInsideZone
                ? (language === 'ar' ? 'تأكيد العنوان' : 'Confirm address')
                : (language === 'ar' ? 'خارج منطقة التوصيل' : 'Outside delivery zone')
              }
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
