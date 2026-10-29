// 真实 Electron 的桥协议 E2E：启动临时实例，验证 v2 发现 / 事件 / 幂等 / 下行 / 鉴权。
// 用法：node scripts/mocks/bridge-e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..', '..');
const electron = (() => {
  try {
    return require('electron');
  } catch {
    return path.join(desktop, 'node_modules', 'electron', 'dist', 'electron.exe');
  }
})();

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-bridge-e2e-'));
const basePort = await freePort();
const aiPort = await freePort();

// 最小 OpenAI 兼容 mock：只验证 RPC 能把桌面端总结链路跑通。
const AI_TEXT = '## 桌面 RPC 总结\n\n- 通过桌面端生成。\n- 用于桥接 E2E。';
const mockAi = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        /* ignore */
      }
      if (!payload.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: AI_TEXT } }],
            usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
          })
        );
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });
      const chunks = AI_TEXT.match(/[\s\S]{1,8}/g) || [];
      let index = 0;
      const timer = setInterval(() => {
        if (index >= chunks.length) {
          res.write('data: [DONE]\n\n');
          clearInterval(timer);
          res.end();
          return;
        }
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: chunks[index++] } }] })}\n\n`
        );
      }, 5);
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
await new Promise((resolve) => mockAi.listen(aiPort, '127.0.0.1', resolve));

fs.writeFileSync(
  path.join(userData, 'settings.json'),
  JSON.stringify(
    {
      bridge: { enabled: true, port: basePort, token: 'e2e-token' },
      ai: {
        platforms: [
          {
            id: 'mock',
            name: 'Mock AI',
            baseUrl: `http://127.0.0.1:${aiPort}/v1`,
            apiKey: 'test-key',
            model: 'mock-model',
            enabled: true
          }
        ],
        activeId: 'mock'
      }
    },
    null,
    2
  )
);

const env = { ...process.env, BSUB_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.'], { cwd: desktop, env, stdio: 'ignore', windowsHide: true });

function stop() {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    /* ignore */
  }
  try {
    mockAi.closeAllConnections?.();
    mockAi.close();
  } catch {
    /* ignore */
  }
}

async function waitForHello(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let offset = 0; offset < 10; offset += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${basePort + offset}/v1/hello`, {
          cache: 'no-store'
        });
        if (response.ok) {
          const data = await response.json();
          if (data && data.app === 'shizi') return { port: data.port || basePort + offset, data };
        }
      } catch {
        /* not ready */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('等待桌面端桥超时');
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
}

try {
  const { port, data: hello } = await waitForHello();
  const base = `http://127.0.0.1:${port}`;
  const headers = { authorization: 'Bearer e2e-token', 'content-type': 'application/json' };

  check('hello 返回 protocol=2', hello.protocol === 2, String(hello.protocol));
  check('hello 声明 events 能力', Array.isArray(hello.capabilities) && hello.capabilities.includes('events'));
  check('hello 有 instanceId', Boolean(hello.instanceId));

  const unauthorized = await fetch(`${base}/v1/health`);
  check('health 无 token 返回 401', unauthorized.status === 401, String(unauthorized.status));

  const health = await fetch(`${base}/v1/health`, { headers });
  const healthBody = await health.json();
  check('health 正常', health.status === 200 && healthBody.ok === true);

  const eventId = `e2e-${Date.now()}`;
  const batch = {
    protocol: 2,
    client: { id: 'e2e', browser: 'chrome', version: '2.19.0' },
    events: [
      {
        id: eventId,
        type: 'history.upsert',
        payload: {
          video: {
            bvid: 'BV1E2E000001',
            cid: 777000001,
            title: '桥 E2E 视频',
            owner: 'E2E',
            duration: 12,
            url: 'https://www.bilibili.com/video/BV1E2E000001'
          },
          track: { lan: 'zh-CN', lanDoc: '中文', source: 'e2e', isAi: false },
          lines: [
            { start: 0, end: 1, text: '第一句。' },
            { start: 1, end: 2, text: '第二句。' }
          ],
          summary: '## E2E\n- ok'
        }
      }
    ]
  };

  const events = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(batch)
  });
  const eventsBody = await events.json();
  check('events 入库成功', events.status === 200 && eventsBody.results?.[0]?.ok === true, JSON.stringify(eventsBody));
  check('events 返回 lineCount', eventsBody.results?.[0]?.lineCount === 2);
  check('events 保存总结', eventsBody.results?.[0]?.summarySaved === true);

  const duplicate = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(batch)
  });
  const duplicateBody = await duplicate.json();
  check('重复事件幂等', duplicateBody.results?.[0]?.duplicate === true, JSON.stringify(duplicateBody));

  const bad = await fetch(`${base}/v1/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ protocol: 2, events: [{ id: 'bad', type: 'nope', payload: { v: 1 } }] })
  });
  check('未知事件返回 400', bad.status === 400, String(bad.status));

  const pull = await fetch(`${base}/v1/pull?since=-1&wait=0`, { headers });
  const pullBody = await pull.json();
  check('pull 首次握手返回游标', pull.status === 200 && Number(pullBody.cursor) >= 1, JSON.stringify(pullBody));

  const tail = await fetch(`${base}/v1/pull?since=${Math.max(0, Number(pullBody.cursor) - 1)}&wait=0`, {
    headers
  });
  const tailBody = await tail.json();
  check(
    'pull 能收到 library.changed',
    Array.isArray(tailBody.events) && tailBody.events.some((event) => event.type === 'library.changed'),
    JSON.stringify(tailBody)
  );

  const health2 = await fetch(`${base}/v1/health`, { headers });
  const health2Body = await health2.json();
  check(
    '入库后库统计增加',
    Number(health2Body.library?.videos) >= 1 && Number(health2Body.library?.segments) >= 2,
    JSON.stringify(health2Body.library)
  );

  const library = await fetch(`${base}/v1/library/items`, { headers });
  const libraryBody = await library.json();
  const first = Array.isArray(libraryBody.items) ? libraryBody.items[0] : null;
  check('library/items 返回库投影', Boolean(first) && first.uid === 'v:BV1E2E000001:777000001', JSON.stringify(first));
  check('library 投影带总结摘要', Boolean(first && first.summaryPreview && first.summaryPreview.includes('E2E')));
  check('library 投影带字幕行数', first && first.lineCount === 2);
  check('library 未截断标记', libraryBody.truncated === false && libraryBody.total === 1);

  const detailRes = await fetch(
    `${base}/v1/library/item?uid=${encodeURIComponent(first ? first.uid : '')}`,
    { headers }
  );
  const detail = await detailRes.json();
  check('library/item 返回总结正文', detailRes.status === 200 && detail.summary?.content?.includes('E2E'));
  check('library/item 返回轨元数据', Array.isArray(detail.tracks) && detail.tracks.length === 1);

  // ---- 插件回写：总结/笔记 + 乐观并发 ----
  const uid = first ? first.uid : 'v:BV1E2E000001:777000001';
  const writeSummary = await fetch(`${base}/v1/library/summary`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      uid,
      content: '## 插件回写\n\n- 来自扩展',
      model: 'plugin',
      baseUpdatedAt: 0
    })
  });
  const writeSummaryBody = await writeSummary.json();
  check('回写总结成功', writeSummary.status === 200 && writeSummaryBody.ok === true, JSON.stringify(writeSummaryBody));

  const detailAfterWrite = await fetch(
    `${base}/v1/library/item?uid=${encodeURIComponent(uid)}`,
    { headers }
  );
  const detailAfterWriteBody = await detailAfterWrite.json();
  check(
    '回写后详情为新内容',
    detailAfterWriteBody.summary?.content?.includes('插件回写') === true,
    detailAfterWriteBody.summary?.content
  );

  const staleBase = await fetch(`${base}/v1/library/summary`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      uid,
      content: '## 旧版本\n\n- 应被拒绝',
      model: 'plugin',
      baseUpdatedAt: 1
    })
  });
  const staleBody = await staleBase.json();
  check('旧 baseUpdatedAt 返回 409', staleBase.status === 409 && staleBody.conflict === true, JSON.stringify(staleBody));

  const noteRes = await fetch(`${base}/v1/library/note`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ uid, content: '插件写的笔记', baseUpdatedAt: 0 })
  });
  const noteBody = await noteRes.json();
  check('回写笔记成功', noteRes.status === 200 && noteBody.ok === true && noteBody.note?.content === '插件写的笔记');

  // ---- MCP 审批 ----
  const approvalRes = await fetch(`${base}/v1/rpc/approval`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: 'missing', allow: true })
  });
  const approvalBody = await approvalRes.json();
  check(
    '未知审批请求返回 404',
    approvalRes.status === 404 && approvalBody.ok === false,
    JSON.stringify(approvalBody)
  );

  // ---- 增量变更 ----
  const changesRes = await fetch(`${base}/v1/library/changes?since=1`, { headers });
  const changesBody = await changesRes.json();
  check(
    '增量变更返回视频',
    changesRes.status === 200 &&
      changesBody.full === false &&
      Array.isArray(changesBody.items) &&
      changesBody.items.some((item) => item.uid === 'v:BV1E2E000001:777000001'),
    JSON.stringify(changesBody).slice(0, 220)
  );
  check('增量变更带 serverTime', Number(changesBody.serverTime) > 0);

  // ---- 对话同步到 chat.db ----
  const chatKey = 'v|BV1E2E000001|777000001|1';
  const chatPayload = {
    key: chatKey,
    videoKey: chatKey,
    videoTitle: '桥 E2E 视频',
    messages: [
      { role: 'user', content: '这是什么？' },
      { role: 'assistant', content: '这是桥接测试。', reasoning: '思考' }
    ]
  };
  const chatSync = await fetch(`${base}/v1/chat/sync`, {
    method: 'POST',
    headers,
    body: JSON.stringify(chatPayload)
  });
  const chatSyncBody = await chatSync.json();
  check(
    '对话同步到 chat.db',
    chatSync.status === 200 && chatSyncBody.ok === true && chatSyncBody.count === 2 && chatSyncBody.conversationId > 0,
    JSON.stringify(chatSyncBody)
  );
  const chatSyncAgain = await fetch(`${base}/v1/chat/sync`, {
    method: 'POST',
    headers,
    body: JSON.stringify(chatPayload)
  });
  const chatSyncAgainBody = await chatSyncAgain.json();
  check(
    '重复同步不会重复创建会话',
    chatSyncAgainBody.conversationId === chatSyncBody.conversationId,
    JSON.stringify(chatSyncAgainBody)
  );

  // ---- 标签 / 合集回写 ----
  const tagsRes = await fetch(`${base}/v1/library/tags`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ uid, tags: ['桥测试', 'E2E'] })
  });
  const tagsBody = await tagsRes.json();
  check(
    '回写标签成功',
    tagsRes.status === 200 && tagsBody.ok === true && tagsBody.tags.includes('桥测试'),
    JSON.stringify(tagsBody)
  );

  const collectionsRes = await fetch(`${base}/v1/library/collections`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ uid, collections: ['桥合集'] })
  });
  const collectionsBody = await collectionsRes.json();
  check(
    '回写合集成功',
    collectionsRes.status === 200 &&
      collectionsBody.ok === true &&
      collectionsBody.collections.includes('桥合集'),
    JSON.stringify(collectionsBody)
  );

  const afterMeta = await fetch(`${base}/v1/library/item?uid=${encodeURIComponent(uid)}`, { headers });
  const afterMetaBody = await afterMeta.json();
  check(
    '详情带标签与合集',
    afterMetaBody.item?.tags?.includes('桥测试') && afterMetaBody.item?.collections?.includes('桥合集'),
    JSON.stringify({ tags: afterMetaBody.item?.tags, collections: afterMetaBody.item?.collections })
  );

  // ---- 本地 ASR：未配置时明确拒绝，插件据此回退在线 ----
  const asrRes = await fetch(`${base}/v1/asr?format=wav&duration=1`, {
    method: 'POST',
    headers: { authorization: 'Bearer e2e-token', 'content-type': 'application/octet-stream' },
    body: Buffer.alloc(3200)
  });
  const asrBody = await asrRes.json();
  check(
    '本地 ASR 未配置时返回 409',
    asrRes.status === 409 && asrBody.ok === false && Boolean(asrBody.error),
    JSON.stringify(asrBody)
  );

  // ---- 导出：插件在桌面端连接时用桌面引擎 ----
  const exportRes = await fetch(`${base}/v1/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      protocol: 2,
      method: 'export.build',
      params: {
        video: {
          bvid: 'BV1E2E000001',
          cid: 777000001,
          title: '桥 E2E 视频',
          owner: 'E2E',
          duration: 12,
          url: 'https://www.bilibili.com/video/BV1E2E000001'
        },
        lines: [
          { start: 0, end: 1, text: '第一句。' },
          { start: 1, end: 2, text: '第二句。' }
        ],
        format: 'srt',
        filenamePattern: '{title}'
      }
    })
  });
  const exportBody = await exportRes.json();
  check(
    'rpc export.build 返回 SRT',
    exportBody.ok === true &&
      exportBody.data?.ext === 'srt' &&
      exportBody.data?.content?.includes('-->') &&
      exportBody.data?.content?.includes('第一句'),
    JSON.stringify(exportBody).slice(0, 220)
  );
  check(
    'rpc export.build 返回文件名与扩展',
    Boolean(exportBody.data?.filename) && exportBody.data?.ext === 'srt',
    exportBody.data?.filename
  );

  // ---- v2 RPC：桌面 AI 委托 ----
  const settingsRes = await fetch(`${base}/v1/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ protocol: 2, method: 'settings.read', params: {} })
  });
  const settingsBody = await settingsRes.json();
  check(
    'rpc settings.read 报告桌面 AI 可用',
    settingsBody.ok === true && settingsBody.data?.ai?.ready === true,
    JSON.stringify(settingsBody)
  );
  check('rpc settings.read 不返回 Key', !JSON.stringify(settingsBody).includes('test-key'));

  const rpcRes = await fetch(`${base}/v1/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      protocol: 2,
      method: 'ai.summarize',
      stream: true,
      params: {
        video: {
          bvid: 'BV1E2E000001',
          cid: 777000001,
          title: '桥 E2E 视频',
          owner: 'E2E',
          duration: 12,
          url: 'https://www.bilibili.com/video/BV1E2E000001'
        },
        lines: [
          { start: 0, end: 1, text: '第一句。' },
          { start: 1, end: 2, text: '第二句。' }
        ],
        web: false
      }
    })
  });
  const rawRpc = await rpcRes.text();
  const rpcEvents = rawRpc
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const rpcText = rpcEvents
    .filter((event) => event.type === 'delta')
    .map((event) => event.text)
    .join('');
  const rpcDone = rpcEvents.find((event) => event.type === 'done');
  check('rpc ai.summarize 流式返回', rpcRes.ok && rpcText.includes('桌面 RPC 总结'), rawRpc.slice(0, 160));
  check('rpc ai.summarize 有 done 与 model', Boolean(rpcDone && rpcDone.model), JSON.stringify(rpcDone));
} catch (error) {
  failures += 1;
  console.error('[bridge-e2e] 失败:', error && error.stack ? error.stack : error);
} finally {
  stop();
}

if (failures) {
  console.error(`[bridge-e2e] ${failures} 项失败`);
  process.exit(1);
}
console.log('[bridge-e2e] 全部通过');
