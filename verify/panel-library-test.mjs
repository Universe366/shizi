// 「库」面板渲染单测：不依赖真实桌面端，只验证列表/搜索/空态。
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';

const dom = new JSDOM('<!doctype html><div id="host"></div><div id="overlay-root"></div>', {
  url: 'https://example.com/panel'
});
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.location = dom.window.location;
global.indexedDB = indexedDB;

const memory = {};
global.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === 'string') return key in memory ? { [key]: memory[key] } : {};
        return { ...memory };
      },
      async set(patch) {
        Object.assign(memory, patch);
      }
    }
  },
  runtime: { id: 'test-extension', sendMessage: (_msg, cb) => cb && cb({ ok: true }) }
};

global.fetch = async (url) => {
  if (String(url).includes('/v1/hello')) {
    return new Response(
      JSON.stringify({
        ok: true,
        app: 'shizi',
        protocol: 2,
        version: '0.160.0',
        instanceId: 'panel-test',
        port: 49901,
        token: 'panel-token',
        capabilities: ['events', 'pull', 'library.read']
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
  if (String(url).includes('/v1/library/item')) {
    return new Response(
      JSON.stringify({
        ok: true,
        item: {
          uid: 'v:BV1LIB00001:9',
          title: '库面板测试视频',
          owner: '测试 UP',
          duration: 125
        },
        summary: { content: '# 桌面总结\n\n- 一条结论', model: 'mock', updatedAt: 1000 },
        note: null,
        tracks: []
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
  return new Response(JSON.stringify({ ok: false, error: 'not found' }), { status: 404 });
};

const { store } = await import('../shizi-extension/src/sidepanel/modules/store.js');
const link = await import('../shizi-extension/src/sidepanel/modules/desktop-link.js');
const panel = await import('../shizi-extension/src/sidepanel/modules/panel-library.js');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const host = document.getElementById('host');
store.set({
  settings: {
    desktop: { enabled: true, autoSync: true, port: 49901, token: 'panel-token' },
    ai: { platforms: [], activeId: '' }
  },
  desktopLibrary: {
    items: [
      {
        uid: 'v:BV1LIB00001:9',
        title: '库面板测试视频',
        owner: '测试 UP',
        duration: 125,
        tags: ['标签A'],
        collections: ['合集A'],
        summaryPreview: '这是一段总结摘要',
        lineCount: 240,
        trackCount: 1,
        url: 'https://www.bilibili.com/video/BV1LIB00001'
      },
      {
        uid: 'v:BV1LIB00002:9',
        title: '第二条',
        owner: '另一个 UP',
        duration: 60,
        tags: [],
        collections: [],
        summaryPreview: '',
        lineCount: 10,
        trackCount: 1,
        url: 'https://www.bilibili.com/video/BV1LIB00002'
      }
    ],
    total: 2,
    syncedAt: Date.now(),
    offline: false,
    error: ''
  }
});

await link.ensureLink(true);
panel.init(host);
const text = host.textContent;
check('渲染标题', text.includes('库面板测试视频'));
check('渲染 UP 与时长', text.includes('测试 UP') && text.includes('02:05'), text.slice(0, 100));
check('渲染标签与合集', text.includes('标签A') && text.includes('合集A'));
check('渲染总结摘要', text.includes('这是一段总结摘要'));
check('渲染两条', host.querySelectorAll('.lib-row').length === 2);
check('显示条数', text.includes('2 条'));

// 详情浮层（读桌面端 /v1/library/item）
host.querySelector('.lib-title').click();
await new Promise((resolve) => setTimeout(resolve, 80));
check(
  '点击标题打开详情浮层',
  document.getElementById('overlay-root').textContent.includes('桌面总结') &&
    document.getElementById('overlay-root').textContent.includes('一条结论'),
  document.getElementById('overlay-root').textContent.slice(0, 120)
);

// 搜索过滤
const input = host.querySelector('.lib-search');
input.value = '第二条';
input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
check('搜索过滤生效', host.querySelectorAll('.lib-row').length === 1);
check('过滤后保留匹配项', host.textContent.includes('第二条') && !host.textContent.includes('库面板测试视频'));

// 搜不到 -> 空态
input.value = '不存在的关键词';
input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
check('无匹配显示空态', host.textContent.includes('没有匹配的条目'));

// 空库（先清掉搜索词，否则会显示「没有匹配的条目」）
const inputNow = host.querySelector('.lib-search');
inputNow.value = '';
inputNow.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
store.set({
  desktopLibrary: { items: [], total: 0, syncedAt: 0, offline: true, error: '未连接桌面端' }
});
check(
  '空库显示引导',
  host.textContent.includes('还没有桌面库缓存') || host.textContent.includes('桌面库还是空的')
);

console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
