// 桌面 AI 委托客户端单测：probe / NDJSON 流解析 / done。
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
const ai = await import('../shizi-extension/src/sidepanel/modules/desktop-ai.js');

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const port = 49841;
const token = 'ai-test-token';
let rpcMode = 'ok';
let asrRequest = null;

const server = http.createServer(async (req, res) => {
  if (req.url === '/v1/hello') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        app: 'shizi',
        protocol: 2,
        version: '0.160.0',
        instanceId: 'ai-test',
        port,
        token,
        capabilities: ['events', 'pull', 'library.read', 'ai.chat', 'ai.summarize', 'settings.read']
      })
    );
    return;
  }
  if (String(req.url).startsWith('/v1/asr')) {
    let size = 0;
    for await (const chunk of req) size += chunk.length;
    asrRequest = { url: req.url, size };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        text: '你好',
        model: 'whisper-base',
        segments: [{ t: 0, d: 1, text: '你好' }]
      })
    );
    return;
  }
  if (req.url === '/v1/rpc') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body || '{}');
    if (payload.method === 'optimize.lines') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          type: 'done',
          text: '',
          data: { suggestions: [{ index: 0, original: '你好', suggestion: '您好' }] }
        })
      );
      return;
    }
    if (payload.method === 'translate.lines') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          type: 'done',
          text: '',
          data: {
            language: '英文',
            lines: [{ start: 0, end: 1, text: 'hello' }]
          }
        })
      );
      return;
    }
    if (payload.method === 'export.build') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          type: 'done',
          text: '',
          data: { content: '1\n00:00:00,000 --> 00:00:01,000\n你好\n', ext: 'srt', mime: 'application/x-subrip', filename: '测试.srt' }
        })
      );
      return;
    }
    if (payload.method === 'tts.speak') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          type: 'done',
          text: '',
          data: { dataUrl: 'data:audio/mpeg;base64,AAAA', mime: 'audio/mpeg', engine: 'sapi' }
        })
      );
      return;
    }
    if (payload.method === 'settings.read') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          type: 'done',
          text: '',
          data: { ai: { ready: rpcMode === 'ok', reason: rpcMode === 'ok' ? '' : '没有 Key' } }
        })
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    if (rpcMode === 'error') {
      res.write(JSON.stringify({ type: 'error', error: 'mock 失败' }) + '\n');
      res.end();
      return;
    }
    for (const text of ['## 标题', '\n\n', '- 结论']) {
      res.write(JSON.stringify({ type: 'delta', text }) + '\n');
    }
    res.write(JSON.stringify({ type: 'done', text: '## 标题\n\n- 结论', model: 'mock' }) + '\n');
    res.end();
    return;
  }
  res.writeHead(404);
  res.end('{}');
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

store.set({
  settings: {
    desktop: { enabled: true, autoSync: true, port, token },
    ai: { platforms: [], activeId: '' }
  }
});

await link.ensureLink(true);
const status = await ai.probeDesktopAi(true);
check('probe 报告桌面 AI 可用', status.ready === true, JSON.stringify(status));

const deltas = [];
const ended = new Promise((resolve) => {
  const stream = new ai.DesktopStream();
  stream.start(
    'ai.summarize',
    {
      video: { bvid: 'BV1AI000001', cid: 1, title: 'AI 测试', url: 'https://www.bilibili.com/video/BV1AI000001' },
      lines: [{ start: 0, end: 1, text: '一句' }]
    },
    {
      onDelta: (text) => deltas.push(text),
      onEnd: (event) => resolve(event),
      onError: (error) => resolve({ error })
    }
  );
});
const done = await ended;
check('NDJSON delta 拼接', deltas.join('') === '## 标题\n\n- 结论', deltas.join(''));
check('done 带 model', done && done.model === 'mock', JSON.stringify(done));

// 桌面 ASR 分片
const asrOut = await ai.transcribeViaDesktop(Buffer.from('fake-wav'), {
  duration: 5,
  format: 'wav',
  title: '测试',
  url: 'https://www.bilibili.com/video/BV1'
});
check('桌面 ASR 返回 segments', asrOut.ok === true && asrOut.segments[0].text === '你好', JSON.stringify(asrOut));
check(
  '桌面 ASR 请求带时长与格式',
  asrRequest && asrRequest.url.includes('duration=5') && asrRequest.url.includes('format=wav') && asrRequest.size === 8,
  JSON.stringify(asrRequest)
);

// 桌面校对
const optimized = await ai.optimizeViaDesktop([{ from: 0, to: 1, text: '你好' }]);
check(
  '桌面校对返回建议',
  optimized && optimized.suggestions[0].suggestion === '您好',
  JSON.stringify(optimized)
);

// 桌面翻译
const translated = await ai.translateViaDesktop([{ from: 0, to: 1, text: '你好' }], '英文');
check(
  '桌面翻译返回行',
  translated && translated.language === '英文' && translated.lines[0].text === 'hello',
  JSON.stringify(translated)
);

// 桌面导出
const exported = await ai.exportViaDesktop({
  video: { bvid: 'BV1', title: '测试' },
  lines: [{ start: 0, end: 1, text: '你好' }],
  format: 'srt',
  template: 'timestamped'
});
check('桌面导出返回文件内容', exported && exported.ext === 'srt' && exported.filename.endsWith('.srt'), JSON.stringify(exported));

// 桌面 TTS
const tts = await ai.speakViaDesktop('朗读这段总结');
check(
  '桌面 TTS 返回 dataUrl',
  tts && tts.dataUrl.startsWith('data:audio/') && tts.engine === 'sapi',
  JSON.stringify(tts)
);

// 错误事件
rpcMode = 'error';
const err = await new Promise((resolve) => {
  const stream = new ai.DesktopStream();
  stream.start(
    'ai.chat',
    { messages: [{ role: 'user', content: '你好' }], video: null, lines: [] },
    { onError: (error) => resolve(error), onEnd: () => resolve({ unexpected: true }) }
  );
});
check('桌面端错误转成 onError', err && err.title === '桌面端生成失败' && /mock/.test(err.detail), JSON.stringify(err));

server.close();
await new Promise((resolve) => setTimeout(resolve, 80));
console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
