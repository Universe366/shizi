import type { StartShortcut } from '../../../shared/types';
import { SiteIcon } from './start/SiteIcon';

export function StartPageDragGhost({
  drag
}: {
  drag: { item: StartShortcut; x: number; y: number; offsetX: number; offsetY: number };
}) {
  return (
    <div
      className="sc-drag-ghost"
      style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY }}
    >
      <SiteIcon item={drag.item} />
      <span>{drag.item.label}</span>
    </div>
  );
}

export function StartPageToast({
  text,
  onUndo
}: {
  text: string;
  onUndo?: () => void;
}) {
  return (
    <div className="sc-toast" role="status">
      <span>{text}</span>
      {onUndo && (
        <button type="button" onClick={onUndo}>
          撤销
        </button>
      )}
    </div>
  );
}

export function StartPageFooter({
  wallpaperLabel
}: {
  wallpaperLabel: string;
}) {
  return (
    <footer className="sc-foot">
      <span>Ctrl K 命令 · / 聚焦搜索 · 右键或悬停编辑快捷方式</span>
      <span className="sc-wall-name">{wallpaperLabel}</span>
    </footer>
  );
}
