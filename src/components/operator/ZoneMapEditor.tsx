import { useState, useEffect, useMemo } from 'react';
import { X, Save, Trash2, Edit2, Plus, Navigation, ZoomIn, ZoomOut } from 'lucide-react';
import { MapContainer, TileLayer, Polygon, Marker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { DeliveryZone, PolygonPoint } from '../../lib/supabase';
import {
  getPolygonCenter,
  isPointInPolygon,
  ensurePointLabels,
  insertPolygonPoint,
  removePolygonPointByLabel
} from '../../lib/geoUtils';

// Fix Leaflet icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

// Custom vertex icon for editing
const vertexIcon = L.divIcon({
  className: 'custom-vertex-icon',
  html: '<div style="background-color: white; border: 2px solid #a855f7; width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6]
});

const hoveredVertexIcon = L.divIcon({
  className: 'custom-vertex-icon-hovered',
  html: '<div style="background-color: #ef4444; border: 2px solid white; width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 6px rgba(239, 68, 68, 0.8);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

const branchIcon = L.divIcon({
  className: 'custom-branch-icon',
  html: '<div style="background-color: #ef4444; border: 2px solid white; width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 6px rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 10px;">+</div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

interface ZoneMapEditorProps {
  zones: DeliveryZone[];
  onZoneCreate: (zoneData: { 
    name: string; 
    polygon_points: PolygonPoint[]; 
    is_active: boolean; 
    base_delivery_price: number;
    branch_location?: PolygonPoint | null;
  }) => Promise<void>;
  onZoneUpdate: (zoneId: string, updates: Partial<DeliveryZone>) => Promise<void>;
  onZoneDelete: (zoneId: string) => Promise<void>;
  onClose: () => void;
}

interface EditingZone {
  id: string | null;
  name: string;
  points: PolygonPoint[];
  is_active: boolean;
  base_delivery_price: number;
}

// Map Controller for syncing center and zoom
function MapController({ center, zoom }: { center: [number, number], zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

// Map Events component for drawing
function MapEventsHandler({
  onMapClick,
  onMapHover,
  isDrawing
}: {
  onMapClick: (lat: number, lng: number) => void,
  onMapHover: (lat: number, lng: number, x: number, y: number) => void,
  isDrawing: boolean
}) {
  useMapEvents({
    click: (e) => {
      if (isDrawing) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
    mousemove: (e) => {
      onMapHover(e.latlng.lat, e.latlng.lng, e.containerPoint.x, e.containerPoint.y);
    },
    mouseup: () => {
      window.dispatchEvent(new CustomEvent('mapMouseUp'));
    }
  });
  return null;
}

function MapMouseMoveHandler({
  isDragging,
  lastPos,
  onDrag,
  onStop
}: {
  isDragging: boolean,
  lastPos: L.LatLng | null,
  onDrag: (pos: L.LatLng) => void,
  onStop: () => void
}) {
  const map = useMap();

  useEffect(() => {
    if (isDragging) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [isDragging, map]);

  useMapEvents({
    mousemove: (e) => {
      if (isDragging) {
        onDrag(e.latlng);
      }
    },
    mouseup: () => {
      if (isDragging) {
        onStop();
      }
    }
  });

  useEffect(() => {
    const handleUp = () => {
      if (isDragging) onStop();
    };
    window.addEventListener('mapMouseUp', handleUp);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mapMouseUp', handleUp);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, onStop]);

  return null;
}

export default function ZoneMapEditor({
  zones,
  onZoneCreate,
  onZoneUpdate,
  onZoneDelete,
  onClose
}: ZoneMapEditorProps) {
  const [mapCenter, setMapCenter] = useState<[number, number]>([31.204662, 30.182862]);
  const [zoomLevel, setZoomLevel] = useState(13);
  const [isDrawing, setIsDrawing] = useState(false);
  const [editingZone, setEditingZone] = useState<EditingZone | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [hoveredZone, setHoveredZone] = useState<{ id: string; name: string; price: number; x: number; y: number } | null>(null);
  const [hoveredPointLabel, setHoveredPointLabel] = useState<number | null>(null);
  const [canEditPoints, setCanEditPoints] = useState(false);
  const [centerPin, setCenterPin] = useState<PolygonPoint | null>(null);
  const [isDraggingPolygon, setIsDraggingPolygon] = useState(false);
  const [lastMousePos, setLastMousePos] = useState<L.LatLng | null>(null);
  const [lastDragTime, setLastDragTime] = useState(0);
  const [hasMovedDuringDrag, setHasMovedDuringDrag] = useState(false);
  const [movePinFreely, setMovePinFreely] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (zones.length > 0 && zones[0].polygon_points && zones[0].polygon_points.length > 0) {
      const center = zones[0].branch_location || getPolygonCenter(zones[0].polygon_points);
      setMapCenter([center.lat, center.lng]);
    }
  }, []);

  const handleMapClick = (lat: number, lng: number) => {
    if (!editingZone || !isDrawing || !canEditPoints) return;
    if (Date.now() - lastDragTime < 200) return; // Ignore clicks right after dragging
    
    const newPoints = insertPolygonPoint(editingZone.points, { lat, lng });

    setEditingZone({
      ...editingZone,
      points: newPoints
    });
  };

  const handleMapHover = (lat: number, lng: number, x: number, y: number) => {
    if (isDrawing || editingZone) {
      setHoveredZone(null);
      return;
    }

    let found = null;
    const point = { lat, lng };

    for (const zone of zones) {
      if (zone.polygon_points && zone.polygon_points.length >= 3) {
        if (isPointInPolygon(point, zone.polygon_points)) {
          found = {
            id: zone.id,
            name: zone.name,
            price: Number(zone.base_delivery_price || 0),
            x,
            y: y + 80 // Adjustment for tooltip position relative to container
          };
          break;
        }
      }
    }
    setHoveredZone(found);
  };

  const handleStartNewZone = () => {
    setCenterPin(null);
    setEditingZone({
      id: null,
      name: '',
      points: [],
      is_active: true,
      base_delivery_price: 0
    });
    setIsDrawing(true);
    setCanEditPoints(true);
    setZoneName('');
    setSelectedZoneId(null);
    setMovePinFreely(false);
  };

  const handleEditZone = (zone: DeliveryZone) => {
    const rawPoints = zone.polygon_points
      ? (typeof zone.polygon_points === 'string'
        ? JSON.parse(zone.polygon_points)
        : zone.polygon_points)
      : [];
    const points = rawPoints as PolygonPoint[];

    setEditingZone({
      id: zone.id,
      name: zone.name,
      points: ensurePointLabels(points),
      is_active: zone.is_active,
      base_delivery_price: Number(zone.base_delivery_price ?? 0)
    });
    setIsDrawing(true);
    setZoneName(zone.name);
    setSelectedZoneId(zone.id);

    if (points.length > 0) {
      const localPinKey = `zone_pin_${zone.id}`;
      const savedPin = localStorage.getItem(localPinKey);
      const center = savedPin
        ? (JSON.parse(savedPin) as PolygonPoint)
        : getPolygonCenter(points);
      setMapCenter([center.lat, center.lng]);
      setCenterPin(center);
    } else {
      setCenterPin(null);
    }
    setCanEditPoints(false);
    setMovePinFreely(false);
  };

  const handleDeletePoint = (index: number) => {
    if (!editingZone) return;
    setEditingZone({
      ...editingZone,
      points: editingZone.points.filter((_, i) => i !== index)
    });
  };

  const handlePointDragMove = (index: number, lat: number, lng: number) => {
    if (!editingZone) return;
    setEditingZone({
      ...editingZone,
      points: editingZone.points.map((p, i) => i === index ? { ...p, lat, lng } : p)
    });
  };

  // No automatic movement of centerPin. It stays where it was first set or moved manually.
  // (Effect removed to satisfy requirement of decoupling pin from shape)

  const handleSaveZone = async () => {
    if (isSaving) return;
    if (!editingZone || editingZone.points.length < 3) {
      alert('يجب أن يحتوي الزون على 3 نقاط على الأقل');
      return;
    }

    if (!zoneName.trim()) {
      alert('يجب إدخال اسم الزون');
      return;
    }

    setIsSaving(true);
    try {
      if (editingZone.id) {
        // Save pin to localStorage (no DB column needed)
        if (centerPin) {
          localStorage.setItem(`zone_pin_${editingZone.id}`, JSON.stringify(centerPin));
        } else {
          localStorage.removeItem(`zone_pin_${editingZone.id}`);
        }
        await onZoneUpdate(editingZone.id, {
          name: zoneName.trim(),
          polygon_points: editingZone.points,
          is_active: editingZone.is_active,
          base_delivery_price: editingZone.base_delivery_price
        });
      } else {
        await onZoneCreate({
          name: zoneName.trim(),
          polygon_points: editingZone.points,
          is_active: editingZone.is_active,
          base_delivery_price: editingZone.base_delivery_price
          // branch_location saved to localStorage after we get the new zone's id from DB
        });
      }

      setEditingZone(null);
      setIsDrawing(false);
      setZoneName('');
      setSelectedZoneId(null);
      setCenterPin(null);
      setCanEditPoints(false);
      setMovePinFreely(false);
    } catch (error) {
      console.error('Error saving zone:', error);
      alert('حدث خطأ أثناء حفظ الزون');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingZone(null);
    setIsDrawing(false);
    setZoneName('');
    setSelectedZoneId(null);
    setCenterPin(null);
    setCanEditPoints(false);
  };

  const handleDeleteZone = async (zoneId: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الزون؟')) return;
    try {
      await onZoneDelete(zoneId);
      if (selectedZoneId === zoneId) handleCancelEdit();
    } catch (error) {
      console.error('Error deleting zone:', error);
      alert('حدث خطأ أثناء حذف الزون');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl border-2 border-purple-500 max-w-7xl w-full h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-purple-800/50 p-4 flex items-center justify-between border-b-2 border-purple-500 z-10">
          <div className="flex items-center gap-3">
            {isDrawing && (
              <div className="bg-yellow-600 text-black px-4 py-2 rounded-lg font-bold">
                وضع الرسم: اضغط على الخريطة لإضافة نقاط
              </div>
            )}
          </div>
          <h2 className="text-2xl font-black text-white">إدارة مناطق التوصيل</h2>
          <button
            onClick={onClose}
            className="bg-red-600 hover:bg-red-500 p-2 rounded-lg transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
        </div>

        <div className={`flex-1 flex overflow-hidden relative ${editingZone && canEditPoints ? 'delivery-service-edit-mode' : ''}`}>
          {/* Map Section */}
          <div className="flex-1 relative">
            <MapContainer
              center={mapCenter}
              zoom={zoomLevel}
              className="w-full h-full bg-gray-800"
              zoomControl={false}
              attributionControl={false}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                className="dark-tile-layer"
              />

              <MapController center={mapCenter} zoom={zoomLevel} />
              <MapEventsHandler
                onMapClick={handleMapClick}
                onMapHover={(lat, lng, x, y) => {
                  handleMapHover(lat, lng, x, y);
                  if (isDraggingPolygon && lastMousePos && editingZone) {
                    const map = (window as any).leafletMap; // We need to capture map instance or use latlng from event
                    // Actually handleMapHover is called from mousemove event, which has latlng
                  }
                }}
                isDrawing={isDrawing}
              />
              <MapMouseMoveHandler 
                isDragging={isDraggingPolygon}
                lastPos={lastMousePos}
                onDrag={(newPos) => {
                  if (lastMousePos && editingZone) {
                    setHasMovedDuringDrag(true);
                    const deltaLat = newPos.lat - lastMousePos.lat;
                    const deltaLng = newPos.lng - lastMousePos.lng;
                    const newPoints = editingZone.points.map(p => ({
                      ...p,
                      lat: p.lat + deltaLat,
                      lng: p.lng + deltaLng
                    }));
                    setEditingZone({ ...editingZone, points: newPoints });
                    
                    // Move center pin with shape
                    if (centerPin) {
                      setCenterPin({
                        ...centerPin,
                        lat: centerPin.lat + deltaLat,
                        lng: centerPin.lng + deltaLng
                      });
                    }
                    
                    setLastMousePos(newPos);
                  }
                }}
                onStop={() => {
                  setIsDraggingPolygon(false);
                  setLastMousePos(null);
                  if (hasMovedDuringDrag) {
                    setLastDragTime(Date.now());
                  }
                  setHasMovedDuringDrag(false);
                }}
              />

              {/* All Zones */}
              {zones.map(zone => {
                const positions = (zone.polygon_points || []).map(p => [p.lat, p.lng] as [number, number]);
                if (positions.length < 3) return null;
                const isSelected = zone.id === selectedZoneId;
                const isEditing = editingZone?.id === zone.id;

                return (
                  <Polygon
                    key={zone.id}
                    positions={positions}
                    pathOptions={{
                      fillColor: isSelected || isEditing ? '#a855f7' : zone.is_active ? '#10b981' : '#ef4444',
                      fillOpacity: 0.2,
                      color: isSelected || isEditing ? '#a855f7' : zone.is_active ? '#10b981' : '#ef4444',
                      weight: isSelected || isEditing ? 3 : 2
                    }}
                  />
                );
              })}

              {/* Currently Editing Zone (with draggable markers) */}
              {editingZone && (
                <>
                  <Polygon
                    positions={editingZone.points.map(p => [p.lat, p.lng])}
                    pathOptions={{
                      fillColor: '#a855f7',
                      fillOpacity: 0.3,
                      color: '#a855f7',
                      weight: 3,
                      className: canEditPoints ? 'cursor-move' : ''
                    }}
                    eventHandlers={{
                      mousedown: (e) => {
                        if (canEditPoints) {
                          setIsDraggingPolygon(true);
                          setHasMovedDuringDrag(false);
                          setLastMousePos(e.latlng);
                          L.DomEvent.stopPropagation(e as any);
                        }
                      }
                    }}
                  />
                  {editingZone.points.map((point, index) => {
                    const label = point.label ?? (index + 1);
                    return (
                      <Marker
                        key={`vertex-${index}-${label}`}
                        position={[point.lat, point.lng]}
                        icon={hoveredPointLabel === label ? hoveredVertexIcon : vertexIcon}
                      draggable={canEditPoints}
                      eventHandlers={{
                        drag: (e) => {
                          const newPos = e.target.getLatLng();
                          handlePointDragMove(index, newPos.lat, newPos.lng);
                        },
                        click: (e) => {
                          // Only stop propagation, no deletion on click
                          L.DomEvent.stopPropagation(e as any);
                        },
                        mouseover: () => setHoveredPointLabel(label),
                        mouseout: () => setHoveredPointLabel(null)
                      }}
                    />
                  );
                  })}

                  {/* Center Pin for moving the whole zone */}
                  {editingZone.points.length >= 3 && centerPin && (
                    <Marker
                      position={[centerPin.lat, centerPin.lng]}
                      icon={branchIcon}
                      draggable={canEditPoints}
                      eventHandlers={{
                        drag: (e) => {
                          const newPos = e.target.getLatLng();
                          const deltaLat = newPos.lat - centerPin.lat;
                          const deltaLng = newPos.lng - centerPin.lng;
                          
                          if (movePinFreely) {
                            setCenterPin({ ...centerPin, lat: newPos.lat, lng: newPos.lng });
                          } else {
                            // Move whole zone
                            const newPoints = editingZone.points.map(p => ({
                              ...p,
                              lat: p.lat + deltaLat,
                              lng: p.lng + deltaLng
                            }));
                            setEditingZone({ ...editingZone, points: newPoints });
                            setCenterPin({ ...centerPin, lat: newPos.lat, lng: newPos.lng });
                            setLastDragTime(Date.now());
                          }
                        }
                      }}
                    />
                  )}
                </>
              )}
            </MapContainer>

            {/* Custom Tooltip */}
            {hoveredZone && (
              <div
                className="absolute pointer-events-none z-[1000] bg-gray-500/40 backdrop-blur-sm text-white px-2 py-1 rounded shadow-md whitespace-nowrap transform -translate-x-1/2 -translate-y-full mb-8"
                style={{ left: hoveredZone.x, top: hoveredZone.y }}
              >
                <div className="font-bold text-[10px] text-center mb-0.5 text-gray-200">{hoveredZone.name}</div>
                <div className="text-white font-bold text-center text-xs">
                  {hoveredZone.price} ج
                </div>
              </div>
            )}

            {/* Zoom Controls */}
            <div className="absolute top-2 right-2 flex flex-col gap-2 z-[400]">
              <button
                onClick={() => setZoomLevel(prev => Math.min(prev + 1, 18))}
                disabled={zoomLevel >= 18}
                className="bg-black/70 hover:bg-black/90 text-white p-2 rounded-lg transition-colors disabled:opacity-50"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
              <button
                onClick={() => setZoomLevel(prev => Math.max(prev - 1, 1))}
                disabled={zoomLevel <= 1}
                className="bg-black/70 hover:bg-black/90 text-white p-2 rounded-lg transition-colors disabled:opacity-50"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <button
                onClick={() => {
                  if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(pos => {
                      setMapCenter([pos.coords.latitude, pos.coords.longitude]);
                    });
                  }
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-lg transition-colors"
                title="Current Location"
              >
                <Navigation className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-80 bg-gray-800 border-l-2 border-purple-500 overflow-y-auto p-4 space-y-4 custom-scrollbar z-10">
            {/* Zone List - Only show when NOT editing */}
            {!editingZone && (
              <div>
                <button
                  type="button"
                  onClick={handleStartNewZone}
                  className="w-full mb-4 bg-green-600 hover:bg-green-500 text-white px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors font-bold"
                >
                  <Plus className="w-5 h-5" />
                  <span>إضافة زون طلب جديد</span>
                </button>
                <h3 className="text-xl font-bold text-white mb-3 text-right">الزونات الحالية</h3>
                <div className="space-y-2">
                  {zones.map(zone => (
                    <div
                      key={zone.id}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${selectedZoneId === zone.id
                        ? 'border-purple-400 bg-purple-900/30'
                        : 'border-gray-700 bg-gray-900/50'
                        }`}
                      onClick={() => handleEditZone(zone)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-bold text-right">{zone.name}</span>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${zone.is_active ? 'bg-green-700 text-green-100' : 'bg-red-700 text-red-100'}`}>
                          {zone.is_active ? 'فعال' : 'معطل'}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEditZone(zone); }}
                          className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-1 rounded text-sm font-bold"
                        >
                          <Edit2 className="w-4 h-4 inline mr-1" /> تعديل
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteZone(zone.id); }}
                          className="bg-red-600 hover:bg-red-500 text-white py-1 rounded text-sm font-bold px-3"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Editor Panel */}
            {editingZone && (
              <div className="bg-purple-900/20 border-2 border-purple-500 rounded-lg p-4">
                <h3 className="text-lg font-bold text-white mb-3 text-right">
                  {editingZone.id ? 'تعديل الزون' : 'زون جديد'}
                </h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        const next = !canEditPoints;
                        setCanEditPoints(next);
                        setIsDrawing(next);
                        if (!next) setMovePinFreely(false);
                      }}
                      className={`py-2 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 border-2 ${canEditPoints ? 'bg-orange-600 border-orange-400 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-purple-500 hover:text-purple-400'}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      {canEditPoints ? 'إغلاق التعديل' : 'تفعيل السحب'}
                    </button>
                    {canEditPoints && (
                      <button
                        onClick={() => setMovePinFreely(!movePinFreely)}
                        className={`py-2 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 border-2 ${movePinFreely ? 'bg-blue-600 border-blue-400 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-purple-500 hover:text-purple-400'}`}
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        {movePinFreely ? 'تثبيت الدبوس' : 'تحريك الدبوس منفصل'}
                      </button>
                    )}
                  </div>
                  <div>
                    <label className="block text-purple-300 mb-2 text-right">اسم الزون</label>
                    <input
                      type="text"
                      value={zoneName}
                      onChange={(e) => setZoneName(e.target.value)}
                      className="w-full bg-gray-800 border border-purple-500/50 rounded-lg px-3 py-2 text-white text-right outline-none focus:border-purple-400"
                      placeholder="منطقة وسط البلد"
                      dir="rtl"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setEditingZone({ ...editingZone, is_active: !editingZone.is_active })}
                      className={`px-4 py-1 rounded-lg text-sm font-bold transition-all border-2 ${
                        editingZone.is_active
                          ? 'bg-green-600 border-green-400 text-white hover:bg-green-500'
                          : 'bg-red-700 border-red-500 text-white hover:bg-red-600'
                      }`}
                    >
                      {editingZone.is_active ? 'فعالة' : 'معطلة'}
                    </button>
                    <span className="text-purple-300 text-sm text-right">حالة الزون</span>
                  </div>
                  <div>
                    <label className="block text-purple-300 mb-2 text-right text-xs">سعر التوصيل الأساسي</label>
                    <input
                      type="number"
                      value={editingZone.base_delivery_price}
                      onChange={(e) => setEditingZone({ ...editingZone, base_delivery_price: Number(e.target.value) })}
                      className="w-full bg-gray-800 border border-purple-500/50 rounded-lg px-3 py-2 text-white text-right outline-none focus:border-purple-400"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={handleCancelEdit} className="flex-1 bg-gray-700 py-2 rounded-lg text-white font-bold">إلغاء</button>
                    <button
                      type="button"
                      onClick={handleSaveZone}
                      disabled={isSaving}
                      className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed py-2 rounded-lg text-white font-bold"
                    >
                      {isSaving ? 'جاري الحفظ...' : 'حفظ'}
                    </button>
                  </div>
                  {canEditPoints && editingZone.points.length > 0 && (
                    <div className="mt-4 pt-2 border-t border-purple-500/20">
                      <p className="text-[10px] text-purple-300 mb-1 text-right">إزالة نقاط معينة:</p>
                      <div className="flex flex-wrap gap-1 justify-end">
                        {[...editingZone.points]
                          .sort((a, b) => (a.label ?? 0) - (b.label ?? 0))
                          .map((p, i) => {
                            const label = p.label ?? (i + 1);
                            return (
                              <button
                                key={`${label}-${i}`}
                                onMouseEnter={() => setHoveredPointLabel(label)}
                                onMouseLeave={() => setHoveredPointLabel(null)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const remaining = removePolygonPointByLabel(editingZone.points, label);
                                  setEditingZone({
                                    ...editingZone,
                                    points: remaining
                                  });
                                  if (remaining.length >= 3) {
                                    setCenterPin(getPolygonCenter(remaining));
                                  } else {
                                    setCenterPin(null);
                                  }
                                }}
                                className={`bg-gray-900 border px-1.5 py-0.5 rounded text-[10px] transition-all ${
                                  hoveredPointLabel === label
                                    ? 'border-red-500 text-red-500 scale-110 shadow-lg shadow-red-900/50'
                                    : 'border-purple-600/30 text-purple-100 hover:border-red-500 hover:text-red-400'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                      </div>
                      <p className="text-[9px] text-gray-500 mt-2 text-right">💡 المؤشر (+) لتحريك الزون · النقاط البيضاء لسحب الأطراف</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{
        __html: `
        .dark-tile-layer {
          filter: invert(0.9) hue-rotate(180deg) brightness(0.8);
        }
        .leaflet-container {
          background: #111827 !important;
        }
        .custom-vertex-icon {
          background: none !important;
          border: none !important;
        }
        .delivery-service-edit-mode .leaflet-container,
        .delivery-service-edit-mode .leaflet-container *,
        .delivery-service-edit-mode .leaflet-pane,
        .delivery-service-edit-mode .leaflet-pane * {
          cursor: crosshair !important;
        }
        .cursor-move {
          cursor: move !important;
        }
      `}} />
    </div>
  );
}
