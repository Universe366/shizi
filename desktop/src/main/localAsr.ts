import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import type { AsrPlatform } from '../shared/types';
import { localAsrStatus } from './localAsrSetup';

export interface LocalWhisperSegment {
  start: number;
  end: number;
  text: string;
}

export interface LocalWhisperPaths {
  exe: string;
  model: string;
}

function friendlyPath(value: string): string {
  return value.trim().replace(/^"|"$/g, '');
}

/** 校验本地 whisper.cpp 配置；错误信息直接告诉用户要下什么文件。 */
export function resolveLocalWhisperPaths(platform: AsrPlatform): LocalWhisperPaths {
  let exe = friendlyPath(platform.localExe || '');
  let model = friendlyPath(platform.localModel || '');
  // 模型目录迁移过（userData → 安装目录）时，旧路径会失效；
  // 这里按“已下载的构建/模型”兜底，避免用户升级后突然不能转写。
  // 单元测试/非 Electron 环境下 localAsrStatus 不可用，忽略即可。
  let installed: ReturnType<typeof localAsrStatus> | null = null;
  const status = () => {
    if (installed) return installed;
    try {
      installed = localAsrStatus();
    } catch {
      installed = null;
    }
    return installed;
  };
  if (!exe || !fs.existsSync(exe)) {
    const found = status();
    if (found?.binary) exe = found.binary;
  }
  if (!model || !fs.existsSync(model)) {
    const found = status();
    const first = found?.models.tiny || found?.models.base || found?.models.small;
    if (first) model = first;
  }
  if (!exe) {
    throw new Error(
      '本地 Whisper：请选择 whisper.cpp 的可执行文件（Windows 一般是 whisper-cli.exe）'
    );
  }
  if (!fs.existsSync(exe) || !fs.statSync(exe).isFile()) {
    throw new Error(`本地 Whisper：找不到可执行文件 ${exe}`);
  }
  if (!model) {
    throw new Error('本地 Whisper：请选择模型文件（ggml-base.bin / ggml-small.bin 等）');
  }
  if (!fs.existsSync(model) || !fs.statSync(model).isFile()) {
    throw new Error(`本地 Whisper：找不到模型文件 ${model}`);
  }
  return { exe, model };
}

function clockToSeconds(value: string): number {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(String(value || '').trim());
  if (!match) return 0;
  return (
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4].padEnd(3, '0')) / 1000
  );
}

interface WhisperToken {
  text?: string;
  offsets?: { from?: number; to?: number };
}

/** 用 token 级时间戳把超长段落切成更自然的字幕行；没有 token 时按字数均分。 */
export function splitLongSegment(
  text: string,
  start: number,
  end: number,
  tokens?: WhisperToken[],
  maxChars = 42
): LocalWhisperSegment[] {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return [{ start, end, text: clean }];

  const usable = (tokens || [])
    .map((token) => ({
      text: String(token.text || ''),
      from: Number(token.offsets?.from),
      to: Number(token.offsets?.to)
    }))
    .filter(
      (token) =>
        token.text.trim() &&
        !/^\[_.*_\]$/.test(token.text.trim()) &&
        Number.isFinite(token.from) &&
        Number.isFinite(token.to)
    );

  if (usable.length >= 2) {
    const parts: LocalWhisperSegment[] = [];
    let current = '';
    let from = 0;
    let to = 0;
    const flush = () => {
      const value = current.trim();
      if (value) parts.push({ start: from / 1000, end: Math.max(from + 300, to) / 1000, text: value });
      current = '';
      from = 0;
      to = 0;
    };
    for (const token of usable) {
      if (!current) from = token.from;
      current += token.text;
      to = token.to;
      const value = current.trim();
      const punctuation = /[。！？!?…；;]$/.test(value);
      const atWordBoundary = token.text.startsWith(' ') || /[\u4e00-\u9fff]$/.test(value);
      if (value.length >= maxChars && (punctuation || atWordBoundary)) flush();
      else if (value.length >= maxChars * 1.5) flush();
    }
    flush();
    if (parts.length > 1) return parts;
  }

  // 没有 token / token 不可用：按标点和字数比例切分。
  const pieces: string[] = [];
  let rest = clean;
  while (rest.length > maxChars) {
    let cut = -1;
    for (let index = Math.min(maxChars, rest.length - 1); index >= Math.max(8, maxChars / 2); index -= 1) {
      if (/[，,。！？!?；;：:、]/.test(rest[index - 1])) {
        cut = index;
        break;
      }
    }
    if (cut < 0) cut = maxChars;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0) || 1;
  const span = Math.max(0.3, end - start);
  let cursor = start;
  return pieces.map((piece) => {
    const duration = Math.max(0.3, (piece.length / total) * span);
    const row = { start: cursor, end: cursor + duration, text: piece };
    cursor += duration;
    return row;
  });
}

/** whisper.cpp 的 -ojf JSON：优先用 offsets（毫秒），没有就解析 timestamps。 */
export function parseWhisperJson(text: string): LocalWhisperSegment[] {
  let json: unknown;
  try {
    json = JSON.parse(String(text || ''));
  } catch {
    return [];
  }
  const rows = (json as { transcription?: unknown })?.transcription;
  if (!Array.isArray(rows)) return [];
  const segments: LocalWhisperSegment[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as {
      offsets?: { from?: number; to?: number };
      timestamps?: { from?: string; to?: string };
      text?: string;
      tokens?: WhisperToken[];
    };
    const text = String(item.text || '').trim();
    if (!text) continue;
    const startMs = Number(item.offsets?.from);
    const endMs = Number(item.offsets?.to);
    const start = Number.isFinite(startMs) ? startMs / 1000 : clockToSeconds(item.timestamps?.from || '');
    const end = Number.isFinite(endMs)
      ? endMs / 1000
      : clockToSeconds(item.timestamps?.to || '') || start + Math.max(0.8, text.length * 0.12);
    segments.push(
      ...splitLongSegment(text, Math.max(0, start), Math.max(start + 0.3, end), item.tokens)
    );
  }
  return segments;
}

/** 没有 JSON 时的兜底：解析 whisper.cpp 标准输出的 `[00:00:00.000 --> ...] 文本`。 */
export function parseWhisperStdout(text: string): LocalWhisperSegment[] {
  const lines = String(text || '').split(/\r?\n/);
  const segments: LocalWhisperSegment[] = [];
  const pattern =
    /^\[(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\]\s*(.*)$/;
  for (const line of lines) {
    const match = pattern.exec(line.trim());
    if (!match) continue;
    const start =
      Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
    const end =
      Number(match[5]) * 3600 + Number(match[6]) * 60 + Number(match[7]) + Number(match[8]) / 1000;
    const text = match[9].trim();
    if (text) segments.push({ start, end, text });
  }
  return segments;
}

export function parseWhisperOutput(stdout: string, jsonText?: string): LocalWhisperSegment[] {
  const fromJson = jsonText ? parseWhisperJson(jsonText) : [];
  if (fromJson.length) return fromJson;
  return parseWhisperStdout(stdout);
}

interface RunOptions {
  exe: string;
  model: string;
  wav: string;
  language: string;
  threads: number;
  outBase: string;
  signal?: AbortSignal;
  onProgress?: (percent: number, message: string) => void;
}

/** 调用 whisper.cpp 识别一个 16k 单声道 wav，返回带时间轴的段落。 */
export async function runLocalWhisper(options: RunOptions): Promise<LocalWhisperSegment[]> {
  const { exe, model, wav, outBase } = options;
  const threads = Math.max(1, Math.min(32, Math.round(options.threads || 4)));
  const language = String(options.language || 'auto').trim() || 'auto';
  const args = [
    '-m',
    model,
    '-f',
    wav,
    '-l',
    language,
    '-t',
    String(threads),
    // 先让 whisper 按 ~42 字符断行，再交给「断句」合并；避免一屏一大段。
    '-ml',
    '42',
    '-ojf',
    '-pp',
    '-of',
    outBase
  ];
  let stdout = '';
  let stderr = '';
  let lastPercent = 0;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      cwd: path.dirname(exe)
    });
    const abort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      const error = new Error('已终止');
      error.name = 'AbortError';
      reject(error);
    };
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-200000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-20000);
      const matches = [...stderr.matchAll(/progress\s*=\s*(\d+)%/g)];
      const percent = matches.length ? Number(matches[matches.length - 1][1]) : 0;
      if (percent >= lastPercent + 5 || percent === 100) {
        lastPercent = percent;
        options.onProgress?.(percent, `本地识别 ${percent}%`);
      }
    });
    child.on('error', (error) => {
      options.signal?.removeEventListener('abort', abort);
      reject(
        new Error(
          `启动 whisper.cpp 失败：${error.message}（确认选择的是 whisper-cli.exe，且没有被安全软件拦截）`
        )
      );
    });
    child.on('close', (code) => {
      options.signal?.removeEventListener('abort', abort);
      if (code === 0) {
        resolve();
        return;
      }
      const reason = stderr.trim().slice(-300);
      const hint = /vulkan/i.test(stderr)
        ? '（Vulkan 初始化失败：更新显卡驱动，或改用 CPU 构建）'
        : /cuda|cublas/i.test(stderr)
          ? '（CUDA 初始化失败：确认 NVIDIA 驱动支持该 CUDA 版本，或改用 Vulkan / CPU）'
          : '';
      reject(new Error(`whisper.cpp 退出码 ${code}${reason ? `：${reason}` : ''}${hint}`));
    });
  });

  const jsonFile = `${outBase}.json`;
  let jsonText = '';
  try {
    jsonText = fs.readFileSync(jsonFile, 'utf8');
  } catch {
    // 旧版/精简版可能不写 JSON，退回解析 stdout
  }
  const segments = parseWhisperOutput(stdout, jsonText);
  try {
    fs.rmSync(jsonFile, { force: true });
  } catch {
    // ignore
  }
  // 用 ffmpeg 的静音检测在自然停顿处补切长句；失败不影响转写结果。
  const refined = await refineBySilence(wav, segments, options.signal).catch(() => segments);
  return refined;
}

interface SilenceRange {
  start: number;
  end: number;
}

/** ffmpeg silencedetect：找到 0.4 秒以上的停顿，用于把长句切在真实换气处。 */
export function detectSilences(text: string): SilenceRange[] {
  const ranges: SilenceRange[] = [];
  let start: number | null = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const startMatch = /silence_start:\s*([\d.]+)/.exec(line);
    if (startMatch) {
      start = Number(startMatch[1]);
      continue;
    }
    const endMatch = /silence_end:\s*([\d.]+)/.exec(line);
    if (endMatch && start != null) {
      const end = Number(endMatch[1]);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start + 0.35) {
        ranges.push({ start, end });
      }
      start = null;
    }
  }
  return ranges;
}

async function refineBySilence(
  wav: string,
  segments: LocalWhisperSegment[],
  signal?: AbortSignal
): Promise<LocalWhisperSegment[]> {
  const ffmpeg = ffmpegStatic;
  if (!ffmpeg || !segments.length) return segments;
  const silences = await new Promise<SilenceRange[]>((resolve) => {
    const child = spawn(
      ffmpeg,
      ['-hide_banner', '-i', wav, '-af', 'silencedetect=noise=-35dB:d=0.4', '-f', 'null', '-'],
      { windowsHide: true }
    );
    let stderr = '';
    const abort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve([]);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-20000);
    });
    child.on('error', () => resolve([]));
    child.on('close', () => {
      signal?.removeEventListener('abort', abort);
      resolve(detectSilences(stderr));
    });
  });
  if (!silences.length) return segments;

  const output: LocalWhisperSegment[] = [];
  for (const segment of segments) {
    const candidates = silences.filter(
      (silence) =>
        silence.start > segment.start + 0.25 &&
        silence.end < segment.end - 0.25 &&
        silence.end - silence.start >= 0.4
    );
    if (segment.text.length < 20 || !candidates.length) {
      output.push(segment);
      continue;
    }
    const pause = candidates.reduce((best, item) =>
      item.end - item.start > best.end - best.start ? item : best
    );
    const ratio = Math.min(
      0.85,
      Math.max(0.15, (pause.start + pause.end) / 2 / Math.max(0.1, segment.end - segment.start))
    );
    let cut = Math.round(segment.text.length * ratio);
    for (let offset = 0; offset < 8 && cut > 2 && cut < segment.text.length - 2; offset += 1) {
      if (/[，,。！？!?；;：:、\s]/.test(segment.text[cut - 1])) break;
      cut += 1;
    }
    if (cut < 4 || cut > segment.text.length - 4) {
      output.push(segment);
      continue;
    }
    const midpoint = (pause.start + pause.end) / 2;
    output.push(
      { start: segment.start, end: midpoint, text: segment.text.slice(0, cut).trim() },
      { start: midpoint, end: segment.end, text: segment.text.slice(cut).trim() }
    );
  }
  return output;
}

/** 测试连接：文件存在 + 可执行文件能打印帮助。 */
export async function probeLocalWhisper(
  platform: AsrPlatform
): Promise<{ ok: boolean; ms: number; sample: string }> {
  const { exe, model } = resolveLocalWhisperPaths(platform);
  const started = Date.now();
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(exe, ['-h'], { windowsHide: true, cwd: path.dirname(exe) });
    let text = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error('whisper.cpp 没有响应（-h 超时）'));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      text = `${text}${String(chunk)}`.slice(-4000);
    });
    child.stderr.on('data', (chunk) => {
      text = `${text}${String(chunk)}`.slice(-4000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`无法启动可执行文件：${error.message}`));
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(text);
    });
  });
  if (!/whisper|usage:/i.test(output)) {
    throw new Error('这个程序看起来不是 whisper.cpp（帮助信息里没有 whisper/usage）');
  }
  return {
    ok: true,
    ms: Date.now() - started,
    sample: `whisper.cpp 可用 · 模型 ${path.basename(model)}`
  };
}
