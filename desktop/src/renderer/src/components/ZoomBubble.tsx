import { useEffect, useRef } from 'react';
import { Minus, Plus, X } from 'lucide-react';

const PRESETS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];

interface ZoomBubbleProps {
  open: boolean;
  zoom: number;
  onClose: () => void;
}

/** Edge 风格缩放浮窗：− / 百分比 / ＋ / 常用比例。 */
export function ZoomBubble({ open, zoom, onClose }: ZoomBubbleProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (ref.current && target && ref.current.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onClose]);

  if (!open) return null;
  const percent = Math.round((Number(zoom) || 1) * 100);

  return (
    <div className="zoom-bubble" ref={ref} role="group" aria-label="缩放">
      <div className="zoom-bubble-head">
        <span>缩放</span>
        <button type="button" className="zoom-bubble-close" title="关闭缩放面板" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      <div className="zoom-bubble-control">
        <button
          type="button"
          title="缩小"
          aria-label="缩小"
          onClick={() => void window.bsub.zoomOut()}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="zoom-bubble-value"
          title="重置为 100%"
          onClick={() => void window.bsub.zoomReset()}
        >
          {percent}%
        </button>
        <button
          type="button"
          title="放大"
          aria-label="放大"
          onClick={() => void window.bsub.zoomIn()}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="zoom-bubble-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={Math.abs(preset - (Number(zoom) || 1)) < 0.001 ? 'is-active' : ''}
            onClick={() => void window.bsub.setZoom(preset)}
          >
            {Math.round(preset * 100)}%
          </button>
        ))}
      </div>
      <div className="zoom-bubble-hint">Ctrl + 滚轮 / Ctrl + + − 也可以缩放</div>
    </div>
  );
}
