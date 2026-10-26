import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { app, session } from 'electron';

export type LocalModelId = 'tiny' | 'base' | 'small';
export type LocalBinaryVariant = 'cpu' | 'vulkan' | 'cuda118' | 'cuda124';

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

// 计算后端：
// - cpu / cuda：官方 ggml-org/whisper.cpp v1.9.2 构建；
// - vulkan：lemonade-sdk/whisper.cpp-rocm 的 Windows Vulkan 构建（AMD / NVIDIA / Intel 通用）。
// 所有包都固定 URL + SHA-256，避免上游 latest 漂移。
export const LOCAL_BINARIES: Record<
  LocalBinaryVariant,
  RemoteFile & { label: string; dir: string; note: string }
> = {
  cpu: {
    label: 'CPU（通用，约 8MB）',
    note: '没有独立显卡或不想折腾时选这个。',
    dir: 'whisper.cpp-cpu',
    size: 8194445,
    sha256: '49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a',
    urls: [
      'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip'
    ]
  },
  vulkan: {
    label: 'Vulkan（AMD / NVIDIA / Intel，约 20MB）',
    note: 'AMD 显卡推荐；需要显卡驱动带 Vulkan 运行时。',
    dir: 'whisper.cpp-vulkan',
    size: 21203995,
    sha256: 'e0d20a0f92e31b98adc0faf71172efc810b701e6391a9d858ca045bff26f77cd',
    urls: [
      'https://github.com/lemonade-sdk/whisper.cpp-rocm/releases/download/v1.8.4/whisper-v1.8.4-windows-vulkan-x64.zip'
    ]
  },
  cuda118: {
    label: 'NVIDIA CUDA 11.8（约 257MB）',
    note: '较旧的 NVIDIA 驱动 / 显卡选这个。',
    dir: 'whisper.cpp-cuda118',
    size: 269446789,
    sha256: '1776668730f5594a0b15f930225779e863dd8280397f9ee7c6e47ccf82bbb203',
    urls: [
      'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-cublas-11.8.0-bin-x64.zip'
    ]
  },
  cuda124: {
    label: 'NVIDIA CUDA 12.4（约 640MB）',
    note: '较新的 NVIDIA 驱动推荐；包体较大。',
    dir: 'whisper.cpp-cuda124',
    size: 670611449,
    sha256: '443110ddaad70d4290ab2e77179e31cf712035bbc4fad56bb4519a90c917b39c',
    urls: [
      'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-cublas-12.4.0-bin-x64.zip'
    ]
  }
};

export interface DownloadProgress {
  key: string;
  percent: number;
  received: number;
  total: number;
  message: string;
}

function writable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** 旧版本把模型放在 userData 里；换到安装目录后自动搬一次。 */
function migrateLegacy(target: string): void {
  const legacy = path.join(app.getPath('userData'), 'models', 'whisper');
  if (path.resolve(legacy) === path.resolve(target)) return;
  if (!fs.existsSync(legacy)) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(legacy, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const from = path.join(legacy, entry.name);
    const to = path.join(target, entry.name);
    if (fs.existsSync(to)) continue;
    try {
      fs.renameSync(from, to);
    } catch {
      try {
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
      } catch {
        // 搬不动就留着，不影响新下载
      }
    }
  }
}

/**
 * 模型/二进制优先放软件安装目录（绿色版就是程序目录）；
 * 安装到 Program Files 等不可写位置时退回 userData，并把实际目录显示在设置里。
 */
export function localAsrDir(): string {
  const base = path.dirname(app.getPath('exe'));
  const primary = path.join(base, 'models', 'whisper');
  if (writable(primary)) {
    migrateLegacy(primary);
    return primary;
  }
  const fallback = path.join(app.getPath('userData'), 'models', 'whisper');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

export function localModelPath(id: LocalModelId): string {
  return path.join(localAsrDir(), `ggml-${id}.bin`);
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

function findWhisperExe(dir: string): string | null {
  const queue = [dir];
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
  variant: LocalBinaryVariant = 'cpu',
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('一键下载只支持 Windows；其他系统请手动选择 whisper-cli');
  }
  const source = LOCAL_BINARIES[variant];
  if (!source) throw new Error('未知的 whisper.cpp 构建');
  const dir = localAsrDir();
  const target = path.join(dir, source.dir);
  const existing = findWhisperExe(target);
  if (existing) return existing;
  const zip = path.join(dir, `${source.dir}.zip`);
  if (!fs.existsSync(zip) || fs.statSync(zip).size !== source.size) {
    await downloadTo(source, zip, `binary:${variant}`, onProgress, signal);
  }
  onProgress({
    key: `binary:${variant}`,
    percent: 92,
    received: 0,
    total: 0,
    message: '正在解压…'
  });
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  await extractZip(zip, target);
  const exe = findWhisperExe(target);
  if (!exe) throw new Error('解压后没有找到 whisper-cli.exe');
  fs.rmSync(zip, { force: true });
  onProgress({
    key: `binary:${variant}`,
    percent: 100,
    received: 0,
    total: 0,
    message: '已就绪'
  });
  return exe;
}

/** 供设置页显示「已下载」状态：不触发任何网络请求。 */
export function localAsrStatus(): {
  dir: string;
  models: Partial<Record<LocalModelId, string>>;
  binaries: Partial<Record<LocalBinaryVariant, string>>;
  binary: string | null;
  note: string;
} {
  const dir = localAsrDir();
  const models: Partial<Record<LocalModelId, string>> = {};
  for (const id of Object.keys(LOCAL_MODELS) as LocalModelId[]) {
    const file = existingModel(id);
    if (file) models[id] = file;
  }
  const binaries: Partial<Record<LocalBinaryVariant, string>> = {};
  for (const variant of Object.keys(LOCAL_BINARIES) as LocalBinaryVariant[]) {
    const exe = findWhisperExe(path.join(dir, LOCAL_BINARIES[variant].dir));
    if (exe) binaries[variant] = exe;
  }
  // 0.38.26 之前下载的旧目录（whisper.cpp）按 CPU 构建继续可用。
  if (!binaries.cpu) {
    const legacy = findWhisperExe(path.join(dir, 'whisper.cpp'));
    if (legacy) binaries.cpu = legacy;
  }
  const preferred: LocalBinaryVariant[] = ['cuda124', 'cuda118', 'vulkan', 'cpu'];
  const found = preferred.find((variant) => binaries[variant]);
  const primary = path.join(path.dirname(app.getPath('exe')), 'models', 'whisper');
  const note = writable(primary) ? '模型保存在软件目录' : '安装目录不可写，已退回用户数据目录';
  return {
    dir,
    models,
    binaries,
    binary: found ? binaries[found] || null : null,
    note
  };
}

/** 读取显卡名称，供「检测显卡」按钮选择 CUDA / Vulkan。 */
export async function detectGpuNames(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name'
      ],
      { windowsHide: true }
    );
    let out = '';
    child.stdout.on('data', (chunk) => {
      out = `${out}${String(chunk)}`.slice(-4000);
    });
    child.on('error', () => resolve([]));
    child.on('close', () =>
      resolve(
        out
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      )
    );
  });
}
