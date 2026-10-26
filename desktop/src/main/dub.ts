import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import type { SubtitleLine } from '../shared/types';
import { probeDuration } from './media';

/**
 * 配音（实验性）：用 Windows 自带 SAPI 逐条合成，再按字幕时间轴对齐成音轨。
 * 优点是完全离线、无需 Key；音色取决于系统已安装语音（中文一般有 Huihui）。
 */

const PS_SCRIPT = `param([string]$InputFile,[string]$OutDir,[string]$Voice)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($Voice) { try { $synth.SelectVoice($Voice) } catch { } }
$items = Get-Content -Raw -Encoding UTF8 -LiteralPath $InputFile | ConvertFrom-Json
$index = 0
foreach ($item in $items) {
  $file = Join-Path $OutDir ("line-{0:D4}.wav" -f $index)
  $synth.SetOutputToWaveFile($file)
  $synth.Speak([string]$item.text)
  $synth.SetOutputToNull()
  Write-Output ("DONE " + $index)
  $index++
}
$synth.Dispose()
`;

function runPowerShell(args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { windowsHide: true }
    );
    let stdout = '';
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
      stdout = `${stdout}${String(chunk)}`.slice(-20000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-4000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (code === 0) resolve(stdout);
      else reject(new Error(`PowerShell 退出码 ${code}：${stderr.slice(-400)}`));
    });
  });
}

export async function listTtsVoices(): Promise<string[]> {
  const out = await runPowerShell([
    '-Command',
    'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }'
  ]);
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function atempoChain(rate: number): string {
  const parts: string[] = [];
  let speed = Math.max(0.5, Math.min(4, rate));
  while (speed > 2) {
    parts.push('atempo=2');
    speed /= 2;
  }
  parts.push(`atempo=${speed.toFixed(3)}`);
  return parts.join(',');
}

function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  const ffmpeg = ffmpegStatic;
  if (!ffmpeg) return Promise.reject(new Error('没有找到 FFmpeg'));
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      windowsHide: true
    });
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
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg 退出码 ${code}：${stderr.slice(-300)}`));
    });
  });
}

export interface DubOptions {
  voice?: string;
  /** video：替换视频音轨；audio：只输出 m4a */
  mode: 'audio' | 'video';
  title: string;
}

export async function dubVideo(
  videoPath: string,
  lines: SubtitleLine[],
  outputPath: string,
  options: DubOptions,
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal
): Promise<void> {
  if (process.platform !== 'win32') throw new Error('本地配音目前只支持 Windows');
  if (!lines.length) throw new Error('没有字幕，无法配音');
  if (lines.length > 300) throw new Error('字幕超过 300 行，请先断句/精简后再配音');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-dub-'));
  const script = path.join(work, 'tts.ps1');
  const input = path.join(work, 'lines.json');
  fs.writeFileSync(script, `\ufeff${PS_SCRIPT}`, 'utf8');
  fs.writeFileSync(
    input,
    JSON.stringify(lines.map((line) => ({ text: line.text }))),
    'utf8'
  );
  const ttsDir = path.join(work, 'tts');
  fs.mkdirSync(ttsDir, { recursive: true });

  try {
    onProgress(2, '合成语音…');
    let done = 0;
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        input,
        ttsDir,
        options.voice || ''
      ],
      { windowsHide: true }
    );
    let stderr = '';
    const abort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    };
    if (signal?.aborted) throw new Error('已取消');
    signal?.addEventListener('abort', abort, { once: true });
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        const matches = String(chunk).match(/DONE \d+/g);
        if (matches) {
          done += matches.length;
          onProgress(
            2 + Math.round((done / lines.length) * 50),
            `合成语音 ${done} / ${lines.length}`
          );
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-2000);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) reject(new Error('已取消'));
        else if (code === 0) resolve();
        else reject(new Error(`语音合成失败：${stderr.slice(-300)}`));
      });
    });

    // 逐条按时间轴做“槽位”：TTS 太长就加速，太短就补静音。
    const clips: string[] = [];
    let cursor = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (signal?.aborted) throw new Error('已取消');
      const line = lines[index];
      const tts = path.join(ttsDir, `line-${String(index).padStart(4, '0')}.wav`);
      if (!fs.existsSync(tts)) continue;
      const slot = Math.max(0.25, line.end - line.start);
      const ttsDuration = await probeDuration(tts);
      const speed = ttsDuration > slot ? Math.min(4, ttsDuration / slot) : 1;
      const gap = Math.max(0, line.start - cursor);
      if (gap > 0.05) {
        const silence = path.join(work, `gap-${index}.wav`);
        await runFfmpeg(
          ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(gap), silence],
          signal
        );
        clips.push(silence);
      }
      const fitted = path.join(work, `slot-${index}.wav`);
      await runFfmpeg(
        [
          '-i',
          tts,
          '-af',
          `${speed > 1.001 ? `${atempoChain(speed)},` : ''}apad`,
          '-t',
          String(slot),
          '-ar',
          '48000',
          '-ac',
          '1',
          fitted
        ],
        signal
      );
      clips.push(fitted);
      cursor = Math.max(cursor, line.start) + slot;
      if (index % 10 === 0) {
        onProgress(52 + Math.round((index / lines.length) * 36), `对齐 ${index + 1} / ${lines.length}`);
      }
    }
    if (!clips.length) throw new Error('没有生成任何配音片段');
    const list = path.join(work, 'concat.txt');
    fs.writeFileSync(
      list,
      clips.map((clip) => `file '${clip.replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8'
    );
    const merged = path.join(work, 'dub.wav');
    onProgress(90, '拼接音轨…');
    await runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', merged], signal);

    if (options.mode === 'audio') {
      await runFfmpeg(['-i', merged, '-c:a', 'aac', '-b:a', '160k', outputPath], signal);
    } else {
      onProgress(96, '封装视频…');
      await runFfmpeg(
        [
          '-i',
          videoPath,
          '-i',
          merged,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          '160k',
          '-shortest',
          '-movflags',
          '+faststart',
          outputPath
        ],
        signal
      );
    }
    onProgress(100, '配音完成');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
