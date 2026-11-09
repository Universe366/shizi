import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 下载固定版本的 yt-dlp 到 resources/yt-dlp/，打包时由 extraResources 带进安装包。
 * 不把 exe 提交进仓库；CI 和本地构建时自动获取，已存在则跳过。
 */
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '2026.10.26';
const targetDir = path.join(desktop, 'resources', 'yt-dlp');
const asset =
  process.platform === 'win32'
    ? 'yt-dlp.exe'
    : process.platform === 'darwin'
      ? 'yt-dlp_macos'
      : 'yt-dlp_linux';
const target = path.join(targetDir, asset);
const marker = path.join(targetDir, '.version');
const force = process.argv.includes('--force');

if (!force && fs.existsSync(target) && fs.existsSync(marker)) {
  try {
    if (fs.readFileSync(marker, 'utf8').trim() === VERSION) {
      console.log('[yt-dlp] up to date', VERSION);
      process.exit(0);
    }
  } catch {
    // 重新下载
  }
}

function run(args) {
  return spawnSync(args[0], args.slice(1), { encoding: 'utf8', timeout: 180000 });
}

function download(url, output, resume = true) {
  const curl = run([
    'curl',
    '-L',
    '--fail',
    '--retry',
    '3',
    '--connect-timeout',
    '20',
    ...(resume ? ['--continue-at', '-'] : []),
    '-o',
    output,
    url
  ]);
  if (curl.status === 0) return;
  throw new Error(`下载失败（curl ${curl.status}）：${url}`);
}

fs.mkdirSync(targetDir, { recursive: true });
const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}`;
console.log('[yt-dlp] fetching', VERSION, asset);

const sumsFile = path.join(targetDir, 'SHA2-256SUMS');
fs.rmSync(sumsFile, { force: true });
download(`${base}/SHA2-256SUMS`, sumsFile, false);
const sums = fs.readFileSync(sumsFile, 'utf8');
const line = sums.split(/\r?\n/).find((item) => item.trim().endsWith(`  ${asset}`));
if (!line) throw new Error(`校验文件里没有 ${asset}`);
const expected = line.trim().split(/\s+/)[0].toLowerCase();

const tmp = `${target}.download`;
download(`${base}/${asset}`, tmp);
const actual = spawnSync('certutil', ['-hashfile', tmp, 'SHA256'], { encoding: 'utf8' });
if (actual.status === 0) {
  const got = actual.stdout.replace(/\s+/g, '').toLowerCase();
  if (!got.includes(expected)) throw new Error('SHA-256 校验失败');
} else {
  // 非 Windows 或没有 certutil 时用 Node 计算
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(fs.readFileSync(tmp)).digest('hex');
  if (hash !== expected) throw new Error('SHA-256 校验失败');
}
fs.rmSync(target, { force: true });
fs.renameSync(tmp, target);
fs.writeFileSync(marker, `${VERSION}\n`, 'utf8');
try {
  fs.chmodSync(target, 0o755);
} catch {
  // Windows 忽略
}
console.log('[yt-dlp] ready', target);
