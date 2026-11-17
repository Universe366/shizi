/**
 * 清理本地工作区里可重新生成的构建产物。
 * 不碰 node_modules，也不删 resources/yt-dlp（下次构建会重新下载 23MB）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const workspace = path.resolve(desktop, '..');

const targets = [
  path.join(desktop, 'out'),
  path.join(desktop, 'release'),
  path.join(desktop, 'resources/extension'),
  path.join(desktop, 'resources/page-bridge.js'),
  path.join(desktop, 'resources/tray.png'),
  path.join(workspace, 'verify/build'),
  path.join(workspace, 'shizi-extension/_metadata')
];

let removed = 0;
for (const target of targets) {
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, { recursive: true, force: true });
  removed += 1;
  console.log('[clean] removed', path.relative(workspace, target));
}
console.log(`[clean] done, ${removed} target(s). node_modules / resources/yt-dlp 保留。`);
