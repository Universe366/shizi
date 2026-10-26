import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import { app } from 'electron';
import type { OnlineDownloadOptions } from '../shared/types';

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

export async function downloadOnlineVideo(
  url: string,
  onProgress: (percent: number, message: string) => void,
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
  const ytdlp = await ensureYtDlp(onProgress, signal);
  const outputDir = path.join(app.getPath('downloads'), 'Shizi');
  fs.mkdirSync(outputDir, { recursive: true });
  const resultFile = path.join(os.tmpdir(), `shizi-ytdlp-${Date.now()}.txt`);
  const quality = options.quality || 'best';
  const audioOnly = options.audioOnly === true;
  const format = audioOnly
    ? 'ba/b'
    : quality === 'best'
      ? 'bv*+ba/b'
      : `bv*[height<=${quality}]+ba/b[height<=${quality}]`;
  const args = [
    '--no-playlist',
    '--newline',
    '--no-warnings',
    '-f',
    format,
    '-o',
    path.join(outputDir, '%(title).80s [%(id)s].%(ext)s'),
    '--print-to-file',
    'after_move:filepath',
    resultFile
  ];
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

  onProgress(0, '解析链接…');
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
      const text = String(chunk);
      const match = /\[download\]\s+([\d.]+)%/.exec(text);
      if (match) {
        const percent = Math.min(99, Math.round(Number(match[1])));
        onProgress(percent, `下载中 ${percent}%`);
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
  let file = '';
  try {
    file = fs.readFileSync(resultFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).pop() || '';
  } catch {
    // ignore
  } finally {
    fs.rmSync(resultFile, { force: true });
  }
  if (!file || !fs.existsSync(file)) {
    throw new Error('下载完成，但没有找到输出文件');
  }
  onProgress(100, '下载完成');
  return { path: file };
}
