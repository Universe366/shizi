import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import { CONVERT_FORMATS, convertGroupOf } from '../shared/convertFormats';
import { probeDuration } from './media';

export interface ConvertResult {
  path: string;
}

function outputPath(input: string, target: string): string {
  const dir = path.join(app.getPath('downloads'), 'ShiziConvert');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.basename(input, path.extname(input)).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  let file = path.join(dir, `${base}.${target}`);
  let index = 2;
  while (fs.existsSync(file)) {
    file = path.join(dir, `${base} (${index}).${target}`);
    index += 1;
  }
  return file;
}

function argsFor(input: string, output: string, target: string): string[] {
  const group = convertGroupOf(input);
  const args = ['-y', '-i', input];
  if (target === 'mp3') args.push('-vn', '-c:a', 'libmp3lame', '-b:a', '192k');
  else if (target === 'm4a') args.push('-vn', '-c:a', 'aac', '-b:a', '192k');
  else if (target === 'wav') args.push('-vn', '-c:a', 'pcm_s16le');
  else if (target === 'flac') args.push('-vn', '-c:a', 'flac');
  else if (target === 'ogg') args.push('-vn', '-c:a', 'libvorbis', '-q:a', '5');
  else if (target === 'gif') args.push('-vf', 'fps=12,scale=640:-1:flags=lanczos', '-loop', '0');
  else if (group === 'image') args.push('-frames:v', '1');
  else if (target === 'webm') args.push('-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus');
  else if (target === 'mkv') args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac');
  else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '192k');
  args.push(output);
  return args;
}

export async function convertFile(
  input: string,
  target: string,
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal
): Promise<ConvertResult> {
  if (!fs.existsSync(input)) throw new Error('源文件不存在');
  const format = CONVERT_FORMATS.find((item) => item.id === target);
  if (!format) throw new Error('不支持的目标格式');
  if (!ffmpegStatic) throw new Error('缺少 ffmpeg，无法转换');
  const output = outputPath(input, format.ext);
  const duration = await probeDuration(input).catch(() => 0);
  onProgress(0, '准备转换…');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegStatic as string, argsFor(input, output, target), {
      windowsHide: true
    });
    let stderr = '';
    const abort = () => {
      try {
        child.kill('SIGKILL');
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
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
      const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(String(chunk));
      if (match && duration > 0) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        const percent = Math.min(99, Math.round((seconds / duration) * 100));
        onProgress(percent, `转换中 ${percent}%`);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (code === 0) resolve();
      else {
        try {
          fs.rmSync(output, { force: true });
        } catch {
          // ignore
        }
        reject(new Error(`转换失败（ffmpeg ${code}）：${stderr.slice(-240)}`));
      }
    });
  });
  onProgress(100, '转换完成');
  return { path: output };
}
