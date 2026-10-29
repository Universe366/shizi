// 模拟「浏览器插件 → 桌面端」的推送，验证桥协议。
// 用法：node scripts/mocks/bridge-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const settingsPath =
  process.env.BSUB_BRIDGE_SETTINGS ||
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Electron', 'settings.json');

let settings = null;
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch (error) {
  console.error('[bridge-test] 读不到设置文件:', settingsPath, error.message);
  process.exit(1);
}

const port = Number(settings?.bridge?.port) || 47821;
const token = String(settings?.bridge?.token || '');
if (!token) {
  console.error('[bridge-test] settings.json 里没有 bridge.token，先启动一次桌面端');
  process.exit(1);
}

const base = `http://127.0.0.1:${port}`;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

const payload = {
  protocolVersion: 1,
  clientId: 'bridge-test',
  browserKind: 'chrome',
  extensionVersion: '2.16.2',
  video: {
    bvid: 'BV1TEST00001',
    cid: 999000001,
    title: '插件桥测试视频',
    owner: '测试 UP',
    duration: 120,
    url: 'https://www.bilibili.com/video/BV1TEST00001',
    cover: ''
  },
  track: {
    lan: 'zh-CN',
    lanDoc: '中文',
    source: 'extension-test',
    isAi: false,
    url: 'extension://bridge-test'
  },
  lines: [
    { start: 0, end: 1.5, text: '这是从插件推到桌面端的第一句。' },
    { start: 1.5, end: 3.2, text: '这是第二句，用来验证入库链路。' }
  ],
  summary: '## 桥接测试\n- 插件的字幕与总结已经写入桌面库。'
};

const health = await fetch(`${base}/v1/health`, { headers });
console.log('[bridge-test] health', health.status, await health.text());

const response = await fetch(`${base}/v1/ingest`, {
  method: 'POST',
  headers,
  body: JSON.stringify(payload)
});
console.log('[bridge-test] ingest', response.status, await response.text());

const unauthorized = await fetch(`${base}/v1/health`);
console.log('[bridge-test] unauthorized', unauthorized.status);

// v2：批量事件 + 幂等 + 下行拉取
const eventId = `bridge-test-${Date.now()}`;
const v2Payload = {
  protocol: 2,
  client: { id: 'bridge-test', browser: 'chrome', version: '2.19.0' },
  events: [
    {
      id: eventId,
      type: 'history.upsert',
      payload: {
        video: {
          bvid: 'BV1TEST00002',
          cid: 999000002,
          title: '桥协议 v2 测试视频',
          owner: '测试 UP',
          duration: 60,
          url: 'https://www.bilibili.com/video/BV1TEST00002'
        },
        track: { lan: 'zh-CN', lanDoc: '中文', source: 'extension-test', isAi: false },
        lines: [
          { start: 0, end: 1, text: 'v2 第一句。' },
          { start: 1, end: 2, text: 'v2 第二句。' }
        ],
        summary: '## v2\n- events 接口可用。'
      }
    }
  ]
};
const eventsRes = await fetch(`${base}/v1/events`, {
  method: 'POST',
  headers,
  body: JSON.stringify(v2Payload)
});
console.log('[bridge-test] events', eventsRes.status, await eventsRes.text());

const duplicateRes = await fetch(`${base}/v1/events`, {
  method: 'POST',
  headers,
  body: JSON.stringify(v2Payload)
});
console.log('[bridge-test] events-duplicate', duplicateRes.status, await duplicateRes.text());

const pullRes = await fetch(`${base}/v1/pull?since=0&wait=0`, { headers });
console.log('[bridge-test] pull', pullRes.status, await pullRes.text());

const badType = await fetch(`${base}/v1/events`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    protocol: 2,
    events: [{ id: 'bad', type: 'nope', payload: { video: {} } }]
  })
});
console.log('[bridge-test] bad-event', badType.status, await badType.text());
