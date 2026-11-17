import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  dir: '',
  zip: null as Uint8Array | null,
  marketText: '',
  handler: null as ((request: Request) => Promise<Response>) | null,
  settings: {
    general: {
      theme: 'dark',
      accentColor: '#123456',
      colorScheme: 'slate',
      density: 'comfortable',
      fontScale: 1
    },
    plugins: { marketUrl: 'https://example.com/market.json' }
  }
}));

vi.mock('electron', () => ({
  app: { getPath: () => state.dir, getVersion: () => '9.9.9' },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: (_scheme: string, handler: (request: Request) => Promise<Response>) => {
      state.handler = handler;
    }
  },
  session: {
    defaultSession: {
      fetch: vi.fn(async () => {
        if (state.marketText) return new Response(state.marketText, { status: 200 });
        if (state.zip) return new Response(state.zip as never, { status: 200 });
        return new Response('remote-ok', { status: 200 });
      })
    }
  },
  shell: { showItemInFolder: vi.fn() }
}));

vi.mock('./settings', () => ({
  loadSettings: () => state.settings,
  saveSettings: (next: typeof state.settings) => {
    state.settings = next;
    return next;
  }
}));
vi.mock('./library/videos', () => ({
  listLibrary: () => ({ videos: [], stats: {}, total: 0 })
}));
vi.mock('./library/search', () => ({
  searchLibrary: () => ({ query: '', total: 0, matches: [], videos: [], mode: 'like' })
}));
vi.mock('./page', () => ({ getPageInfo: async () => null }));

import {
  fetchPluginMarket,
  installPluginFromArchive,
  installPluginFromDir,
  installPluginFromUrl,
  installPluginProtocol,
  listPlugins,
  pluginMarketUrl,
  pluginRpc,
  readRegistry,
  removePlugin,
  setPluginEnabled,
  setPluginMarketUrl
} from './plugins';

/** 生成 STORE 压缩的 ZIP（测试用，不引入解压依赖）。 */
function makeZip(entries: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [entryName, content] of entries) {
    const name = Buffer.from(entryName, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

const tempDirs: string[] = [];

function makePlugin(
  manifest: Record<string, unknown> = {},
  files: Record<string, string> = { 'index.html': '<h1>hello</h1>' }
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-plugin-'));
  tempDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      id: 'demo.plugin',
      name: '演示插件',
      version: '1.0.0',
      permissions: ['storage'],
      contributes: { panels: [{ id: 'main', title: '演示' }] },
      ...manifest
    })
  );
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

beforeAll(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-userdata-'));
  installPluginProtocol();
});

beforeEach(() => {
  fs.rmSync(path.join(state.dir, 'plugins'), { recursive: true, force: true });
  state.marketText = '';
  state.zip = null;
  state.settings.plugins.marketUrl = 'https://example.com/market.json';
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(state.dir, { recursive: true, force: true });
});

describe('插件安装与登记', () => {
  it('安装后复制到 userData/plugins 并登记', () => {
    const source = makePlugin();
    const result = installPluginFromDir(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe('demo.plugin');
    expect(result.data.enabled).toBe(true);
    expect(fs.existsSync(path.join(state.dir, 'plugins', 'demo.plugin', 'index.html'))).toBe(true);
    expect(listPlugins()).toHaveLength(1);
    expect(readRegistry().plugins[0].manifest.name).toBe('演示插件');
  });

  it('入口文件不存在时拒绝安装', () => {
    const source = makePlugin({ contributes: { panels: [{ id: 'main', entry: 'missing.html' }] } });
    const result = installPluginFromDir(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('入口文件不存在');
  });

  it('没有面板和命令时拒绝安装', () => {
    const source = makePlugin({ contributes: {} });
    const result = installPluginFromDir(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('面板或命令');
  });

  it('重复安装同一 id 只保留一条记录并更新版本', () => {
    installPluginFromDir(makePlugin());
    const updated = makePlugin({ version: '2.0.0' });
    const result = installPluginFromDir(updated);
    expect(result.ok).toBe(true);
    expect(listPlugins()).toHaveLength(1);
    expect(listPlugins()[0].version).toBe('2.0.0');
  });

  it('停用与移除', () => {
    const result = installPluginFromDir(makePlugin());
    if (!result.ok) throw new Error(result.error);
    expect(setPluginEnabled('demo.plugin', false).ok).toBe(true);
    expect(listPlugins()[0].enabled).toBe(false);
    expect(removePlugin('demo.plugin').ok).toBe(true);
    expect(listPlugins()).toHaveLength(0);
    expect(fs.existsSync(path.join(state.dir, 'plugins', 'demo.plugin'))).toBe(false);
  });
});

describe('插件协议', () => {
  it('按 id 提供静态文件并带 CSP', async () => {
    installPluginFromDir(makePlugin());
    const handler = state.handler;
    expect(handler).toBeTypeOf('function');
    const response = await handler!(new Request('shizi-plugin://demo.plugin/index.html'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(await response.text()).toContain('hello');
  });

  it('未安装 / 未启用 / 越界路径都拒绝', async () => {
    const installed = installPluginFromDir(makePlugin());
    if (!installed.ok) throw new Error(installed.error);
    const handler = state.handler!;

    expect((await handler(new Request('shizi-plugin://other.plugin/index.html'))).status).toBe(404);
    // 编码过的 .. 会被 URL 解析器折叠掉，落到目录内 → 404（安全）；
    // 编码斜杠保留下来，真正越界时必须 403。
    expect(
      (await handler(new Request('shizi-plugin://demo.plugin/%2e%2e/%2e%2e/secret.txt'))).status
    ).toBe(404);
    expect(
      (await handler(new Request('shizi-plugin://demo.plugin/..%2f..%2fsecret.txt'))).status
    ).toBe(403);

    setPluginEnabled('demo.plugin', false);
    expect((await handler(new Request('shizi-plugin://demo.plugin/index.html'))).status).toBe(404);
  });
});

describe('插件 RPC', () => {
  const tabs = {} as never;

  it('未申请权限的能力直接拒绝', async () => {
    const source = makePlugin({ permissions: ['storage'] });
    installPluginFromDir(source);
    const result = await pluginRpc('demo.plugin', 'net.fetch', { url: 'https://a.test' }, tabs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('net.fetch');
  });

  it('storage 读写按插件隔离', async () => {
    installPluginFromDir(makePlugin());
    expect((await pluginRpc('demo.plugin', 'storage.set', { key: 'a', value: 1 }, tabs)).ok).toBe(
      true
    );
    const read = await pluginRpc('demo.plugin', 'storage.get', { key: 'a' }, tabs);
    expect(read).toEqual({ ok: true, data: 1 });
    const all = await pluginRpc('demo.plugin', 'storage.get', {}, tabs);
    expect(all).toEqual({ ok: true, data: { a: 1 } });
    expect((await pluginRpc('demo.plugin', 'storage.remove', { key: 'a' }, tabs)).ok).toBe(true);
  });

  it('app.info / theme.get 无需权限', async () => {
    installPluginFromDir(makePlugin());
    const info = await pluginRpc('demo.plugin', 'app.info', {}, tabs);
    expect(info).toMatchObject({ ok: true, data: { version: '9.9.9' } });
    const theme = await pluginRpc('demo.plugin', 'theme.get', {}, tabs);
    expect(theme).toMatchObject({ ok: true, data: { theme: 'dark', accentColor: '#123456' } });
  });

  it('未知方法、未启用插件、不存在的插件都返回错误', async () => {
    installPluginFromDir(makePlugin());
    const unknown = await pluginRpc('demo.plugin', 'shell.exec', {}, tabs);
    expect(unknown.ok).toBe(false);

    setPluginEnabled('demo.plugin', false);
    const disabled = await pluginRpc('demo.plugin', 'app.info', {}, tabs);
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.error).toContain('未启用');

    const missing = await pluginRpc('nope.nope', 'app.info', {}, tabs);
    expect(missing.ok).toBe(false);
  });
});

describe('从 zip 安装插件', () => {
  it('zip 内套一层目录也能识别 manifest 并安装', () => {
    const zip = makeZip([
      [
        'demo/manifest.json',
        JSON.stringify({
          id: 'zip.demo',
          name: 'Zip 插件',
          version: '1.0.0',
          contributes: { panels: [{ id: 'main', title: '面板' }] }
        })
      ],
      ['demo/index.html', '<h1>zip</h1>']
    ]);
    const file = path.join(state.dir, 'demo.zip');
    fs.writeFileSync(file, zip);

    const result = installPluginFromArchive(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe('zip.demo');
    expect(fs.existsSync(path.join(state.dir, 'plugins', 'zip.demo', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(state.dir, 'plugins-tmp'))).toBe(false);
  });

  it('从 http(s) 链接下载 zip 并安装', async () => {
    state.zip = makeZip([
      [
        'remote/manifest.json',
        JSON.stringify({
          id: 'remote.demo',
          name: '远程插件',
          version: '1.0.0',
          contributes: { panels: [{ id: 'main', title: '面板' }] }
        })
      ],
      ['remote/index.html', '<h1>remote</h1>']
    ]);
    const result = await installPluginFromUrl('https://example.com/plugin.zip');
    state.zip = null;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe('remote.demo');
    expect(fs.existsSync(path.join(state.dir, 'plugins', 'remote.demo', 'index.html'))).toBe(true);
  });

  it('市场安装会校验 sha256', async () => {
    const zip = makeZip([
      [
        'checked/manifest.json',
        JSON.stringify({
          id: 'checked.demo',
          name: '校验插件',
          version: '1.0.0',
          contributes: { panels: [{ id: 'main', title: '面板' }] }
        })
      ],
      ['checked/index.html', '<h1>checked</h1>']
    ]);
    const hash = createHash('sha256').update(zip).digest('hex');
    state.zip = zip;

    const wrong = await installPluginFromUrl('https://example.com/p.zip', '0'.repeat(64));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain('sha256');

    const good = await installPluginFromUrl('https://example.com/p.zip', hash);
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.data.id).toBe('checked.demo');
  });

  it('非 http(s) 链接被拒绝', async () => {
    const result = await installPluginFromUrl('file:///c:/plugin.zip');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('http(s)');
  });

  it('没有 manifest 的压缩包失败且不留下插件', () => {
    const zip = makeZip([['readme.txt', 'nothing']]);
    const file = path.join(state.dir, 'empty.zip');
    fs.writeFileSync(file, zip);
    const result = installPluginFromArchive(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('manifest.json');
    expect(listPlugins()).toHaveLength(0);
  });
});

describe('插件市场', () => {
  it('拉取索引并合并已安装版本', async () => {
    installPluginFromDir(makePlugin({ version: '1.0.0' }));
    state.marketText = JSON.stringify({
      plugins: [
        {
          id: 'demo.plugin',
          name: '演示插件',
          version: '2.0.0',
          zip: 'https://example.com/demo.zip'
        },
        {
          id: 'new.plugin',
          name: '新插件',
          version: '1.0.0',
          zip: 'https://example.com/new.zip'
        }
      ]
    });

    const result = await fetchPluginMarket();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toHaveLength(2);
    expect(result.data.entries[0]).toMatchObject({
      id: 'demo.plugin',
      installedVersion: '1.0.0',
      updateAvailable: true
    });
    expect(result.data.entries[1]).toMatchObject({
      id: 'new.plugin',
      installedVersion: '',
      updateAvailable: false
    });
    expect(result.data.source).toContain('market.json');
  });

  it('地址校验与保存', () => {
    expect(setPluginMarketUrl('file:///c:/x.json').ok).toBe(false);
    expect(setPluginMarketUrl('https://example.com/list.json').ok).toBe(true);
    expect(pluginMarketUrl()).toBe('https://example.com/list.json');
    expect(setPluginMarketUrl('').ok).toBe(true);
    expect(pluginMarketUrl()).toBe('');
  });

  it('没有配置地址时不发请求', async () => {
    setPluginMarketUrl('');
    const result = await fetchPluginMarket();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('市场地址');
  });

  it('索引不是 JSON 时给出错误', async () => {
    state.marketText = 'not json';
    const result = await fetchPluginMarket();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('JSON');
  });
});
