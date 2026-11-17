import { describe, expect, it } from 'vitest';
import {
  normalizePluginEntry,
  normalizePluginId,
  parsePluginManifest,
  parsePluginSection,
  pluginEntryUrl,
  pluginPanelSection
} from './plugins';

const manifest = {
  id: 'demo.hello',
  name: '示例插件',
  version: '1.0.0',
  description: '演示',
  author: 'tester',
  permissions: ['storage', 'library.read', 'unknown.permission'],
  contributes: {
    panels: [{ id: 'main', title: '示例', icon: '🧩', entry: './ui/index.html' }],
    commands: [{ id: 'run', title: '运行示例' }]
  }
};

describe('插件清单解析', () => {
  it('读取面板、命令和过滤后的权限', () => {
    const parsed = parsePluginManifest(JSON.stringify(manifest));
    expect(parsed.id).toBe('demo.hello');
    expect(parsed.permissions).toEqual(['storage', 'library.read']);
    expect(parsed.panels[0]).toMatchObject({ id: 'main', title: '示例', entry: 'ui/index.html' });
    expect(parsed.commands[0].entry).toBe('index.html?command=run');
  });

  it('id / name 不合法时给出中文错误', () => {
    expect(() => parsePluginManifest(JSON.stringify({ ...manifest, id: 'Bad ID' }))).toThrow('id');
    expect(() => parsePluginManifest(JSON.stringify({ ...manifest, name: '' }))).toThrow('name');
    expect(() => parsePluginManifest('{oops')).toThrow('合法 JSON');
  });

  it('拒绝越界入口、去重并限制数量', () => {
    const parsed = parsePluginManifest(
      JSON.stringify({
        ...manifest,
        contributes: {
          panels: [
            { id: 'a', title: 'A', entry: '../secret.html' },
            { id: 'a', title: 'A2', entry: 'ok.html' },
            { id: 'b', title: 'B' }
          ],
          commands: []
        }
      })
    );
    expect(parsed.panels.map((panel) => panel.id)).toEqual(['a', 'b']);
    // 越界入口回退到默认入口，而不是抛错
    expect(parsed.panels[0].entry).toBe('index.html');
  });

  it('entry 规范化拒绝绝对路径和反斜杠', () => {
    expect(normalizePluginEntry('a/b.html', 'index.html')).toBe('a/b.html');
    expect(normalizePluginEntry('C:\\x.html', 'index.html')).toBe('index.html');
    expect(normalizePluginEntry('/abs.html', 'index.html')).toBe('index.html');
    expect(normalizePluginEntry('a/../b.html', 'index.html')).toBe('index.html');
    expect(normalizePluginEntry('', 'index.html')).toBe('index.html');
  });

  it('id 规范化与 Section 互转', () => {
    expect(normalizePluginId('Demo.Hello')).toBe('demo.hello');
    expect(normalizePluginId('--bad')).toBeNull();
    expect(pluginPanelSection('demo.hello', 'main')).toBe('plugin:demo.hello:main');
    expect(parsePluginSection('plugin:demo.hello:main')).toEqual({
      pluginId: 'demo.hello',
      panelId: 'main'
    });
    expect(parsePluginSection('plugin:broken')).toBeNull();
    expect(pluginEntryUrl('demo.hello', 'ui/index.html')).toBe(
      'shizi-plugin://demo.hello/ui/index.html'
    );
  });
});
