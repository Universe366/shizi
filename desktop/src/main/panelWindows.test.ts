import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  class FakeWindow {
    static instances: FakeWindow[] = [];
    options: Record<string, unknown>;
    bounds: { x: number; y: number; width: number; height: number };
    events = new Map<string, Array<(...args: unknown[]) => void>>();
    destroyed = false;
    shown = false;
    focused = false;
    onTop = false;
    loaded: { file?: string; query?: Record<string, string>; url?: string } = {};

    constructor(options: Record<string, unknown>) {
      this.options = options;
      this.bounds = {
        x: Number(options.x) || 0,
        y: Number(options.y) || 0,
        width: Number(options.width) || 0,
        height: Number(options.height) || 0
      };
      this.onTop = options.alwaysOnTop === true;
      FakeWindow.instances.push(this);
    }

    on(name: string, cb: (...args: unknown[]) => void) {
      const list = this.events.get(name) || [];
      list.push(cb);
      this.events.set(name, list);
    }

    once(name: string, cb: (...args: unknown[]) => void) {
      this.on(name, cb);
      if (name === 'ready-to-show') cb();
    }

    emit(name: string) {
      for (const cb of this.events.get(name) || []) cb();
    }

    loadFile(file: string, options?: { query?: Record<string, string> }) {
      this.loaded = { file, query: options?.query };
    }

    loadURL(url: string) {
      this.loaded = { url };
    }

    getBounds() {
      return this.bounds;
    }

    setAlwaysOnTop(value: boolean) {
      this.onTop = value;
    }

    show() {
      this.shown = true;
    }

    focus() {
      this.focused = true;
    }

    isMinimized() {
      return false;
    }

    restore() {}

    isDestroyed() {
      return this.destroyed;
    }

    close() {
      this.destroyed = true;
      this.emit('closed');
    }
  }
  return { dir: '', FakeWindow };
});

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  BrowserWindow: state.FakeWindow,
  nativeTheme: { themeSource: 'system', shouldUseDarkColors: false },
  screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
  }
}));

import {
  closePanelWindow,
  disposePanelWindows,
  initPanelWindows,
  listPanelWindows,
  openPanelWindow,
  setPanelAlwaysOnTop
} from './panelWindows';

const FakeWindow = state.FakeWindow;

function closeAll() {
  for (const item of listPanelWindows()) closePanelWindow(item.section);
  FakeWindow.instances.length = 0;
}

beforeEach(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-panels-'));
  closeAll();
});

afterEach(() => {
  closeAll();
  fs.rmSync(state.dir, { recursive: true, force: true });
});

describe('独立面板窗口', () => {
  it('打开窗口并带上 section/title 查询参数', () => {
    const result = openPanelWindow('subtitles', '字幕');
    expect(result.ok).toBe(true);
    expect(FakeWindow.instances).toHaveLength(1);
    const win = FakeWindow.instances[0];
    expect(win.shown).toBe(true);
    expect(win.loaded.query).toMatchObject({ window: 'panel', section: 'subtitles', title: '字幕' });
    expect(listPanelWindows()).toHaveLength(1);
  });

  it('同一面板重复打开只聚焦已有窗口', () => {
    const first = openPanelWindow('summary', '总结');
    const second = openPanelWindow('summary', '总结');
    expect(first.ok && second.ok).toBe(true);
    expect(FakeWindow.instances).toHaveLength(1);
    expect(FakeWindow.instances[0].focused).toBe(true);
  });

  it('置顶与关闭', () => {
    openPanelWindow('chat', '对话');
    expect(setPanelAlwaysOnTop('chat', true).ok).toBe(true);
    expect(FakeWindow.instances[0].onTop).toBe(true);
    expect(listPanelWindows()[0].alwaysOnTop).toBe(true);

    expect(closePanelWindow('chat').ok).toBe(true);
    expect(listPanelWindows()).toHaveLength(0);
    expect(closePanelWindow('chat').ok).toBe(false);
  });

  it('位置写进 panel-windows.json 并在重启后恢复', async () => {
    const main = new FakeWindow({ x: 0, y: 0, width: 1200, height: 800 }) as never;
    initPanelWindows(main);
    FakeWindow.instances.length = 0; // 只统计面板窗口，主窗口不参与断言
    openPanelWindow('subtitles', '字幕');
    FakeWindow.instances[0].bounds = { x: 120, y: 90, width: 400, height: 700 };
    FakeWindow.instances[0].emit('move');
    await new Promise((resolve) => setTimeout(resolve, 450));

    const store = JSON.parse(fs.readFileSync(path.join(state.dir, 'panel-windows.json'), 'utf8'));
    expect(store.windows[0]).toMatchObject({ section: 'subtitles', x: 120, y: 90, width: 400 });

    // 模拟退出：先把位置落盘，再关窗（关窗不能把列表写空）
    disposePanelWindows();
    closeAll();
    FakeWindow.instances.length = 0;
    initPanelWindows(main);
    expect(FakeWindow.instances).toHaveLength(1);
    expect(FakeWindow.instances[0].bounds).toMatchObject({ x: 120, y: 90, width: 400 });
  });

  it('超过上限时拒绝再开', () => {
    for (let index = 0; index < 12; index += 1) {
      expect(openPanelWindow(`plugin:p${index}:main`, 'P').ok).toBe(true);
    }
    const overflow = openPanelWindow('plugin:extra:main', 'X');
    expect(overflow.ok).toBe(false);
  });
});
