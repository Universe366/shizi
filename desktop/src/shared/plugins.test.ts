import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  mergeMarketItems,
  normalizePluginEntry,
  normalizePluginId,
  parsePluginManifest,
  parsePluginMarket,
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

  it('解析市场索引：支持数组与 { plugins }，坏条目丢弃', () => {
    const entries = parsePluginMarket(
      JSON.stringify({
        plugins: [
          {
            id: 'demo.market',
            name: '市场插件',
            version: '1.2.0',
            zip: 'https://example.com/demo.zip',
            sha256: 'A'.repeat(64),
            minAppVersion: '0.163.0',
            homepage: 'https://example.com',
            tags: ['bilibili', '笔记']
          },
          { id: 'demo.market', name: '重复', zip: 'https://example.com/x.zip' },
          { id: 'bad id', name: '坏 id', zip: 'https://example.com/x.zip' },
          { id: 'no.zip', name: '相对地址', zip: './demo.zip' }
        ]
      })
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'demo.market',
      version: '1.2.0',
      sha256: 'a'.repeat(64),
      minAppVersion: '0.163.0',
      tags: ['bilibili', '笔记']
    });

    expect(parsePluginMarket('[]')).toEqual([]);
    expect(() => parsePluginMarket('{oops')).toThrow('合法 JSON');
  });

  it('合并已安装版本并标出可更新', () => {
    const entries = parsePluginMarket(
      JSON.stringify([
        { id: 'a.one', name: 'A', version: '2.0.0', zip: 'https://e.test/a.zip' },
        { id: 'b.two', name: 'B', version: '1.0.0', zip: 'https://e.test/b.zip' }
      ])
    );
    const merged = mergeMarketItems(entries, [{ id: 'a.one', version: '1.0.0' }], '0.163.0');
    expect(merged[0]).toMatchObject({
      installedVersion: '1.0.0',
      updateAvailable: true,
      compatible: true
    });
    expect(merged[1]).toMatchObject({ installedVersion: '', updateAvailable: false });
  });

  it('最低版本门槛与版本比较', () => {
    const entries = parsePluginMarket(
      JSON.stringify([
        {
          id: 'new.app',
          name: '新版本插件',
          version: '1.0.0',
          zip: 'https://e.test/n.zip',
          minAppVersion: '0.200.0'
        }
      ])
    );
    expect(mergeMarketItems(entries, [], '0.163.0')[0].compatible).toBe(false);
    expect(mergeMarketItems(entries, [], '0.200.0')[0].compatible).toBe(true);
    expect(compareVersions('0.163.0', '0.162.57')).toBe(1);
    expect(compareVersions('0.162.57', '0.163.0')).toBe(-1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
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
