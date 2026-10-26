import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { app, session } from 'electron';

export type LocalModelId = 'tiny' | 'base' | 'small';

interface RemoteFile {
  urls: string[];
  sha256: string;
  size: number;
}

// whisper.cpp 官方 ggml 模型（固定版本，不随上游 latest 漂移）。
// 主地址用国内可访问的 hf-mirror，失败再试 huggingface。
export const LOCAL_MODELS: Record<LocalModelId, RemoteFile & { label: string }> = {
  tiny: {
    label: 'tiny · 最快、准确率一般（约 74MB）',
    size: 77691713,
    sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21',
    urls: [
      'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin'
    ]
  },
  base: {
    label: 'base · 推荐（约 141MB）',
    size: 147951465,
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    urls: [
      'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'
    ]
  },
  small: {
    label: 'small · 更准但更慢（约 465MB）',
    size: 487601967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    urls: [
      'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
    ]
  }
};

// whisper.cpp v1.9.2 的 Windows x64 CPU 构建；固定 URL + SHA-256。
const BINARY_ZIP: RemoteFile & { version: string } = {
  version: 'v1.9.2',
  size: 8194445,
  sha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a',
  urls: [
    'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip'
  ]
};

export interface DownloadProgress {
  key: string;
  percent: number;
  received: number;
  total: number;
  message: string;
}

function whisperDir(): string {
  const dir = path.join(app.getPath('userData'), 'models', 'whisper');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function localModelPath(id: LocalModelId): string {
  return path.join(whisperDir(), `ggml-${id}.bin`);
}

function existingModel(id: LocalModelId): string | null {
  const file = localModelPath(id);
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size === LOCAL_MODELS[id].size ? file : null;
  } catch {
    return null;
  }
}

async function downloadTo(
  file: RemoteFile,
  target: string,
  key: string,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const temp = `${target}.download`;
  let lastError: Error | null = null;
  for (const url of file.urls) {
    if (signal?.aborted) throw new Error('已取消');
    try {
      const response = await session.defaultSession.fetch(url, { signal });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      const total = Number(response.headers.get('content-length')) || file.size;
      const hash = createHash('sha256');
      const stream = fs.createWriteStream(temp);
      const reader = response.body.getReader();
      let received = 0;
      let lastSent = -1;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          hash.update(chunk);
          received += chunk.length;
          if (!stream.write(chunk)) {
            await new Promise<void>((resolve) => {
              stream.once('drain', () => resolve());
            });
          }
          const percent = total ? Math.min(100, Math.floor((received / total) * 100)) : 0;
          if (percent !== lastSent) {
            lastSent = percent;
            onProgress({
              key,
              percent,
              received,
              total,
              message: `下载中 ${percent}%`
            });
          }
        }
      } finally {
        await new Promise<void>((resolve) => {
          stream.end(() => resolve());
        });
      }
      const digest = hash.digest('hex');
      if (digest !== file.sha256) {
        fs.rmSync(temp, { force: true });
        throw new Error('下载文件校验失败（SHA-256 不一致）');
      }
      const stat = fs.statSync(temp);
      if (file.size && stat.size !== file.size) {
        fs.rmSync(temp, { force: true });
        throw new Error(`下载文件大小不对（${stat.size} / ${file.size}）`);
      }
      fs.renameSync(temp, target);
      onProgress({ key, percent: 100, received: stat.size, total: stat.size, message: '下载完成' });
      return;
    } catch (error) {
      lastError = error as Error;
      try {
        fs.rmSync(temp, { force: true });
      } catch {
        // ignore
      }
      if (signal?.aborted) throw new Error('已取消', { cause: error });
      // 换下一个镜像
    }
  }
  throw new Error(`下载失败：${lastError?.message || '所有下载地址都不可用'}`);
}

export async function downloadLocalModel(
  id: LocalModelId,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const existing = existingModel(id);
  if (existing) return existing;
  const source = LOCAL_MODELS[id];
  if (!source) throw new Error('未知的模型');
  const target = localModelPath(id);
  await downloadTo(source, target, `model:${id}`, onProgress, signal);
  return target;
}

function findWhisperExe(dir: string): string | null {  const queue = [dir];
  while (queue.length) {
    const current = queue.shift() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (/^whisper-cli\.exe$/i.test(entry.name)) return full;
    }
  }
  return null;
}

function extractZip(zip: string, dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const escapedZip = zip.replace(/'/g, "''");
    const escapedDir = dir.replace(/'/g, "''");
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDir}' -Force`
      ],
      { windowsHide: true }
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`解压失败（PowerShell ${code}）：${stderr.slice(-300)}`));
    });
  });
}

export async function downloadWhisperBinary(
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('一键下载只支持 Windows；其他系统请手动选择 whisper-cli');
  }
  const dir = whisperDir();
  const existing = findWhisperExe(dir);
  if (existing) return existing;
  const zip = path.join(dir, `whisper-bin-x64-${BINARY_ZIP.version}.zip`);
  if (!fs.existsSync(zip) || fs.statSync(zip).size !== BINARY_ZIP.size) {
    await downloadTo(BINARY_ZIP, zip, 'binary', onProgress, signal);
  }
  onProgress({ key: 'binary', percent: 92, received: 0, total: 0, message: '正在解压…' });
  const target = path.join(dir, 'whisper.cpp');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  await extractZip(zip, target);
  const exe = findWhisperExe(target);
  if (!exe) throw new Error('解压后没有找到 whisper-cli.exe');
  fs.rmSync(zip, { force: true });
  onProgress({ key: 'binary', percent: 100, received: 0, total: 0, message: '已就绪' });
  return exe;
}

/** 供设置页显示「已下载」状态：不触发任何网络请求。 */
export function localAsrStatus(): { models: Partial<Record<LocalModelId, string>>; binary: string | null } {
  const models: Partial<Record<LocalModelId, string>> = {};
  for (const id of Object.keys(LOCAL_MODELS) as LocalModelId[]) {
    const file = existingModel(id);
    if (file) models[id] = file;
  }
  return { models, binary: findWhisperExe(whisperDir()) };
}
