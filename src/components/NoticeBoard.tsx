/**
 * NOTICE BOARD — Principal announcements post karta hai, sab portals dekhte hain.
 * Demo/local store: 'acadamis_notices' (portalStore pattern).
 */
import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { Megaphone, Plus, Trash2, Pin, AlertTriangle, Info, Bell } from 'lucide-react';
import { toast } from 'sonner';
import type { Notice, NoticePriority, NoticeAudience, UserSession } from '../types';
import { usePortalCollection, newId, PORTAL_TABLES } from '../lib/portalStore';

interface NoticeBoardProps {
  userSession: UserSession;
}

const PRIORITY_STYLES: Record<NoticePriority, { badge: string; icon: any }> = {
  urgent: { badge: 'bg-rose-100 text-rose-700', icon: AlertTriangle },
  important: { badge: 'bg-amber-100 text-amber-700', icon: Bell },
  normal: { badge: 'bg-slate-100 text-slate-600', icon: Info },
};

export default function NoticeBoard({ userSession }: NoticeBoardProps) {
  const { items: notices, upsert, remove } = usePortalCollection<Notice>('acadamis_notices', PORTAL_TABLES.notices);
  const canManage = userSession.role === 'principal' || userSession.role === 'developer';

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<NoticePriority>('normal');
  const [audience, setAudience] = useState<NoticeAudience>('all');
  const [showForm, setShowForm] = useState(false);

  // Role-based audience filter
  const visible = useMemo(() => {
    let list = notices;
    if (userSession.role === 'teacher' || userSession.role === 'coordinator') {
      list = list.filter(n => n.audience === 'all' || n.audience === 'teachers');
    } else if (userSession.role === 'student') {
      list = list.filter(n => n.audience === 'all' || n.audience === 'students');
    }
    const rank: Record<NoticePriority, number> = { urgent: 0, important: 1, normal: 2 };
    return list.slice().sort((a, b) => rank[a.priority] - rank[b.priority] || b.createdAt.localeCompare(a.createdAt));
  }, [notices, userSession.role]);

  const handlePost = () => {
    if (!title.trim() || !message.trim()) {
      toast.error('Title aur message dono zaroori hain');
      return;
    }
    const notice: Notice = {
      id: newId('notice'),
      title: title.trim(),
      message: message.trim(),
      priority,
      audience,
      authorName: userSession.name || 'Principal',
      authorRole: userSession.role,
      createdAt: new Date().toISOString(),
    };
    upsert(notice);
    setTitle(''); setMessage(''); setPriority('normal'); setAudience('all');
    setShowForm(false);
    toast.success('Notice publish ho gaya! 📢');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase flex items-center gap-2">
            <Megaphone size={22} className="text-teal-600" /> Notice Board
          </h1>
          <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-bold">School announcements — sab portals par live</p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm(v => !v)}
            className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-teal-200 transition-all flex items-center gap-2"
          >
            <Plus size={15} /> New Notice
          </button>
        )}
      </div>

      {/* Compose Form (Principal only) */}
      {canManage && showForm && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Notice title (e.g. Parent-Teacher Meeting)"
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:border-teal-500"
          />
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Notice message / details..."
            rows={3}
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-teal-500"
          />
          <div className="flex flex-wrap gap-3 items-center">
            <select value={priority} onChange={e => setPriority(e.target.value as NoticePriority)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest">
              <option value="normal">Normal</option>
              <option value="important">Important</option>
              <option value="urgent">Urgent</option>
            </select>
            <select value={audience} onChange={e => setAudience(e.target.value as NoticeAudience)} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-widest">
              <option value="all">Everyone</option>
              <option value="teachers">Teachers Only</option>
              <option value="students">Students Only</option>
            </select>
            <button onClick={handlePost} className="ml-auto px-5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-black uppercase tracking-widest">
              Publish
            </button>
          </div>
        </motion.div>
      )}
      {/* Notices List */}
      <div className="space-y-3">
        {visible.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
            Koi notice nahi — sab clear hai ✨
          </div>
        )}
        {visible.map((n, i) => {
          const st = PRIORITY_STYLES[n.priority];
          const Icon = st.icon;
          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.05, 0.3) }}
              className={`bg-white border rounded-2xl p-4 shadow-sm ${n.priority === 'urgent' ? 'border-rose-200' : n.priority === 'important' ? 'border-amber-200' : 'border-slate-200'}`}
            >
              <div className="flex items-start gap-3">
                <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${st.badge}`}>
                  <Icon size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black text-slate-900 text-sm">{n.title}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${st.badge}`}>{n.priority}</span>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-500">
                      {n.audience === 'all' ? 'Everyone' : n.audience === 'teachers' ? 'Teachers' : 'Students'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mt-1.5 leading-relaxed whitespace-pre-wrap break-words">{n.message}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2 flex items-center gap-1">
                    <Pin size={10} /> {n.authorName} · {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
                {canManage && (
                  <button
                    onClick={() => { remove(n.id); toast.success('Notice delete ho gaya'); }}
                    className="shrink-0 p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    aria-label="Delete notice"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
