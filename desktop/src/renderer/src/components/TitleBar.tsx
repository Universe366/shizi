import { Maximize2, Minimize2, Pin, PinOff, X } from 'lucide-react';

interface TitleBarProps {
  pinned: boolean;
  onTogglePinned: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
}

/** 自绘标题栏：logo、置顶、最小化、最大化/还原、关闭。 */
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
      <span className="app-titlebar-logo" aria-hidden>
        字
      </span>
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
          <Minimize2 size={14} />
        </button>
        <button
          type="button"
          className="app-titlebar-btn"
          title={maximized ? '还原' : '最大化'}
          onClick={onToggleMaximize}
        >
          {maximized ? <Maximize2 size={14} className="is-restore" /> : <Maximize2 size={14} />}
        </button>
        <button
          type="button"
          className="app-titlebar-btn is-close"
          title="关闭"
          onClick={() => void window.bsub.requestClose()}
        >
          <X size={15} />
        </button>
      </div>
    </header>
  );
}
