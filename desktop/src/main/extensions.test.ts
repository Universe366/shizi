import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({
  loaded: new Map<string, string>(),
  removed: [] as string[],
  failPaths: new Set<string>(),
  seq: 0,
  dir: ''
}));

vi.mock('electron', () => ({
  app: { getPath: () => electronState.dir },
  session: {
    defaultSession: {
      loadExtension: async (extensionPath: string) => {
        if (electronState.failPaths.has(extensionPath)) throw new Error('扩展被拒绝加载');
        const existing = electronState.loaded.get(extensionPath);
        if (existing) throw new Error('扩展已经加载');
        const id = `chrome-${++electronState.seq}`;
        electronState.loaded.set(extensionPath, id);
        return { id, path: extensionPath };
      },
      removeExtension: (id: string) => {
        electronState.removed.push(id);
        for (const [key, value] of electronState.loaded) {
          if (value === id) electronState.loaded.delete(key);
        }
      }
    }
  },
  shell: { showItemInFolder: vi.fn() }
}));

const settingsState = vi.hoisted(() => ({
  value: { extensions: { enabled: true, items: [] as unknown[] } } as {
    extensions: { enabled: boolean; items: Record<string, unknown>[] };
  }
}));

vi.mock('./settings', () => ({
  loadSettings: () => settingsState.value,
  saveSettings: (next: typeof settingsState.value) => {
    settingsState.value = next;
    return next;
  }
}));

import {
  addBrowserExtension,
  addBrowserExtensionFromArchive,
  listBrowserExtensions,
  loadBrowserExtensions,
  readExtensionManifest,
  removeBrowserExtension,
  revealBrowserExtension,
  setBrowserExtensionEnabled,
  setBrowserExtensionsEnabled
} from './extensions';
import { makeCrx3Fixture, makeZipFixture } from './zipFixture';

const tempDirs: string[] = [];

function makeExtension(name = '示例扩展', manifestVersion = 3): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-ext-'));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      manifest_version: manifestVersion,
      name,
      version: '1.2.3',
      background: { service_worker: 'sw.js' }
    })
  );
  return dir;
}

const makeZip = makeZipFixture;
const makeCrx3 = makeCrx3Fixture;

beforeEach(() => {
  electronState.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-ext-data-'));
  electronState.loaded.clear();
  electronState.removed.length = 0;
  electronState.failPaths.clear();
  electronState.seq = 0;
  settingsState.value = { extensions: { enabled: true, items: [] } };
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (electronState.dir) fs.rmSync(electronState.dir, { recursive: true, force: true });
});

describe('readExtensionManifest', () => {
  it('读取 MV3 扩展的名称和版本', () => {
    expect(readExtensionManifest(makeExtension('日志助手'))).toEqual({
      name: '日志助手',
      version: '1.2.3',
      manifestVersion: 3
    });
  });

  it('MV2 也能识别（是否加载由 Chromium 决定）', () => {
    expect(readExtensionManifest(makeExtension('老扩展', 2)).manifestVersion).toBe(2);
  });

  it('缺少 manifest.json / 非法 JSON / 版本不对都给出中文错误', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-ext-'));
    tempDirs.push(empty);
    expect(() => readExtensionManifest(empty)).toThrow('manifest.json');

    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-ext-'));
    tempDirs.push(broken);
    fs.writeFileSync(path.join(broken, 'manifest.json'), '{ not json');
    expect(() => readExtensionManifest(broken)).toThrow('合法 JSON');

    const wrong = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-ext-'));
    tempDirs.push(wrong);
    fs.writeFileSync(path.join(wrong, 'manifest.json'), JSON.stringify({ manifest_version: 4, name: 'x', version: '1' }));
    expect(() => readExtensionManifest(wrong)).toThrow('manifest_version');
  });
});

describe('扩展生命周期', () => {
  it('添加后写入设置并加载', async () => {
    const dir = makeExtension();
    const result = await addBrowserExtension(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.loaded).toBe(true);
    expect(result.data.name).toBe('示例扩展');
    expect(settingsState.value.extensions.items).toHaveLength(1);
    expect(listBrowserExtensions().items[0].loaded).toBe(true);
  });

  it('重复添加同一目录不会产生第二条记录', async () => {
    const dir = makeExtension();
    const first = await addBrowserExtension(dir);
    const second = await addBrowserExtension(dir);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.id).toBe(first.data.id);
    expect(settingsState.value.extensions.items).toHaveLength(1);
  });

  it('停用会卸载，重新启用会再次加载', async () => {
    const dir = makeExtension();
    const added = await addBrowserExtension(dir);
    if (!added.ok) throw new Error(added.error);

    const off = await setBrowserExtensionEnabled(added.data.id, false);
    expect(off.ok && off.data.loaded).toBe(false);
    expect(electronState.removed).toHaveLength(1);

    const on = await setBrowserExtensionEnabled(added.data.id, true);
    expect(on.ok && on.data.loaded).toBe(true);
    expect(electronState.loaded.size).toBe(1);
  });

  it('总开关关闭时全部卸载，重新打开时按列表恢复', async () => {
    const dir = makeExtension();
    await addBrowserExtension(dir);

    const off = await setBrowserExtensionsEnabled(false);
    expect(off.ok && off.data.enabled).toBe(false);
    expect(off.ok && off.data.items[0].loaded).toBe(false);

    const on = await setBrowserExtensionsEnabled(true);
    expect(on.ok && on.data.enabled).toBe(true);
    expect(on.ok && on.data.items[0].loaded).toBe(true);
  });

  it('移除会卸载并从设置里删除', async () => {
    const dir = makeExtension();
    const added = await addBrowserExtension(dir);
    if (!added.ok) throw new Error(added.error);
    const removed = removeBrowserExtension(added.data.id);
    expect(removed.ok).toBe(true);
    expect(settingsState.value.extensions.items).toHaveLength(0);
    expect(electronState.loaded.size).toBe(0);
  });

  it('加载失败时保留条目并显示错误，不影响其它扩展', async () => {
    const broken = makeExtension('坏扩展');
    const good = makeExtension('好扩展');
    electronState.failPaths.add(broken);

    const first = await addBrowserExtension(broken);
    const second = await addBrowserExtension(good);
    expect(first.ok && first.data.loaded).toBe(false);
    expect(first.ok && first.data.error).toContain('拒绝');
    expect(second.ok && second.data.loaded).toBe(true);
    expect(settingsState.value.extensions.items).toHaveLength(2);
  });

  it('启动加载只处理启用的扩展，单个失败不抛出', async () => {
    const good = makeExtension('好扩展');
    const broken = makeExtension('坏扩展');
    electronState.failPaths.add(broken);
    settingsState.value.extensions.items = [
      { id: 'a', path: good, name: '好扩展', version: '1', manifestVersion: 3, enabled: true, addedAt: 1 },
      { id: 'b', path: broken, name: '坏扩展', version: '1', manifestVersion: 3, enabled: true, addedAt: 2 }
    ];
    await expect(loadBrowserExtensions()).resolves.toBeUndefined();
    const items = listBrowserExtensions().items;
    expect(items.find((item) => item.id === 'a')?.loaded).toBe(true);
    expect(items.find((item) => item.id === 'b')?.error).toContain('拒绝');
  });

  it('定位扩展目录不会因为文件不存在而抛出', async () => {
    const dir = makeExtension();
    const added = await addBrowserExtension(dir);
    if (!added.ok) throw new Error(added.error);
    expect(revealBrowserExtension(added.data.id).ok).toBe(true);
    expect(revealBrowserExtension('missing').ok).toBe(false);
  });
});

describe('从压缩包安装扩展', () => {
  const manifest = JSON.stringify({
    manifest_version: 3,
    name: '压缩包扩展',
    version: '2.0.0',
    background: { service_worker: 'sw.js' }
  });

  it('zip 会解压到 userData/extensions 并加载', async () => {
    const zip = makeZip([
      ['manifest.json', manifest],
      ['sw.js', '']
    ]);
    const file = path.join(electronState.dir, 'demo.zip');
    fs.writeFileSync(file, zip);

    const result = await addBrowserExtensionFromArchive(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe('压缩包扩展');
    expect(result.data.path).toContain(path.join(electronState.dir, 'extensions'));
    expect(result.data.loaded).toBe(true);
  });

  it('crx3 剥掉签名头后同样能安装', async () => {
    const zip = makeZip([
      ['manifest.json', manifest],
      ['sw.js', '']
    ]);
    const file = path.join(electronState.dir, 'demo.crx');
    fs.writeFileSync(file, makeCrx3(zip));

    const result = await addBrowserExtensionFromArchive(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.loaded).toBe(true);
  });

  it('非压缩包与缺失 manifest 都会失败且不留目录', async () => {
    const textFile = path.join(electronState.dir, 'x.zip');
    fs.writeFileSync(textFile, 'not a zip');
    expect((await addBrowserExtensionFromArchive(textFile)).ok).toBe(false);

    const emptyZip = path.join(electronState.dir, 'empty.zip');
    fs.writeFileSync(emptyZip, makeZip([['readme.txt', 'no manifest']]));
    const result = await addBrowserExtensionFromArchive(emptyZip);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('manifest.json');
    const leftover = fs.existsSync(path.join(electronState.dir, 'extensions'))
      ? fs.readdirSync(path.join(electronState.dir, 'extensions'))
      : [];
    expect(leftover).toHaveLength(0);
  });
});
