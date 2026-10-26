import { useEffect } from 'react';
import {
  BookOpen,
  Captions,
  Library,
  MessageSquare,
  Plus,
  RotateCw,
  Search,
  Settings,
  Sparkles
} from 'lucide-react';
import type { WheelActionId } from '../../../shared/types';
import { WHEEL_ACTION_LABELS } from '../../../shared/wheelActions';

const ICONS: Record<WheelActionId, typeof Sparkles> = {
  summary: Captions,
  chat: MessageSquare,
  newChat: Plus,
  library: Library,
  settings: Settings,
  start: Sparkles,
  find: Search,
  reader: BookOpen,
  reload: RotateCw,
  none: Sparkles
};

/** 全局轮盘：8 个扇区，点击扇区或按 1–8 触发，Esc 关闭。 */
export function RadialMenu({
  open,
  sectors,
  onAction,
  onClose
}: {
  open: boolean;
  sectors: WheelActionId[];
  onAction: (action: WheelActionId) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < 8) {
        event.preventDefault();
        const action = sectors[index];
        if (action && action !== 'none') onAction(action);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAction, onClose, open, sectors]);

  if (!open) return null;

  return (
    <div
      className="radial-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="radial-wheel" role="menu" aria-label="快捷轮盘">
        <div className="radial-center">
          <Sparkles size={16} />
          <span>快捷轮盘</span>
          <small>1–8 / Esc</small>
        </div>
        {sectors.map((action, index) => {
          const Icon = ICONS[action] || Sparkles;
          const angle = (360 / 8) * index - 90;
          return (
            <button
              key={`${action}-${index}`}
              className={`radial-sector${action === 'none' ? ' is-empty' : ''}`}
              style={{ transform: `rotate(${angle}deg) translate(132px) rotate(${-angle}deg)` }}
              title={`${index + 1}. ${WHEEL_ACTION_LABELS[action]}`}
              disabled={action === 'none'}
              onClick={() => onAction(action)}
            >
              <Icon size={15} />
              <span>{WHEEL_ACTION_LABELS[action]}</span>
              <em>{index + 1}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}
