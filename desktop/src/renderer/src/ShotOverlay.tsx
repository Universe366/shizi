import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeSelection, toolbarPosition, type Point, type Rect } from '../../shared/shotGeometry';

/**
 * 框选截图覆盖窗：铺满当前显示器的截图，拖出选框后弹出动作条。
 * 只做交互与坐标，裁剪在主进程按 HiDPI 比例完成。
 */
type ShotTool = 'rect' | 'arrow' | 'mosaic';

interface ShotShape {
  tool: ShotTool;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const SHOT_COLOR = '#ff4d5e';

function paintShape(
  ctx: CanvasRenderingContext2D,
  shape: ShotShape,
  image?: HTMLImageElement,
  ratio = 1
) {
  const x1 = shape.x1 * ratio;
  const y1 = shape.y1 * ratio;
  const x2 = shape.x2 * ratio;
  const y2 = shape.y2 * ratio;
  const width = x2 - x1;
  const height = y2 - y1;
  ctx.save();
  if (shape.tool === 'rect') {
    ctx.strokeStyle = SHOT_COLOR;
    ctx.lineWidth = Math.max(2, 3 * ratio);
    ctx.strokeRect(x1, y1, width, height);
  } else if (shape.tool === 'arrow') {
    ctx.strokeStyle = SHOT_COLOR;
    ctx.fillStyle = SHOT_COLOR;
    ctx.lineWidth = Math.max(2, 3 * ratio);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const size = Math.max(8, 11 * ratio);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - size * Math.cos(angle - 0.45), y2 - size * Math.sin(angle - 0.45));
    ctx.lineTo(x2 - size * Math.cos(angle + 0.45), y2 - size * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();
  } else {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(width);
    const h = Math.abs(height);
    if (image && w > 2 && h > 2) {
      const block = Math.max(4, 10 * ratio);
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(w / block));
      small.height = Math.max(1, Math.round(h / block));
      const smallCtx = small.getContext('2d');
      if (smallCtx) {
        smallCtx.drawImage(image, left, top, w, h, 0, 0, small.width, small.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, left, top, w, h);
      }
    } else {
      ctx.fillStyle = 'rgba(20, 20, 24, 0.55)';
      ctx.fillRect(left, top, w, h);
    }
  }
  ctx.restore();
}

export function ShotOverlay() {
  const [image, setImage] = useState<{ dataUrl: string; width: number; height: number } | null>(
    null
  );
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<ShotTool | null>(null);
  const [shapes, setShapes] = useState<ShotShape[]>([]);
  const [drawing, setDrawing] = useState<ShotShape | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let alive = true;
    void window.bsub.shotInit().then((payload) => {
      if (!alive) return;
      if (!payload || !payload.dataUrl) {
        setError('没有拿到屏幕画面');
        void window.bsub.shotDone(null);
        return;
      }
      setImage(payload);
    });
    return () => {
      alive = false;
    };
  }, []);

  const cancel = useCallback(() => {
    void window.bsub.shotDone(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
        return;
      }
      if (!selection) return;
      if (event.key === 'r') setTool('rect');
      if (event.key === 'a') setTool('arrow');
      if (event.key === 'm') setTool('mosaic');
      if (event.key === 'z' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setShapes((items) => items.slice(0, -1));
        return;
      }
      const action =
        event.key === '1' ? 'image' : event.key === '2' ? 'chat' : event.key === '3' ? 'ocr' : null;
      if (!action) return;
      event.preventDefault();
      void finish(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel, selection]);

  const bounds = useMemo(
    () => ({ width: image?.width || window.innerWidth, height: image?.height || window.innerHeight }),
    [image]
  );

  const dragging = start !== null;
  const liveRect = start && current ? normalizeSelection(start, current, bounds, 1) : null;
  const rect = selection || liveRect;

  const flatten = (): string | undefined => {
    if (!selection || !imageRef.current || !shapes.length) return undefined;
    const image = imageRef.current;
    const ratio = image.naturalWidth && bounds.width ? image.naturalWidth / bounds.width : 1;
    const width = Math.max(1, Math.round(selection.width * ratio));
    const height = Math.max(1, Math.round(selection.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    try {
      ctx.drawImage(
        image,
        selection.x * ratio,
        selection.y * ratio,
        selection.width * ratio,
        selection.height * ratio,
        0,
        0,
        width,
        height
      );
      for (const shape of shapes) paintShape(ctx, shape, image, ratio);
      return canvas.toDataURL('image/jpeg', 0.9);
    } catch {
      return undefined;
    }
  };

  const finish = (action: 'image' | 'chat' | 'ocr') => {
    if (!selection) return;
    const annotatedDataUrl = flatten();
    void window.bsub.shotDone({
      selection,
      action,
      ...(annotatedDataUrl ? { annotatedDataUrl } : {})
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selection) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const shape of shapes) paintShape(ctx, shape, imageRef.current || undefined, 1);
    if (drawing) paintShape(ctx, drawing, imageRef.current || undefined, 1);
  }, [shapes, drawing, selection, image]);

  const toolbarSize = { width: 520, height: 46 };
  const toolbar = selection
    ? toolbarPosition(selection, { width: bounds.width, height: bounds.height }, toolbarSize)
    : null;

  return (
    <div
      className={`shot-root${dragging ? ' is-dragging' : ''}${selection ? ' is-chosen' : ''}`}
      style={{
        ['--shot-width' as string]: `${bounds.width}px`,
        ['--shot-height' as string]: `${bounds.height}px`
      }}
      onMouseDown={(event) => {
        if (event.button !== 0 || selection) return;
        event.preventDefault();
        setStart({ x: event.clientX, y: event.clientY });
        setCurrent({ x: event.clientX, y: event.clientY });
      }}
      onMouseMove={(event) => {
        if (!start) return;
        setCurrent({ x: event.clientX, y: event.clientY });
      }}
      onMouseUp={(event) => {
        if (!start) return;
        const next = normalizeSelection(start, { x: event.clientX, y: event.clientY }, bounds);
        setStart(null);
        setCurrent(null);
        if (next) setSelection(next);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        cancel();
      }}
    >
      {image && (
        <img ref={imageRef} className="shot-image" src={image.dataUrl} alt="屏幕截图" draggable={false} />
      )}

      {!rect && <div className="shot-mask" />}

      {rect && (
        <div
          className="shot-selection"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <span className="shot-size">
            {rect.width} × {rect.height}
          </span>
          <canvas
            ref={canvasRef}
            className={`shot-annotate${tool ? ' is-drawing' : ''}`}
            width={Math.round(rect.width)}
            height={Math.round(rect.height)}
            style={{ left: 0, top: 0, width: rect.width, height: rect.height }}
            onMouseDown={(event) => {
              event.stopPropagation();
              if (!tool) return;
              const point = { x: event.clientX - rect.x, y: event.clientY - rect.y };
              setDrawing({ tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y });
            }}
            onMouseMove={(event) => {
              if (!drawing) return;
              setDrawing({
                ...drawing,
                x2: event.clientX - rect.x,
                y2: event.clientY - rect.y
              });
            }}
            onMouseUp={() => {
              if (!drawing) return;
              const shape = drawing;
              setDrawing(null);
              if (Math.abs(shape.x2 - shape.x1) + Math.abs(shape.y2 - shape.y1) > 4) {
                setShapes((items) => [...items, shape]);
              }
            }}
          />
        </div>
      )}

      {!selection && (
        <div className="shot-hint">
          {error || '拖动鼠标框选区域　·　Esc 或右键取消'}
        </div>
      )}

      {selection && toolbar && (
        <div
          className="shot-toolbar"
          style={{ left: toolbar.x, top: toolbar.y, width: toolbarSize.width }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={`shot-tool${tool === 'rect' ? ' is-active' : ''}`}
            title="矩形标注（R）"
            onClick={() => setTool(tool === 'rect' ? null : 'rect')}
          >
            矩形
          </button>
          <button
            type="button"
            className={`shot-tool${tool === 'arrow' ? ' is-active' : ''}`}
            title="箭头标注（A）"
            onClick={() => setTool(tool === 'arrow' ? null : 'arrow')}
          >
            箭头
          </button>
          <button
            type="button"
            className={`shot-tool${tool === 'mosaic' ? ' is-active' : ''}`}
            title="马赛克（M）"
            onClick={() => setTool(tool === 'mosaic' ? null : 'mosaic')}
          >
            马赛克
          </button>
          <button
            type="button"
            className="shot-tool"
            title="撤销（Ctrl+Z）"
            onClick={() => setShapes((items) => items.slice(0, -1))}
          >
            撤销
          </button>
          <span className="shot-tool-sep" />
          <button type="button" title="识别图片（1）" onClick={() => finish('image')}>
            识别图片
          </button>
          <button type="button" title="对话（2）" onClick={() => finish('chat')}>
            对话
          </button>
          <button type="button" title="提取文字（3）" onClick={() => finish('ocr')}>
            提取文字
          </button>
          <button type="button" className="shot-toolbar-cancel" title="取消（Esc）" onClick={cancel}>
            取消
          </button>
        </div>
      )}
    </div>
  );
}
