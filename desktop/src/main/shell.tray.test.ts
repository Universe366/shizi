import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTray } from './shell';

/**
 * 托盘回归测试：用假的 electron 模块跑真实的 shell.createTray，
 * 锁住「图标 16px、菜单项、点击回调、失败降级」这几件容易改坏的事。
 */
const mocks = vi.hoisted(() => {
  const trays: Array<any> = [];
  const quit = vi.fn();
  const resize = vi.fn((size: unknown) => ({ resized: size }));
  const createFromPath = vi.fn((file: string) => ({ file, resize }));
  class FakeTray {
    image: unknown;
    tooltip = '';
    menu: any = null;
    handlers: Record<string, () => void> = {};
    constructor(image: unknown) {
      this.image = image;
      trays.push(this);
    }
    setToolTip(text: string) {
      this.tooltip = text;
    }
    setContextMenu(menu: any) {
      this.menu = menu;
    }
    on(event: string, handler: () => void) {
      this.handlers[event] = handler;
    }
  }
  return { trays, quit, resize, createFromPath, FakeTray };
});

vi.mock('electron', () => ({
  app: { quit: mocks.quit },
  Menu: { buildFromTemplate: (template: any[]) => ({ template }) },
  nativeImage: { createFromPath: mocks.createFromPath },
  Tray: mocks.FakeTray
}));

function reset() {
  mocks.trays.length = 0;
  mocks.quit.mockClear();
  mocks.resize.mockClear();
  mocks.createFromPath.mockClear();
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    iconPath: 'C:/app/tray.png',
    tooltip: '拾字',
    onShow: vi.fn(),
    onQuit: vi.fn(),
    ...overrides
  };
}

describe('createTray', () => {
  beforeEach(reset);

  it('找不到图标时跳过托盘，不抛错', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onShow = vi.fn();
    const onQuit = vi.fn();
    expect(createTray({ iconPath: null, tooltip: '拾字', onShow, onQuit })).toBeNull();
    expect(mocks.trays).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('图标缩放到 16px 并设置 tooltip', () => {
    const tray = createTray(options() as any);
    expect(mocks.createFromPath).toHaveBeenCalledWith('C:/app/tray.png');
    expect(mocks.resize).toHaveBeenCalledWith({ width: 16, height: 16 });
    expect(tray).toBe(mocks.trays[0]);
    expect(mocks.trays[0].tooltip).toBe('拾字');
  });

  it('菜单包含显示/隐藏、退出，并触发回调', () => {
    const opts = options();
    createTray(opts as any);
    const template = mocks.trays[0].menu.template;
    expect(template[0].label).toBe('显示 / 隐藏主窗口');
    expect(template[1].type).toBe('separator');
    expect(template[2].label).toBe('退出');

    template[0].click();
    expect(opts.onShow).toHaveBeenCalledTimes(1);

    template[2].click();
    expect(mocks.quit).toHaveBeenCalledTimes(1);
    expect(opts.onQuit).toHaveBeenCalledTimes(1);
  });

  it('窗口可见时点托盘项改为隐藏', () => {
    const onShow = vi.fn();
    const onHide = vi.fn();
    createTray({ ...options(), onShow, onHide, getVisible: () => true } as any);
    const template = mocks.trays[0].menu.template;
    template[0].click();
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onShow).not.toHaveBeenCalled();
  });

  it('可配置起始页 / 工作台 / 设置 / 检查更新', () => {
    const onStart = vi.fn();
    const onLibrary = vi.fn();
    const onSettings = vi.fn();
    const onCheckUpdate = vi.fn();
    createTray({ ...options(), onStart, onLibrary, onSettings, onCheckUpdate } as any);
    const template = mocks.trays[0].menu.template;
    const labels = template.map((item: any) => item.label || item.type);
    expect(labels).toContain('起始页');
    expect(labels).toContain('工作台');
    expect(labels).toContain('设置');
    expect(labels).toContain('检查更新');
    template.find((item: any) => item.label === '起始页').click();
    template.find((item: any) => item.label === '工作台').click();
    template.find((item: any) => item.label === '设置').click();
    template.find((item: any) => item.label === '检查更新').click();
    expect(onStart).toHaveBeenCalled();
    expect(onLibrary).toHaveBeenCalled();
    expect(onSettings).toHaveBeenCalled();
    expect(onCheckUpdate).toHaveBeenCalled();
  });

  it('双击托盘图标也显示主窗口', () => {
    const opts = options();
    createTray(opts as any);
    mocks.trays[0].handlers['double-click']();
    mocks.trays[0].handlers['click']();
    expect(opts.onShow).toHaveBeenCalledTimes(2);
  });

  it('构造 Tray 抛错时返回 null', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.createFromPath.mockImplementationOnce(() => {
      throw new Error('no image');
    });
    expect(createTray(options() as any)).toBeNull();
    warn.mockRestore();
  });
});
