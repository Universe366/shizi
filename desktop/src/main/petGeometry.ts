// 桌宠的位置与窗口尺寸计算（纯函数，不依赖 electron，便于测试）。
//
// 目标：
// - 桌宠永远留在某个显示器的可见工作区内（拔掉副屏、改分辨率后也不丢）；
// - 窗口按内容收缩/展开，避免透明窗口在桌面上「挡住看不见的区域」；
// - 拖拽松手时吸附到屏幕边缘，手感更稳。

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PetLayoutMode = 'compact' | 'bubble' | 'widget' | 'menu';

export const PET_MIN_SIZE = 64;
export const PET_MAX_SIZE = 180;
export const PET_DEFAULT_SIZE = 96;
export const PET_EDGE_SNAP = 28;
export const PET_GRIP = 14;
export const PET_GAP = 6;

export function normalizePetSize(value: number | undefined): number {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return PET_DEFAULT_SIZE;
  return Math.min(PET_MAX_SIZE, Math.max(PET_MIN_SIZE, Math.round(size)));
}

/** 每种状态下的窗口尺寸：桌宠本体 + 需要展示的气泡/挂件高度。 */
export interface BubbleSize {
  width: number;
  height: number;
}

export const DEFAULT_BUBBLE: BubbleSize = { width: 440, height: 480 };

/** 气泡窗口 = 气泡内容 + 桌宠本体 + 边距/把手。 */
export function petLayoutSize(
  mode: PetLayoutMode,
  petSize: number,
  bubble: BubbleSize = DEFAULT_BUBBLE
): { width: number; height: number } {
  const size = normalizePetSize(petSize);
  switch (mode) {
    case 'bubble':
      return { width: bubble.width + 12, height: bubble.height + size + 38 };
    case 'widget':
      return { width: 232, height: size + 252 };
    case 'menu':
      return { width: 236, height: size + 400 };
    case 'compact':
    default:
      return { width: size + 12, height: size + 34 };
  }
}

/** 有气泡时右击菜单也能放下，所以优先 bubble。 */
export function petLayoutForState(input: {
  open: boolean;
  widgetOpen: boolean;
  menuOpen: boolean;
}): PetLayoutMode {
  if (input.open) return 'bubble';
  if (input.menuOpen) return 'menu';
  if (input.widgetOpen) return 'widget';
  return 'compact';
}

export function clampRectToArea(rect: Rect, area: Rect): Rect {
  const maxX = area.x + area.width - rect.width;
  const maxY = area.y + area.height - rect.height;
  return {
    ...rect,
    x: Math.min(Math.max(rect.x, area.x), Math.max(area.x, maxX)),
    y: Math.min(Math.max(rect.y, area.y), Math.max(area.y, maxY))
  };
}

/** 松手时贴边：左右上下各留 PET_EDGE_SNAP 的吸附范围。 */
export function snapRectToEdges(rect: Rect, area: Rect, threshold = PET_EDGE_SNAP): Rect {
  const snapped = { ...rect };
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  if (Math.abs(rect.x - area.x) <= threshold) snapped.x = area.x;
  else if (Math.abs(rect.x + rect.width - right) <= threshold) snapped.x = right - rect.width;
  if (Math.abs(rect.y - area.y) <= threshold) snapped.y = area.y;
  else if (Math.abs(rect.y + rect.height - bottom) <= threshold) snapped.y = bottom - rect.height;
  return clampRectToArea(snapped, area);
}

/** 默认位置：右下角，留 24px 边距（与旧版视觉位置接近）。 */
export function defaultPetRect(petSize: number, area: Rect, mode: PetLayoutMode = 'compact'): Rect {
  const size = petLayoutSize(mode, petSize);
  return clampRectToArea(
    { x: area.x + area.width - size.width - 24, y: area.y + area.height - size.height - 24, ...size },
    area
  );
}

function distanceToArea(point: { x: number; y: number }, area: Rect): number {
  const dx = Math.max(area.x - point.x, 0, point.x - (area.x + area.width));
  const dy = Math.max(area.y - point.y, 0, point.y - (area.y + area.height));
  return dx * dx + dy * dy;
}

/** 选最近的显示器：点在某个工作区内优先，否则取中心距离最近的。 */
export function nearestWorkArea(
  point: { x: number; y: number } | null,
  areas: Rect[]
): Rect | null {
  if (!areas.length) return null;
  if (!point) return areas[0];
  const inside = areas.find(
    (area) =>
      point.x >= area.x &&
      point.x <= area.x + area.width &&
      point.y >= area.y &&
      point.y <= area.y + area.height
  );
  if (inside) return inside;
  return areas.reduce((best, area) =>
    distanceToArea(point, area) < distanceToArea(point, best) ? area : best
  );
}

/** 窗口内边距（与 styles.css 的 .pet-root padding 保持一致）。 */
export const PET_PADDING = 6;

/** 窗口矩形 → 桌宠本体矩形（默认贴底；below 模式下本体在顶部、面板向下展开）。 */
export function bodyRectFor(
  windowRect: Rect,
  petSize: number,
  below = false,
  align: 'center' | 'left' | 'right' = 'center'
): Rect {
  const size = normalizePetSize(petSize);
  const topOffset = PET_PADDING + PET_GRIP + PET_GAP;
  const x =
    align === 'left'
      ? windowRect.x + PET_PADDING
      : align === 'right'
        ? windowRect.x + windowRect.width - PET_PADDING - size
        : windowRect.x + Math.round((windowRect.width - size) / 2);
  return {
    x,
    y: below
      ? windowRect.y + topOffset
      : windowRect.y + windowRect.height - PET_PADDING - size,
    width: size,
    height: size
  };
}

/** 桌宠本体矩形 + 布局模式 → 窗口矩形（窗口向上、向两侧长，本体位置不变）。 */
export function windowRectFor(
  bodyRect: Rect,
  mode: PetLayoutMode,
  petSize: number,
  bubble: BubbleSize = DEFAULT_BUBBLE,
  below = false,
  align: 'center' | 'left' | 'right' = 'center'
): Rect {
  const size = normalizePetSize(petSize);
  const windowSize = petLayoutSize(mode, size, bubble);
  const topOffset = PET_PADDING + PET_GRIP + PET_GAP;
  const x =
    align === 'left'
      ? bodyRect.x - PET_PADDING
      : align === 'right'
        ? bodyRect.x + size + PET_PADDING - windowSize.width
        : bodyRect.x - Math.round((windowSize.width - size) / 2);
  return {
    x,
    y: below ? bodyRect.y - topOffset : bodyRect.y + size + PET_PADDING - windowSize.height,
    width: windowSize.width,
    height: windowSize.height
  };
}

/**
 * 上方空间不够、下方够的时候，把面板翻到桌宠下面（窗口向下长、本体贴顶）。
 * compact 不翻；padding 取 6 与 CSS 对齐。
 */
export function shouldFlipBelow(
  body: Rect,
  mode: PetLayoutMode,
  petSize: number,
  area: Rect,
  bubble: BubbleSize = DEFAULT_BUBBLE
): boolean {
  if (mode === 'compact') return false;
  const size = normalizePetSize(petSize);
  const win = petLayoutSize(mode, size, bubble);
  const panel = win.height - size - (PET_PADDING * 2 + PET_GRIP + PET_GAP * 2);
  if (panel <= 0) return false;
  const need = panel + PET_GAP;
  const above = body.y - area.y;
  const below = area.y + area.height - (body.y + body.height);
  return above < need && below >= need;
}

/** 默认本体位置：右下角，距工作区边缘 24px。 */
export function defaultBodyRect(petSize: number, area: Rect): Rect {
  const size = normalizePetSize(petSize);
  return clampRectToArea(
    { x: area.x + area.width - size - 24, y: area.y + area.height - size - 24, width: size, height: size },
    area
  );
}

/** 图片缩放：等比缩到最长边不超过 max（不放大）。 */
export function fitWithin(
  width: number,
  height: number,
  max = 1600
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return { width: 1, height: 1 };
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type PetCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** 指定角落的本体矩形（Reset / 启动位置用）。 */
export function cornerBodyRect(petSize: number, area: Rect, corner: PetCorner, margin = 24): Rect {
  const size = normalizePetSize(petSize);
  const left = area.x + margin;
  const right = area.x + area.width - size - margin;
  const top = area.y + margin;
  const bottom = area.y + area.height - size - margin;
  const x = corner === 'bottom-left' || corner === 'top-left' ? left : right;
  const y = corner === 'top-left' || corner === 'top-right' ? top : bottom;
  return clampRectToArea({ x, y, width: size, height: size }, area);
}

/**
 * 拖到屏幕外时的橡皮筋：允许露出一点点（手感 Q 弹），但不会真拖丢。
 * factor 越大越"硬"，0.3 表示最多只能超出边界的 30%。
 */
export function rubberBandRect(target: Rect, clamped: Rect, factor = 0.3): Rect {
  return {
    ...clamped,
    x: Math.round(clamped.x + (target.x - clamped.x) * factor),
    y: Math.round(clamped.y + (target.y - clamped.y) * factor)
  };
}

/** 甩出去的初始速度门槛（px/ms）。 */
export const THROW_THRESHOLD = 0.12;

/** 每帧摩擦衰减；dt 是距上一帧的毫秒数。 */
export function decayVelocity(
  v: { vx: number; vy: number },
  dt: number,
  friction = 0.9
): { vx: number; vy: number } {
  const k = Math.pow(friction, Math.max(1, dt) / 16);
  return { vx: v.vx * k, vy: v.vy * k };
}

export function speedOf(v: { vx: number; vy: number }): number {
  return Math.hypot(v.vx, v.vy);
}
