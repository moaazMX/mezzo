/**
 * Geographic utility functions for delivery zones
 */

import { PolygonPoint } from './supabase';

/**
 * Ray casting algorithm to check if a point is inside a polygon
 * @param point The point to check {lat, lng}
 * @param polygon Array of polygon vertices {lat, lng}
 * @returns true if point is inside polygon
 */
export function isPointInPolygon(
  point: { lat: number; lng: number },
  polygon: PolygonPoint[]
): boolean {
  if (!polygon || polygon.length < 3) return false;

  let inside = false;
  const { lat, lng } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Calculate the center point (centroid) of a polygon
 */
export function getPolygonCenter(polygon: PolygonPoint[]): { lat: number; lng: number } {
  if (!polygon || polygon.length === 0) {
    return { lat: 0, lng: 0 };
  }

  let sumLat = 0;
  let sumLng = 0;

  for (const point of polygon) {
    sumLat += point.lat;
    sumLng += point.lng;
  }

  return {
    lat: sumLat / polygon.length,
    lng: sumLng / polygon.length
  };
}

/**
 * Calculate bounding box for a polygon (for map viewport)
 */
export function getPolygonBounds(polygon: PolygonPoint[]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  if (!polygon || polygon.length === 0) {
    return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
  }

  let minLat = polygon[0].lat;
  let maxLat = polygon[0].lat;
  let minLng = polygon[0].lng;
  let maxLng = polygon[0].lng;

  for (const point of polygon) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLng = Math.min(minLng, point.lng);
    maxLng = Math.max(maxLng, point.lng);
  }

  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Create a nested polygon layer by scaling all points toward the centroid.
 *
 * This keeps the same overall shape while shrinking it uniformly.
 *
 * @param existingLayer Array of polygon points representing the existing layer
 * @param scaleFactor   How much to keep of the distance from the centroid (0-1), default 0.8 (80%)
 */
export function createNestedLayer(
  existingLayer: PolygonPoint[],
  scaleFactor: number = 0.8
): PolygonPoint[] {
  if (!existingLayer || existingLayer.length === 0) {
    return [];
  }

  const center = getPolygonCenter(existingLayer);

  return existingLayer.map(point => ({
    lat: center.lat + (point.lat - center.lat) * scaleFactor,
    lng: center.lng + (point.lng - center.lng) * scaleFactor
  }));
}

/**
 * Create an expanded polygon layer by scaling all points away from the centroid.
 *
 * This keeps the same shape while making it larger.
 *
 * @param existingLayer Array of polygon points representing the existing layer
 * @param scaleFactor   Expansion factor (> 1 makes the polygon larger), default 1.25
 */
export function createExpandedLayer(
  existingLayer: PolygonPoint[],
  scaleFactor: number = 1.25
): PolygonPoint[] {
  return scalePolygonAroundCenter(existingLayer, scaleFactor);
}

/** Uniform scale around polygon centroid. scaleFactor 1 = unchanged, 1.25 = 125%. */
export function scalePolygonAroundCenter(
  polygon: PolygonPoint[],
  scaleFactor: number
): PolygonPoint[] {
  if (!polygon || polygon.length === 0 || scaleFactor === 1) {
    return polygon ? [...polygon] : [];
  }

  const center = getPolygonCenter(polygon);
  const scaled = polygon.map((point) => ({
    ...point,
    lat: center.lat + (point.lat - center.lat) * scaleFactor,
    lng: center.lng + (point.lng - center.lng) * scaleFactor
  }));
  return assignSequentialPointLabels(scaled);
}

/** Rotate polygon around its centroid (degrees, positive = clockwise on map). */
export function rotatePolygonAroundCenter(
  polygon: PolygonPoint[],
  degrees: number
): PolygonPoint[] {
  if (!polygon || polygon.length === 0 || degrees === 0) {
    return polygon ? [...polygon] : [];
  }

  const center = getPolygonCenter(polygon);
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cosLat = Math.cos((center.lat * Math.PI) / 180);

  const rotated = polygon.map((point) => {
    const dx = (point.lng - center.lng) * cosLat;
    const dy = point.lat - center.lat;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return {
      ...point,
      lat: center.lat + ry,
      lng: center.lng + rx / cosLat
    };
  });
  return assignSequentialPointLabels(rotated);
}

export function applyLayerTransform(
  basePoints: PolygonPoint[],
  scalePercent: number,
  rotateDegrees: number
): PolygonPoint[] {
  const scaleFactor = scalePercent / 100;
  const scaled = scalePolygonAroundCenter(basePoints, scaleFactor);
  return rotatePolygonAroundCenter(scaled, rotateDegrees);
}

/** Assign labels 1..n in array order (e.g. new expanded layers). */
export function assignSequentialPointLabels(points: PolygonPoint[]): PolygonPoint[] {
  return points.map((p, index) => ({ ...p, label: index + 1 }));
}

/** Fill missing labels without changing existing ones (zone-map style). */
export function ensurePointLabels(points: PolygonPoint[]): PolygonPoint[] {
  if (points.length === 0) return [];
  const hasAny = points.some(p => p.label != null && p.label > 0);
  if (!hasAny) {
    return points.map((p, i) => ({ ...p, label: i + 1 }));
  }
  const used = new Set<number>();
  for (const p of points) {
    if (p.label != null && p.label > 0) used.add(p.label);
  }
  let next = used.size > 0 ? Math.max(...used) + 1 : 1;
  return points.map(p => {
    if (p.label != null && p.label > 0) return p;
    while (used.has(next)) next++;
    const label = next;
    used.add(label);
    next++;
    return { ...p, label };
  });
}

/** Insert a vertex; newest point gets the next label (e.g. 6 after 5 existing). */
export function insertPolygonPoint(
  existingPoints: PolygonPoint[],
  latlng: { lat: number; lng: number }
): PolygonPoint[] {
  const normalized = ensurePointLabels(existingPoints);
  const maxLabel = normalized.reduce((max, p) => Math.max(max, p.label ?? 0), 0);
  const newPoint: PolygonPoint = { lat: latlng.lat, lng: latlng.lng, label: maxLabel + 1 };
  return insertPointAtNearestEdge(normalized, newPoint);
}

/** Remove a vertex by label (labels of remaining points are unchanged). */
export function removePolygonPointByLabel(points: PolygonPoint[], label: number): PolygonPoint[] {
  return points.filter(p => p.label !== label);
}

/** ~15m — ignore map clicks too close to an existing vertex */
const VERTEX_CLICK_THRESHOLD_DEG = 0.00015;

/** Shoelace formula — used to pick the most specific zone when several overlap. */
export function approximatePolygonArea(points: PolygonPoint[]): number {
  if (!points || points.length < 3) return Infinity;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    sum += points[i].lng * points[j].lat - points[j].lng * points[i].lat;
  }
  return Math.abs(sum) / 2;
}

export function isNearExistingVertex(
  latlng: { lat: number; lng: number },
  points: PolygonPoint[],
  thresholdDeg = VERTEX_CLICK_THRESHOLD_DEG
): boolean {
  return points.some(
    p =>
      Math.abs(p.lat - latlng.lat) < thresholdDeg &&
      Math.abs(p.lng - latlng.lng) < thresholdDeg
  );
}

/**
 * Distance from a point to a line segment (squared, for performance).
 */
function distToSegmentSq(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p.lng - a.lng;
    const ey = p.lat - a.lat;
    return ex * ex + ey * ey;
  }
  let t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projLng = a.lng + t * dx;
  const projLat = a.lat + t * dy;
  const ex = p.lng - projLng;
  const ey = p.lat - projLat;
  return ex * ex + ey * ey;
}

/**
 * Insert a new point on the nearest polygon edge (between the two closest vertices).
 * Vertex order is preserved so the shape never self-intersects.
 * The newest point keeps its own label (max+1); it does not need to be last in the array.
 */
export function insertPointAtNearestEdge(
  existingPoints: PolygonPoint[],
  newPoint: PolygonPoint
): PolygonPoint[] {
  if (existingPoints.length < 3) {
    return [...existingPoints, newPoint];
  }

  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < existingPoints.length; i++) {
    const j = (i + 1) % existingPoints.length;
    const d = distToSegmentSq(newPoint, existingPoints[i], existingPoints[j]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = j; // insert between vertex i and vertex j
    }
  }

  const result = [...existingPoints];
  result.splice(bestIdx, 0, newPoint);
  return result;
}
