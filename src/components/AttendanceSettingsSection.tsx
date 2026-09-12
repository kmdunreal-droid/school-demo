import { useState } from 'react';
import { toast } from 'sonner';
import { MapPin, Navigation, LocateFixed, CheckCircle2, XCircle, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { SchoolLocation } from '../types';
import { getAttendanceSettings, setAttendanceSettings, saveSchoolLocation } from '../lib/attendanceSettings';

interface AttendanceSettingsSectionProps {
  schoolLocation: SchoolLocation;
  onSaved?: (loc: SchoolLocation) => void;
}

/**
 * Attendance Collection Settings — Principal ke Settings tab ke liye.
 * GPS-restricted check-in toggle + school GPS location (lat/lng/radius)
 * yahan se configure hota hai. Teacher ka check-in isi par verify hota hai.
 */
export default function AttendanceSettingsSection({ schoolLocation, onSaved }: AttendanceSettingsSectionProps) {
  const [gpsRestricted, setGpsRestricted] = useState<boolean>(() => getAttendanceSettings().gpsRestricted);
  const [name, setName] = useState<string>(schoolLocation.name);
  const [lat, setLat] = useState<string>(String(schoolLocation.lat));
  const [lng, setLng] = useState<string>(String(schoolLocation.lng));
  const [radius, setRadius] = useState<string>(String(schoolLocation.radiusMeters));
  const [locating, setLocating] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const flashSaved = () => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
  };

  const toggleGpsRestricted = () => {
    const next = !gpsRestricted;
    setGpsRestricted(next);
    setAttendanceSettings({ gpsRestricted: next });
    toast.success(next
      ? 'GPS-restricted check-in ON — teachers sirf school radius ke andar se check-in kar sakte hain.'
      : 'GPS-restricted check-in OFF — teachers kisi bhi location se check-in kar sakte hain.');
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Is browser mein geolocation available nahi hai.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
        toast.success('Current location mil gayi — Save Location dabakar confirm karein.');
      },
      () => {
        setLocating(false);
        toast.error('Device location nahi mili. Coordinates manually enter karein (Google Maps se copy karein).');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSaveLocation = () => {
    const nLat = Number(lat);
    const nLng = Number(lng);
    const nRadius = Number(radius);
    if (isNaN(nLat) || isNaN(nLng) || nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) {
      toast.error('Valid Latitude (-90..90) aur Longitude (-180..180) enter karein.');
      return;
    }
    if (isNaN(nRadius) || nRadius <= 0) {
      toast.error('Valid Radius (meters) enter karein — minimum 1 m.');
      return;
    }
    const loc: SchoolLocation = {
      lat: nLat,
      lng: nLng,
      radiusMeters: Math.max(1, Math.round(nRadius)),
      name: name.trim() || 'Demo Academy',
    };
    saveSchoolLocation(loc);
    setAttendanceSettings({ gpsRestricted });
    onSaved?.(loc);
    flashSaved();
    toast.success('Attendance location saved — teachers ka GPS radius ab naye coordinates se check hoga.');
  };

  return (
    <div className="relative overflow-hidden bg-white dark:bg-slate-800/90 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm border-t-4 border-t-sky-500">
      {/* Decorative glows */}
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 w-56 h-56 rounded-full bg-gradient-to-br from-sky-500/15 to-blue-500/10 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute bottom-0 right-0 w-32 h-32 rounded-full bg-amber-500/5 blur-2xl" />
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative p-3 bg-gradient-to-br from-sky-500 via-sky-600 to-blue-600 rounded-xl text-white shadow-lg shadow-sky-200 ring-4 ring-sky-500/15">
            <MapPin size={22} />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase text-slate-800 dark:text-slate-100 flex items-center gap-2">
              Attendance Collection — Location Settings
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Teacher check-in ka verification yahan se control hota hai.
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest w-fit ${
            gpsRestricted ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/20' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/20'
          }`}
        >
          {gpsRestricted ? (
            <><ShieldCheck size={13} /> GPS Restricted — ON</>
          ) : (
            <><ShieldAlert size={13} /> GPS Restricted — OFF</>
          )}
        </span>
      </div>

      {/* GPS toggle */}
      <div className="mt-4 flex items-center justify-between p-3 bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl">
        <div className="space-y-0.5">
          <p className="text-xs font-black uppercase text-slate-700 dark:text-slate-200">GPS-Restricted Check-In</p>
          <p className="text-xs text-slate-400 dark:text-slate-400">
            {gpsRestricted
              ? 'Teachers sirf school radius ke ANDAR se check-in kar sakte hain.'
              : 'Teachers kisi bhi location se check-in kar sakte hain (manual allowance).'}
          </p>
        </div>
        <button
          type="button"
          onClick={toggleGpsRestricted}
          className={`w-11 h-6 rounded-full flex items-center px-1 transition-colors shrink-0 ${gpsRestricted ? 'bg-sky-600' : 'bg-slate-300'}`}
        >
          <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${gpsRestricted ? 'translate-x-5' : 'translate-x-0'}`}></div>
        </button>
      </div>

      {/* School location form */}
      <div className="mt-4">
        <label className="block text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-widest mb-1.5">
          School GPS Location (Attendance Radius)
        </label>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mb-2">
          Teacher check-in sirf is location ke radius ke ANDAR hota hai. Coordinates Google Maps se copy karein.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Latitude</label>
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="24.860700"
              className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:focus:ring-sky-400/30"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Longitude</label>
            <input
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="67.001100"
              className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:focus:ring-sky-400/30"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Radius (m)</label>
            <input
              type="number"
              min={1}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              placeholder="500"
              className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:focus:ring-sky-400/30"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Location Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Demo Academy"
              className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 dark:focus:ring-sky-400/30"
            />
          </div>
        </div>

        {/* Buttons */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="px-4 py-2 bg-sky-50 dark:bg-sky-500/10 hover:bg-sky-100 dark:hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <LocateFixed size={13} className={locating ? 'animate-pulse' : ''} />
            {locating ? 'Locating...' : 'Use My Location'}
          </button>
          <button
            type="button"
            onClick={handleSaveLocation}
            className="px-5 py-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 shadow-lg shadow-sky-200/60 hover:shadow-xl hover:-translate-y-0.5 transition-all"
          >
            <Navigation size={13} /> {savedFlash ? 'Saved ✓' : 'Save Location'}
          </button>
          <span className="inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold text-slate-500">
            {gpsRestricted ? (
              <><CheckCircle2 size={12} className="text-sky-600" /> Check-in sirf school ke andar se hoga</>
            ) : (
              <><XCircle size={12} className="text-amber-500" /> Check-in kisi bhi location se ho sakta hai</>
            )}
          </span>
        </div>
      </div>

      {/* Info note */}
      <div className="mt-4 p-3 bg-sky-50 dark:bg-sky-500/10 border border-sky-100 dark:border-sky-500/20 rounded-xl text-[11px] text-sky-800 dark:text-sky-200 leading-relaxed">
        <p className="font-bold uppercase tracking-widest mb-0.5 flex items-center gap-1.5">
          <MapPin size={11} /> How It Works
        </p>
        Teacher <strong>My Attendance</strong> tab mein <strong>Check-In</strong> dabata hai — browser ka live GPS
        school location se compare hota hai (Haversine distance). <strong>GPS Restricted ON</strong> par door hoga to
        check-in block ho jata hai. Device GPS na mile to teacher "Demo GPS (School Location)" checkbox use kar sakta hai.
      </div>
    </div>
  );
}