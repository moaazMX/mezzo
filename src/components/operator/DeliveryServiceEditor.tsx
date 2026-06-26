import React, { useState, useEffect, useCallback } from 'react';
import { X, Save, Trash2, Edit2, Plus, Navigation, ZoomIn, ZoomOut, MapPin, ChevronDown } from 'lucide-react';
import { MapContainer, TileLayer, Polygon, Marker, Pane, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { DeliveryService, DeliveryZoneLayer, PolygonPoint, DeliveryZone } from '../../lib/supabase';
import {
  getPolygonCenter,
  createExpandedLayer,
  ensurePointLabels,
  insertPolygonPoint,
  removePolygonPointByLabel,
  isNearExistingVertex,
  isPointInPolygon,
  applyLayerTransform
} from '../../lib/geoUtils';
import ScrubNumberInput from './ScrubNumberInput';

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
  onZoneCreate?: (zoneData: {
    name: string;
    polygon_points: PolygonPoint[];
    is_active: boolean;
    base_delivery_price?: number;
  }) => Promise<void>;
  onZoneUpdate?: (zoneId: string, updates: Partial<DeliveryZone>) => Promise<void>;
  onZoneDelete?: (zoneId: string) => Promise<void>;
  onClose: () => void;
}

interface EditingBlockerZone {
  id: string | null;
  name: string;
  points: PolygonPoint[];
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
  onMapHover,
  isDrawing,
  draggedLayerId,
  dragStartPos,
  mouseDownLayer,
  onDragMove,
  onDragEnd,
  onDragStart
}: {
  onMapClick: (latlng: { lat: number, lng: number }) => void,
  onMapHover?: (lat: number, lng: number, x: number, y: number) => void,
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
      onMapHover?.(e.latlng.lat, e.latlng.lng, e.containerPoint.x, e.containerPoint.y);
    },
    mouseup: () => {
      onDragEnd();
    }
  });
  return null;
}

function MapBlockerDragHandler({
  isDragging,
  onDrag,
  onStop
}: {
  isDragging: boolean;
  onDrag: (pos: L.LatLng) => void;
  onStop: () => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (isDragging) map.dragging.disable();
    else map.dragging.enable();
  }, [isDragging, map]);

  useMapEvents({
    mousemove: (e) => {
      if (isDragging) onDrag(e.latlng);
    },
    mouseup: () => {
      if (isDragging) onStop();
    }
  });

  useEffect(() => {
    const handleUp = () => {
      if (isDragging) onStop();
    };
    window.addEventListener('mouseup', handleUp);
    return () => window.removeEventListener('mouseup', handleUp);
  }, [isDragging, onStop]);

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
  onZoneCreate,
  onZoneUpdate,
  onZoneDelete,
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
  const [pinDragStartPos, setPinDragStartPos] = useState<PolygonPoint | null>(null);
  const [allLayersInitialPoints, setAllLayersInitialPoints] = useState<Map<string, PolygonPoint[]>>(new Map());
  const [moveCenterOnly, setMoveCenterOnly] = useState(false);
  const [canEditPoints, setCanEditPoints] = useState(false);
  const [movedOtherLayers, setMovedOtherLayers] = useState<Map<string, PolygonPoint[]>>(new Map());
  const [stagedLayers, setStagedLayers] = useState<EditingLayer[]>([]);
  const [draggedLayerId, setDraggedLayerId] = useState<string | number | null>(null);
  const [dragStartPos, setDragStartPos] = useState<L.LatLng | null>(null);
  const [draggedLayerInitialPoints, setDraggedLayerInitialPoints] = useState<PolygonPoint[] | null>(null);
  const [hoveredPointLabel, setHoveredPointLabel] = useState<{ layerId: string, label: number } | null>(null);
  const [hoveredBlockerLabel, setHoveredBlockerLabel] = useState<number | null>(null);
  const [hoveredLayerId, setHoveredLayerId] = useState<string | null>(null);
  const [dragDidOccur, setDragDidOccur] = useState(false);
  const [mouseDownLayer, setMouseDownLayer] = useState<{ layerId: string; startPos: L.LatLng; points: PolygonPoint[] } | null>(null);
  const [updatedLayerPrices, setUpdatedLayerPrices] = useState<Map<string, number>>(new Map());
  const [updatedLayerNames, setUpdatedLayerNames] = useState<Map<string, string>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [editingBlockerZone, setEditingBlockerZone] = useState<EditingBlockerZone | null>(null);
  const [blockerZoneName, setBlockerZoneName] = useState('');
  const [isDraggingBlocker, setIsDraggingBlocker] = useState(false);
  const [blockerDragStart, setBlockerDragStart] = useState<L.LatLng | null>(null);
  const [blockerDragDidMove, setBlockerDragDidMove] = useState(false);
  const [hoveredLayerTooltip, setHoveredLayerTooltip] = useState<{
    name: string;
    price: number;
    x: number;
    y: number;
  } | null>(null);
  const [layerTransformBase, setLayerTransformBase] = useState<Map<string, PolygonPoint[]>>(new Map());
  const [layerScalePercent, setLayerScalePercent] = useState<Map<string, number>>(new Map());
  const [layerRotateDegrees, setLayerRotateDegrees] = useState<Map<string, number>>(new Map());
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [pendingBlockerUpdates, setPendingBlockerUpdates] = useState<
    Map<string, { name: string; points: PolygonPoint[] }>
  >(new Map());
  const [deletedBlockerZoneIds, setDeletedBlockerZoneIds] = useState<Set<string>>(new Set());

  const isStagedId = (id: string) => id.startsWith('unpinned-') || id === 'initial-layer';
  const blockerZones = (zones || []).filter(
    (z) => z.is_active === false && !deletedBlockerZoneIds.has(z.id)
  );

  const getBlockerTransformId = (blocker: EditingBlockerZone | null) =>
    blocker?.id ? `blocker:${blocker.id}` : 'blocker:new';

  const getLayerScale = (transformId: string) => layerScalePercent.get(transformId) ?? 100;
  const getLayerRotate = (transformId: string) => layerRotateDegrees.get(transformId) ?? 0;

  const getBlockerPoints = (zone: DeliveryZone): PolygonPoint[] => {
    if (editingBlockerZone?.id === zone.id) return editingBlockerZone.points;
    const pending = pendingBlockerUpdates.get(zone.id);
    if (pending) return pending.points;
    return ensurePointLabels((zone.polygon_points || []) as PolygonPoint[]);
  };

  const syncTransformBase = (layerId: string, points: PolygonPoint[]) => {
    setLayerTransformBase((prev) => {
      const next = new Map(prev);
      next.set(layerId, ensurePointLabels(points.map((p) => ({ ...p }))));
      return next;
    });
    setLayerScalePercent((prev) => {
      const next = new Map(prev);
      next.set(layerId, 100);
      return next;
    });
    setLayerRotateDegrees((prev) => {
      const next = new Map(prev);
      next.set(layerId, 0);
      return next;
    });
  };

  const applyTransformToLayerPoints = (
    layerId: string,
    scale: number,
    rotate: number,
    baseOverride?: PolygonPoint[]
  ) => {
    const base =
      baseOverride ??
      layerTransformBase.get(layerId) ??
      (editingLayer && getLayerId(editingLayer) === layerId ? editingLayer.points : null);
    if (!base || base.length < 3) return;
    const transformed = applyLayerTransform(base, scale, rotate);

    if (editingLayer && getLayerId(editingLayer) === layerId) {
      setEditingLayer({ ...editingLayer, points: transformed });
    }
    if (isStagedId(layerId)) {
      setStagedLayers((prev) =>
        prev.map((l) => (getLayerId(l) === layerId ? { ...l, points: transformed } : l))
      );
    } else {
      setMovedOtherLayers((prev) => new Map(prev).set(layerId, transformed));
    }
  };

  const handleLayerTransformChange = (layerId: string, scale: number, rotate: number) => {
    if (!layerTransformBase.has(layerId)) {
      const current = getPointsForLayer(
        layerId,
        editingLayer && getLayerId(editingLayer) === layerId
          ? editingLayer.points
          : []
      );
      if (current.length >= 3) syncTransformBase(layerId, current);
    }
    setLayerScalePercent((prev) => new Map(prev).set(layerId, scale));
    setLayerRotateDegrees((prev) => new Map(prev).set(layerId, rotate));
    applyTransformToLayerPoints(layerId, scale, rotate);
  };

  const applyTransformToBlockerPoints = (transformId: string, scale: number, rotate: number) => {
    if (!editingBlockerZone) return;
    const base = layerTransformBase.get(transformId) ?? editingBlockerZone.points;
    if (base.length < 3) return;
    const transformed = applyLayerTransform(base, scale, rotate);
    setEditingBlockerZone({ ...editingBlockerZone, points: transformed });
  };

  const handleBlockerTransformChange = (transformId: string, scale: number, rotate: number) => {
    if (!layerTransformBase.has(transformId) && editingBlockerZone?.points.length >= 3) {
      syncTransformBase(transformId, editingBlockerZone.points);
    }
    setLayerScalePercent((prev) => new Map(prev).set(transformId, scale));
    setLayerRotateDegrees((prev) => new Map(prev).set(transformId, rotate));
    applyTransformToBlockerPoints(transformId, scale, rotate);
  };

  const persistEditingBlockerZone = () => {
    if (!editingBlockerZone?.id) return;
    setPendingBlockerUpdates((prev) =>
      new Map(prev).set(editingBlockerZone.id!, {
        name: blockerZoneName.trim() || editingBlockerZone.name,
        points: editingBlockerZone.points
      })
    );
  };

  const selectLayerForEdit = (
    layerId: string,
    layer: DeliveryZoneLayer | EditingLayer,
    points: PolygonPoint[]
  ) => {
    persistEditingBlockerZone();
    setEditingBlockerZone(null);

    const layerName =
      (layer as DeliveryZoneLayer).name ?? (layer as EditingLayer).name ?? null;
    const labeled = ensurePointLabels(points);
    syncTransformBase(layerId, labeled);
    setExpandedItemId(layerId);
    setEditingLayer({
      id: layerId.startsWith('unpinned-') || layerId === 'initial-layer'
        ? layerId
        : (layer as DeliveryZoneLayer).id,
      serviceId: editingService!.id,
      points: labeled,
      delivery_price: layer.delivery_price,
      order_index: layer.order_index,
      name: layerName
    });
  };

  const selectBlockerForEdit = (zone: DeliveryZone | null, draft?: EditingBlockerZone) => {
    persistEditingLayerPoints();
    setEditingLayer(null);
    setHoveredLayerId(null);

    if (draft) {
      setEditingBlockerZone(draft);
      setBlockerZoneName(draft.name);
      setExpandedItemId('blocker:new');
      if (draft.points.length > 0) {
        const center = getPolygonCenter(draft.points);
        setMapCenter([center.lat, center.lng]);
      }
      return;
    }

    if (!zone) return;
    const rawPoints = getBlockerPoints(zone);
    setEditingBlockerZone({
      id: zone.id,
      name: pendingBlockerUpdates.get(zone.id)?.name ?? zone.name,
      points: rawPoints
    });
    setBlockerZoneName(pendingBlockerUpdates.get(zone.id)?.name ?? zone.name);
    setExpandedItemId(`blocker:${zone.id}`);
    syncTransformBase(`blocker:${zone.id}`, rawPoints);
    if (rawPoints.length > 0) {
      const center = getPolygonCenter(rawPoints);
      setMapCenter([center.lat, center.lng]);
    }
  };

  const saveAllBlockerZones = async () => {
    persistEditingBlockerZone();

    if (
      editingBlockerZone &&
      editingBlockerZone.points.length >= 3 &&
      blockerZoneName.trim()
    ) {
      if (editingBlockerZone.id && onZoneUpdate) {
        await onZoneUpdate(editingBlockerZone.id, {
          name: blockerZoneName.trim(),
          polygon_points: editingBlockerZone.points,
          is_active: false
        });
      } else if (onZoneCreate) {
        await onZoneCreate({
          name: blockerZoneName.trim(),
          polygon_points: editingBlockerZone.points,
          is_active: false,
          base_delivery_price: 0
        });
      }
    }

    for (const [id, data] of pendingBlockerUpdates) {
      if (editingBlockerZone?.id === id) continue;
      if (deletedBlockerZoneIds.has(id)) continue;
      if (!data.points || data.points.length < 3) continue;
      await onZoneUpdate?.(id, {
        name: data.name,
        polygon_points: data.points,
        is_active: false
      });
    }

    for (const id of deletedBlockerZoneIds) {
      await onZoneDelete?.(id);
    }
  };

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
  const isCreatingNewService = !!editingService?.id?.startsWith('new-');

  const handleMapHoverLayers = (lat: number, lng: number, x: number, y: number) => {
    if (
      canEditPoints ||
      isDrawingLayer ||
      isAddingPoints ||
      editingBlockerZone ||
      noLayersForCurrentService
    ) {
      setHoveredLayerTooltip(null);
      return;
    }

    const point = { lat, lng };
    let found: { name: string; price: number; x: number; y: number } | null = null;

    for (const service of services) {
      if (!service.is_active) continue;
      const layers = (service.layers || []).slice().sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      for (const layer of layers) {
        const layerId = getLayerId(layer, service.id);
        if (deletedLayerIds.has(layerId)) continue;
        const pts = getPointsForLayer(layerId, layer.polygon_points || []);
        if (pts.length >= 3 && isPointInPolygon(point, pts)) {
          const price =
            updatedLayerPrices.get(layerId) ?? Number(layer.delivery_price || 0);
          const name =
            updatedLayerNames.get(layerId) ?? layer.name ?? `طبقة ${layer.order_index}`;
          found = { name, price, x, y: y + 72 };
          break;
        }
      }
      if (found) break;
    }

    setHoveredLayerTooltip(found);
  };

  const isServiceBeingEdited = (serviceId: string | null | undefined) =>
    !!editingService && serviceId !== undefined && editingService.id === serviceId;

  const startNewService = () => {
    const newId = 'new-' + Date.now();
    setEditingService({ id: newId, name: '', is_active: true, branch_location: null });
    setSelectedServiceId(newId);
    setEditingLayer({ id: 'initial-layer', serviceId: newId, points: [], delivery_price: 0, order_index: 1, name: null });
    setStagedLayers([]);
    setCenterPin(null);
    setMovedOtherLayers(new Map());
    setDeletedLayerIds(new Set());
    setIsDrawingLayer(true);
    setIsAddingPoints(true);
    setCanEditPoints(true);
    setUpdatedLayerPrices(new Map());
    setUpdatedLayerNames(new Map());
  };

  const captureBranchDragInitialPoints = (): Map<string, PolygonPoint[]> => {
    if (!editingService?.id) return new Map();
    const serviceId = editingService.id;
    const initialPointsMap = new Map<string, PolygonPoint[]>();

    if (editingLayer && editingLayer.serviceId === serviceId) {
      initialPointsMap.set(getLayerId(editingLayer), [...editingLayer.points]);
    }

    stagedLayers.forEach(l => {
      if (l.serviceId === serviceId) {
        initialPointsMap.set(getLayerId(l), [...l.points]);
      }
    });

    if (!serviceId.startsWith('new-')) {
      const currentSvc = services.find(s => s.id === serviceId);
      currentSvc?.layers?.forEach(l => {
        const id = getLayerId(l);
        if (!initialPointsMap.has(id)) {
          const pts = movedOtherLayers.get(id) || (l.polygon_points as PolygonPoint[]) || [];
          initialPointsMap.set(id, [...pts]);
        }
      });
    }

    return initialPointsMap;
  };

  // عند حذف كل الطبقات، تفعيل "تفعيل السحب والتعديل" تلقائياً ليكون البدء من جديد جاهزاً
  useEffect(() => {
    if (noLayersForCurrentService && !editingLayer) {
      setCanEditPoints(true);
      setIsAddingPoints(true);
    }
  }, [noLayersForCurrentService, editingLayer]);

  // دبوس الفرع يظهر تلقائياً عند اكتمال أول شكل (3 نقاط)
  useEffect(() => {
    if (!isCreatingNewService || !editingLayer || editingLayer.points.length < 3) return;
    const center = getPolygonCenter(editingLayer.points);
    setCenterPin((prev) => prev ?? center);
    setEditingService((prev) =>
      prev && !prev.branch_location ? { ...prev, branch_location: center } : prev
    );
  }, [isCreatingNewService, editingLayer?.points, editingLayer?.id]);

  const onMapClick = (latlng: { lat: number, lng: number }) => {
    if (dragDidOccur || blockerDragDidMove) {
      setDragDidOccur(false);
      setBlockerDragDidMove(false);
      return;
    }

    if (editingBlockerZone && canEditPoints) {
      const newPoints = insertPolygonPoint(editingBlockerZone.points, latlng);
      setEditingBlockerZone({ ...editingBlockerZone, points: newPoints });
      return;
    }

    if (editingLayer?.points.length && isNearExistingVertex(latlng, editingLayer.points)) {
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
        points: [{ ...latlng, label: 1 }],
        delivery_price: 0,
        order_index: 1,
        name: null
      });
      setIsAddingPoints(true);
      return;
    }

    if (isAddingPoints && editingLayer) {
      const newPoints = insertPolygonPoint(editingLayer.points, latlng);
      setEditingLayer({ ...editingLayer, points: newPoints });

      const layerId = getLayerId(editingLayer);
      if (layerId.startsWith('unpinned-') || layerId === 'initial-layer') {
        setStagedLayers(prev => prev.map(l => getLayerId(l) === layerId ? { ...l, points: newPoints } : l));
      } else {
        setMovedOtherLayers(prev => new Map(prev).set(layerId, newPoints));
      }
      return;
    }

    if (!isDrawingLayer || !editingService) return; // Only allow drawing if a service is being edited

    // This part is for initial drawing of a new layer for a new service
    if (editingLayer && editingLayer.serviceId === editingService.id) {
      const newPoints = insertPolygonPoint(editingLayer.points, latlng);
      setEditingLayer({ ...editingLayer, points: newPoints });
    }
  };

  const onDragMove = (latlng: L.LatLng) => {
    if (!draggedLayerId || !dragStartPos || !draggedLayerInitialPoints) return;

    const deltaLat = latlng.lat - dragStartPos.lat;
    const deltaLng = latlng.lng - dragStartPos.lng;

    const targetId = draggedLayerId.toString();
    const newPoints = draggedLayerInitialPoints.map(p => ({
      ...p,
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

  const startNewBlockerZone = () => {
    persistEditingLayerPoints();
    persistEditingBlockerZone();
    selectBlockerForEdit(null, { id: null, name: '', points: [] });
    setCanEditPoints(true);
    setIsAddingPoints(true);
  };

  const handleEditBlockerZone = (zone: DeliveryZone) => {
    selectBlockerForEdit(zone);
    setCanEditPoints(true);
    setIsAddingPoints(true);
  };

  const handleCancelBlockerZone = () => {
    if (editingBlockerZone?.id) {
      setPendingBlockerUpdates((prev) => {
        const next = new Map(prev);
        next.delete(editingBlockerZone.id!);
        return next;
      });
    }
    setEditingBlockerZone(null);
    setBlockerZoneName('');
    setExpandedItemId(null);
    setIsDraggingBlocker(false);
    setBlockerDragStart(null);
  };

  const handleDeleteBlockerZone = (zoneId: string) => {
    if (!window.confirm('هل أنت متأكد من حذف زون التعطيل؟')) return;
    setDeletedBlockerZoneIds((prev) => new Set(prev).add(zoneId));
    if (editingBlockerZone?.id === zoneId) {
      setEditingBlockerZone(null);
      setBlockerZoneName('');
      setExpandedItemId(null);
    }
    setPendingBlockerUpdates((prev) => {
      const next = new Map(prev);
      next.delete(zoneId);
      return next;
    });
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
    setCanEditPoints(false);
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
      const labeledServiceLayers = sortedLayers.map(layer => {
        const points = (layer.polygon_points || []) as PolygonPoint[];
        return { ...layer, polygon_points: ensurePointLabels(points) };
      });

      const base = labeledServiceLayers[0];
      setEditingLayer({
        id: base.id,
        serviceId: service.id,
        points: base.polygon_points as PolygonPoint[],
        delivery_price: base.delivery_price,
        order_index: base.order_index || 1,
        name: base.name || null
      });

      if (base.polygon_points.length >= 3) {
        setCenterPin(getAllLayersCenterPin({ ...service, layers: labeledServiceLayers }) || getPolygonCenter(base.polygon_points as PolygonPoint[]));
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

  const resolveBranchLocation = (): PolygonPoint | null => {
    if (centerPin) return centerPin;
    if (editingService?.branch_location) return editingService.branch_location as PolygonPoint;

    const collectLayerPoints = (): PolygonPoint[] | null => {
      if (editingLayer && editingLayer.points.length >= 3) return editingLayer.points;
      const staged = stagedLayers.find(
        (l) => l.serviceId === editingService?.id && l.points.length >= 3
      );
      if (staged) return staged.points;
      return null;
    };

    const pts = collectLayerPoints();
    return pts ? getPolygonCenter(pts) : null;
  };

  const handleSaveService = async () => {
    if (isSaving || !editingService) return;
    if (!editingService.name.trim()) {
      alert('يجب إدخال اسم خدمة التوصيل');
      return;
    }

    const branchLocation = resolveBranchLocation();
    const isNewService = !editingService.id || editingService.id.startsWith('new-');

    if (isNewService && !branchLocation) {
      alert('يجب رسم طبقة واحدة على الأقل (3 نقاط) لتحديد موقع الفرع قبل الحفظ');
      return;
    }

    setIsSaving(true);
    try {
      await saveAllBlockerZones();

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
          branch_location: branchLocation || editingService.branch_location
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
          branch_location: branchLocation,
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
      setEditingBlockerZone(null);
      setBlockerZoneName('');
      setExpandedItemId(null);
      setPendingBlockerUpdates(new Map());
      setDeletedBlockerZoneIds(new Set());
    } catch (err) {
      console.error('Error saving delivery service changes:', err);
      alert('حدث خطأ أثناء حفظ التغييرات: ' + (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingService(null);
    setEditingLayer(null);
    setEditingBlockerZone(null);
    setBlockerZoneName('');
    setExpandedItemId(null);
    setPendingBlockerUpdates(new Map());
    setDeletedBlockerZoneIds(new Set());
    setStagedLayers([]);
    setMovedOtherLayers(new Map());
    setDeletedLayerIds(new Set());
    setIsDrawingLayer(false);
    setIsAddingPoints(false);
    setCenterPin(null);
    setCanEditPoints(false);
    setSelectedServiceId(null);
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

  const renderBlockerZoneCards = () => {
    const cards: React.ReactNode[] = [];

    if (editingBlockerZone && !editingBlockerZone.id) {
      const zoneKey = 'blocker:new';
      const transformId = 'blocker:new';
      const pts = editingBlockerZone.points;
      const isBExpanded = expandedItemId === zoneKey;
      cards.push(
        <div key={zoneKey} className="rounded-lg border-2 overflow-hidden bg-red-900/40 border-red-500">
          <div
            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
            onClick={() => {
              persistEditingLayerPoints();
              if (isBExpanded) setExpandedItemId(null);
              else selectBlockerForEdit(null, editingBlockerZone);
            }}
          >
            <button type="button" onClick={(e) => { e.stopPropagation(); handleCancelBlockerZone(); }} className="text-red-400 p-1"><X className="w-3.5 h-3.5" /></button>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${isBExpanded ? 'rotate-180' : ''}`} />
            <div className="flex-1 text-right text-xs">
              <span className="text-red-100 font-bold">{blockerZoneName || 'زون جديد'}</span>
              <span className="text-gray-500 mr-2">· {pts.length} نقطة</span>
            </div>
          </div>
          {isBExpanded && (
            <div className="px-2 pb-2 space-y-2 border-t border-red-500/30" onClick={(e) => e.stopPropagation()}>
              <input value={blockerZoneName} onChange={(e) => setBlockerZoneName(e.target.value)} placeholder="اسم زون التعطيل" className="w-full bg-black border border-red-500/50 rounded text-white text-xs py-1 px-2 text-right" dir="rtl" />
              {canEditPoints && pts.length >= 3 && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col items-end gap-0.5"><span className="text-[10px] text-gray-400">التكبير %</span><ScrubNumberInput value={getLayerScale(transformId)} onChange={(v) => handleBlockerTransformChange(transformId, v, getLayerRotate(transformId))} min={10} max={300} suffix="%" className="w-full bg-black border border-red-500/50 rounded text-center text-white text-xs py-1" /></div>
                  <div className="flex flex-col items-end gap-0.5"><span className="text-[10px] text-gray-400">التدوير °</span><ScrubNumberInput value={getLayerRotate(transformId)} onChange={(v) => handleBlockerTransformChange(transformId, getLayerScale(transformId), v)} min={-360} max={360} suffix="°" className="w-full bg-black border border-red-500/50 rounded text-center text-white text-xs py-1" /></div>
                </div>
              )}
              {canEditPoints && pts.length > 0 && (
                <div className="flex flex-wrap gap-1 justify-end">
                  {[...pts].sort((a, b) => (a.label ?? 0) - (b.label ?? 0)).map((p, i) => {
                    const label = p.label ?? i + 1;
                    return (
                      <button key={label} type="button" onMouseEnter={() => setHoveredBlockerLabel(label)} onMouseLeave={() => setHoveredBlockerLabel(null)} onClick={() => setEditingBlockerZone({ ...editingBlockerZone, points: removePolygonPointByLabel(pts, label) })} className={`bg-gray-900 border px-1.5 py-0.5 rounded text-[10px] ${hoveredBlockerLabel === label ? 'border-red-500 text-red-500' : 'border-red-600/30'}`}>{label}</button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    blockerZones.forEach((zone) => {
      const zoneKey = `blocker:${zone.id}`;
      const transformId = zoneKey;
      const isActive = editingBlockerZone?.id === zone.id;
      const pts = isActive ? editingBlockerZone!.points : getBlockerPoints(zone);
      const zName = isActive ? blockerZoneName : (pendingBlockerUpdates.get(zone.id)?.name ?? zone.name);
      const isBExpanded = expandedItemId === zoneKey;

      cards.push(
        <div key={zone.id} className={`rounded-lg border-2 overflow-hidden ${isActive ? 'bg-red-900/40 border-red-500' : 'bg-gray-800/80 border-red-900/50'}`}>
          <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer" onClick={() => { persistEditingLayerPoints(); if (isBExpanded) setExpandedItemId(null); else handleEditBlockerZone(zone); }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); handleDeleteBlockerZone(zone.id); }} className="text-red-400 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
            <ChevronDown className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${isBExpanded ? 'rotate-180' : ''}`} />
            <div className="flex-1 text-right text-xs"><span className="text-red-100 font-bold">{zName}</span><span className="text-gray-500 mr-2">· {pts.length} نقطة</span></div>
          </div>
          {isBExpanded && (
            <div className="px-2 pb-2 space-y-2 border-t border-red-500/30" onClick={(e) => e.stopPropagation()}>
              <input value={zName} onChange={(e) => { setBlockerZoneName(e.target.value); if (isActive) setEditingBlockerZone((b) => b ? { ...b, name: e.target.value } : b); }} className="w-full bg-black border border-red-500/50 rounded text-white text-xs py-1 px-2 text-right" dir="rtl" />
              {isActive && canEditPoints && pts.length >= 3 && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col items-end gap-0.5"><span className="text-[10px] text-gray-400">التكبير %</span><ScrubNumberInput value={getLayerScale(transformId)} onChange={(v) => handleBlockerTransformChange(transformId, v, getLayerRotate(transformId))} min={10} max={300} suffix="%" className="w-full bg-black border border-red-500/50 rounded text-center text-white text-xs py-1" /></div>
                  <div className="flex flex-col items-end gap-0.5"><span className="text-[10px] text-gray-400">التدوير °</span><ScrubNumberInput value={getLayerRotate(transformId)} onChange={(v) => handleBlockerTransformChange(transformId, getLayerScale(transformId), v)} min={-360} max={360} suffix="°" className="w-full bg-black border border-red-500/50 rounded text-center text-white text-xs py-1" /></div>
                </div>
              )}
              {isActive && canEditPoints && pts.length > 0 && (
                <div className="flex flex-wrap gap-1 justify-end">
                  {[...pts].sort((a, b) => (a.label ?? 0) - (b.label ?? 0)).map((p, i) => {
                    const label = p.label ?? i + 1;
                    return <button key={label} type="button" onMouseEnter={() => setHoveredBlockerLabel(label)} onMouseLeave={() => setHoveredBlockerLabel(null)} onClick={() => setEditingBlockerZone({ ...editingBlockerZone!, points: removePolygonPointByLabel(pts, label) })} className="bg-gray-900 border border-red-600/30 px-1.5 py-0.5 rounded text-[10px]">{label}</button>;
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      );
    });

    return <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">{cards}</div>;
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-2xl border-2 border-yellow-500 max-w-7xl w-full h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="bg-yellow-700/40 p-4 flex items-center justify-between border-b-2 border-yellow-500">
          <div className="w-10" />
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
          <div className={`flex-1 relative ${isDrawingLayer || isAddingPoints || canEditPoints || noLayersForCurrentService || editingBlockerZone ? 'delivery-service-edit-mode' : ''}`}>
            <MapContainer
              center={mapCenter}
              zoom={zoomLevel}
              style={{ width: '100%', height: '100%' }}
              className={isDrawingLayer || isAddingPoints || canEditPoints || noLayersForCurrentService || editingBlockerZone ? 'cursor-crosshair' : ''}
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
                onMapHover={handleMapHoverLayers}
                isDrawing={isDrawingLayer || isAddingPoints || noLayersForCurrentService || !!editingBlockerZone}
                draggedLayerId={draggedLayerId}
                dragStartPos={dragStartPos}
                mouseDownLayer={mouseDownLayer}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
                onDragStart={onDragStart}
              />
              <MapBlockerDragHandler
                isDragging={isDraggingBlocker}
                onDrag={(newPos) => {
                  if (!blockerDragStart || !editingBlockerZone) return;
                  setBlockerDragDidMove(true);
                  const deltaLat = newPos.lat - blockerDragStart.lat;
                  const deltaLng = newPos.lng - blockerDragStart.lng;
                  setEditingBlockerZone({
                    ...editingBlockerZone,
                    points: editingBlockerZone.points.map((p) => ({
                      ...p,
                      lat: p.lat + deltaLat,
                      lng: p.lng + deltaLng
                    }))
                  });
                  setBlockerDragStart(newPos);
                }}
                onStop={() => {
                  setIsDraggingBlocker(false);
                  setBlockerDragStart(null);
                }}
              />

              {/* Blocker zones (disabled) */}
              {blockerZones.map((zone) => {
                if (editingBlockerZone?.id === zone.id) return null;
                const positions = (zone.polygon_points || []).map((p) => [p.lat, p.lng] as [number, number]);
                if (positions.length < 3) return null;
                return (
                  <Polygon
                    key={zone.id}
                    positions={positions}
                    pathOptions={{
                      fillColor: '#ef4444',
                      fillOpacity: 0.2,
                      color: '#ef4444',
                      weight: 2
                    }}
                  />
                );
              })}

              {editingBlockerZone && editingBlockerZone.points.length >= 1 && (
                <>
                  {editingBlockerZone.points.length >= 3 && (
                    <Polygon
                      positions={editingBlockerZone.points.map((p) => [p.lat, p.lng])}
                      pathOptions={{
                        fillColor: '#ef4444',
                        fillOpacity: 0.35,
                        color: '#ef4444',
                        weight: 3,
                        className: canEditPoints ? 'cursor-move' : ''
                      }}
                      eventHandlers={{
                        mousedown: (e) => {
                          if (canEditPoints) {
                            setIsDraggingBlocker(true);
                            setBlockerDragDidMove(false);
                            setBlockerDragStart(e.latlng);
                            L.DomEvent.stopPropagation(e as any);
                          }
                        }
                      }}
                    />
                  )}
                  {canEditPoints &&
                    editingBlockerZone.points.map((point, index) => {
                      const label = point.label ?? index + 1;
                      const isHovered = hoveredBlockerLabel === label;
                      return (
                        <Marker
                          key={`blocker-vertex-${index}-${label}`}
                          position={[point.lat, point.lng]}
                          icon={isHovered ? hoveredVertexIcon : vertexIcon}
                          draggable={canEditPoints}
                          eventHandlers={{
                            drag: (e) => {
                              const newPos = e.target.getLatLng();
                              setEditingBlockerZone({
                                ...editingBlockerZone,
                                points: editingBlockerZone.points.map((p, i) =>
                                  i === index ? { ...p, lat: newPos.lat, lng: newPos.lng } : p
                                )
                              });
                            },
                            mouseover: () => setHoveredBlockerLabel(label),
                            mouseout: () => setHoveredBlockerLabel(null)
                          }}
                        />
                      );
                    })}
                </>
              )}

              {/* Service Layers */}
              {services.map(service => {
                const isCurrentService = isServiceBeingEdited(service.id)
                  || (!editingService && service.id === selectedServiceId);
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
                              if (canEditPoints && isEditingLayer && isServiceBeingEdited(service.id)) {
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
                              if (isAddingPoints && isEditingLayer && isServiceBeingEdited(service.id)) {
                                L.DomEvent.stop(e);
                                onMapClick(e.latlng);
                              }
                            }
                          }}
                        />
                        {isCurrentService &&
                          editingService &&
                          canEditPoints &&
                          isEditingLayer &&
                          isServiceBeingEdited(service.id) &&
                          points.map((pt, i) => {
                            const label = pt.label ?? (i + 1);
                            const isHovered = hoveredPointLabel?.layerId === layerId && hoveredPointLabel.label === label;
                            return (
                              <Marker
                                key={`${layerId}-pt-${i}-${label}`}
                                position={[pt.lat, pt.lng]}
                                icon={isHovered ? hoveredVertexIcon : vertexIcon}
                                draggable={canEditPoints && isServiceBeingEdited(service.id)}
                                eventHandlers={{
                                  click: (e) => {
                                    L.DomEvent.stopPropagation(e);
                                  },
                                  drag: (e) => {
                                    const marker = e.target;
                                    const newPos = marker.getLatLng();
                                    const newPoints = points.map((p, idx) =>
                                      idx === i ? { ...p, lat: newPos.lat, lng: newPos.lng } : p
                                    );
                                    if (editingLayer && getLayerId(editingLayer) === layerId) {
                                      setEditingLayer({ ...editingLayer, points: newPoints });
                                    }
                                    if (isStagedId(layerId)) {
                                      setStagedLayers(prev => prev.map(l => getLayerId(l) === layerId ? { ...l, points: newPoints } : l));
                                    } else {
                                      setMovedOtherLayers(prev => new Map(prev).set(layerId, newPoints));
                                    }
                                  },
                                  mouseover: () => setHoveredPointLabel({ layerId, label }),
                                  mouseout: () => setHoveredPointLabel(null)
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
                  const idA = getLayerId(a, editingService!.id);
                  const idB = getLayerId(b, editingService!.id);
                  const isEditingA = editingLayer && getLayerId(editingLayer) === idA;
                  const isEditingB = editingLayer && getLayerId(editingLayer) === idB;
                  if (isEditingA && !isEditingB) return 1;
                  if (isEditingB && !isEditingA) return -1;
                  return (b.order_index || 0) - (a.order_index || 0);
                })
                .map((layer) => {
                  const layerId = getLayerId(layer, editingService!.id);
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
                            if (canEditPoints && isEditingLayer && isServiceBeingEdited(editingService!.id!)) {
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
                            if (isAddingPoints && isEditingLayer && isServiceBeingEdited(editingService!.id!)) {
                              L.DomEvent.stop(e);
                              onMapClick(e.latlng);
                            }
                          }
                        }}
                      />
                      {canEditPoints &&
                        isEditingLayer &&
                        isServiceBeingEdited(editingService!.id) &&
                        layer.points.map((pt, i) => {
                          const label = pt.label ?? (i + 1);
                          const isHovered = hoveredPointLabel?.layerId === layerId && hoveredPointLabel.label === label;
                          return (
                            <Marker
                              key={`${layerId}-pt-${i}-${label}`}
                              position={[pt.lat, pt.lng]}
                              icon={isHovered ? hoveredVertexIcon : vertexIcon}
                              draggable={isServiceBeingEdited(editingService!.id)}
                              eventHandlers={{
                                click: (e) => {
                                  L.DomEvent.stopPropagation(e);
                                },
                                drag: (e) => {
                                  const marker = e.target;
                                  const newPos = marker.getLatLng();
                                  const newPoints = points.map((p, idxPt) =>
                                    idxPt === i ? { ...p, lat: newPos.lat, lng: newPos.lng } : p
                                  );
                                  if (editingLayer && getLayerId(editingLayer) === layerId) {
                                    setEditingLayer({ ...editingLayer, points: newPoints });
                                  }
                                  setStagedLayers(prev => prev.map((l) => getLayerId(l) === layerId ? { ...l, points: newPoints } : l));
                                },
                                mouseover: () => setHoveredPointLabel({ layerId, label }),
                                mouseout: () => setHoveredPointLabel(null)
                              }}
                            />
                          );
                        })}
                    </div>
                  );
                })}

              {/* Editing Layer - لوحة خاصة دائماً في الأعلى حتى في حالة عدم وجودها ضمن layers أو stagedLayers */}
              {editingLayer && editingLayer.points.length > 0 && (
                <>
                  <Pane name="editing-polygon-pane" style={{ zIndex: 650 }}>
                    {editingLayer.points.length >= 3 && (() => {
                      const layerId = getLayerId(editingLayer);
                      return (
                        <Polygon
                          positions={editingLayer.points.map(p => [p.lat, p.lng])}
                          pathOptions={{
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
                                L.DomEvent.stop(e);
                                onMapClick(e.latlng);
                              }
                            }
                          }}
                        />
                      );
                    })()}
                  </Pane>
                  <Pane name="vertex-markers" style={{ zIndex: 800 }}>
                    {canEditPoints && editingLayer.points.map((pt, i) => {
                      const layerId = getLayerId(editingLayer);
                      const label = pt.label ?? (i + 1);
                      const isHovered = hoveredPointLabel?.layerId === layerId && hoveredPointLabel.label === label;
                      return (
                        <Marker
                          key={`editing-pt-${i}-${label}`}
                          position={[pt.lat, pt.lng]}
                          icon={isHovered ? hoveredVertexIcon : vertexIcon}
                          draggable={canEditPoints}
                          zIndexOffset={1000}
                          eventHandlers={{
                            click: (e) => {
                              L.DomEvent.stopPropagation(e);
                            },
                            drag: (e) => {
                              const marker = e.target;
                              const newPos = marker.getLatLng();
                              const newPoints = editingLayer.points.map((p, idx) =>
                                idx === i ? { ...p, lat: newPos.lat, lng: newPos.lng } : p
                              );
                              setEditingLayer({ ...editingLayer, points: newPoints });

                              const layerId = getLayerId(editingLayer);
                              if (isStagedId(layerId)) {
                                setStagedLayers(prev => prev.map(l => getLayerId(l) === layerId ? { ...l, points: newPoints } : l));
                              } else {
                                setMovedOtherLayers(prev => new Map(prev).set(layerId, newPoints));
                              }
                            },
                            mouseover: () => setHoveredPointLabel({ layerId, label }),
                            mouseout: () => setHoveredPointLabel(null)
                          }}
                        />
                      );
                    })}
                  </Pane>
                </>
              )}

              {/* Branch Center Pins for ALL services */}
              <Pane name="branch-pin-pane" style={{ zIndex: 700 }}>
                {isCreatingNewService && (() => {
                  const pinPos =
                    centerPin ||
                    (editingLayer && editingLayer.points.length >= 3
                      ? getPolygonCenter(editingLayer.points)
                      : null);
                  if (!pinPos) return null;
                  return (
                    <Marker
                      key="branch-pin-new-service"
                      position={[pinPos.lat, pinPos.lng]}
                      icon={branchIcon}
                      draggable={canEditPoints}
                      eventHandlers={{
                        dragstart: (e) => {
                          if (!canEditPoints) return;
                          setDragDidOccur(true);
                          const p = e.target.getLatLng();
                          setPinDragStartPos({ lat: p.lat, lng: p.lng });
                          if (!moveCenterOnly) {
                            setAllLayersInitialPoints(captureBranchDragInitialPoints());
                          }
                        },
                        drag: (e) => {
                          if (!canEditPoints || !pinDragStartPos) return;
                          setDragDidOccur(true);
                          const newPos = e.target.getLatLng();
                          const totalDeltaLat = newPos.lat - pinDragStartPos.lat;
                          const totalDeltaLng = newPos.lng - pinDragStartPos.lng;
                          const point = { lat: newPos.lat, lng: newPos.lng };
                          setCenterPin(point);
                          if (editingService) {
                            setEditingService({ ...editingService, branch_location: point });
                          }
                          if (!moveCenterOnly && editingService) {
                            if (editingLayer && editingLayer.serviceId === editingService.id) {
                              const initial = allLayersInitialPoints.get(getLayerId(editingLayer));
                              if (initial) {
                                setEditingLayer({
                                  ...editingLayer,
                                  points: initial.map(p => ({
                                    ...p,
                                    lat: p.lat + totalDeltaLat,
                                    lng: p.lng + totalDeltaLng
                                  }))
                                });
                              }
                            }
                            setStagedLayers(prev =>
                              prev.map(l => {
                                if (l.serviceId !== editingService.id) return l;
                                const initial = allLayersInitialPoints.get(getLayerId(l));
                                if (!initial) return l;
                                return {
                                  ...l,
                                  points: initial.map(p => ({
                                    ...p,
                                    lat: p.lat + totalDeltaLat,
                                    lng: p.lng + totalDeltaLng
                                  }))
                                };
                              })
                            );
                            setMovedOtherLayers(prev => {
                              const next = new Map(prev);
                              allLayersInitialPoints.forEach((initial, id) => {
                                next.set(
                                  id,
                                  initial.map(p => ({
                                    ...p,
                                    lat: p.lat + totalDeltaLat,
                                    lng: p.lng + totalDeltaLng
                                  }))
                                );
                              });
                              return next;
                            });
                          }
                        },
                        dragend: () => {
                          setPinDragStartPos(null);
                          setAllLayersInitialPoints(new Map());
                        }
                      }}
                    />
                  );
                })()}
                {services.map(svc => {
                  const canDragBranch = isServiceBeingEdited(svc.id) && canEditPoints;
                  const isActive = editingService
                    ? svc.id === editingService.id
                    : svc.id === selectedServiceId;
                  const pos = isActive && centerPin && isServiceBeingEdited(svc.id)
                    ? centerPin
                    : (svc.branch_location as PolygonPoint);

                  if (!pos || !pos.lat || !pos.lng) return null;
                  if (isCreatingNewService) return null;

                  return (
                    <Marker
                      key={`branch-pin-${svc.id}`}
                      position={[pos.lat, pos.lng]}
                      icon={branchIcon}
                      draggable={canDragBranch}
                      opacity={canDragBranch ? 1 : 0.45}
                      eventHandlers={{
                        dragstart: (e) => {
                          if (!canDragBranch) return;
                          setDragDidOccur(true);
                          const marker = e.target;
                          const p = marker.getLatLng();
                          setPinDragStartPos({ lat: p.lat, lng: p.lng });

                          if (!moveCenterOnly && editingService) {
                            setAllLayersInitialPoints(captureBranchDragInitialPoints());
                          }
                        },
                        drag: (e) => {
                          if (!canDragBranch || !pinDragStartPos) return;
                          setDragDidOccur(true);
                          const newPos = e.target.getLatLng();
                          const totalDeltaLat = newPos.lat - pinDragStartPos.lat;
                          const totalDeltaLng = newPos.lng - pinDragStartPos.lng;
                          const point = { lat: newPos.lat, lng: newPos.lng };

                          setCenterPin(point);
                          if (editingService) {
                            setEditingService({ ...editingService, branch_location: point });
                          }

                          if (!moveCenterOnly && editingService) {
                            if (editingLayer && editingLayer.serviceId === editingService.id) {
                              const initial = allLayersInitialPoints.get(getLayerId(editingLayer));
                              if (initial) {
                                setEditingLayer({
                                  ...editingLayer,
                                  points: initial.map(p => ({
                                    ...p,
                                    lat: p.lat + totalDeltaLat,
                                    lng: p.lng + totalDeltaLng
                                  }))
                                });
                              }
                            }
                            setStagedLayers(prev =>
                              prev.map(l => {
                                if (l.serviceId !== editingService.id) return l;
                                const initial = allLayersInitialPoints.get(getLayerId(l));
                                if (!initial) return l;
                                return {
                                  ...l,
                                  points: initial.map(p => ({
                                    ...p,
                                    lat: p.lat + totalDeltaLat,
                                    lng: p.lng + totalDeltaLng
                                  }))
                                };
                              })
                            );
                            setMovedOtherLayers(prev => {
                              const next = new Map(prev);
                              allLayersInitialPoints.forEach((initial, id) => {
                                next.set(
                                  id,
                                  initial.map(p => ({
                                    ...p,
                                    lat: p.lat + totalDeltaLat,
                                    lng: p.lng + totalDeltaLng
                                  }))
                                );
                              });
                              return next;
                            });
                          }
                        },
                        dragend: () => {
                          setPinDragStartPos(null);
                          setAllLayersInitialPoints(new Map());
                        },
                        click: () => {
                          if (!editingService) {
                            handleSelectService(svc);
                          }
                        }
                      }}
                    />
                  );
                })}
              </Pane>
            </MapContainer>

            {hoveredLayerTooltip && (
              <div
                className="absolute pointer-events-none z-[1000] bg-gray-500/40 backdrop-blur-sm text-white px-2 py-1 rounded shadow-md whitespace-nowrap transform -translate-x-1/2 -translate-y-full mb-8"
                style={{ left: hoveredLayerTooltip.x, top: hoveredLayerTooltip.y }}
              >
                <div className="font-bold text-[10px] text-center mb-0.5 text-gray-200">{hoveredLayerTooltip.name}</div>
                <div className="text-white font-bold text-center text-xs">{hoveredLayerTooltip.price} ج</div>
              </div>
            )}

            {/* Float Controls */}
            <div className="absolute top-2 right-2 flex flex-col gap-2 z-[1000]">
              <button onClick={handleZoomIn} disabled={zoomLevel >= 18} className="bg-black/70 hover:bg-black/90 text-white p-2 rounded-lg transition-colors disabled:opacity-50"><ZoomIn className="w-5 h-5" /></button>
              <button onClick={handleZoomOut} disabled={zoomLevel <= 1} className="bg-black/70 hover:bg-black/90 text-white p-2 rounded-lg transition-colors disabled:opacity-50"><ZoomOut className="w-5 h-5" /></button>
              <button onClick={handleRecenterToBranch} className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded-lg transition-colors"><Navigation className="w-5 h-5" /></button>
            </div>

            <div className="absolute bottom-3 left-3 bg-black/70 text-white text-xs px-2 py-1 rounded z-[1000]">
              {editingBlockerZone
                ? 'اضغط على الخريطة لإضافة نقاط زون التعطيل'
                : 'اسحب دبوس الفرع لتحريك موقع الفرع والطبقات (أو فعّل تحريك الدبوس منفصل)'}
            </div>
          </div>

          {/* Sidebar */}
          <div className="w-96 bg-gray-800 border-l-2 border-yellow-500 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {/* Services list (تظهر فقط عندما لا نكون في وضع تعديل خدمة معينة) */}
            {!editingService && (
              <div>
                <button
                  type="button"
                  onClick={startNewService}
                  className="w-full mb-4 bg-yellow-500 hover:bg-yellow-400 text-black px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors font-bold"
                >
                  <Plus className="w-5 h-5" />
                  <span>خدمة توصيل جديدة</span>
                </button>
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
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const next = !canEditPoints;
                        setCanEditPoints(next);
                        setIsAddingPoints(next);
                        if (!next) {
                          setMoveCenterOnly(false);
                          setEditingBlockerZone(null);
                        }
                      }}
                      className={`py-2 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 border-2 ${canEditPoints ? 'bg-orange-600 border-orange-400 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-yellow-500 hover:text-yellow-400'}`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      {canEditPoints ? 'إغلاق التعديل' : 'تفعيل السحب'}
                    </button>
                    {canEditPoints && (
                      <button
                        type="button"
                        onClick={() => setMoveCenterOnly(!moveCenterOnly)}
                        className={`py-2 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5 border-2 ${moveCenterOnly ? 'bg-blue-600 border-blue-400 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-yellow-500 hover:text-yellow-400'}`}
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        {moveCenterOnly ? 'تثبيت الدبوس' : 'تحريك الدبوس منفصل'}
                      </button>
                    )}
                  </div>
                  {canEditPoints && onZoneCreate && (
                    <button
                      type="button"
                      onClick={startNewBlockerZone}
                      className="w-full py-2 rounded-lg text-[10px] font-black border-2 border-red-500/60 bg-red-900/30 text-red-100 hover:bg-red-800/40 transition-all"
                    >
                      + إضافة زون تعطيل
                    </button>
                  )}
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
                    <button
                      type="button"
                      onClick={handleSaveService}
                      disabled={isSaving}
                      className="flex-1 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-black py-2 rounded-lg transition-colors font-bold flex items-center justify-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      {isSaving ? 'جاري الحفظ...' : 'حفظ'}
                    </button>
                  </div>
                </div>

              </>
            )}

            {/* Layers for current service */}
            {editingService && (
              <div className="bg-gray-900/60 border-2 border-yellow-500/40 rounded-lg p-4 space-y-2">
                <h4 className="text-xs font-bold text-yellow-200 text-right mb-2">طبقات التسعير</h4>

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
                      const layerId = getLayerId(layer, editingService!.id);
                      const isEditing = editingLayer && getLayerId(editingLayer) === layerId;
                      const isStaged = layerId.startsWith('unpinned-');

                      // Get current points
                      const points = getPointsForLayer(layerId, (layer as DeliveryZoneLayer).polygon_points || (layer as EditingLayer).points || []);
                      const existingName = (layer as DeliveryZoneLayer).name ?? (layer as EditingLayer).name ?? null;
                      const displayName =
                        updatedLayerNames.get(layerId) ??
                        existingName ??
                        `طبقة ${layer.order_index}`;
                      const displayPrice =
                        updatedLayerPrices.get(layerId) ??
                        (isEditing && editingLayer && getLayerId(editingLayer) === layerId
                          ? editingLayer.delivery_price
                          : layer.delivery_price);
                      const isExpanded = expandedItemId === layerId;
                      const isLayerActive =
                        !!editingLayer &&
                        getLayerId(editingLayer) === layerId &&
                        !editingBlockerZone;

                      return (
                        <div
                          key={layerId}
                          className={`rounded-lg border-2 transition-all overflow-hidden ${isLayerActive ? 'bg-yellow-900/40 border-yellow-500' : 'bg-gray-800/80 border-gray-700 hover:border-yellow-600'}`}
                          onMouseEnter={() => setHoveredLayerId(layerId)}
                          onMouseLeave={() => setHoveredLayerId(null)}
                        >
                          <div
                            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                            onClick={() => {
                              persistEditingBlockerZone();
                              if (isExpanded) {
                                setExpandedItemId(null);
                                return;
                              }
                              persistEditingLayerPoints();
                              selectLayerForEdit(layerId, layer as DeliveryZoneLayer | EditingLayer, points);
                            }}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleLayerDelete(layerId);
                              }}
                              className="text-red-500 hover:text-red-400 p-1 shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            <ChevronDown
                              className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                            />
                            <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
                              {isStaged && (
                                <span className="bg-blue-600 text-white text-[8px] px-1 rounded font-bold shrink-0">
                                  جديد
                                </span>
                              )}
                              <span className="text-yellow-200 font-bold text-xs truncate">{displayName}</span>
                              <span className="text-gray-400 text-[10px] shrink-0">{displayPrice} ج</span>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="px-2 pb-2 pt-1 border-t border-yellow-500/20 space-y-2" onClick={(e) => e.stopPropagation()}>
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-[10px] text-gray-400">اسم الطبقة</span>
                                <input
                                  type="text"
                                  value={displayName}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setUpdatedLayerNames((prev) => {
                                      const map = new Map(prev);
                                      map.set(layerId, val);
                                      return map;
                                    });
                                    if (isStaged) {
                                      setStagedLayers((prev) =>
                                        prev.map((l) => (getLayerId(l) === layerId ? { ...l, name: val } : l))
                                      );
                                    }
                                    setEditingLayer((prev) => {
                                      if (!prev || getLayerId(prev) !== layerId) return prev;
                                      return { ...prev, name: val };
                                    });
                                  }}
                                  className="w-full bg-black border border-yellow-500/50 rounded text-right text-white text-xs py-1 px-2"
                                />
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-[10px] text-gray-400">سعر التوصيل</span>
                                <input
                                  type="number"
                                  value={displayPrice}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    if (isStaged) {
                                      setStagedLayers((prev) =>
                                        prev.map((l) =>
                                          getLayerId(l) === layerId ? { ...l, delivery_price: val } : l
                                        )
                                      );
                                    }
                                    setUpdatedLayerPrices((prev) => {
                                      const map = new Map(prev);
                                      map.set(layerId, val);
                                      return map;
                                    });
                                    setEditingLayer((prev) => {
                                      if (prev && getLayerId(prev) === layerId) {
                                        return { ...prev, delivery_price: val };
                                      }
                                      return {
                                        id:
                                          isStaged || layerId === 'initial-layer'
                                            ? layerId
                                            : (layer as DeliveryZoneLayer).id,
                                        serviceId: editingService.id,
                                        points,
                                        delivery_price: val,
                                        order_index: layer.order_index,
                                        name: existingName ?? null
                                      };
                                    });
                                  }}
                                  className="w-full bg-black border border-yellow-500/50 rounded text-center text-white text-xs py-1"
                                />
                              </div>
                              <p className="text-[10px] text-gray-500 text-right">{points.length} نقاط</p>

                          {isLayerActive && canEditPoints && points.length >= 3 && (
                            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-yellow-500/20">
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="text-[10px] text-gray-400">التكبير %</span>
                                <ScrubNumberInput
                                  value={getLayerScale(layerId)}
                                  onChange={(val) =>
                                    handleLayerTransformChange(layerId, val, getLayerRotate(layerId))
                                  }
                                  min={10}
                                  max={300}
                                  step={1}
                                  decimals={0}
                                  suffix="%"
                                  className="w-full bg-black border border-yellow-500/50 rounded text-center text-white text-xs py-1"
                                />
                              </div>
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="text-[10px] text-gray-400">التدوير °</span>
                                <ScrubNumberInput
                                  value={getLayerRotate(layerId)}
                                  onChange={(val) =>
                                    handleLayerTransformChange(layerId, getLayerScale(layerId), val)
                                  }
                                  min={-360}
                                  max={360}
                                  step={1}
                                  decimals={0}
                                  suffix="°"
                                  className="w-full bg-black border border-yellow-500/50 rounded text-center text-white text-xs py-1"
                                />
                              </div>
                            </div>
                          )}

                          {/* Pin removal buttons for the active layer */}
                          {isLayerActive && canEditPoints && points.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-yellow-500/20">
                              <p className="text-[10px] text-yellow-300 mb-1 text-right">إزالة نقاط معينة:</p>
                              <div className="flex flex-wrap gap-1 justify-end">
                                {[...points]
                                  .sort((a, b) => (a.label ?? 0) - (b.label ?? 0))
                                  .map((p, i) => {
                                    const label = p.label ?? (i + 1);
                                    return (
                                      <button
                                        key={`${label}-${i}`}
                                        onMouseEnter={() => setHoveredPointLabel({ layerId, label })}
                                        onMouseLeave={() => setHoveredPointLabel(null)}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const newPoints = removePolygonPointByLabel(points, label);
                                          setEditingLayer({ ...editingLayer, points: newPoints });

                                          if (layerId.startsWith('unpinned-')) {
                                            setStagedLayers(prev => prev.map(l => getLayerId(l) === layerId ? { ...l, points: newPoints } : l));
                                          } else {
                                            setMovedOtherLayers(prev => new Map(prev).set(layerId, newPoints));
                                          }
                                        }}
                                        className={`bg-gray-900 border px-1.5 py-0.5 rounded text-[10px] transition-all ${hoveredPointLabel?.layerId === layerId && hoveredPointLabel.label === label ? 'border-red-500 text-red-500 scale-110 shadow-lg shadow-red-900/50' : 'border-yellow-600/30 text-yellow-100 hover:border-red-500 hover:text-red-400'}`}
                                      >
                                        {label}
                                      </button>
                                    );
                                  })}
                              </div>
                            </div>
                          )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>

                <div className="bg-red-950/30 border border-red-500/40 rounded-lg p-4 space-y-2 mt-3">
                  <h4 className="text-xs font-bold text-red-200 text-right">زونات التعطيل</h4>
                  <p className="text-[10px] text-red-200/70 text-right mb-2">تعطيل جزء معين من زون الطلب</p>
                  {renderBlockerZoneCards()}
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
        .custom-vertex-icon,
        .custom-vertex-icon-hovered {
          background: none !important;
          border: none !important;
        }
        .leaflet-vertex-markers-pane {
          z-index: 800 !important;
          pointer-events: auto !important;
        }
        .leaflet-vertex-markers-pane .leaflet-marker-icon {
          z-index: 800 !important;
        }
        .delivery-service-edit-mode .leaflet-container,
        .delivery-service-edit-mode .leaflet-container *,
        .delivery-service-edit-mode .leaflet-pane,
        .delivery-service-edit-mode .leaflet-pane * {
          cursor: crosshair !important;
        }
        .scrub-number-input {
          cursor: ew-resize;
          user-select: none;
        }
        .scrub-number-input--dragging {
          cursor: ew-resize !important;
        }
      `}} />
    </div >
  );
}
