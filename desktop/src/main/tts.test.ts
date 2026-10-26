import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtsSettings } from '../shared/types';

const state = vi.hoisted(() => ({
  fetched: [] as Array<{ url: string; init: RequestInit }>,
  audio: new Uint8Array([1, 2, 3, 4])
}));

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      fetch: async (url: string, init: RequestInit) => {
        state.fetched.push({ url, init });
        return new Response(state.audio, {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' }
        });
      }
    }
  }
}));

import { edgeSynthesize, openaiSynthesize, sapiSynthesize } from './tts';

interface FakeSocket {
  binaryType: string;
  sent: string[];
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

class MockWebSocket implements FakeSocket {
  static instance: MockWebSocket | null = null;
  binaryType = '';
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instance = this;
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string): void {
    this.sent.push(data);
    if (!data.includes('Path:ssml')) return;
    const header = Buffer.from('X-RequestId:x\r\nPath:audio\r\n');
    const audio = Buffer.from('fake-mp3');
    const frame = Buffer.alloc(2 + header.length + audio.length);
    frame.writeUInt16BE(header.length, 0);
    header.copy(frame, 2);
    audio.copy(frame, 2 + header.length);
    setTimeout(() => {
      this.onmessage?.({ data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.length) });
      this.onmessage?.({ data: 'X-RequestId:x\r\nPath:turn.end' });
    }, 0);
  }

  close(): void {
    this.onclose?.();
  }
}

const originalWebSocket = globalThis.WebSocket;

describe('TTS 合成', () => {
  beforeEach(() => {
    state.fetched = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  it('edge：发送 speech.config 与 SSML，并按二进制帧拼出音频', async () => {
    const audio = await edgeSynthesize('你好世界', {
      voice: 'zh-CN-XiaoxiaoNeural',
      rate: 1.5,
      volume: 80
    });
    expect(audio.toString()).toBe('fake-mp3');
    const socket = MockWebSocket.instance!;
    expect(socket.url).toContain('speech.platform.bing.com');
    expect(socket.sent[0]).toContain('Path:speech.config');
    const ssml = socket.sent[1];
    expect(ssml).toContain("voice name='zh-CN-XiaoxiaoNeural'");
    expect(ssml).toContain("rate='+50%'");
    expect(ssml).toContain("volume='80'");
    expect(ssml).toContain('你好世界');
  });

  it('edge：转义 SSML 特殊字符', async () => {
    await edgeSynthesize('a < b & c', { voice: 'zh-CN-XiaoxiaoNeural', rate: 1, volume: 100 });
    const ssml = MockWebSocket.instance!.sent[1];
    expect(ssml).toContain('a &lt; b &amp; c');
  });

  it('openai：/audio/speech 请求体与鉴权', async () => {
    const config: TtsSettings['openai'] = {
      baseUrl: 'https://api.example.com/v1/',
      apiKey: 'sk-test',
      model: 'tts-1',
      voice: 'alloy'
    };
    const audio = await openaiSynthesize('hello', config, { rate: 1.25 });
    expect(audio.length).toBe(4);
    const call = state.fetched[0];
    expect(call.url).toBe('https://api.example.com/v1/audio/speech');
    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(call.init.body));
    expect(body).toMatchObject({ model: 'tts-1', voice: 'alloy', input: 'hello', speed: 1.25 });
  });

  it.skipIf(process.platform !== 'win32')(
    'sapi：离线合成 WAV',
    async () => {
      const audio = await sapiSynthesize('系统语音测试', { voice: '', rate: 1, volume: 80 });
      expect(audio.subarray(0, 4).toString()).toBe('RIFF');
      expect(audio.length).toBeGreaterThan(1000);
    },
    60000
  );
});
