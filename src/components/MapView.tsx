import { useState, useEffect } from 'react';
import { X, ExternalLink, MapPin } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';

interface MapViewProps {
  isOpen: boolean;
  onClose: () => void;
  latitude: number;
  longitude: number;
  customerName?: string;
  address?: string;
}

export default function MapView({ isOpen, onClose, latitude, longitude, customerName, address }: MapViewProps) {
  const { language } = useLanguage();
  const { theme } = useTheme();
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Validate coordinates
    if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
      setMapError(language === 'ar' ? 'إحداثيات غير صحيحة' : 'Invalid coordinates');
      return;
    }

    setMapError(null);
  }, [isOpen, latitude, longitude, language]);

  const openInGoogleMaps = () => {
    const url = `https://www.google.com/maps?q=${latitude},${longitude}`;
    window.open(url, '_blank');
  };

  const openInAppleMaps = () => {
    const url = `https://maps.apple.com/?q=${latitude},${longitude}`;
    window.open(url, '_blank');
  };

  if (!isOpen) return null;

  if (mapError || !latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
    return (
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="bg-dark rounded-2xl border-2 border-primary max-w-md w-full shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-primary/30 p-4 flex items-center justify-between border-b-2 border-primary">
            <button
              onClick={onClose}
              className="bg-red-600 hover:bg-red-500 p-2 rounded-lg transition-colors"
            >
              <X className="w-6 h-6 text-white" />
            </button>
            <h2 className="text-2xl font-black text-white">{language === 'ar' ? 'الخريطة' : 'Map'}</h2>
            <div className="w-10"></div>
          </div>
          <div className="p-6 text-center">
            <p className="text-red-400 mb-4">{mapError || (language === 'ar' ? 'إحداثيات غير صحيحة' : 'Invalid coordinates')}</p>
            <button
              onClick={onClose}
              className="bg-primary hover:bg-primary/80 text-white px-6 py-2 rounded-lg"
            >
              {language === 'ar' ? 'إغلاق' : 'Close'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Use OpenStreetMap with Leaflet (no API key required)
  // For embedded view, we'll use a simple iframe to OpenStreetMap or provide external links
  const openStreetMapUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}&zoom=15`;

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-dark rounded-2xl border-2 border-primary max-w-4xl w-full shadow-2xl flex flex-col"
        style={{ height: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-primary/30 p-4 flex items-center justify-between border-b-2 border-primary">
          <button
            onClick={onClose}
            className="bg-red-600 hover:bg-red-500 p-2 rounded-lg transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-muted" />
            <h2 className="text-2xl font-black text-white">{language === 'ar' ? 'موقع العميل' : 'Customer Location'}</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={openInGoogleMaps}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
              title={language === 'ar' ? 'فتح في Google Maps' : 'Open in Google Maps'}
            >
              <ExternalLink className="w-4 h-4" />
              <span className="text-sm font-bold">Google</span>
            </button>
            <button
              onClick={openInAppleMaps}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
              title={language === 'ar' ? 'فتح في Apple Maps' : 'Open in Apple Maps'}
            >
              <ExternalLink className="w-4 h-4" />
              <span className="text-sm font-bold">Apple</span>
            </button>
            <button
              onClick={() => window.open(openStreetMapUrl, '_blank')}
              className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
              title={language === 'ar' ? 'فتح في OpenStreetMap' : 'Open in OpenStreetMap'}
            >
              <ExternalLink className="w-4 h-4" />
              <span className="text-sm font-bold">OSM</span>
            </button>
          </div>
        </div>

        <div className="flex-1 relative overflow-hidden bg-gray-800">
          {customerName && (
            <div className="absolute top-4 left-4 z-10 bg-dark/90 border-2 border-primary rounded-lg p-3 max-w-xs">
              <p className="text-white font-bold text-sm mb-1">{customerName}</p>
              {address && (
                <p className="text-muted text-xs">{address}</p>
              )}
              <p className="text-primary text-xs mt-1">
                {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </p>
            </div>
          )}

          <iframe
            width="100%"
            height="100%"
            style={{ border: 0, filter: theme === 'dark' ? 'invert(0.9) hue-rotate(180deg) brightness(0.8)' : 'none' }}
            loading="lazy"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${longitude - 0.01},${latitude - 0.01},${longitude + 0.01},${latitude + 0.01}&layer=mapnik&marker=${latitude},${longitude}`}
            title={language === 'ar' ? 'خريطة موقع العميل' : 'Customer Location Map'}
          />
        </div>
      </div>
    </div>
  );
}
