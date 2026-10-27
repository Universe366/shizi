import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import type { SynthesizeRequest } from '../shared/types';
import { buildAss } from '../shared/ass';
import { probeDuration } from './media';

export interface SynthesizeProgress {
  percent: number;
  message: string;
}

export async function synthesizeVideo(
  request: SynthesizeRequest,
  outputPath: string,
  onProgress: (progress: SynthesizeProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const ffmpeg = ffmpegStatic;
  if (!ffmpeg) throw new Error('没有找到 FFmpeg，无法合成视频');
  const videoPath = path.resolve(request.videoPath);
  if (!fs.existsSync(videoPath)) throw new Error(`找不到视频文件：${videoPath}`);
  if (!request.lines.length) throw new Error('没有字幕，无法合成');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-synth-'));
  const duration = await probeDuration(videoPath);
  // 软字幕也封装 ASS：播放器里可以开关字幕，样式（字体/颜色/位置）也能保留。
  const subtitleFile = path.join(temp, 'sub.ass');
  fs.writeFileSync(
    subtitleFile,
    buildAss(request.lines, {
      style: request.style,
      translated: request.translatedLines
    }),
    'utf8'
  );

  const args =
    request.mode === 'hard'
      ? [
          '-y',
          '-i',
          videoPath,
          '-vf',
          'ass=sub.ass',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+faststart',
          outputPath
        ]
      : [
          '-y',
          '-i',
          videoPath,
          '-i',
          subtitleFile,
          '-map',
          '0',
          '-map',
          '1',
          '-c',
          'copy',
          '-c:s',
          'ass',
          '-metadata:s:s:0',
          `language=${request.softLanguage || 'chi'}`,
          '-metadata:s:s:0',
          `title=${request.style?.bilingual ? '双语字幕' : '字幕'}`,
          outputPath
        ];

  onProgress({ percent: 0, message: '准备合成…' });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostats',
          '-progress',
          'pipe:1',
          ...args
        ],
        { cwd: temp, windowsHide: true }
      );
      let stderr = '';
      let lastPercent = -1;
      const abort = () => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      };
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', (chunk) => {
        const text = String(chunk);
        const match = /out_time_ms=(\d+)/.exec(text);
        const percentFromDuration =
          match && duration > 0
            ? Math.min(99, Math.round((Number(match[1]) / 1_000_000 / duration) * 100))
            : -1;
        if (percentFromDuration >= 0 && percentFromDuration !== lastPercent) {
          lastPercent = percentFromDuration;
          onProgress({ percent: percentFromDuration, message: `合成中 ${percentFromDuration}%` });
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-3000);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) {
          reject(new Error('已取消'));
          return;
        }
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg 退出码 ${code}：${stderr.slice(-400)}`));
      });
    });
    onProgress({ percent: 100, message: '合成完成' });
    return outputPath;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
