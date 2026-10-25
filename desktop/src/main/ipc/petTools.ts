import { clipboard, ipcMain } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
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
$procId = 0
[void][FgWin]::GetWindowThreadProcessId($h, [ref]$procId)
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
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

let fullscreenCache: { at: number; fullscreen: boolean; process: string } | null = null;

/** 判断前台窗口是否几乎铺满它所在的显示器（其他应用全屏）。 */
export async function foregroundFullscreen(): Promise<{ fullscreen: boolean; process: string }> {
  if (fullscreenCache && Date.now() - fullscreenCache.at < 2500) return fullscreenCache;
  if (process.platform !== 'win32') return { fullscreen: false, process: '' };
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class FgFull {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
}
"@
$h = [FgFull]::GetForegroundWindow()
$r = New-Object FgFull+RECT
[void][FgFull]::GetWindowRect($h, [ref]$r)
$procId = 0
[void][FgFull]::GetWindowThreadProcessId($h, [ref]$procId)
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
$b = [System.Windows.Forms.Screen]::FromHandle($h).Bounds
$w = $r.Right - $r.Left
$hgt = $r.Bottom - $r.Top
$style = [FgFull]::GetWindowLong($h, -16)
$noCaption = (($style -band 0xC00000) -eq 0)
$full = $noCaption -and ($w -ge $b.Width * 0.99) -and ($hgt -ge $b.Height * 0.98)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output (([string]$full) + "|" + $(if ($p) { $p.ProcessName } else { "" }))
`;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 3000, windowsHide: true }
    );
    const [flag, proc] = String(stdout || '').trim().split('|');
    fullscreenCache = { at: Date.now(), fullscreen: flag === 'True', process: proc || '' };
    return fullscreenCache;
  } catch {
    return { fullscreen: false, process: '' };
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
      if (ext === '.pdf') {
        if (stat.size > 20 * 1024 * 1024) throw new Error('PDF 超过 20MB');
        const buffer = await fs.promises.readFile(file);
        const parsed = await pdfParse(buffer);
        const text = String(parsed.text || '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (!text) throw new Error('PDF 里没有可提取的文字（可能是扫描件）');
        return {
          ok: true,
          data: { kind: 'text', name: path.basename(file), text: text.slice(0, 60000) }
        };
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
