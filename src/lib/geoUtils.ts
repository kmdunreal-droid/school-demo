/**
 * GEO UTILITIES — teacher attendance ke GPS verification ke liye.
 * Haversine formula se school vs live-position distance calculate hota hai.
 */
import type { SchoolLocation } from '../types';

/** Default school location (Karachi — demo). Principal settings mein change ho sakta hai. */
export const DEFAULT_SCHOOL_LOCATION: SchoolLocation = {
  lat: 24.8607,
  lng: 67.0011,
  radiusMeters: 500,
  name: 'Demo Academy (Karachi)',
};

export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
}

/** Browser geolocation se current position (permission required). */
export async function getCurrentPosition(): Promise<GeoPosition | null> {
  try {
    if (typeof navigator === 'undefined') return null;
    const geoApi = (navigator as any).geolocation;
    if (!geoApi || typeof geoApi.getCurrentPosition !== 'function') {
      console.warn('[Geo] Browser geolocation available nahi (HTTPS/localhost wala experiment).');
      return null;
    }
    const pos = await new Promise<any>((resolve, reject) => {
      geoApi.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
      });
    });
    return {
      latitude: pos.coords?.latitude ?? pos.latitude,
      longitude: pos.coords?.longitude ?? pos.longitude,
      accuracyMeters: pos.coords?.accuracy ?? null,
    };
  } catch (e: any) {
    console.warn('[Geo] Location fetch failed:', e?.message || e);
    return null;
  }
}

/** Haversine distance in meters (do lat/lng points). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000; // earth radius (m)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** School radius ke andar hai ya nahi. */
export function isWithinSchoolRadius(loc: SchoolLocation, lat: number, lng: number, marginM: number = 0): boolean {
  const d = haversineMeters(loc.lat, loc.lng, lat, lng);
  return d <= (loc.radiusMeters + marginM);
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}