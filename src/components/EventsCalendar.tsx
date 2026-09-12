/**
 * SCHOOL CALENDAR & EVENTS — holidays, exams, PTM, sports day.
 * Month grid + upcoming list. Principal manage karta hai.
 * Demo/local store: 'acadamis_events' (portalStore pattern).
 */
import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { CalendarDays, Plus, Trash2, ChevronLeft, ChevronRight, PartyPopper, BookOpen, Users, Trophy, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { SchoolEvent, EventType, UserSession } from '../types';
import { usePortalCollection, newId, PORTAL_TABLES } from '../lib/portalStore';

interface EventsCalendarProps {
  userSession: UserSession;
}

const TYPE_META: Record<EventType, { label: string; dot: string; badge: string; icon: any }> = {
  holiday: { label: 'Holiday', dot: 'bg-rose-500', badge: 'bg-rose-100 text-rose-700', icon: PartyPopper },
  exam: { label: 'Exam', dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700', icon: BookOpen },
  meeting: { label: 'Meeting / PTM', dot: 'bg-teal-500', badge: 'bg-teal-100 text-teal-700', icon: Users },
  event: { label: 'Event', dot: 'bg-indigo-500', badge: 'bg-indigo-100 text-indigo-700', icon: Sparkles },
  sports: { label: 'Sports', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', icon: Trophy },
};

export default function EventsCalendar({ userSession }: EventsCalendarProps) {
  const { items: events, upsert, remove } = usePortalCollection<SchoolEvent>('acadamis_events', PORTAL_TABLES.events);
  const canManage = userSession.role === 'principal' || userSession.role === 'developer';

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today.toISOString().split('T')[0]);
  const [type, setType] = useState<EventType>('event');
  const [description, setDescription] = useState('');

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // Monday-first

  const eventByDate = useMemo(() => {
    const map: Record<string, SchoolEvent[]> = {};
    events.forEach(e => {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return map;
  }, [events]);

  const upcoming = useMemo(() => {
    const t = today.toISOString().split('T')[0];
    return events
      .filter(e => e.date >= t)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8);
  }, [events]);

  const handleAdd = () => {
    if (!title.trim() || !date) {
      toast.error('Title aur date dono zaroori hain');
      return;
    }
    upsert({
      id: newId('event'),
      title: title.trim(),
      date,
      type,
      description: description.trim() || undefined,
      createdBy: userSession.name || 'Principal',
      createdAt: new Date().toISOString(),
    });
    setTitle(''); setDescription('');
    setShowForm(false);
    toast.success('Calendar mein add ho gaya! 📅');
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1);
  };

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
            <CalendarDays size={22} className="text-teal-600" /> School Calendar
          </h1>
          <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">Events · Holidays · Exams · PTM</p>
        </div>
        {canManage && (
          <button onClick={() => setShowForm(v => !v)} className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-teal-200 transition-all flex items-center gap-2">
            <Plus size={15} /> Add Event
          </button>
        )}
      </div>

      {canManage && showForm && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title (e.g. Annual Sports Day)" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:border-teal-500" />
          <div className="flex flex-wrap gap-3 items-center">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold" />
            <select value={type} onChange={e => setType(e.target.value as EventType)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest">
              {Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Details (optional)" className="flex-1 min-w-[180px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs" />
            <button onClick={handleAdd} className="px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-black uppercase tracking-widest">Add</button>
          </div>
        </motion.div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Month Grid */}
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><ChevronLeft size={16} /></button>
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-700">{monthLabel}</h3>
            <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center mb-1">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <span key={i} className="text-[9px] font-black text-slate-400 uppercase py-1">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const dayEvents = eventByDate[dateStr] || [];
              const isToday = dateStr === today.toISOString().split('T')[0];
              return (
                <div key={day} className={`aspect-square rounded-lg border flex flex-col items-center justify-center gap-0.5 p-0.5 ${isToday ? 'border-teal-500 bg-teal-50' : dayEvents.length > 0 ? 'border-amber-200 bg-amber-50/50' : 'border-slate-100'}`}>
                  <span className={`text-[10px] font-bold ${isToday ? 'text-teal-700' : 'text-slate-600'}`}>{day}</span>
                  <div className="flex gap-0.5">
                    {dayEvents.slice(0, 3).map(e => (
                      <span key={e.id} className={`w-1.5 h-1.5 rounded-full ${TYPE_META[e.type]?.dot || 'bg-slate-400'}`} title={e.title} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Upcoming List */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-3">Upcoming</h3>
          <div className="space-y-2.5">
            {upcoming.length === 0 && <p className="text-xs font-bold text-slate-400 uppercase tracking-widest py-6 text-center">Koi event nahi</p>}
            {upcoming.map(e => {
              const meta = TYPE_META[e.type] || TYPE_META.event;
              const Icon = meta.icon;
              return (
                <div key={e.id} className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors group">
                  <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${meta.badge}`}><Icon size={14} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-black text-slate-800 truncate">{e.title}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      {new Date(e.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })} · {meta.label}
                    </p>
                  </div>
                  {canManage && (
                    <button onClick={() => { remove(e.id); toast.success('Event delete ho gaya'); }} className="shrink-0 p-1.5 text-slate-300 hover:text-rose-600 rounded-lg opacity-0 group-hover:opacity-100 transition-all">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
