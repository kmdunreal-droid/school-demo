import { safeStorage } from './safeStorage';
import type { SchoolLocation } from '../types';

// ============================================================
// ATTENDANCE COLLECTION SETTINGS — Settings (Principal) se
// configure hoti hain. GPS-restricted mode + school location
// teacher check-in ko verify karte hain.
// ============================================================
export const ATTENDANCE_SETTINGS_STORAGE = 'acadamis_attendance_settings';
export const SCHOOL_LOCATION_STORAGE = 'acadamis_school_location';

export interface AttendanceSettings {
  /** true = teacher check-in sirf school radius ke ANDAR se hota hai. */
  gpsRestricted: boolean;
}

export function getAttendanceSettings(): AttendanceSettings {
  try {
    const raw = safeStorage.getItem(ATTENDANCE_SETTINGS_STORAGE);
    if (raw && raw !== 'undefined' && raw !== 'null') {
      const parsed = JSON.parse(raw);
      return { gpsRestricted: parsed.gpsRestricted !== false };
    }
  } catch (e) {
    /* ignore */
  }
  return { gpsRestricted: true };
}

export function setAttendanceSettings(s: AttendanceSettings): void {
  safeStorage.setItem(ATTENDANCE_SETTINGS_STORAGE, JSON.stringify(s));
}

/** localStorage se saved school location load (fallback reserved). */
export function getSavedSchoolLocation(fallback: SchoolLocation): SchoolLocation {
  try {
    const raw = safeStorage.getItem(SCHOOL_LOCATION_STORAGE);
    if (raw && raw !== 'undefined' && raw !== 'null') {
      const p = JSON.parse(raw);
      if (
        p &&
        typeof p.lat === 'number' &&
        typeof p.lng === 'number' &&
        typeof p.radiusMeters === 'number' &&
        typeof p.name === 'string'
      ) {
        return p as SchoolLocation;
      }
    }
  } catch (e) {
    /* ignore */
  }
  return fallback;
}

export function saveSchoolLocation(loc: SchoolLocation): void {
  safeStorage.setItem(SCHOOL_LOCATION_STORAGE, JSON.stringify(loc));
}