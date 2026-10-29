import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { app } from 'electron';
import type {
  DownloadProbeEntry,
  DownloadProbeResult,
  OnlineDownloadOptions
} from '../shared/types';
import { overallPercent, parseYtDlpItem, parseYtDlpProgress } from './ytdlp';

/**
 * 在线视频下载：按需获取固定版本 yt-dlp，调用它下载 B 站/YouTube 等。
 * 只处理用户主动输入、且其有权下载的内容；不解析 DRM。
 */
const YTDLP = {
  version: '2026.10.21',
  size: 17880111,
  sha256: '33121d192d706e62f684a06f80918e3f3a8ba52ac3a65213b6951c39c7d9f555',
  urls: [
    'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp.exe',
    'https://ghproxy.net/https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp.exe'
  ]
};

function toolsDir(): string {
  const candidates = [
    path.join(path.dirname(app.getPath('exe')), 'tools'),
    path.join(app.getPath('userData'), 'tools')
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch {
      // 试下一个
    }
  }
  return candidates[candidates.length - 1];
}

async function downloadFile(
  url: string,
  target: string,
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const temp = `${target}.download`;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (signal?.aborted) throw new Error('已取消');
    let start = 0;
    try {
      start = fs.existsSync(temp) ? fs.statSync(temp).size : 0;
    } catch {
      start = 0;
    }
    if (start >= YTDLP.size) {
      // 已下载完，只做校验。
      const digest = createHash('sha256').update(fs.readFileSync(temp)).digest('hex');
      if (digest === YTDLP.sha256) {
        fs.renameSync(temp, target);
        return;
      }
      fs.rmSync(temp, { force: true });
      start = 0;
    }
    try {
      const response = await fetch(url, {
        signal,
        headers: start > 0 ? { Range: `bytes=${start}-` } : undefined
      });
      if (response.status === 416 && start > 0) {
        const digest = createHash('sha256').update(fs.readFileSync(temp)).digest('hex');
        if (digest !== YTDLP.sha256) throw new Error('已下载文件校验失败');
        fs.renameSync(temp, target);
        return;
      }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      if (start > 0 && response.status !== 206) start = 0;
      const total = Number(response.headers.get('content-length'))
        ? start + Number(response.headers.get('content-length'))
        : YTDLP.size;
      const stream = fs.createWriteStream(temp, { flags: start > 0 ? 'a' : 'w' });
      const reader = response.body.getReader();
      let received = start;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          received += chunk.length;
          if (!stream.write(chunk)) {
            await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
          }
          onProgress(
            total ? Math.min(99, Math.floor((received / total) * 100)) : 0,
            `下载 yt-dlp ${Math.round(received / 1024 / 1024)} / ${Math.round(total / 1024 / 1024)} MB`
          );
        }
      } finally {
        await new Promise<void>((resolve) => stream.end(() => resolve()));
      }
      const digest = createHash('sha256').update(fs.readFileSync(temp)).digest('hex');
      if (digest !== YTDLP.sha256) {
        fs.rmSync(temp, { force: true });
        throw new Error('yt-dlp 校验失败（SHA-256 不一致）');
      }
      fs.renameSync(temp, target);
      return;
    } catch (error) {
      lastError = error as Error;
      if (signal?.aborted) throw new Error('已取消', { cause: error });
      // 网络中断时保留临时文件，下一轮用 Range 续传。
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  throw new Error(`yt-dlp 下载失败：${lastError?.message || '网络中断'}`);
}

export async function ensureYtDlp(
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const target = path.join(toolsDir(), `yt-dlp-${YTDLP.version}.exe`);
  if (fs.existsSync(target) && fs.statSync(target).size === YTDLP.size) return target;
  let lastError: Error | null = null;
  for (const url of YTDLP.urls) {
    try {
      onProgress(0, '准备下载 yt-dlp…');
      await downloadFile(url, target, onProgress, signal);
      return target;
    } catch (error) {
      lastError = error as Error;
      if (signal?.aborted) throw new Error('已取消', { cause: error });
    }
  }
  throw new Error(`yt-dlp 下载失败：${lastError?.message || '所有地址不可用'}`);
}

export interface OnlineDownloadResult {
  path: string;
}

export interface DownloadProgressInfo {
  percent: number;
  message: string;
  speed?: string;
  eta?: string;
}

export interface OnlineDownloadResult {
  path: string;
  paths: string[];
}

function outputTemplate(options: OnlineDownloadOptions, isList: boolean): string {
  const base =
    options.template === 'title-id'
      ? '%(title).80s [%(id)s].%(ext)s'
      : options.template === 'uploader-title'
        ? '%(uploader).40s - %(title).60s [%(id)s].%(ext)s'
        : '%(title).80s.%(ext)s';
  if (!isList) return base;
  const numbered = `%(playlist_index|1)02d - ${base}`;
  return options.folderPerList ? path.join('%(playlist_title|列表).60s', numbered) : numbered;
}

function runYtDlpJson(ytdlp: string, args: string[], timeoutMs = 90_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlp, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error('解析超时，请检查链接或网络'));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${String(chunk)}`;
      if (stdout.length > 25_000_000) {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`解析失败：${stderr.slice(-300) || `yt-dlp 退出码 ${code}`}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error('解析结果不是有效 JSON'));
      }
    });
  });
}

/** 解析链接：单个视频或分P/合集/番剧列表。 */
export async function probeOnlineVideo(url: string): Promise<DownloadProbeResult> {
  const target = String(url || '').trim();
  try {
    const parsed = new URL(target);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('protocol');
  } catch {
    throw new Error('链接格式不对');
  }
  const ytdlp = await ensureYtDlp(() => undefined);
  const json = await runYtDlpJson(ytdlp, [
    '-J',
    '--flat-playlist',
    '--playlist-end',
    '100',
    '--no-warnings',
    target
  ]);

  const rawEntries = Array.isArray(json.entries) ? (json.entries as Array<Record<string, unknown>>) : [];
  const entries: DownloadProbeEntry[] = rawEntries
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const thumbnails = Array.isArray(item.thumbnails)
        ? (item.thumbnails as Array<{ url?: string }>)
        : [];
      return {
        index: index + 1,
        id: String(item.id || ''),
        title: String(item.title || `第 ${index + 1} 个`),
        duration: Number(item.duration) || 0,
        url: String(item.webpage_url || item.url || target),
        thumbnail: thumbnails.length ? String(thumbnails[thumbnails.length - 1]?.url || '') : ''
      };
    });

  const kind: DownloadProbeResult['kind'] =
    entries.length > 1 || json._type === 'playlist' || json._type === 'multi_video'
      ? 'playlist'
      : 'single';

  const thumbnails = Array.isArray(json.thumbnails) ? (json.thumbnails as Array<{ url?: string }>) : [];
  const duration =
    Number(json.duration) ||
    entries.reduce((sum, item) => sum + (item.duration || 0), 0);

  return {
    kind,
    id: String(json.id || ''),
    title: String(json.title || '未命名视频'),
    uploader: String(json.uploader || json.channel || json.creator || ''),
    duration,
    thumbnail: String(
      json.thumbnail || (thumbnails.length ? thumbnails[thumbnails.length - 1]?.url : '') ||
        entries[0]?.thumbnail ||
        ''
    ),
    webpageUrl: String(json.webpage_url || target),
    entries: kind === 'playlist' ? entries : []
  };
}

export async function downloadOnlineVideo(
  url: string,
  onProgress: (info: DownloadProgressInfo) => void,
  signal?: AbortSignal,
  options: OnlineDownloadOptions = {}
): Promise<OnlineDownloadResult> {
  const target = String(url || '').trim();
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error('链接格式不对');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('只支持 http/https 链接');
  const report = (percent: number, message: string, speed?: string, eta?: string) =>
    onProgress({ percent, message, speed, eta });
  const ytdlp = await ensureYtDlp((percent, message) => report(percent, message), signal);
  const outputDir =
    String(options.dir || '').trim() || path.join(app.getPath('downloads'), 'Shizi');
  fs.mkdirSync(outputDir, { recursive: true });
  const resultFile = path.join(os.tmpdir(), `shizi-ytdlp-${Date.now()}.txt`);
  const quality = options.quality || 'best';
  const audioOnly = options.audioOnly === true;
  const isList = Array.isArray(options.playlistItems) && options.playlistItems.length > 0;
  const format = audioOnly
    ? 'ba/b'
    : quality === 'best'
      ? 'bv*+ba/b'
      : `bv*[height<=${quality}]+ba/b[height<=${quality}]`;
  // DASH 分片并发下载；比默认串行快很多，同时不至于打满带宽/被站点限流。
  const args = [
    '--newline',
    '--no-warnings',
    '--concurrent-fragments',
    '8',
    '--retries',
    '10',
    '--fragment-retries',
    '10'
  ];
  if (isList) {
    args.push('--yes-playlist', '--playlist-items', options.playlistItems!.join(','));
  } else {
    args.push('--no-playlist');
  }
  args.push(
    '-f',
    format,
    '-o',
    path.join(outputDir, outputTemplate(options, isList)),
    '--print-to-file',
    'after_move:filepath',
    resultFile
  );
  if (audioOnly) {
    args.push('--extract-audio', '--audio-format', options.audioFormat === 'mp3' ? 'mp3' : 'm4a');
  } else {
    args.push('--merge-output-format', 'mp4');
  }
  if (options.cover !== false) args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
  if (options.subtitles === true) {
    args.push('--write-subs', '--write-auto-subs', '--sub-langs', 'all', '--convert-subs', 'srt');
  }
  if (options.metadata === true) args.push('--write-info-json', '--write-description');
  if (ffmpegStatic) args.push('--ffmpeg-location', ffmpegStatic);
  args.push(target);

  report(0, isList ? `准备下载 ${options.playlistItems!.length} 个条目…` : '解析链接…');
  let itemIndex = 1;
  let itemTotal = isList ? options.playlistItems!.length : 1;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ytdlp, args, { windowsHide: true });
    let stderr = '';
    const abort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      reject(new Error('已取消'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const item = parseYtDlpItem(line);
        if (item) {
          itemIndex = item.index;
          itemTotal = item.total || itemTotal;
          continue;
        }
        const progress = parseYtDlpProgress(line);
        if (progress) {
          const overall = overallPercent(itemIndex, itemTotal, progress.percent);
          const label =
            itemTotal > 1
              ? `下载中 ${overall}%（第 ${itemIndex}/${itemTotal} 项）`
              : `下载中 ${overall}%`;
          report(overall, label, progress.speed, progress.eta);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-3000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp 退出码 ${code}：${stderr.slice(-400)}`));
    });
  });
  let paths: string[] = [];
  try {
    paths = fs
      .readFileSync(resultFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    // ignore
  } finally {
    fs.rmSync(resultFile, { force: true });
  }
  const file = paths[paths.length - 1] || '';
  if (!file || !fs.existsSync(file)) {
    throw new Error('下载完成，但没有找到输出文件');
  }
  report(100, isList ? `下载完成 · ${paths.length} 个文件` : '下载完成');
  return { path: file, paths };
}
