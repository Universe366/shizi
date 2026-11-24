import { describe, expect, it } from 'vitest';
import {
  buildUserAgent,
  closeAction,
  closeChoiceFromDialog,
  launchUrlFromArgv,
  resolveStartUrl,
  startupTarget,
  shortcutAction,
  shouldRestoreSession,
  windowFrameOptions
} from './windowPolicy';

describe('shortcutAction', () => {
  it('只处理 keyDown', () => {
    expect(shortcutAction({ type: 'keyUp', key: 'F11' })).toBeNull();
    expect(shortcutAction({ type: 'char', key: 'Escape' })).toBeNull();
  });

  it('Escape / Esc 退出全屏', () => {
    expect(shortcutAction({ type: 'keyDown', key: 'Escape' })).toBe('exit-fullscreen');
    expect(shortcutAction({ type: 'keyDown', key: 'Esc' })).toBe('exit-fullscreen');
  });

  it('Ctrl 加减号与 0 控制缩放', () => {
    expect(shortcutAction({ type: 'keyDown', key: '=', control: true })).toBe('zoom-in');
    expect(shortcutAction({ type: 'keyDown', key: '+', control: true })).toBe('zoom-in');
    expect(shortcutAction({ type: 'keyDown', key: '-', control: true })).toBe('zoom-out');
    expect(shortcutAction({ type: 'keyDown', key: '_', control: true })).toBe('zoom-out');
    expect(shortcutAction({ type: 'keyDown', key: '0', control: true })).toBe('zoom-reset');
  });

  it('F11 切换全屏', () => {
    expect(shortcutAction({ type: 'keyDown', key: 'F11' })).toBe('toggle-fullscreen');
  });

  it('Ctrl+Shift+Q 退出', () => {
    expect(shortcutAction({ type: 'keyDown', key: 'q', control: true, shift: true })).toBe('quit');
    expect(shortcutAction({ type: 'keyDown', key: 'Q', control: true, shift: true })).toBe('quit');
  });

  it('普通输入不拦截', () => {
    expect(shortcutAction({ type: 'keyDown', key: 'q' })).toBeNull();
    expect(shortcutAction({ type: 'keyDown', key: 'q', control: true })).toBeNull();
    expect(shortcutAction({ type: 'keyDown', key: '=' })).toBeNull();
    expect(shortcutAction({ type: 'keyDown', key: '0' })).toBeNull();
  });
});

describe('windowFrameOptions', () => {
  it('尺寸与安全设置固定', () => {
    const frame = windowFrameOptions({ dark: false, preloadPath: 'C:/app/preload.js' });
    expect(frame.width).toBe(1440);
    expect(frame.height).toBe(920);
    expect(frame.minWidth).toBe(640);
    expect(frame.minHeight).toBe(480);
    // 1920 屏左右分屏是 960，最小宽度必须低于它，否则右侧窗口会被顶住。
    expect(frame.minWidth).toBeLessThanOrEqual(960);
    expect(frame.show).toBe(false);
    expect(frame.autoHideMenuBar).toBe(true);
    expect(frame.webPreferences).toEqual({
      preload: 'C:/app/preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    });
  });

  it('首帧底色跟随深浅色', () => {
    expect(windowFrameOptions({ dark: true, preloadPath: 'p' }).backgroundColor).toBe('#141416');
    expect(windowFrameOptions({ dark: false, preloadPath: 'p' }).backgroundColor).toBe('#f6f6f3');
  });
});

describe('启动参数', () => {
  it('UA 同时带 Chrome 与 Edg 版本', () => {
    const ua = buildUserAgent('140.0.0.0');
    expect(ua).toContain('Chrome/140.0.0.0');
    expect(ua).toContain('Edg/140.0.0.0');
    expect(ua).toContain('Windows NT 10.0');
  });

  it('起始页默认 B 站，可用环境变量覆盖', () => {
    expect(resolveStartUrl({})).toBe('https://www.bilibili.com/');
    expect(resolveStartUrl({ BSUB_START_URL: 'https://example.com/x' })).toBe('https://example.com/x');
    expect(resolveStartUrl({ BSUB_START_URL: '' })).toBe('https://www.bilibili.com/');
  });

  it('只有显式 false 才关闭会话恢复', () => {
    expect(shouldRestoreSession(undefined)).toBe(true);
    expect(shouldRestoreSession({})).toBe(true);
    expect(shouldRestoreSession({ general: {} })).toBe(true);
    expect(shouldRestoreSession({ general: { restoreSession: true } })).toBe(true);
    expect(shouldRestoreSession({ general: { restoreSession: false } })).toBe(false);
  });
});

describe('startupTarget', () => {
  it('默认恢复上次会话', () => {
    expect(startupTarget({ general: {} }, 'https://start')).toEqual({
      restore: true,
      startUrl: 'https://start'
    });
    expect(startupTarget(undefined, 'https://start')).toEqual({
      restore: true,
      startUrl: 'https://start'
    });
  });

  it('start 直接进起始页，url 打开指定网址', () => {
    expect(startupTarget({ general: { startupMode: 'start' } }, 'https://start')).toEqual({
      restore: false,
      startUrl: 'https://start'
    });
    expect(
      startupTarget({ general: { startupMode: 'url', startupUrl: 'https://b.example' } }, 'https://start')
    ).toEqual({ restore: false, startUrl: 'https://b.example' });
  });

  it('指定网址非法时退回恢复会话', () => {
    expect(
      startupTarget({ general: { startupMode: 'url', startupUrl: 'not-a-url' } }, 'https://start')
    ).toEqual({ restore: true, startUrl: 'https://start' });
  });

  it('兼容只有 restoreSession 的老配置', () => {
    expect(startupTarget({ general: { restoreSession: false } }, 'https://start')).toEqual({
      restore: false,
      startUrl: 'https://start'
    });
  });
});

describe('launchUrlFromArgv', () => {
  it('取命令行里的 http(s) 链接', () => {
    expect(launchUrlFromArgv(['C:\\拾字\\拾字.exe', 'https://www.bilibili.com/video/BV1xx'])).toBe(
      'https://www.bilibili.com/video/BV1xx'
    );
    expect(launchUrlFromArgv(['electron', '.', 'http://example.com/a'])).toBe('http://example.com/a');
  });

  it('没有链接或只有开关时返回空串', () => {
    expect(launchUrlFromArgv(['C:\\拾字\\拾字.exe'])).toBe('');
    expect(launchUrlFromArgv(['C:\\拾字\\拾字.exe', '--lang=zh-CN'])).toBe('');
    expect(launchUrlFromArgv([])).toBe('');
  });

  it('忽略非 http(s) 协议', () => {
    expect(launchUrlFromArgv(['file:///C:/a.mp4', 'shizi-plugin://x'])).toBe('');
  });
});

describe('关闭窗口策略', () => {
  it('退出中 / 关掉关闭到托盘 / 对话框等待中都不再询问', () => {
    expect(closeAction({ isQuitting: true, choicePending: false })).toBe('allow');
    expect(closeAction({ isQuitting: false, closeToTray: false, choicePending: false })).toBe('allow');
    expect(closeAction({ isQuitting: false, choicePending: true })).toBe('pending');
  });

  it('默认询问最小化还是退出', () => {
    expect(closeAction({ isQuitting: false, choicePending: false })).toBe('ask');
    expect(closeAction({ isQuitting: false, closeToTray: true, choicePending: false })).toBe('ask');
  });

  it('对话框按钮映射：0 托盘 / 1 退出 / 其他取消', () => {
    expect(closeChoiceFromDialog({ response: 0 })).toBe('tray');
    expect(closeChoiceFromDialog({ response: 1 })).toBe('quit');
    expect(closeChoiceFromDialog({ response: 2 })).toBe('cancel');
    expect(closeChoiceFromDialog({ response: 9 })).toBe('cancel');
  });
});
