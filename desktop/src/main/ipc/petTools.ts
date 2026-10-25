import { clipboard, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PageInfo } from '../../shared/types';
import { transcribeFile } from '../asr';
import { compressDataUrl } from '../imageData';
import { failure } from './shared';

const execFileAsync = promisify(execFile);

function fallbackInfo(): PageInfo {
  return {
    kind: 'page',
    bvid: null,
    aid: null,
    cid: null,
    epId: null,
    seasonId: null,
    page: 1,
    partTitle: '',
    parts: [],
    title: '桌宠语音',
    owner: '',
    desc: '',
    duration: 0,
    url: '',
    signature: ''
  };
}

let foregroundCache: { at: number; title: string; process: string } | null = null;

async function foregroundWindow(): Promise<{ title: string; process: string }> {
  if (foregroundCache && Date.now() - foregroundCache.at < 2000) return foregroundCache;
  if (process.platform !== 'win32') return { title: '', process: '' };
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
}
"@
$h = [FgWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][FgWin]::GetWindowText($h, $sb, 512)
$pid = 0
[void][FgWin]::GetWindowThreadProcessId($h, [ref]$pid)
$p = Get-Process -Id $pid -ErrorAction SilentlyContinue
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output ($sb.ToString() + "|" + $(if ($p) { $p.ProcessName } else { "" }))
`;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 3000, windowsHide: true }
    );
    const [title, proc] = String(stdout || '').trim().split('|');
    foregroundCache = { at: Date.now(), title: title || '', process: proc || '' };
    return foregroundCache;
  } catch {
    return { title: '', process: '' };
  }
}

export function registerPetToolsIpc(): void {
  ipcMain.handle('clipboard:read', async () => (await clipboard.readText()).slice(0, 20000));

  ipcMain.handle('window:foreground', async () => {
    try {
      return { ok: true, data: await foregroundWindow() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('pet:read-file', async (_event, rawPath: unknown) => {
    const file = String(rawPath || '');
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) throw new Error('不是文件');
      if (stat.size > 8 * 1024 * 1024) throw new Error('文件超过 8MB');
      const ext = path.extname(file).toLowerCase();
      const imageExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
      if (imageExt.includes(ext)) {
        const buffer = await fs.promises.readFile(file);
        const dataUrl = `data:image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)};base64,${buffer.toString('base64')}`;
        const compressed = compressDataUrl(dataUrl, 1600, 88);
        if (!compressed) throw new Error('图片读取失败');
        return { ok: true, data: { kind: 'image', name: path.basename(file), dataUrl: compressed.dataUrl } };
      }
      const textExt = ['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.ts', '.js', '.py', '.html', '.css'];
      if (textExt.includes(ext)) {
        if (stat.size > 300 * 1024) throw new Error('文本文件超过 300KB');
        const text = await fs.promises.readFile(file, 'utf8');
        return { ok: true, data: { kind: 'text', name: path.basename(file), text: text.slice(0, 60000) } };
      }
      throw new Error('暂不支持这种文件（支持图片和常见文本）');
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('voice:transcribe', async (_event, payload: { dataUrl?: string }) => {
    const dataUrl = String(payload?.dataUrl || '');
    const match = /^data:audio\/[a-zA-Z0-9.+-]+;base64,(.*)$/s.exec(dataUrl);
    if (!match) return failure(new Error('没有录音数据'));
    const file = path.join(os.tmpdir(), `shizi-voice-${Date.now()}.webm`);
    try {
      await fs.promises.writeFile(file, Buffer.from(match[1], 'base64'));
      const result = await transcribeFile(file, fallbackInfo(), () => {});
      const text = result.lines
        .map((line) => line.text)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) throw new Error('没有识别到语音');
      return { ok: true, data: { text } };
    } catch (error) {
      return failure(error);
    } finally {
      await fs.promises.rm(file, { force: true }).catch(() => {});
    }
  });
}
