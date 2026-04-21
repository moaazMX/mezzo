import { useState, useEffect, useCallback } from 'react';
import { X, Save, Trash2, Edit2, Plus, Navigation, ZoomIn, ZoomOut, MapPin } from 'lucide-react';
import { MapContainer, TileLayer, Polygon, Marker, Pane, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { DeliveryService, DeliveryZoneLayer, PolygonPoint, DeliveryZone } from '../../lib/supabase';
import { getPolygonCenter, createExpandedLayer } from '../../lib/geoUtils';

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
  html: '<div style="background-color: white; border: 2px solid #eab308; width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>',
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

interface DeliveryServiceEditorProps {
  services: DeliveryService[];
  zones?: DeliveryZone[];
  onServiceCreate: (serviceData: {
    name: string;
    branch_location: PolygonPoint | null;
    is_active: boolean;
    initialLayer?: {
      polygon_points: PolygonPoint[];
      delivery_price: number;
    };
  }) => Promise<void>;
  onServiceUpdate: (
    serviceId: string,
    updates: Partial<DeliveryService> & { branch_location?: PolygonPoint | null }
  ) => Promise<void>;
  onServiceDelete: (serviceId: string) => Promise<void>;
  onLayerCreate: (
    serviceId: string,
    layerData: {
      polygon_points: PolygonPoint[];
      delivery_price: number;
      name?: string | null;
      order_index?: number;
    }
  ) => Promise<void>;
  onLayerUpdate: (
    layerId: string,
    updates: Partial<DeliveryZoneLayer> & { polygon_points?: PolygonPoint[] }
  ) => Promise<void>;
  onLayerDelete: (layerId: string) => Promise<void>;
  onClose: () => void;
}

interface EditingService {
  id: string | null;
  name: string;
  is_active: boolean;
  branch_location: PolygonPoint | null;
}

interface EditingLayer {
  id: string | null;
  serviceId: string | null;
  points: PolygonPoint[];
  delivery_price: number;
  order_index: number;
  name?: string | null;
}

// Helper component to sync map center and zoom
function MapController({ center, zoom }: { center: [number, number], zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

const DRAG_THRESHOLD = 0.00005; // minimum lat/lng delta to start drag

// Map Events component for interactions
function MapEventsHandler({
  onMapClick,
  isDrawing,
  draggedLayerId,
  dragStartPos,
  mouseDownLayer,
  onDragMove,
  onDragEnd,
  onDragStart
}: {
  onMapClick: (latlng: { lat: number, lng: number }) => void,
  isDrawing: boolean,
  draggedLayerId: string | number | null,
  dragStartPos: L.LatLng | null,
  mouseDownLayer: { layerId: string; startPos: L.LatLng; points: PolygonPoint[] } | null,
  onDragMove: (latlng: L.LatLng) => void,
  onDragEnd: () => void,
  onDragStart: (layerId: string, startPos: L.LatLng, points: PolygonPoint[]) => void
}) {
  const map = useMap();

  useEffect(() => {
    if (draggedLayerId) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [draggedLayerId, map]);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      onDragEnd();
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [onDragEnd]);

  useMapEvents({
    click: (e) => {
      if (isDrawing) {
        onMapClick(e.latlng);
      }
    },
    mousemove: (e) => {
      if (draggedLayerId && dragStartPos) {
        onDragMove(e.latlng);
      } else if (mouseDownLayer && !draggedLayerId) {
        const dLat = Math.abs(e.latlng.lat - mouseDownLayer.startPos.lat);
        const dLng = Math.abs(e.latlng.lng - mouseDownLayer.startPos.lng);
        if (dLat > DRAG_THRESHOLD || dLng > DRAG_THRESHOLD) {
          onDragStart(mouseDownLayer.layerId, mouseDownLayer.startPos, mouseDownLayer.points);
        }
      }
    },
    mouseup: () => {
      onDragEnd();
    }
  });
  return null;
}

// Helper to get a consistent ID for a layer
const getLayerId = (layer: Partial<DeliveryZoneLayer> | EditingLayer, serviceId?: string | null): string => {
  if ('id' in layer && layer.id) return layer.id.toString();
  const sId = ('serviceId' in layer ? layer.serviceId : serviceId) || 'unknown';
  return `unpinned-${sId}-${layer.order_index}`;
};

export default function DeliveryServiceEditor({
  services,
  zones = [],
  onServiceCreate,
  onServiceUpdate,
  onServiceDelete,
  onLayerCreate,
  onLayerUpdate,
  onLayerDelete,
  onClose
}: DeliveryServiceEditorProps) {
  const [mapCenter, setMapCenter] = useState<[number, number]>([31.204662, 30.182862]);
  const [zoomLevel, setZoomLevel] = useState(13);
  const [editingService, setEditingService] = useState<EditingService | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [editingLayer, setEditingLayer] = useState<EditingLayer | null>(null);
  const [isDrawingLayer, setIsDrawingLayer] = useState(false);
  const [deletedLayerIds, setDeletedLayerIds] = useState<Set<string>>(new Set());
  const [isAddingPoints, setIsAddingPoints] = useState(false);
  const [centerPin, setCenterPin] = useState<PolygonPoint | null>(null);
  const [moveCenterOnly, setMoveCenterOnly] = useState(false);
  const [canEditPoints, setCanEditPoints] = useState(false);
  const [movedOtherLayers, setMovedOtherLayers] = useState<Map<string, PolygonPoint[]>>(new Map());
  const [stagedLayers, setStagedLayers] = useState<EditingLayer[]>([]);
  const [draggedLayerId, setDraggedLayerId] = useState<string | number | null>(null);
  const [dragStartPos, setDragStartPos] = useState<L.LatLng | null>(null);
  const [draggedLayerInitialPoints, setDraggedLayerInitialPoints] = useState<PolygonPoint[] | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{ layerId: string, index: number } | null>(null);
  const [hoveredLayerId, setHoveredLayerId] = useState<string | null>(null);
  const [dragDidOccur, setDragDidOccur] = useState(false);
  const [mouseDownLayer, setMouseDownLayer] = useState<{ layerId: string; startPos: L.LatLng; points: PolygonPoint[] } | null>(null);
  const [updatedLayerPrices, setUpdatedLayerPrices] = useState<Map<string, number>>(new Map());
  const [updatedLayerNames, setUpdatedLayerNames] = useState<Map<string, string>>(new Map());

  const isStagedId = (id: string) => id.startsWith('unpinned-') || id === 'initial-layer';

  const getPointsForLayer = (layerId: string, originalPoints: PolygonPoint[]) => {
    if (editingLayer && getLayerId(editingLayer) === layerId) return editingLayer.points;
    if (isStagedId(layerId)) {
      const staged = stagedLayers.find(l => getLayerId(l) === layerId);
      return staged ? staged.points : (editingLayer && getLayerId(editingLayer) === layerId ? editingLayer.points : originalPoints);
    }
    return movedOtherLayers.get(layerId) || originalPoints;
  };

  // تأكد من حفظ آخر تغييرات على الطبقة الحالية قبل التبديل لطبقة أخرى
  const persistEditingLayerPoints = () => {
    if (!editingLayer) return;
    const layerId = getLayerId(editingLayer, editingLayer.serviceId || editingService?.id || null);
    const points = editingLayer.points || [];
    if (!points.length) return;

    if (isStagedId(layerId)) {
      // إذا كانت طبقة مؤقتة/جديدة
      setStagedLayers(prev => {
        const exists = prev.some(l => getLayerId(l) === layerId);
        if (layerId === 'initial-layer' && !exists) {
          // لا تضف initial-layer إلى staged عند مجرد الاختيار من القائمة (تظهر من editingLayer فقط) فتجنب التكرار
          return prev;
        }
        if (!exists) return [...prev, { ...editingLayer }];
        return prev.map(l => getLayerId(l) === layerId ? { ...l, points } : l);
      });
    } else {
      // طبقة محفوظة في القاعدة – نخزن نقاطها المعدّلة في movedOtherLayers
      setMovedOtherLayers(prev => {
        const next = new Map(prev);
        next.set(layerId, points);
        return next;
      });
    }
  };

  // حساب مركز جميع الطبقات معاً
  const getAllLayersCenterPin = (service: DeliveryService | null, extraPoints?: PolygonPoint[]): PolygonPoint | null => {
    if (!service) return null;
    if (service.branch_location) return service.branch_location as PolygonPoint;

    const allPoints: PolygonPoint[] = [];
    (service.layers || []).forEach(l => {
      if (l.polygon_points && l.polygon_points.length >= 3) {
        allPoints.push(...l.polygon_points);
      }
    });
    if (extraPoints) allPoints.push(...extraPoints);
    if (allPoints.length === 0) return null;
    return getPolygonCenter(allPoints);
  };

  // Initialize: select first service and center map
  useEffect(() => {
    if (!selectedServiceId && services.length > 0) {
      const svc = services[0];
      setSelectedServiceId(svc.id);

      const center = (svc.branch_location as PolygonPoint) ||
        (svc.layers && svc.layers.length > 0
          ? getPolygonCenter(svc.layers[0].polygon_points || [])
          : { lat: mapCenter[0], lng: mapCenter[1] });
      setMapCenter([center.lat, center.lng]);
    }
  }, [services]);

  // Clear editing state when the edited service is deleted
  useEffect(() => {
    if (editingService?.id && !editingService.id.startsWith('new-')) {
      const stillExists = services.some(s => s.id === editingService.id);
      if (!stillExists) {
        setEditingService(null);
        setEditingLayer(null);
        setStagedLayers([]);
        setMovedOtherLayers(new Map());
        setDeletedLayerIds(new Set());
        setIsDrawingLayer(false);
        setIsAddingPoints(false);
        setCenterPin(null);
        setCanEditPoints(false);
        setUpdatedLayerPrices(new Map());
        setUpdatedLayerNames(new Map());
      }
    }
  }, [services, editingService?.id]);

  // Sync editingLayer.id when services update
  useEffect(() => {
    if (!editingLayer || editingLayer.id || !editingLayer.serviceId) return;
    const service = services.find(s => s.id === editingLayer.serviceId);
    if (!service || !service.layers) return;

    const matchedLayer = service.layers.find(
      l => l.order_index === editingLayer.order_index
    );
    if (matchedLayer) {
      setEditingLayer(prev => prev ? { ...prev, id: matchedLayer.id } : prev);
    }
  }, [services]);

  // Clear movedOtherLayers only when explicitly needed (e.g. closing editor)
  // Removed aggressive clearing on services update to prevent jumps on save/add layer.

  // لا توجد أي طبقة للخدمة الحالية (محفوظة أو مؤقتة أو أولى قيد الرسم)
  const hasNoLayersForCurrentService = (): boolean => {
    if (!editingService) return false;
    const saved = (services.find(s => s.id === editingService.id)?.layers || []).filter(l => !deletedLayerIds.has(getLayerId(l, editingService.id)));
    const staged = stagedLayers.filter(l => l.serviceId === editingService.id && !deletedLayerIds.has(getLayerId(l)));
    const hasInitialWithPoints = editingLayer?.id === 'initial-layer' && (editingLayer?.points?.length ?? 0) >= 1;
    return saved.length === 0 && staged.length === 0 && !hasInitialWithPoints;
  };

  const noLayersForCurrentService = !!editingService && hasNoLayersForCurrentService();

  // عند حذف كل الطبقات، تفعيل "تفعيل السحب والتعديل" تلقائياً ليكون البدء من جديد جاهزاً
  useEffect(() => {
    if (noLayersForCurrentService && !editingLayer) {
      setCanEditPoints(true);
      setIsAddingPoints(true);
    }
  }, [noLayersForCurrentService, editingLayer]);

  const onMapClick = (latlng: { lat: number, lng: number }) => {
    if (dragDidOccur) {
      setDragDidOccur(false);
      return;
    }

    // إعادة بدء أول طبقة عندما لا توجد أي طبقة (خدمة جديدة أو وضع التعديل بعد حذف الكل)
    if (editingService && !editingLayer && noLayersForCurrentService) {
      setDeletedLayerIds(prev => {
        const next = new Set(prev);
        next.delete('initial-layer');
        return next;
      });
      setEditingLayer({
        id: 'initial-layer',
        serviceId: editingService.id,
        points: [latlng],
        delivery_price: 0,
        order_index: 1,
        name: null
      });
      setIsAddingPoints(true);
      return;
    }

    if (isAddingPoints && editingLayer) {
      const newPoints = [...editingLayer.points, latlng];
      setEditingLayer({ ...editingLayer, points: newPoints });

      const layerId = getLayerId(editingLayer);
      if (layerId.startsWith('unpinned-') || layerId === 'initial-layer') {
        setStagedLayers(prev => prev.map(l => getLayerId(l) === layerId ? { ...l, points: newPoints } : l));
      } else {
        setMovedOtherLayers(prev => new Map(prev).set(layerId, newPoints));
      }
      if (newPoints.length >= 3) {
        setCenterPin(getPolygonCenter(newPoints));
      }
      return;
    }

    if (!isDrawingLayer || !editingService) return; // Only allow drawing if a service is being edited

    // This part is for initial drawing of a new layer for a new service
    if (editingLayer && editingLayer.serviceId === editingService.id) {
      const newPoints = [...editingLayer.points, latlng];
      setEditingLayer({ ...editingLayer, points: newPoints });
      if (newPoints.length >= 3) {
        setCenterPin(getPolygonCenter(newPoints));
      }
    }
  };

  const onDragMove = (latlng: L.LatLng) => {
    if (!draggedLayerId || !dragStartPos || !draggedLayerInitialPoints) return;

    const deltaLat = latlng.lat - dragStartPos.lat;
    const deltaLng = latlng.lng - dragStartPos.lng;

    const targetId = draggedLayerId.toString();
    const newPoints = draggedLayerInitialPoints.map(p => ({
      lat: p.lat + deltaLat,
      lng: p.lng + deltaLng
    }));

    setDragDidOccur(true);

    if (editingLayer && getLayerId(editingLayer) === targetId) {
      setEditingLayer({ ...editingLayer, points: newPoints });
    }

    if (isStagedId(targetId)) {
      setStagedLayers(prev => prev.map(l => getLayerId(l) === targetId ? { ...l, points: newPoints } : l));
    } else {
      setMovedOtherLayers(prev => new Map(prev).set(targetId, newPoints));
    }
  };

  const onDragEnd = useCallback(() => {
    setDraggedLayerId(null);
    setDragStartPos(null);
    setDraggedLayerInitialPoints(null);
    setMouseDownLayer(null);
  }, []);

  const onDragStart = (layerId: string, startPos: L.LatLng, points: PolygonPoint[]) => {
    setDraggedLayerId(layerId);
    setDragStartPos(startPos);
    setDraggedLayerInitialPoints(points);
    setMouseDownLayer(null);
  };

  const handleZoomIn = () => {
    if (zoomLevel < 18) setZoomLevel((prev: number) => prev + 1);
  };

  const handleZoomOut = () => {
    if (zoomLevel > 1) setZoomLevel((prev: number) => prev - 1);
  };

  const handleRecenterToBranch = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setMapCenter([position.coords.latitude, position.coords.longitude]);
        },
        (error) => {
          console.error('Error getting location:', error);
          if (editingService?.branch_location) {
            const loc = editingService.branch_location as PolygonPoint;
            setMapCenter([loc.lat, loc.lng]);
          } else {
            alert('تعذر تحديد موقعك الحالي. تأكد من تفعيل خدمة الموقع في المتصفح.');
          }
        }
      );
    } else {
      if (editingService?.branch_location) {
        const loc = editingService.branch_location as PolygonPoint;
        setMapCenter([loc.lat, loc.lng]);
      } else {
        alert('المتصفح لا يدعم تحديد الموقع.');
      }
    }
  };

  const handleSelectService = (service: DeliveryService) => {
    setSelectedServiceId(service.id);
    setEditingService(null); // Clear editing service when just selecting
    setEditingLayer(null);
    setIsDrawingLayer(false);
    setIsAddingPoints(false);
    setDeletedLayerIds(new Set());
    setMovedOtherLayers(new Map());
    setUpdatedLayerPrices(new Map());
    setUpdatedLayerNames(new Map());
    setStagedLayers([]);

    const center = (service.branch_location as PolygonPoint) ||
      (service.layers && service.layers.length > 0
        ? getPolygonCenter(service.layers[0].polygon_points || [])
        : { lat: mapCenter[0], lng: mapCenter[1] });
    setMapCenter([center.lat, center.lng]);
  };

  const handleEditService = (service: DeliveryService) => {
    setSelectedServiceId(service.id);
    setEditingService({
      id: service.id,
      name: service.name,
      is_active: service.is_active,
      branch_location: service.branch_location as PolygonPoint || null
    });
    setDeletedLayerIds(new Set());
    setMovedOtherLayers(new Map());
    setStagedLayers([]);
    setIsDrawingLayer(false);
    setIsAddingPoints(false);
    setUpdatedLayerPrices(new Map());
    setUpdatedLayerNames(new Map());


    const sortedLayers = (service.layers || []).slice().sort(
      (a, b) => (a.order_index || 0) - (b.order_index || 0)
    );
    if (sortedLayers.length > 0) {
      const base = sortedLayers[0];
      setEditingLayer({
        id: base.id,
        serviceId: service.id,
        points: base.polygon_points || [],
        delivery_price: base.delivery_price,
        order_index: base.order_index || 1,
        name: base.name || null
      });
      if (base.polygon_points && base.polygon_points.length >= 3) {
        setCenterPin(getAllLayersCenterPin(service) || getPolygonCenter(base.polygon_points));
      } else {
        setCenterPin(service.branch_location as PolygonPoint || null);
      }
    } else {
      setEditingLayer(null);
      setCenterPin(service.branch_location as PolygonPoint || null);
    }

    const center = (service.branch_location as PolygonPoint) ||
      (service.layers && service.layers.length > 0
        ? getPolygonCenter(service.layers[0].polygon_points || [])
        : { lat: mapCenter[0], lng: mapCenter[1] });
    setMapCenter([center.lat, center.lng]);
  };

  const handleSaveService = async () => {
    if (!editingService) return;
    if (!editingService.name.trim()) {
      alert('يجب إدخال اسم خدمة التوصيل');
      return;
    }

    const isNewService = !editingService.id || editingService.id.startsWith('new-');

    try {
      if (!isNewService) {
        // 1. Process Buffered Deletions for existing service (لا نحذف 'initial-layer' فهو معرف محلي فقط)
        for (const id of Array.from(deletedLayerIds)) {
          if (!id.startsWith('unpinned-') && id !== 'initial-layer') {
            await onLayerDelete(id);
          }
        }

        // 1b. إذا كانت الطبقة الحالية أول طبقة مرسومة بعد حذف الكل (initial-layer)، أنشئها في القاعدة
        if (editingLayer?.id === 'initial-layer' && editingLayer.points.length >= 3 && editingLayer.serviceId === editingService.id) {
          await onLayerCreate(editingService.id!, {
            polygon_points: editingLayer.points,
            delivery_price: editingLayer.delivery_price,
            order_index: 1,
            name: updatedLayerNames.get('initial-layer') ?? null
          });
        }

        // 2. Process Buffered Additions (staged layers) for existing service
        for (const layer of stagedLayers) {
          if (layer.serviceId === editingService.id && layer.points.length >= 3) {
            const stagedId = getLayerId(layer, editingService.id);
            const name = updatedLayerNames.get(stagedId) ?? layer.name ?? null;
            await onLayerCreate(editingService.id!, {
              delivery_price: layer.delivery_price,
              polygon_points: layer.points,
              order_index: layer.order_index,
              name
            });
          }
        }

        // 3. Process Modified Existing Layers
        for (const [id, points] of Array.from(movedOtherLayers.entries())) {
          if (deletedLayerIds.has(id)) continue; // Don't update if it's marked for deletion
          const svc = services.find(s => s.id === editingService.id);
          const originalLayer = svc?.layers?.find(l => getLayerId(l) === id);
          if (originalLayer) {
            const updatedPrice = updatedLayerPrices.get(id) ?? originalLayer.delivery_price;
            const updatedName = updatedLayerNames.get(id) ?? originalLayer.name ?? null;
            await onLayerUpdate(id, {
              delivery_price: updatedPrice,
              polygon_points: points,
              name: updatedName ?? undefined
            });
          }
        }

        // 4. Update the currently editing layer if it's an existing one and modified
        if (editingLayer && editingLayer.id && !editingLayer.id.startsWith('unpinned-') && editingLayer.points.length >= 3) {
          // Check if it was moved via movedOtherLayers, if so, it's already handled
          if (!movedOtherLayers.has(editingLayer.id)) {
            const currentService = services.find(s => s.id === editingService.id);
            const originalLayer = currentService?.layers?.find(l => l.id === editingLayer.id);
            if (originalLayer && (JSON.stringify(originalLayer.polygon_points) !== JSON.stringify(editingLayer.points) || originalLayer.delivery_price !== editingLayer.delivery_price)) {
              const updatedName = updatedLayerNames.get(editingLayer.id) ?? originalLayer.name ?? null;
              await onLayerUpdate(editingLayer.id, {
                polygon_points: editingLayer.points,
                delivery_price: editingLayer.delivery_price,
                name: updatedName ?? undefined
              });
            }
          }
        }

        // 5. Apply price/name changes for existing layers that weren't moved
        const svc = services.find(s => s.id === editingService.id);
        if (svc?.layers) {
          for (const layer of svc.layers) {
            const id = getLayerId(layer);
            if (deletedLayerIds.has(id)) continue;
            const priceOverride = updatedLayerPrices.get(id);
            const nameOverride = updatedLayerNames.get(id);
            if (priceOverride === undefined && nameOverride === undefined) continue;

            const newPrice = priceOverride ?? layer.delivery_price;
            const newName = nameOverride ?? layer.name ?? null;

            if (newPrice !== layer.delivery_price || newName !== layer.name) {
              await onLayerUpdate(id, {
                ...(priceOverride !== undefined ? { delivery_price: newPrice } : {}),
                ...(nameOverride !== undefined ? { name: newName } : {})
              });
            }
          }
        }

        // 6. Update service details
        await onServiceUpdate(editingService.id!, {
          name: editingService.name.trim(),
          is_active: editingService.is_active,
          branch_location: centerPin || editingService.branch_location
        });

      } else {
        // Handle new service creation:
        // نجمع كل الطبقات التي تم رسمها (initial-layer + stagedLayers) ونرسلها دفعة واحدة
        const stagedForService = stagedLayers.filter(
          l => l.serviceId === editingService.id && l.points.length >= 3
        );

        // لو كانت هناك طبقة أولى قيد التحرير ولم تُضاف بعد إلى stagedLayers، أضفها
        const initialFromEditing =
          editingLayer &&
            editingLayer.serviceId === editingService.id &&
            editingLayer.points.length >= 3 &&
            !stagedForService.some(l => l.id === editingLayer.id)
            ? [editingLayer]
            : [];

        const allEditingLayers = [...initialFromEditing, ...stagedForService];

        const allLayers = allEditingLayers
          .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
          .map(l => {
            const id = getLayerId(l, editingService.id);
            const name = updatedLayerNames.get(id) ?? l.name ?? null;
            return {
              polygon_points: l.points,
              delivery_price: updatedLayerPrices.get(id) ?? l.delivery_price,
              order_index: l.order_index,
              name
            };
          });

        await onServiceCreate({
          name: editingService.name.trim(),
          branch_location: centerPin || editingService.branch_location,
          is_active: editingService.is_active,
          initialLayer: undefined,
          initialLayers: allLayers.length > 0 ? allLayers : undefined
        } as any);
      }

      // Clear all temporary states
      setEditingService(null);
      setEditingLayer(null);
      setStagedLayers([]);
      setMovedOtherLayers(new Map());
      setDeletedLayerIds(new Set());
      setIsDrawingLayer(false);
      setIsAddingPoints(false);
      setCenterPin(null);
      setCanEditPoints(false);
      setSelectedServiceId(null); // Deselect service after saving
      setUpdatedLayerPrices(new Map());
      setUpdatedLayerNames(new Map());
    } catch (err) {
      console.error('Error saving delivery service changes:', err);
      alert('حدث خطأ أثناء حفظ التغييرات: ' + (err as Error).message);
    }
  };

  const handleCancelEdit = () => {
    setEditingService(null);
    setEditingLayer(null);
    setStagedLayers([]);
    setMovedOtherLayers(new Map());
    setDeletedLayerIds(new Set());
    setIsDrawingLayer(false);
    setIsAddingPoints(false);
    setCenterPin(null);
    setCanEditPoints(false);
    setSelectedServiceId(null); // Deselect service
    setUpdatedLayerPrices(new Map());
    setUpdatedLayerNames(new Map());
  };

  const handleLayerDelete = (layerId: string) => {
    if (editingService) {
      // In edit mode, we buffer deletion
      setDeletedLayerIds(prev => new Set(prev).add(layerId));
      // If the deleted layer was the one being edited, clear editingLayer
      if (editingLayer && getLayerId(editingLayer) === layerId) {
        setEditingLayer(null);
        setIsAddingPoints(false);
      }
      // Also remove from stagedLayers if it was a new, unsaved layer
      setStagedLayers(prev => prev.filter(l => getLayerId(l) !== layerId));
      // Remove from movedOtherLayers if it was moved
      setMovedOtherLayers(prev => {
        const newMap = new Map(prev);
        newMap.delete(layerId);
        return newMap;
      });

      // إذا لم يتبق أي طبقة فعلياً، أخفِ دبوس الفرع
      const svc = services.find(s => s.id === editingService.id);
      const remainingSaved = (svc?.layers || []).filter(l => !new Set([...deletedLayerIds, layerId]).has(getLayerId(l, editingService.id)));
      const remainingStaged = stagedLayers.filter(l => l.serviceId === editingService.id && getLayerId(l) !== layerId);
      if (remainingSaved.length === 0 && remainingStaged.length === 0) {
        setCenterPin(null);
        setEditingService(prev => prev ? { ...prev, branch_location: null } : prev);
      }
    } else {
      // Direct deletion if not editing a service (shouldn't happen with current UI flow)
      onLayerDelete(layerId).catch(console.error);
    }
  };

  const handleAddLayerToService = async (service: DeliveryService) => {
    if (!editingService) return; // Ensure we are in editing mode for a service

    let basePolygon: PolygonPoint[] | null = null;
    const currentServiceData = services.find(s => s.id === service.id);

    // If the currently edited layer is the initial-layer and it's valid, 
    // we need to make sure it's in stagedLayers before we create an expansion from it.
    if (editingLayer && editingLayer.id === 'initial-layer' && editingLayer.points.length >= 3) {
      if (!stagedLayers.find(l => l.id === 'initial-layer')) {
        setStagedLayers(prev => [...prev, editingLayer]);
      }
      basePolygon = editingLayer.points;
    } else if (editingLayer && editingLayer.serviceId === service.id && editingLayer.points.length >= 3) {
      basePolygon = editingLayer.points;
    } else {
      // Otherwise, try to get from the last saved layer of the service
      const savedLayers = (currentServiceData?.layers || [])
        .filter(l => !deletedLayerIds.has(getLayerId(l))) // Exclude deleted layers
        .slice()
        .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      if (savedLayers.length > 0 && savedLayers[savedLayers.length - 1].polygon_points?.length >= 3) {
        basePolygon = movedOtherLayers.get(getLayerId(savedLayers[savedLayers.length - 1])) || savedLayers[savedLayers.length - 1].polygon_points as PolygonPoint[];
      }
    }

    // If no base polygon found, try from staged layers
    if (!basePolygon || basePolygon.length < 3) {
      const lastStaged = stagedLayers
        .filter(l => l.serviceId === service.id && l.points.length >= 3)
        .sort((a, b) => a.order_index - b.order_index)
        .pop();
      if (lastStaged) {
        basePolygon = lastStaged.points;
      }
    }

    if (!basePolygon || basePolygon.length < 3) {
      alert('لا يوجد مضلع أساسي صالح لتوسيع الطبقة. تأكد من وجود طبقة مرسومة تحتوي على 3 نقاط على الأقل.');
      return;
    }

    const expanded = createExpandedLayer(basePolygon, 1.25);

    const serviceLayers = (currentServiceData?.layers || [])
      .filter(l => !deletedLayerIds.has(getLayerId(l))); // Exclude deleted layers

    const maxOrderSaved = serviceLayers.length > 0
      ? Math.max(...serviceLayers.map(l => l.order_index || 0))
      : 0;

    const maxOrderStagedForService = stagedLayers.length > 0
      ? Math.max(
        0,
        ...stagedLayers
          .filter(l => l.serviceId === service.id)
          .map(l => l.order_index || 0)
      )
      : 0;

    const baseOrder =
      editingLayer && editingLayer.serviceId === service.id
        ? Math.max(editingLayer.order_index || 0, maxOrderSaved, maxOrderStagedForService)
        : Math.max(maxOrderSaved, maxOrderStagedForService);

    // New layers تحصل على أرقام متزايدة: 1، 2، 3، ...
    const newOrderIndex = baseOrder + 1;

    const newLayer: EditingLayer = {
      id: `unpinned-${Date.now()}`, // Temporary ID for staged layer
      serviceId: service.id,
      points: expanded,
      delivery_price: 0,
      order_index: newOrderIndex,
      name: null
    };

    setStagedLayers(prev => [...prev, newLayer]);
    setEditingLayer(newLayer); // Make the new layer the active editing layer
    setIsDrawingLayer(false); // Not drawing from scratch, but editing
    setIsAddingPoints(true); // Allow adding points to this new layer
    if (expanded.length >= 3) setCenterPin(getPolygonCenter(expanded));
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl border-2 border-yellow-500 max-w-7xl w-full h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="bg-yellow-700/40 p-4 flex items-center justify-between border-b-2 border-yellow-500">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const newId = 'new-' + Date.now();
                setEditingService({ id: newId, name: '', is_active: true, branch_location: null });
                setEditingLayer({ id: 'initial-layer', serviceId: newId, points: [], delivery_price: 0, order_index: 1, name: null });
                setStagedLayers([]);
                setCenterPin(null);
                setMovedOtherLayers(new Map());
                setDeletedLayerIds(new Set());
                setIsDrawingLayer(true); // Start drawing for a new service
                setIsAddingPoints(true); // Allow adding points to the initial layer
                setCanEditPoints(true); // Ensure pins are visible
                setUpdatedLayerPrices(new Map());
                setUpdatedLayerNames(new Map());
              }}
              className="bg-yellow-500 hover:bg-yellow-400 text-black px-4 py-2 rounded-lg flex items-center gap-2 transition-colors font-bold"
            >
              <Plus className="w-5 h-5" />
              <span>خدمة توصيل جديدة</span>
            </button>
          </div>
          <h2 className="text-2xl font-black text-white flex items-center gap-2">
            <MapPin className="w-6 h-6 text-yellow-300" />
            إدارة خدمات التوصيل (الفروع)
          </h2>
          <button
            onClick={() => {
              setStagedLayers([]);
              setMovedOtherLayers(new Map());
              setDeletedLayerIds(new Set());
              setUpdatedLayerPrices(new Map());
              setUpdatedLayerNames(new Map());
              onClose();
            }}
            className="bg-red-600 hover:bg-red-500 p-2 rounded-lg transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Map */}
          <div className={`flex-1 relative ${isDrawingLayer || isAddingPoints || canEditPoints || noLayersForCurrentService ? 'delivery-service-edit-mode' : ''}`}>
            <MapContainer
              center={mapCenter}
              zoom={zoomLevel}
              style={{ width: '100%', height: '100%' }}
              className={isDrawingLayer || isAddingPoints || canEditPoints || noLayersForCurrentService ? 'cursor-crosshair' : ''}
              zoomControl={false}
              attributionControl={false}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                className="dark-tile-layer"
              />
              <MapController center={mapCenter} zoom={zoomLevel} />
              <MapEventsHandler
                onMapClick={onMapClick}
                isDrawing={isDrawingLayer || isAddingPoints || noLayersForCurrentService}
                draggedLayerId={draggedLayerId}
                dragStartPos={dragStartPos}
                mouseDownLayer={mouseDownLayer}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
                onDragStart={onDragStart}
              />

              {/* Zones */}
              {zones?.map(zone => (
                zone.polygon_points && zone.polygon_points.length >= 3 && (
                  <Polygon
                    key={zone.id}
                    positions={zone.polygon_points.map(p => [p.lat, p.lng])}
                    pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.1, weight: 1 }}
                  />
                )
              ))}

              {/* Service Layers */}
              {services.map(service => {
                const isSelected = service.id === selectedServiceId || service.id === editingService?.id;
                const sortWithEditingOnTop = (a: DeliveryZoneLayer, b: DeliveryZoneLayer) => {
                  const idA = getLayerId(a, service.id);
                  const idB = getLayerId(b, service.id);
                  const isEditingA = editingLayer && getLayerId(editingLayer) === idA;
                  const isEditingB = editingLayer && getLayerId(editingLayer) === idB;
                  if (isEditingA && !isEditingB) return 1;
                  if (isEditingB && !isEditingA) return -1;
                  // Draw lower order_index last so inner/smaller rings are on top
                  return (b.order_index || 0) - (a.order_index || 0);
                };
                return (service.layers || [])
                  .slice()
                  .sort(sortWithEditingOnTop)
                  .map(layer => {
                    const layerId = getLayerId(layer, service.id);
                    // Skip if this layer is marked for deletion
                    if (deletedLayerIds.has(layerId)) return null;
                    // سيتم رسم الطبقة الحالية في لوحة التحرير الخاصة بها
                    if (editingLayer && getLayerId(editingLayer) === layerId) return null;

                    const points = getPointsForLayer(layerId, layer.polygon_points || []);
                    if (points.length < 3) return null;

                    const isEditingLayer =
                      !!editingLayer && getLayerId(editingLayer) === layerId;

                    const isHoveredFromList = hoveredLayerId === layerId;

                    return (
                      <div key={layerId}>
                        <Polygon
                          positions={points.map(p => [p.lat, p.lng])}
                          pathOptions={{
                            // غيّرنا لون الحواف فقط، مع الحفاظ على لون التعبئة الأصفر كما هو
                            color: isEditingLayer ? '#f97316' : (isHoveredFromList ? '#22c55e' : '#facc15'),
                            weight: isEditingLayer ? 3 : (isHoveredFromList ? 2.5 : 1.5),
                            fillColor: '#facc15',
                            fillOpacity: 0.25
                          }}
                          eventHandlers={{
                            mousedown: (e) => {
                              if (canEditPoints && isEditingLayer) {
                                L.DomEvent.stop(e);
                                setDragDidOccur(false);
                                setMouseDownLayer({
                                  layerId,
                                  startPos: e.latlng,
                                  points
                                });
                              }
                            },
                            click: (e) => {
                              if (isAddingPoints && isEditingLayer) {
                                onMapClick(e.latlng);
                              }
                            }
                          }}
                        />
                        {isSelected &&
                          editingService &&
                          canEditPoints &&
                          isEditingLayer &&
                          points.map((pt, i) => {
                            const isHovered = hoveredPoint?.layerId === layerId && hoveredPoint.index === i;
                            return (
                              <Marker
                                key={`${layerId}-pt-${i}`}
                                position={[pt.lat, pt.lng]}
                                icon={isHovered ? hoveredVertexIcon : vertexIcon}
                                draggable={canEditPoints}
                                eventHandlers={{
                                  drag: (e) => {
                                    const marker = e.target;
                                    const newPos = marker.getLatLng();
                                    const newPoints = points.map((p, idx) =>
                                      idx === i ? { lat: newPos.lat, lng: newPos.lng } : p
                                    );
                                    if (editingLayer && getLayerId(editingLayer) === layerId) {
                                      setEditingLayer({ ...editingLayer, points: newPoints });
                                    }
                                    if (isStagedId(layerId)) {
                                      setStagedLayers(prev => prev.map(l => getLayerId(l) === layerId ? { ...l, points: newPoints } : l));
                                    } else {
                                      setMovedOtherLayers(prev => new Map(prev).set(layerId, newPoints));
                                    }
                                  }
                                }}
                              />
                            );
                          })}
                      </div>
                    );
                  });
              })}

              {/* Staged Layers (Creation Mode) */}
              {editingService && [...stagedLayers]
                .sort((a, b) => {
                  const idA = getLayerId(a, editingService.id);
                  const idB = getLayerId(b, editingService.id);
                  const isEditingA = editingLayer && getLayerId(editingLayer) === idA;
                  const isEditingB = editingLayer && getLayerId(editingLayer) === idB;
                  if (isEditingA && !isEditingB) return 1;
                  if (isEditingB && !isEditingA) return -1;
                  return (b.order_index || 0) - (a.order_index || 0);
                })
                .map((layer) => {
                  const layerId = getLayerId(layer, editingService.id);
                  if (deletedLayerIds.has(layerId)) return null; // Skip if marked for deletion
                  // سيتم رسم الطبقة الحالية في لوحة التحرير الخاصة بها
                  if (editingLayer && getLayerId(editingLayer) === layerId) return null;
                  const points = getPointsForLayer(layerId, layer.points);
                  if (points.length < 3) return null;

                  const isEditingLayer =
                    !!editingLayer && getLayerId(editingLayer) === layerId;
                  const isHoveredFromList = hoveredLayerId === layerId;

                return (
                  <div key={layerId}>
                    <Polygon
                      positions={points.map(p => [p.lat, p.lng])}
                      pathOptions={{
                        // غيّرنا لون الحواف فقط، مع الحفاظ على لون التعبئة الأصفر كما هو
                        color: isEditingLayer ? '#f97316' : (isHoveredFromList ? '#22c55e' : '#facc15'),
                        weight: isEditingLayer ? 3 : (isHoveredFromList ? 2.5 : 1.5),
                        fillColor: '#facc15',
                        fillOpacity: 0.25
                      }}
                        eventHandlers={{
                          mousedown: (e) => {
                            if (canEditPoints && isEditingLayer) {
                              L.DomEvent.stop(e);
                              setDragDidOccur(false);
                              setMouseDownLayer({
                                layerId,
                                startPos: e.latlng,
                                points
                              });
                            }
                          },
                          click: (e) => {
                            if (isAddingPoints && isEditingLayer) {
                              onMapClick(e.latlng);
                            }
                          }
                        }}
                      />
                      {canEditPoints &&
                        isEditingLayer &&
                        layer.points.map((pt, i) => {
                          const isHovered = hoveredPoint?.layerId === layerId && hoveredPoint.index === i;
                          return (
                            <Marker
                              key={`${layerId}-pt-${i}`}
                              position={[pt.lat, pt.lng]}
                              icon={isHovered ? hoveredVertexIcon : vertexIcon}
                              draggable={true}
                              eventHandlers={{
                                drag: (e) => {
                                  const marker = e.target;
                                  const newPos = marker.getLatLng();
                                  const newPoints = points.map((p, idxPt) =>
                                    idxPt === i ? { lat: newPos.lat, lng: newPos.lng } : p
                                  );
                                  if (editingLayer && getLayerId(editingLayer) === layerId) {
                                    setEditingLayer({ ...editingLayer, points: newPoints });
                                  }
                                  setStagedLayers(prev => prev.map((l) => getLayerId(l) === layerId ? { ...l, points: newPoints } : l));
                                }
                              }}
                            />
                          );
                        })}
                    </div>
                  );
                })}

              {/* Editing Layer - لوحة خاصة دائماً في الأعلى حتى في حالة عدم وجودها ضمن layers أو stagedLayers */}
              {editingLayer && editingLayer.points.length > 0 && (
                <Pane name="editing-layer-pane" style={{ zIndex: 650 }}>
                  {editingLayer.points.length >= 3 && (() => {
                    const layerId = getLayerId(editingLayer);
                    return (
                      <Polygon
                        positions={editingLayer.points.map(p => [p.lat, p.lng])}
                        pathOptions={{
                          // الطبقة المختارة: حواف برتقالية مع نفس تعبئة الطبقات الأخرى
                          color: '#f97316',
                          weight: 3,
                          fillColor: '#facc15',
                          fillOpacity: 0.25
                        }}
                        eventHandlers={{
                          mousedown: (e) => {
                            if (canEditPoints) {
                              L.DomEvent.stop(e);
                              setDragDidOccur(false);
                              setMouseDownLayer({
                                layerId,
                                startPos: e.latlng,
                                points: editingLayer.points
                              });
                            }
                          },
                          click: (e) => {
                            if (isAddingPoints) {
                              onMapClick(e.latlng);
                            }
                          }
                        }}
                      />
                    );
                  })()}
                  {canEditPoints && editingLayer.points.map((pt, i) => {
                    const layerId = getLayerId(editingLayer);
                    const isHovered = hoveredPoint?.layerId === layerId && hoveredPoint.index === i;
                    return (
                      <Marker
                        key={`editing-pt-${i}`}
                        position={[pt.lat, pt.lng]}
                        icon={isHovered ? hoveredVertexIcon : vertexIcon}
                        draggable={canEditPoints}
                        eventHandlers={{
                          drag: (e) => {
                            const marker = e.target;
                            const newPos = marker.getLatLng();
                            const newPoints = editingLayer.points.map((p, idx) =>
                              idx === i ? { lat: newPos.lat, lng: newPos.lng } : p
                            );
                            setEditingLayer({ ...editingLayer, points: newPoints });

                            const layerId = getLayerId(editingLayer);
                            if (isStagedId(layerId)) {
                              setStagedLayers(prev => prev.map(l => getLayerId(l) === layerId ? { ...l, points: newPoints } : l));
                            } else {
                              setMovedOtherLayers(prev => new Map(prev).set(layerId, newPoints));
                            }
                          }
                        }}
                      />
                    );
                  })}
                </Pane>
              )}

              {/* Branch Center Pin - لوحة أعلى من كل الطبقات ليكون دائماً قابلاً للسحب */}
              {centerPin && (
                <Pane name="branch-pin-pane" style={{ zIndex: 700 }}>
                  <Marker
                    position={[centerPin.lat, centerPin.lng]}
                    icon={branchIcon}
                    draggable={true}
                    eventHandlers={{
                      drag: (e) => {
                        setDragDidOccur(true);
                        const marker = e.target;
                        const newPos = marker.getLatLng();
                        const point = { lat: newPos.lat, lng: newPos.lng };
                        const oldCenter = centerPin;
                        const deltaLat = point.lat - oldCenter.lat;
                        const deltaLng = point.lng - oldCenter.lng;
                        setCenterPin(point);
                        if (editingService) {
                          setEditingService({ ...editingService, branch_location: point });
                          if (!moveCenterOnly) {
                            if (editingLayer) {
                              const newEditingPoints = editingLayer.points.map(p => ({
                                lat: p.lat + deltaLat,
                                lng: p.lng + deltaLng
                              }));
                              setEditingLayer({ ...editingLayer, points: newEditingPoints });
                            }
                            if (editingService) {
                              const currentService = services.find(s => s.id === editingService.id);
                              const serviceLayers = currentService?.layers || [];

                              setMovedOtherLayers(prev => {
                                const nextMap = new Map(prev);
                                serviceLayers.forEach(l => {
                                  const lId = getLayerId(l, editingService.id);
                                  if (deletedLayerIds.has(lId)) return; // Don't move deleted layers
                                  const basePoints = prev.get(lId) || l.polygon_points || [];
                                  const movedPoints = basePoints.map(p => ({
                                    lat: p.lat + deltaLat,
                                    lng: p.lng + deltaLng
                                  }));
                                  nextMap.set(lId, movedPoints);
                                });
                                return nextMap;
                              });

                              // Move stagedLayers for this service
                              setStagedLayers(prev => prev.map(l => {
                                if (l.serviceId === editingService.id) {
                                  return {
                                    ...l,
                                    points: l.points.map(p => ({ lat: p.lat + deltaLat, lng: p.lng + deltaLng }))
                                  };
                                }
                                return l;
                              }));
                            }
                          }
                        }
                      },
                      dragend: () => {
                        // Note: We leave saving to the Save button to prevent overwriting user cancels.
                      }
                    }}
                  />
                </Pane>
              )}
            </MapContainer>

            {/* Float Controls */}
            <div className="absolute top-2 right-2 flex flex-col gap-2 z-[1000]">
              <button onClick={handleZoomIn} disabled={zoomLevel >= 18} className="bg-black/70 hover:bg-black/90 text-white p-2 rounded-lg transition-colors disabled:opacity-50"><ZoomIn className="w-5 h-5" /></button>
              <button onClick={handleZoomOut} disabled={zoomLevel <= 1} className="bg-black/70 hover:bg-black/90 text-white p-2 rounded-lg transition-colors disabled:opacity-50"><ZoomOut className="w-5 h-5" /></button>
              <button onClick={handleRecenterToBranch} className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-lg transition-colors"><Navigation className="w-5 h-5" /></button>
            </div>

            <div className="absolute bottom-3 left-3 bg-black/70 text-white text-xs px-2 py-1 rounded z-[1000]">
              اسحب دبوس الفرع لتحريك موقع الفرع والطبقات (أو فعل "تحريك المركز فقط")
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-96 bg-gray-800 border-l-2 border-yellow-500 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {/* Services list (تظهر فقط عندما لا نكون في وضع تعديل خدمة معينة) */}
            {!editingService && (
              <div>
                <h3 className="text-xl font-bold text-white mb-3 text-right">فروع التوصيل الحالية</h3>
                <div className="space-y-2">
                  {services.map(service => (
                    <div
                      key={service.id}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${selectedServiceId === service.id ? 'border-yellow-400 bg-yellow-900/30' : 'border-gray-700 bg-gray-900/50'}`}
                      onClick={() => handleSelectService(service)}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-bold text-right">{service.name}</span>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${service.is_active ? 'bg-green-700 text-green-100' : 'bg-red-700 text-red-100'}`}>
                          {service.is_active ? 'فعال' : 'معطل'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-300">
                        <span>{service.branch_location ? `${(service.branch_location as PolygonPoint).lat.toFixed(5)}, ${(service.branch_location as PolygonPoint).lng.toFixed(5)}` : 'لم يتم تعيين موقع الفرع بعد'}</span>
                        <span className="text-yellow-300">{service.layers?.length || 0} طبقات خدمة</span>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <button onClick={e => { e.stopPropagation(); handleEditService(service); }} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-1 rounded text-xs font-bold"><Edit2 className="w-3 h-3 inline mr-1" />تعديل</button>
                        <button onClick={e => { e.stopPropagation(); onServiceDelete(service.id).catch(console.error); }} className="bg-red-600 hover:bg-red-500 text-white py-1 px-2 rounded text-xs font-bold"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {editingService && (
              <>
                <div className="bg-yellow-900/20 border-2 border-yellow-500 rounded-lg p-4 space-y-3">
                  <h3 className="text-lg font-bold text-white mb-2 text-right">{editingService.id && !editingService.id.startsWith('new-') ? 'تعديل خدمة التوصيل' : 'خدمة توصيل جديدة'}</h3>
                  <div>
                    <label className="block text-yellow-200 mb-1 text-right text-xs">اسم الفرع / خدمة التوصيل</label>
                    <input type="text" value={editingService.name} onChange={e => setEditingService({ ...editingService, name: e.target.value })} className="w-full bg-gray-900 border border-yellow-500/60 rounded-lg px-3 py-2 text-white text-right" placeholder="مثال: فرع المحلة الكبرى" dir="rtl" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-yellow-100 text-xs">حالة الخدمة</span>
                    <button onClick={() => setEditingService({ ...editingService, is_active: !editingService.is_active })} className={`px-3 py-1 rounded-full text-xs font-bold ${editingService.is_active ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-gray-600 hover:bg-gray-500 text-white'}`}>{editingService.is_active ? 'فعالة' : 'معطلة'}</button>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-yellow-100 text-xs">موقع دبوس الفرع</span>
                      <button
                        onClick={() => {
                          handleAddLayerToService(editingService as DeliveryService);
                        }}
                        className="px-2 py-1 bg-yellow-500 hover:bg-yellow-400 text-black rounded text-xs font-bold flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        إضافة طبقة جديدة
                      </button>
                      <button onClick={() => setMoveCenterOnly(!moveCenterOnly)} className={`px-2 py-1 rounded text-xs font-bold flex items-center gap-1 transition-colors ${moveCenterOnly ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'}`} title="عند التفعيل، سحب الدبوس لن يحرك الطبقات"><MapPin className="w-3 h-3" />{moveCenterOnly ? 'المركز فقط' : 'الكل'}</button>
                    </div>
                    <p className="text-xs text-gray-300 text-right">
                      {centerPin ? `${centerPin.lat.toFixed(6)}, ${centerPin.lng.toFixed(6)}` : 'اختر خدمة توصيل أو انقر على الخريطة.'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCancelEdit}
                      className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition-colors font-bold"
                    >
                      إلغاء
                    </button>
                    <button onClick={handleSaveService} className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black py-2 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"><Save className="w-4 h-4" />حفظ</button>
                  </div>
                </div>
              </>
            )}

            {/* Layers for current service */}
            {editingService && (
              <div className="bg-gray-900/60 border-2 border-yellow-500/40 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between mb-2">
                  <button
                    onClick={() => {
                      const next = !canEditPoints;
                      setCanEditPoints(next);
                      setIsAddingPoints(next);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-2 border-2 ${canEditPoints ? 'bg-orange-600 border-orange-400 text-white shadow-[0_0_15px_rgba(234,88,12,0.4)]' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-yellow-500 hover:text-yellow-400'}`}
                    title="تفعيل هذا الخيار يسمح لك بسحب نقاط المضلع يدوياً أو تحريك الطبقة بالسحب من داخلها، وأيضاً إضافة نقاط جديدة بالضغط على الخريطة"
                  >
                    <Edit2 className={`w-3.5 h-3.5 ${canEditPoints ? 'animate-pulse' : ''}`} />
                    {canEditPoints ? 'إغلاق التعديل' : 'تفعيل السحب والتعديل'}
                  </button>
                  <h4 className="text-xs font-bold text-yellow-200 text-right">طبقات التسعير</h4>
                </div>

                <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-1">
                  {/* Unified Layer List */}
                  {[
                    // طبقات محفوظة من القاعدة
                    ...(services.find(s => s.id === editingService.id)?.layers || [])
                      .filter(l => !deletedLayerIds.has(getLayerId(l, editingService.id))),
                    // طبقات مؤقتة (staged) لنفس الخدمة
                    ...stagedLayers.filter(l => l.serviceId === editingService.id && !deletedLayerIds.has(getLayerId(l))),
                    // أول طبقة قيد الرسم: تظهر مرة واحدة فقط (لا نضيفها إن كانت مضافة مسبقاً في stagedLayers)
                    ...(editingLayer &&
                      editingLayer.id === 'initial-layer' &&
                      editingLayer.points.length >= 1 &&
                      !stagedLayers.some(l => getLayerId(l) === 'initial-layer')
                      ? [editingLayer as any]
                      : [])
                  ]
                    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0))
                    .map((layer) => {
                      const layerId = getLayerId(layer, editingService.id);
                      const isEditing = editingLayer && getLayerId(editingLayer) === layerId;
                      const isStaged = layerId.startsWith('unpinned-');

                      // Get current points
                      const points = getPointsForLayer(layerId, (layer as DeliveryZoneLayer).polygon_points || (layer as EditingLayer).points || []);
                      const existingName = (layer as DeliveryZoneLayer).name ?? (layer as EditingLayer).name ?? null;
                      const displayName =
                        updatedLayerNames.get(layerId) ??
                        existingName ??
                        `طبقة ${layer.order_index}`;

                      return (
                        <div
                          key={layerId}
                          className={`p-3 rounded-lg border-2 transition-all cursor-pointer ${isEditing ? 'bg-yellow-900/40 border-yellow-500' : 'bg-gray-800/80 border-gray-700 hover:border-yellow-600'}`}
                          onClick={() => {
                            // قبل التبديل، احفظ نقاط الطبقة الحالية حتى لا تضيع الدبابيس التي أضيفت من الخريطة
                            persistEditingLayerPoints();

                            const layerName = isEditing && editingLayer ? editingLayer.name : ((layer as DeliveryZoneLayer).name || (layer as EditingLayer).name || null);
                            setEditingLayer({
                              id: isStaged ? layerId : (layer as DeliveryZoneLayer).id,
                              serviceId: editingService.id,
                              points: points,
                              delivery_price: layer.delivery_price,
                              order_index: layer.order_index,
                              name: layerName
                            });
                          }}
                          onMouseEnter={() => setHoveredLayerId(layerId)}
                          onMouseLeave={() => setHoveredLayerId(null)}
                        >
                          <div className="flex justify-between items-center mb-2">
                            <button onClick={e => { e.stopPropagation(); handleLayerDelete(layerId); }} className="text-red-500 hover:text-red-400 p-1 rounded hover:bg-red-900/20 transition-colors"><Trash2 className="w-4 h-4" /></button>
                            <div className="flex items-center gap-3">
                              <div className="flex flex-col items-end gap-1">
                                <div className="flex flex-col items-end">
                                  <span className="text-[10px] text-gray-400">اسم الطبقة</span>
                                  <input
                                    type="text"
                                    value={displayName}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setUpdatedLayerNames(prev => {
                                        const map = new Map(prev);
                                        map.set(layerId, val);
                                        return map;
                                      });
                                      if (isStaged) {
                                        setStagedLayers(prev =>
                                          prev.map(l => getLayerId(l) === layerId ? { ...l, name: val } : l)
                                        );
                                      }
                                      setEditingLayer(prev => {
                                        if (!prev || getLayerId(prev) !== layerId) return prev;
                                        return { ...prev, name: val };
                                      });
                                    }}
                                    className="w-28 bg-black border border-yellow-500/50 rounded text-right text-white text-xs py-1 px-1"
                                    onClick={e => e.stopPropagation()}
                                  />
                                </div>
                                <div className="flex flex-col items-end">
                                  <span className="text-[10px] text-gray-400">سعر التوصيل</span>
                                  <input
                                    type="number"
                                    value={
                                      updatedLayerPrices.get(layerId) ??
                                      (isEditing && editingLayer && getLayerId(editingLayer) === layerId
                                        ? editingLayer.delivery_price
                                        : layer.delivery_price)
                                    }
                                    onChange={e => {
                                      const val = parseFloat(e.target.value) || 0;
                                      if (isStaged) {
                                        setStagedLayers(prev =>
                                          prev.map(l => getLayerId(l) === layerId ? { ...l, delivery_price: val } : l)
                                        );
                                      }

                                      setUpdatedLayerPrices(prev => {
                                        const map = new Map(prev);
                                        map.set(layerId, val);
                                        return map;
                                      });

                                      setEditingLayer(prev => {
                                        if (prev && getLayerId(prev) === layerId) {
                                          return { ...prev, delivery_price: val };
                                        }

                                        // في حال تعديل السعر دون اختيار الطبقة يدوياً من القائمة، قم بتعيينها كطبقة حالية
                                        return {
                                          id: isStaged || layerId === 'initial-layer' ? layerId : (layer as DeliveryZoneLayer).id,
                                          serviceId: editingService.id,
                                          points,
                                          delivery_price: val,
                                          order_index: layer.order_index,
                                          name: existingName ?? null
                                        };
                                      });
                                    }}
                                    className="w-20 bg-black border border-yellow-500/50 rounded text-center text-white text-xs py-1"
                                    onClick={e => e.stopPropagation()}
                                  />
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="flex items-center gap-1 justify-end">
                                  {isStaged && <span className="bg-blue-600 text-white text-[8px] px-1 rounded font-bold">جديد</span>}
                                  <span className="text-yellow-200 font-bold">طبقة {layer.order_index}</span>
                                </div>
                                <span className="text-[10px] text-gray-500">{points.length} نقاط</span>
                              </div>
                            </div>
                          </div>

                          {/* Pin removal buttons for the active layer */}
                          {isEditing && canEditPoints && points.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-yellow-500/20">
                              <p className="text-[10px] text-yellow-300 mb-1 text-right">إزالة نقاط معينة:</p>
                              <div className="flex flex-wrap gap-1 justify-end">
                                {points.map((_, i) => (
                                  <button
                                    key={i}
                                    onMouseEnter={() => setHoveredPoint({ layerId, index: i })}
                                    onMouseLeave={() => setHoveredPoint(null)}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const newPoints = points.filter((_, idx) => idx !== i);
                                      setEditingLayer({ ...editingLayer, points: newPoints });

                                      if (layerId.startsWith('unpinned-')) {
                                        setStagedLayers(prev => prev.map(l => getLayerId(l) === layerId ? { ...l, points: newPoints } : l));
                                      } else {
                                        setMovedOtherLayers(prev => new Map(prev).set(layerId, newPoints));
                                      }
                                    }}
                                    className={`bg-gray-900 border px-1.5 py-0.5 rounded text-[10px] transition-all ${hoveredPoint?.layerId === layerId && hoveredPoint.index === i ? 'border-red-500 text-red-500 scale-110 shadow-lg shadow-red-900/50' : 'border-yellow-600/30 text-yellow-100 hover:border-red-500 hover:text-red-400'}`}
                                  >
                                    {i + 1}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
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
        .delivery-service-edit-mode .leaflet-container,
        .delivery-service-edit-mode .leaflet-container *,
        .delivery-service-edit-mode .leaflet-pane,
        .delivery-service-edit-mode .leaflet-pane * {
          cursor: crosshair !important;
        }
      `}} />
    </div >
  );
}
