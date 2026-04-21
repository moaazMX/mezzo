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
  if (!existingLayer || existingLayer.length === 0) {
    return [];
  }

  const center = getPolygonCenter(existingLayer);

  return existingLayer.map(point => ({
    lat: center.lat + (point.lat - center.lat) * scaleFactor,
    lng: center.lng + (point.lng - center.lng) * scaleFactor
  }));
}
