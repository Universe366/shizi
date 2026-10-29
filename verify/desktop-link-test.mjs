// 桌面端连接层单测：发现 / 入队 / 去重 / 离线补传 / 快照字段。
// 使用本地 HTTP 服务器 + fake-indexeddb，不依赖真实浏览器。
import http from 'node:http';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';

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
  runtime: { id: 'test-extension' }
};
global.indexedDB = indexedDB;

const { store } = await import('../shizi-extension/src/sidepanel/modules/store.js');
const link = await import('../shizi-extension/src/sidepanel/modules/desktop-link.js');
const storage = await import('../shizi-extension/src/shared/storage.js');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function makeState(port, token, summary = '第一版总结') {
  return {
    settings: {
      desktop: { enabled: true, autoSync: true, port, token },
      ai: { platforms: [{ id: 'deepseek', model: 'deepseek-chat' }], activeId: 'deepseek' }
    },
    video: {
      bvid: 'BV1LINK00001',
      cid: 123,
      title: '连接层测试',
      owner: 'UP',
      duration: 30,
      url: 'https://www.bilibili.com/video/BV1LINK00001',
      signature: 'v:123',
      subtitleMeta: { lang: 'zh-CN', langDoc: '中文' }
    },
    subtitles: [
      { from: 0, to: 1, text: '第一句' },
      { from: 1, to: 2, text: '第二句' }
    ],
    summary,
    subtitleMeta: { lang: 'zh-CN', langDoc: '中文' }
  };
}

function startServer(port, token) {
  const received = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/hello') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          app: 'shizi',
          protocol: 2,
          version: '0.160.0',
          instanceId: 'test-instance',
          port,
          token,
          capabilities: ['ingest', 'events', 'pull']
        })
      );
      return;
    }
    if (req.url === '/v1/library/items') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          items: [
            {
              uid: 'v:BV1LINK00001:123',
              title: '连接层测试',
              owner: 'UP',
              url: 'https://www.bilibili.com/video/BV1LINK00001',
              duration: 30,
              updatedAt: Date.now(),
              summaryPreview: '第一版总结',
              tags: ['测试'],
              collections: [],
              trackCount: 1,
              lineCount: 2
            }
          ],
          total: 1
        })
      );
      return;
    }
    if (req.url === '/v1/events') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      received.push(parsed);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          results: parsed.events.map((event) => ({ id: event.id, ok: true, lineCount: 2 }))
        })
      );
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, received }));
  });
}

const port = 49831;
const token = 'link-test-token';
const state = makeState(port, token);
store.set({ settings: state.settings, video: state.video, subtitles: state.subtitles, summary: state.summary, subtitleMeta: state.subtitleMeta });

// 1. 快照字段
const payload = link.buildSnapshotPayload(store.get());
check('快照带 bvid/cid', payload.video.bvid === 'BV1LINK00001' && payload.video.cid === 123);
check('快照行时间从 from/to 归一', payload.lines[0].start === 0 && payload.lines[0].end === 1);
check('快照带当前模型', payload.model === 'deepseek-chat');

// 2. 发现
let running = await startServer(port, token);
const found = await link.discoverDesktop(port);
check('自动发现桌面端', Boolean(found) && found.port === port && found.protocol === 2);

// 3. 连接 + 入队 + 推送
const conn = await link.ensureLink(true);
check('ensureLink 已连接', conn && conn.state === 'connected');

// 3.1 桌面库镜像
const synced = await link.syncLibrary();
check('拉取桌面库镜像', synced.ok === true && synced.items === 1, JSON.stringify(synced));
check('镜像写入 store', (store.get().desktopLibrary?.items || []).length === 1);
check('镜像写入 IndexedDB', (await storage.libraryAll()).length === 1);
const queued = await link.queueSnapshot(store.get());
check('保存后自动入队', queued.queued === true);
let rows = await storage.outboxAll();
check('队列写入一条', rows.length === 1);

const first = await link.flushOutbox({ force: true });
check('推送成功并清空队列', first.pushed === 1 && first.pending === 0, JSON.stringify(first));
check('桌面端收到 history.upsert', running.received[0]?.events?.[0]?.type === 'history.upsert');
rows = await storage.outboxAll();
check('推送后队列为空', rows.length === 0);

// 4. 内容没变不再入队
const unchanged = await link.queueSnapshot(store.get());
check('内容未变不重复入队', unchanged.queued === false && unchanged.reason === 'unchanged');

// 5. 离线：入队但发不出去，桌面端回来后补传
running.server.close();
await new Promise((resolve) => setTimeout(resolve, 50));
const offlineMirror = await link.syncLibrary();
check(
  '离线时保留库镜像',
  offlineMirror.ok === false && (store.get().desktopLibrary?.items || []).length === 1,
  JSON.stringify(offlineMirror)
);
store.set({ summary: '第二版总结' });
const offlineQueued = await link.queueSnapshot(store.get(), { force: true });
check('离线仍入队', offlineQueued.queued === true);
const offlineFlush = await link.flushOutbox();
check('离线推送失败但保留', offlineFlush.pushed === 0 && offlineFlush.pending === 1, JSON.stringify(offlineFlush));

running = await startServer(port, token);
await link.ensureLink(true);
const retry = await link.flushOutbox({ force: true });
check('桌面端恢复后补传', retry.pushed === 1 && retry.pending === 0, JSON.stringify(retry));
check('补传的是新总结', running.received[0]?.events?.[0]?.payload?.summary === '第二版总结');

running.server.close();
await new Promise((resolve) => setTimeout(resolve, 100));

console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
