import { Pin, PinOff, X } from 'lucide-react';
import appIcon from '../assets/app-icon.ico';

interface TitleBarProps {
  pinned: boolean;
  onTogglePinned: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
}

function MinimizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MaximizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function RestoreGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
      <rect x="1" y="3.5" width="6.5" height="6.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M3.5 3.5V1h6.5v6.5H7.5" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** 自绘标题栏：程序 logo、置顶、最小化、最大化/还原、关闭。 */
export function TitleBar({
  pinned,
  onTogglePinned,
  maximized,
  onToggleMaximize
}: TitleBarProps) {
  return (
    <header
      className="app-titlebar"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        onToggleMaximize();
      }}
    >
      <img className="app-titlebar-logo" src={appIcon} alt="" draggable={false} />
      <span className="app-titlebar-name">拾字</span>
      <span className="app-titlebar-spacer" />
      <div className="app-titlebar-actions">
        <button
          type="button"
          className={`app-titlebar-btn${pinned ? ' is-active' : ''}`}
          title={pinned ? '取消窗口置顶' : '窗口置顶'}
          aria-pressed={pinned}
          onClick={onTogglePinned}
        >
          {pinned ? <Pin size={14} fill="currentColor" /> : <PinOff size={14} />}
        </button>
        <button
          type="button"
          className="app-titlebar-btn"
          title="最小化"
          onClick={() => void window.bsub.minimizeWindow()}
        >
          <MinimizeGlyph />
        </button>
        <button
          type="button"
          className="app-titlebar-btn"
          title={maximized ? '还原' : '最大化'}
          onClick={onToggleMaximize}
        >
          {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
        </button>
        <button
          type="button"
          className="app-titlebar-btn is-close"
          title="关闭"
          onClick={() => void window.bsub.requestClose()}
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
