import React, { useState } from 'react';
import { useLongPress } from '../lib/longPress';
import { Edit2, Trash2, FileText } from 'lucide-react';

interface HoldActionWrapperProps {
  onEdit?: () => void;
  onDelete?: () => void;
  onDetail?: () => void;
  children: React.ReactNode;
  className?: string;
}

export const HoldActionWrapper: React.FC<HoldActionWrapperProps> = ({
  onEdit,
  onDelete,
  onDetail,
  children,
  className = ''
}) => {
  const [showMenu, setShowMenu] = useState(false);

  const longPressProps = useLongPress(() => {
    setShowMenu(true);
  }, 500);

  return (
    <div
      {...longPressProps}
      className={`relative select-none ${className}`}
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none', touchAction: 'manipulation' }}
    >
      {children}
      {showMenu && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm z-50 flex items-center justify-center gap-2 flex-wrap rounded-2xl animate-fade-in p-2 shadow-2xl"
        >
          {onDetail && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onDetail();
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md cursor-pointer"
            >
              <FileText size={14} /> Detail
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onEdit();
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md cursor-pointer"
            >
              <Edit2 size={14} /> Edit
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onDelete();
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md cursor-pointer"
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(false);
            }}
            className="px-3 py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-black text-xs rounded-xl transition-all cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
