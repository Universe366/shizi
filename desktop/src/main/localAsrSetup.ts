import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { app, session } from 'electron';

export type LocalModelId = 'tiny' | 'base' | 'small' | 'medium' | 'large-v3-turbo';
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
  },
  medium: {
    label: 'medium · 高质量、很慢（约 1.5GB）',
    size: 1533763059,
    sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208',
    urls: [
      'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin'
    ]
  },
  'large-v3-turbo': {
    label: 'large-v3-turbo · 大模型加速版（约 1.6GB）',
    size: 1624555275,
    sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
    urls: [
      'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin'
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

let migrated = false;

function moveDirectory(from: string, to: string): void {
  if (path.resolve(from) === path.resolve(to)) return;
  if (!fs.existsSync(from)) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(from, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (fs.existsSync(target)) continue;
    try {
      fs.renameSync(source, target);
    } catch {
      try {
        fs.cpSync(source, target, { recursive: true });
        fs.rmSync(source, { recursive: true, force: true });
      } catch {
        // 搬不动就留着，不影响新下载
      }
    }
  }
}

/**
 * 模型/二进制固定放 userData：软件更新会替换安装目录，放程序目录会导致每次更新后模型消失。
 * 旧版本存在安装目录的模型会自动搬一次。
 */
export function localAsrDir(): string {
  const stable = path.join(app.getPath('userData'), 'models', 'whisper');
  fs.mkdirSync(stable, { recursive: true });
  if (!migrated) {
    migrated = true;
    moveDirectory(path.join(path.dirname(app.getPath('exe')), 'models', 'whisper'), stable);
  }
  return stable;
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

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * 模型下载：global fetch（比 Chromium session 更适合大文件）、Range 续传、
 * 空闲超时重试、下载中持续回报速度，不会因为卡住而让进度条永远停在 0%。
 */
async function downloadTo(
  file: RemoteFile,
  target: string,
  key: string,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const temp = `${target}.download`;
  let lastError: Error | null = null;
  const attemptsPerUrl = 4;
  const transports = [
    (url: string, init: RequestInit) => fetch(url, init),
    (url: string, init: RequestInit) => session.defaultSession.fetch(url, init)
  ];

  // 已完整下载过（上次校验失败除外）就直接校验返回。
  if (sizeOf(temp) === file.size) {
    if ((await hashFile(temp)) === file.sha256) {
      fs.renameSync(temp, target);
      onProgress({ key, percent: 100, received: file.size, total: file.size, message: '下载完成' });
      return;
    }
    fs.rmSync(temp, { force: true });
  }

  for (const url of file.urls) {
    for (let attempt = 0; attempt < attemptsPerUrl; attempt += 1) {
      if (signal?.aborted) throw new Error('已取消');
      let start = sizeOf(temp);
      if (start > file.size) {
        fs.rmSync(temp, { force: true });
        start = 0;
      }
      onProgress({
        key,
        percent: file.size ? Math.min(99, Math.floor((start / file.size) * 100)) : 0,
        received: start,
        total: file.size,
        message: start > 0 ? `续传中（已有 ${Math.round(start / 1024 / 1024)}MB）` : '连接下载地址…'
      });

      const controller = new AbortController();
      let idleTimer: NodeJS.Timeout | null = null;
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(new Error('连接超时')), 45000);
      };
      const forward = () => controller.abort();
      signal?.addEventListener('abort', forward, { once: true });
      resetIdle();
      let received = start;
      let lastReport = 0;
      let lastPercent = -1;
      try {
        const requestUrl = url;
        const response = await transports[attempt % transports.length](requestUrl, {
          signal: controller.signal,
          redirect: 'follow',
          headers: start > 0 ? { Range: `bytes=${start}-` } : undefined
        });
        if (response.status === 416 && start > 0) {
          if (sizeOf(temp) === file.size && (await hashFile(temp)) === file.sha256) {
            fs.renameSync(temp, target);
            onProgress({ key, percent: 100, received: file.size, total: file.size, message: '下载完成' });
            return;
          }
          fs.rmSync(temp, { force: true });
          start = 0;
          throw new Error('续传位置无效，重新下载');
        }
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        if (start > 0 && response.status !== 206) {
          // 服务器不支持 Range，只能从头下。
          fs.rmSync(temp, { force: true });
          start = 0;
        }
        const length = Number(response.headers.get('content-length'));
        const total = start + (Number.isFinite(length) && length > 0 ? length : file.size - start);
        const stream = fs.createWriteStream(temp, { flags: start > 0 ? 'a' : 'w' });
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            resetIdle();
            const chunk = Buffer.from(value);
            received += chunk.length;
            if (!stream.write(chunk)) {
              await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
            }
            const now = Date.now();
            const percent = total ? Math.min(99, Math.floor((received / total) * 100)) : 0;
            if (percent !== lastPercent || now - lastReport > 600) {
              lastPercent = percent;
              lastReport = now;
              onProgress({
                key,
                percent,
                received,
                total,
                message:
                  `下载中 ${percent}% · ${(received / 1024 / 1024).toFixed(1)} / ` +
                  `${(total / 1024 / 1024).toFixed(1)} MB`
              });
            }
          }
        } finally {
          await new Promise<void>((resolve) => stream.end(() => resolve()));
        }
        const actual = sizeOf(temp);
        if (file.size && actual !== file.size) {
          throw new Error(`文件不完整（${(actual / 1024 / 1024).toFixed(1)}MB / ${(file.size / 1024 / 1024).toFixed(1)}MB）`);
        }
        onProgress({
          key,
          percent: 99,
          received: actual,
          total: file.size,
          message: '校验完整性…'
        });
        const digest = await hashFile(temp);
        if (digest !== file.sha256) {
          fs.rmSync(temp, { force: true });
          throw new Error('校验失败（SHA-256 不一致）');
        }
        fs.renameSync(temp, target);
        onProgress({ key, percent: 100, received: actual, total: actual, message: '下载完成' });
        return;
      } catch (error) {
        lastError = error as Error;
        if (signal?.aborted) throw new Error('已取消', { cause: error });
        // 保留 .download 供下一次 Range 续传；校验失败时上面已主动清空。
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        signal?.removeEventListener('abort', forward);
      }
    }
  }
  const partial = sizeOf(temp);
  throw new Error(
    `下载失败：${lastError?.message || '所有下载地址都不可用'}` +
      (partial > 0 ? `（已保留 ${(partial / 1024 / 1024).toFixed(1)}MB，下次会继续）` : '')
  );
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
  const note = '模型保存在用户数据目录，软件更新不会丢';
  return {
    dir,
    models,
    binaries,
    binary: found ? binaries[found] || null : null,
    note
  };
}

export function deleteLocalModel(id: LocalModelId): boolean {
  const file = localModelPath(id);
  try {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    return !fs.existsSync(file);
  } catch {
    return false;
  }
}

export function deleteLocalBinary(variant: LocalBinaryVariant): boolean {
  const dir = localAsrDir();
  try {
    fs.rmSync(path.join(dir, LOCAL_BINARIES[variant].dir), { recursive: true, force: true });
    fs.rmSync(path.join(dir, `${LOCAL_BINARIES[variant].dir}.zip`), { force: true });
    return true;
  } catch {
    return false;
  }
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
