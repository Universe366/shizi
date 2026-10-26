import { session } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppSettings, TtsSettings } from '../shared/types';

// ---------------------------------------------------------------------------
// 文字朗读（TTS）：
// - edge：微软 Edge 在线朗读接口，免费、中文自然（默认）
// - sapi：Windows 系统语音，完全离线，音质一般
// - openai：OpenAI 兼容 /audio/speech，音质最好但按量计费
// 主进程只负责合成，播放由渲染层 Audio 负责。
// ---------------------------------------------------------------------------

export interface TtsResult {
  dataUrl: string;
  mime: string;
  engine: TtsSettings['engine'];
  ms: number;
}

export interface EdgeVoice {
  id: string;
  label: string;
}

export const EDGE_VOICES: EdgeVoice[] = [
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓（中文 · 女声）' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊（中文 · 女声）' },
  { id: 'zh-CN-YunxiNeural', label: '云希（中文 · 男声）' },
  { id: 'zh-CN-YunjianNeural', label: '云健（中文 · 男声）' },
  { id: 'zh-CN-YunyangNeural', label: '云扬（中文 · 新闻）' },
  { id: 'zh-TW-HsiaoChenNeural', label: '曉臻（繁体中文 · 女声）' },
  { id: 'en-US-AriaNeural', label: 'Aria（English · female）' },
  { id: 'en-US-GuyNeural', label: 'Guy（English · male）' },
  { id: 'ja-JP-NanamiNeural', label: 'Nanami（日本語 · 女性）' }
];

const EDGE_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const MAX_CHARS = 8000;
/** Edge 接口偶尔被网络/地区拦住：失败后 10 分钟内直接走离线兜底，避免每次等超时。 */
let edgeFailedUntil = 0;

interface MinimalWebSocket {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

function edgeUrl(): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.replace(/\W/g, '');
  return (
    'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1' +
    `?TrustedClientToken=${EDGE_TOKEN}&ConnectionId=${id}`
  );
}

function xmlEscape(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ratePercent(rate: number): string {
  const percent = Math.round((Math.min(2, Math.max(0.5, rate)) - 1) * 100);
  return `${percent >= 0 ? '+' : ''}${percent}%`;
}

/** Edge 朗读：WebSocket + 二进制帧（前 2 字节是 header 长度）。 */
export function edgeSynthesize(
  text: string,
  options: { voice: string; rate: number; volume: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const Ctor = (globalThis as unknown as { WebSocket?: new (url: string) => MinimalWebSocket })
      .WebSocket;
    if (!Ctor) {
      reject(new Error('当前运行时不支持 WebSocket，无法使用 edge 朗读'));
      return;
    }
    const ws = new Ctor(edgeUrl());
    ws.binaryType = 'arraybuffer';
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (error) reject(error);
      else if (!chunks.length) reject(new Error('edge 朗读没有返回音频'));
      else resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => finish(new Error('edge 朗读超时（8 秒）')), 8000);

    ws.onopen = () => {
      const config = {
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
              outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
            }
          }
        }
      };
      ws.send(
        `X-Timestamp:${new Date().toISOString()}\r\n` +
          'Content-Type:application/json; charset=utf-8\r\n' +
          'Path:speech.config\r\n\r\n' +
          JSON.stringify(config)
      );
      const voice = options.voice || 'zh-CN-XiaoxiaoNeural';
      const lang = voice.split('-').slice(0, 2).join('-');
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
        `<voice name='${xmlEscape(voice)}'>` +
        `<prosody pitch='+0Hz' rate='${ratePercent(options.rate)}' volume='${Math.min(100, Math.max(0, Math.round(options.volume)))}'>` +
        xmlEscape(text.slice(0, MAX_CHARS)) +
        '</prosody></voice></speak>';
      ws.send(
        `X-RequestId:${Date.now().toString(36)}${Math.random().toString(36).slice(2)}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${new Date().toISOString()}\r\n` +
          'Path:ssml\r\n\r\n' +
          ssml
      );
    };

    ws.onmessage = (event) => {
      const data = event.data;
      if (typeof data === 'string') {
        if (data.includes('Path:turn.end')) finish();
        return;
      }
      const buffer = Buffer.from(data as ArrayBuffer);
      if (buffer.length < 2) return;
      const headerLength = buffer.readUInt16BE(0);
      if (buffer.length < headerLength + 2) return;
      const header = buffer.slice(2, 2 + headerLength).toString('utf8');
      if (/Path:\s*audio/i.test(header)) chunks.push(buffer.slice(2 + headerLength));
    };
    ws.onerror = () => finish(new Error('edge 朗读连接失败（检查网络/代理）'));
    ws.onclose = () => {
      if (!settled) finish(new Error('edge 朗读连接提前关闭'));
    };
  });
}

const SAPI_SCRIPT = String.raw`param([string]$Text,[string]$TextFile,[string]$Out,[string]$Voice,[int]$Rate,[int]$Volume)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
if ($TextFile -and (Test-Path -LiteralPath $TextFile)) {
  $Text = [IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8)
}
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($Voice) { $synth.SelectVoice($Voice) }
} catch { }
$synth.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
$synth.Volume = [Math]::Max(0, [Math]::Min(100, $Volume))
$synth.SetOutputToWaveFile($Out)
$synth.Speak($Text)
$synth.Dispose()
`;

function ensureSapiScript(): string {
  const dir = path.join(os.tmpdir(), 'shizi-tts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sapi.ps1');
  fs.writeFileSync(file, `\uFEFF${SAPI_SCRIPT}`, 'utf8');
  return file;
}

function runPowerShell(args: string[], timeoutMs = 60000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ...args],
      { windowsHide: true }
    );
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('系统朗读超时'));
    }, timeoutMs);
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `系统朗读退出码 ${code}`));
    });
  });
}

/** Windows SAPI：离线合成 WAV。 */
export async function sapiSynthesize(
  text: string,
  options: { voice: string; rate: number; volume: number }
): Promise<Buffer> {
  if (process.platform !== 'win32') throw new Error('系统朗读只支持 Windows');
  const out = path.join(
    os.tmpdir(),
    `shizi-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`
  );
  const textFile = `${out}.txt`;
  try {
    // 通过 UTF-8 文件传文本：Windows 命令行参数在非中文 locale 会丢字。
    fs.writeFileSync(textFile, text.slice(0, MAX_CHARS), 'utf8');
    await runPowerShell([
      ensureSapiScript(),
      '-TextFile',
      textFile,
      '-Out',
      out,
      '-Voice',
      options.voice || '',
      '-Rate',
      String(Math.round((options.rate - 1) * 10)),
      '-Volume',
      String(options.volume)
    ]);
    const audio = fs.readFileSync(out);
    if (audio.length < 1000) {
      throw new Error('系统语音没有生成音频（当前系统可能没有安装语音包）');
    }
    return audio;
  } finally {
    try {
      fs.rmSync(out, { force: true });
    } catch {
      // ignore
    }
    try {
      fs.rmSync(textFile, { force: true });
    } catch {
      // ignore
    }
  }
}

/** OpenAI 兼容 /audio/speech。 */
export async function openaiSynthesize(
  text: string,
  config: TtsSettings['openai'],
  options: { rate: number }
): Promise<Buffer> {
  const base = String(config.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('请先填写 TTS 接口地址');
  if (!config.model.trim()) throw new Error('请先填写 TTS 模型');
  const response = await session.defaultSession.fetch(`${base}/audio/speech`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: config.model,
      voice: config.voice || 'alloy',
      input: text.slice(0, 4000),
      response_format: 'mp3',
      speed: Math.min(2, Math.max(0.5, options.rate))
    }),
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`TTS 接口 HTTP ${response.status}：${body.slice(0, 160)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function synthesizeSpeech(
  text: string,
  settings: AppSettings
): Promise<TtsResult> {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('没有可朗读的文字');
  const config = settings.tts;
  const started = Date.now();
  const engine = config.engine;
  const voice = config.voice;

  if (engine === 'edge') {
    if (Date.now() < edgeFailedUntil) {
      // 最近刚失败过，直接走离线兜底
    } else {
      try {
        const audio = await edgeSynthesize(clean, {
          voice,
          rate: config.rate,
          volume: config.volume
        });
        return {
          dataUrl: `data:audio/mpeg;base64,${audio.toString('base64')}`,
          mime: 'audio/mpeg',
          engine: 'edge',
          ms: Date.now() - started
        };
      } catch (error) {
        edgeFailedUntil = Date.now() + 10 * 60 * 1000;
        // 在线接口失败时退回离线系统语音，至少能出声。
        console.warn('[tts] edge 失败，回退系统语音:', (error as Error).message);
        if (process.platform !== 'win32') throw error;
      }
    }
  }

  if (engine === 'openai') {
    const audio = await openaiSynthesize(clean, config.openai, { rate: config.rate });
    return {
      dataUrl: `data:audio/mpeg;base64,${audio.toString('base64')}`,
      mime: 'audio/mpeg',
      engine: 'openai',
      ms: Date.now() - started
    };
  }

  const audio = await sapiSynthesize(clean, {
    voice,
    rate: config.rate,
    volume: config.volume
  });
  return {
    dataUrl: `data:audio/wav;base64,${audio.toString('base64')}`,
    mime: 'audio/wav',
    engine: 'sapi',
    ms: Date.now() - started
  };
}

/** 列出可用音色：edge 固定列表 + 系统已安装音色。 */
export async function listVoices(): Promise<{ edge: EdgeVoice[]; sapi: string[] }> {
  const sapi: string[] = [];
  if (process.platform === 'win32') {
    try {
      const output = await new Promise<string>((resolve) => {
        const child = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }"
          ],
          { windowsHide: true }
        );
        let text = '';
        child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
        child.on('close', () => resolve(text));
        child.on('error', () => resolve(''));
        setTimeout(() => {
          child.kill();
          resolve(text);
        }, 8000);
      });
      for (const line of output.split(/\r?\n/)) {
        const name = line.trim();
        if (name && !sapi.includes(name)) sapi.push(name);
      }
    } catch {
      // 忽略：没有系统语音时只返回 edge 列表
    }
  }
  return { edge: EDGE_VOICES, sapi };
}
