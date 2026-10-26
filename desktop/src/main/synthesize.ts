import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import type { SubtitleLine, SynthesizeRequest } from '../shared/types';
import { buildAss } from '../shared/ass';
import { probeDuration } from './media';

function srtTime(seconds: number): string {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function buildSrt(lines: SubtitleLine[]): string {
  return `${lines
    .map((line, index) => {
      const start = Math.max(0, line.start);
      const end = Math.max(start + 0.2, line.end);
      return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${line.text}`;
    })
    .join('\n\n')}\n`;
}

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
  const subtitleFile = path.join(temp, request.mode === 'hard' ? 'sub.ass' : 'sub.srt');
  if (request.mode === 'hard') {
    fs.writeFileSync(
      subtitleFile,
      buildAss(request.lines, {
        style: request.style,
        translated: request.translatedLines
      }),
      'utf8'
    );
  } else {
    fs.writeFileSync(subtitleFile, buildSrt(request.lines), 'utf8');
  }

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
          path.extname(outputPath).toLowerCase() === '.mkv' ? 'srt' : 'mov_text',
          '-metadata:s:s:0',
          'language=chi',
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
