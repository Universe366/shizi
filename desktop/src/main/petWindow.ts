import { BrowserWindow, app, screen } from 'electron';
import path from 'node:path';
import { loadSettings, saveSettings } from './settings';
import {
  bodyRectFor,
  clampRectToArea,
  cornerBodyRect,
  defaultBodyRect,
  nearestWorkArea,
  normalizePetSize,
  rubberBandRect,
  shouldFlipBelow,
  snapRectToEdges,
  speedOf,
  decayVelocity,
  THROW_THRESHOLD,
  windowRectFor,
  type BubbleSize,
  type PetLayoutMode,
  type Rect
} from './petGeometry';

let petWindow: BrowserWindow | null = null;
let layoutMode: PetLayoutMode = 'compact';
let layoutBelow = false;
let transientBubble: BubbleSize | null = null;
let notifiedBelow: boolean | null = null;
/** 用户「希望」桌宠待的位置（本体坐标），布局伸缩时以它为准。 */
let desiredBody: Rect | null = null;
/** 桌宠抢焦点之前是哪个窗口，Esc 收起时还回去。 */
let lastFocusedWindow: BrowserWindow | null = null;
let previousWindow: BrowserWindow | null = null;
let focusTracking = false;

/* ---------------- 位置：内部一律以「桌宠本体」为准 ---------------- */

function workAreas(): Rect[] {
  return screen.getAllDisplays().map((display) => display.workArea);
}

function bodyArea(body: Rect): Rect {
  const center = {
    x: body.x + Math.round(body.width / 2),
    y: body.y + Math.round(body.height / 2)
  };
  return nearestWorkArea(center, workAreas()) || screen.getPrimaryDisplay().workArea;
}

function petSize(): number {
  return normalizePetSize(loadSettings().general.petSize);
}

function bubbleSize(): BubbleSize {
  if (transientBubble) return transientBubble;
  return persistedBubbleSize();
}

function persistedBubbleSize(): BubbleSize {
  const settings = loadSettings();
  return {
    width: settings.general.petBubbleWidth || 440,
    height: settings.general.petBubbleHeight || 480
  };
}

/** 拖角调整气泡大小：persist=false 时只临时生效，松手再落盘。 */
export function resizeBubble(
  width: number,
  height: number,
  persist: boolean
): BubbleSize {
  const next = {
    width: Math.min(760, Math.max(320, Math.round(Number(width) || 440))),
    height: Math.min(820, Math.max(260, Math.round(Number(height) || 480)))
  };
  if (!persist) {
    transientBubble = next;
    layoutPetWindow();
    return next;
  }
  transientBubble = null;
  const settings = loadSettings();
  settings.general.petBubbleWidth = next.width;
  settings.general.petBubbleHeight = next.height;
  saveSettings(settings);
  layoutPetWindow();
  return next;
}

/** 当前本体矩形；窗口不存在时用默认右下角兜底。 */
function currentBody(): Rect {
  const size = petSize();
  if (!petWindow || petWindow.isDestroyed()) {
    return defaultBodyRect(size, screen.getPrimaryDisplay().workArea);
  }
  const [x, y] = petWindow.getPosition();
  const [width, height] = petWindow.getSize();
  return bodyRectFor({ x, y, width, height }, size, layoutBelow);
}

function clampBody(body: Rect): Rect {
  return clampRectToArea(body, bodyArea(body));
}

/** 用户上次放下的位置（设置里存的是本体坐标）。 */
function persistedBody(): Rect | null {
  const settings = loadSettings();
  if (!settings.general.petX && !settings.general.petY) return null;
  const size = petSize();
  return clampBody({
    x: settings.general.petX,
    y: settings.general.petY,
    width: size,
    height: size
  });
}

/** 把本体放到指定位置：窗口按当前布局围绕本体展开（本体屏幕坐标不变）。 */
function applyBody(target: Rect, remember = false): Rect {
  const body = clampBody(target);
  if (!petWindow || petWindow.isDestroyed()) {
    if (remember) desiredBody = body;
    return body;
  }
  const area = bodyArea(body);
  updateBelow(body, area);
  const windowRect = windowRectFor(body, layoutMode, body.width, bubbleSize(), layoutBelow);
  const bounded = clampRectToArea(windowRect, area);
  petWindow.setBounds(bounded);
  // 窗口被屏幕边缘推回时，本体以实际窗口为准。
  const applied = bodyRectFor(bounded, body.width, layoutBelow);
  if (remember) desiredBody = applied;
  return applied;
}

/** 上方放不下、下方放得下时，把面板翻到桌宠下面；变化时通知渲染层换 CSS 顺序。 */
function updateBelow(body: Rect, area: Rect): void {
  const next = shouldFlipBelow(body, layoutMode, body.width, area, bubbleSize());
  if (next === layoutBelow) return;
  layoutBelow = next;
  if (notifiedBelow !== layoutBelow) {
    notifiedBelow = layoutBelow;
    petWebContents()?.send('pet:flipped', layoutBelow);
  }
}

function persistBody(body: Rect): void {
  desiredBody = body;
  const settings = loadSettings();
  settings.general.petX = body.x;
  settings.general.petY = body.y;
  saveSettings(settings);
}

function onDisplaysChanged(): void {
  // 拔掉副屏 / 改分辨率后把本体拉回可见区域。
  const body = currentBody();
  const bounded = clampBody(body);
  if (bounded.x !== body.x || bounded.y !== body.y) {
    applyBody(bounded, true);
    persistBody(bounded);
  }
}

/* ---------------- 窗口生命周期 ---------------- */

/** 桌宠窗口：透明、无边框、置顶、不进任务栏；尺寸随内容伸缩。 */
export function openPetWindow(useStartCorner = false): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.showInactive();
    return;
  }
  layoutMode = 'compact';
  layoutBelow = false;
  notifiedBelow = false;
  startFocusTracking();
  const size = petSize();
  const settings = loadSettings();
  const corner = settings.general.petStartCorner;
  const primary = screen.getPrimaryDisplay().workArea;
  const startRect =
    useStartCorner && corner && corner !== 'remember'
      ? cornerBodyRect(size, primary, corner)
      : null;
  const saved =
    startRect ||
    (settings.general.petX || settings.general.petY
      ? { x: settings.general.petX, y: settings.general.petY, width: size, height: size }
      : defaultBodyRect(size, primary));
  const body = clampBody(saved);
  desiredBody = body;
  const rect = windowRectFor(body, layoutMode, size, bubbleSize());

  petWindow = new BrowserWindow({
    ...rect,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  applyWindowStyle();
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void petWindow.loadURL(`${rendererUrl}?window=pet`);
  } else {
    void petWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { window: 'pet' }
    });
  }
  petWindow.once('ready-to-show', () => petWindow?.showInactive());

  petWindow.on('closed', () => {
    petWindow = null;
    stopDragLoop();
    screen.removeListener('display-metrics-changed', onDisplaysChanged);
    screen.removeListener('display-added', onDisplaysChanged);
    screen.removeListener('display-removed', onDisplaysChanged);
  });
  screen.on('display-metrics-changed', onDisplaysChanged);
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  console.log('[pet] window opened', `${rect.width}x${rect.height}`, layoutMode);
}

export function closePetWindow(): void {
  stopDragLoop();
  stopInertia();
  if (petWindow && !petWindow.isDestroyed()) petWindow.close();
  petWindow = null;
}

/** 设置里切换开关时调用：创建/销毁窗口；开关值由调用方写设置。 */
export function setPetEnabled(enabled: boolean): void {
  if (enabled) openPetWindow();
  else closePetWindow();
}

export function initPetWindow(): void {
  if (loadSettings().general.petEnabled) {
    setTimeout(() => openPetWindow(true), 1200);
  }
}

/* ---------------- 布局 ---------------- */

export function layoutPetWindow(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  // 展开时窗口可能被屏幕边缘推回（本体暂时让位）；收回时回到用户放下的位置。
  const body =
    layoutMode === 'compact'
      ? desiredBody || persistedBody() || currentBody()
      : currentBody();
  const area = bodyArea(body);
  updateBelow(body, area);
  const windowRect = windowRectFor(body, layoutMode, petSize(), bubbleSize(), layoutBelow);
  const bounded = clampRectToArea(windowRect, area);
  petWindow.setBounds(bounded);
}

/** 渲染层切换气泡/挂件/菜单时调用。 */
export function setPetLayout(mode: PetLayoutMode): void {
  const allowed: PetLayoutMode[] = ['compact', 'bubble', 'widget', 'menu'];
  layoutMode = allowed.includes(mode) ? mode : 'compact';
  layoutPetWindow();
}

export function petLayout(): PetLayoutMode {
  return layoutMode;
}

function applyWindowStyle(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const settings = loadSettings();
  petWindow.setOpacity(Math.min(1, Math.max(0.4, settings.general.petOpacity ?? 1)));
  petWindow.setAlwaysOnTop(settings.general.petAlwaysOnTop !== false, 'screen-saver');
  layoutPetWindow();
}

/** 保存设置后同步窗口尺寸、透明度与置顶。 */
export function applyPetSettings(): void {
  applyWindowStyle();
}

/* ---------------- 查询与操作 ---------------- */

export function petPosition(): { x: number; y: number } | null {
  if (!petWindow || petWindow.isDestroyed()) return null;
  const [x, y] = petWindow.getPosition();
  return { x, y };
}

/** 桌宠本体在屏幕上的矩形（跨布局稳定）。 */
export function petFlipped(): boolean {
  return layoutBelow;
}

export function petBodyRect(): Rect | null {
  if (!petWindow || petWindow.isDestroyed()) return null;
  return currentBody();
}

export function resetPetPosition(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  stopInertia();
  const settings = loadSettings();
  const primary = screen.getPrimaryDisplay().workArea;
  const corner = settings.general.petStartCorner;
  const body =
    corner && corner !== 'remember'
      ? cornerBodyRect(petSize(), primary, corner)
      : defaultBodyRect(petSize(), primary);
  persistBody(applyBody(body));
}

/** 直接设置本体位置（程序化移动 / 兼容旧 IPC）。 */
export function movePet(x: number, y: number): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  applyBody({ x: Math.round(x), y: Math.round(y), width: petSize(), height: petSize() }, true);
}

/** 松手：吸附屏幕边缘 + 立即保存。返回吸附后的本体位置。 */
export function dropPet(x: number, y: number): { x: number; y: number } | null {
  if (!petWindow || petWindow.isDestroyed()) return null;
  const body = { x: Math.round(x), y: Math.round(y), width: petSize(), height: petSize() };
  const snapped = loadSettings().general.petSnap === false ? body : snapRectToEdges(body, bodyArea(body));
  const applied = applyBody(snapped, true);
  persistBody(applied);
  return { x: applied.x, y: applied.y };
}

/* ---------------- 拖拽：主进程跟随光标（指针移出窗口也不掉） ---------------- */

let dragTimer: NodeJS.Timeout | null = null;
let dragStart: { cursor: Electron.Point; body: Rect } | null = null;
let dragMoved = false;
let lastMoveAt = 0;
let dragVelocity = { vx: 0, vy: 0 };
let inertiaTimer: NodeJS.Timeout | null = null;
let inertia = { vx: 0, vy: 0 };

function stopDragLoop(): void {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  dragStart = null;
}

export function beginPetDrag(): void {
  if (!petWindow || petWindow.isDestroyed() || dragTimer) return;
  stopInertia();
  dragStart = { cursor: screen.getCursorScreenPoint(), body: currentBody() };
  dragMoved = false;
  dragVelocity = { vx: 0, vy: 0 };
  lastMoveAt = Date.now();
  let lastCursor = dragStart.cursor;
  let lastSampleAt = Date.now();
  dragTimer = setInterval(() => {
    if (!dragStart || !petWindow || petWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const now = Date.now();
    const dt = now - lastSampleAt;
    const stepX = cursor.x - lastCursor.x;
    const stepY = cursor.y - lastCursor.y;
    if (dt > 0 && (stepX !== 0 || stepY !== 0)) {
      dragVelocity = { vx: stepX / dt, vy: stepY / dt };
      lastSampleAt = now;
    } else if (now - lastSampleAt > 150) {
      // 停了 150ms 以上才算真的松手/停住，避免松手瞬间被一帧 0 速度覆盖掉惯性。
      dragVelocity = { vx: 0, vy: 0 };
      lastSampleAt = now;
    }
    const dx = cursor.x - dragStart.cursor.x;
    const dy = cursor.y - dragStart.cursor.y;
    if (cursor.x !== lastCursor.x || cursor.y !== lastCursor.y) {
      lastCursor = cursor;
      lastMoveAt = now;
    }
    if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    if (dragMoved) {
      const target = { ...dragStart.body, x: dragStart.body.x + dx, y: dragStart.body.y + dy };
      const clamped = clampBody(target);
      // 越界时只露出一小截（橡皮筋），松手会被拉回。
      applyBody(rubberBandRect(target, clamped));
      // 指针移出窗口后可能收不到 mouseup：光标停住 1.2s 就自动收尾。
      if (now - lastMoveAt > 1200) void endPetDrag();
    }
  }, 16);
}

/** 松手后的惯性：按松手速度继续滑，摩擦到停或撞边，最后吸附并落盘。 */
function startInertia(vx: number, vy: number): void {
  stopInertia();
  if (Math.hypot(vx, vy) < 0.05) return;
  inertia = { vx, vy };
  let last = Date.now();
  inertiaTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) {
      stopInertia();
      return;
    }
    const now = Date.now();
    const dt = Math.min(48, Math.max(1, now - last));
    last = now;
    const body = currentBody();
    const target = {
      ...body,
      x: body.x + inertia.vx * dt,
      y: body.y + inertia.vy * dt
    };
    const clamped = clampBody(target);
    if (Math.abs(clamped.x - target.x) > 1) inertia.vx = 0;
    if (Math.abs(clamped.y - target.y) > 1) inertia.vy = 0;
    const applied = applyBody(clamped);
    inertia = decayVelocity(inertia, dt);
    if (speedOf(inertia) < 0.02) {
      stopInertia();
      const settled = applyBody(snapRectToEdges(applied, bodyArea(applied)));
      persistBody(settled);
    }
  }, 16);
}

function stopInertia(): void {
  if (inertiaTimer) {
    clearInterval(inertiaTimer);
    inertiaTimer = null;
  }
  inertia = { vx: 0, vy: 0 };
}

export function endPetDrag(): { x: number; y: number; moved: boolean } | null {
  const wasDrag = dragMoved;
  const { vx, vy } = dragVelocity;
  stopDragLoop();
  if (!petWindow || petWindow.isDestroyed()) return null;

  // 甩出去：先按速度滑一段，停下时再吸附/落盘。
  if (
    wasDrag &&
    loadSettings().general.petThrow !== false &&
    speedOf({ vx, vy }) > THROW_THRESHOLD
  ) {
    startInertia(vx, vy);
    const body = currentBody();
    return { x: body.x, y: body.y, moved: true };
  }

  const body = currentBody();
  const snapped =
    loadSettings().general.petSnap === false ? body : snapRectToEdges(body, bodyArea(body));
  const applied = applyBody(snapped);
  if (wasDrag) persistBody(applied);
  return { x: applied.x, y: applied.y, moved: wasDrag };
}

/* ---------------- 截图时临时隐藏（避免把桌宠自己拍进去） ---------------- */

export function petWebContents(): Electron.WebContents | null {
  if (!petWindow || petWindow.isDestroyed()) return null;
  return petWindow.webContents;
}

export async function withPetHidden<T>(run: () => Promise<T>): Promise<T> {
  const win = petWindow;
  const visible = Boolean(win && !win.isDestroyed() && win.isVisible());
  if (visible && win) win.hide();
  try {
    if (visible) await new Promise((resolve) => setTimeout(resolve, 90));
    return await run();
  } finally {
    if (visible && petWindow && !petWindow.isDestroyed()) petWindow.showInactive();
  }
}

/** 右键菜单里的「置顶」开关：立即生效并写回设置。 */
export function setPetAlwaysOnTop(enabled: boolean): boolean {
  const settings = loadSettings();
  settings.general.petAlwaysOnTop = enabled;
  saveSettings(settings);
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setAlwaysOnTop(enabled, 'screen-saver');
  }
  return enabled;
}

/** 开始跟踪窗口焦点：记住桌宠抢焦点之前是哪个窗口。 */
function startFocusTracking(): void {
  if (focusTracking) return;
  focusTracking = true;
  lastFocusedWindow = BrowserWindow.getFocusedWindow();
  app.on('browser-window-focus', (_event, win) => {
    if (win === petWindow && lastFocusedWindow && lastFocusedWindow !== petWindow) {
      previousWindow = lastFocusedWindow;
    }
    lastFocusedWindow = win;
  });
}

/** 把焦点还给上一个窗口（Esc 收起气泡后调用，别让焦点留在不可见的桌宠窗口里）。 */
export function petBlur(): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const usable = (win: BrowserWindow | null): win is BrowserWindow =>
    Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
  const target =
    usable(previousWindow)
      ? previousWindow
      : BrowserWindow.getAllWindows().find(
          (win) => win !== petWindow && usable(win) && win.isFocusable()
        );
  if (target) {
    target.focus();
    return;
  }
  try {
    petWindow.blur();
  } catch {
    // 某些平台不支持，忽略
  }
}
