import { app, session } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AppSettings } from '../shared/types';

// ---------------------------------------------------------------------------
// 本地 OCR：Windows 10/11 自带的 WinRT OCR（Windows.Media.Ocr）。
// 通过 PowerShell 5.1 调 WinRT，零下载、离线、单张几十毫秒。
// 识别质量一般（小字/复杂排版会错），所以调用方仍保留「用 AI 精确识别」兜底。
// ---------------------------------------------------------------------------

const SCRIPT = String.raw`param([string]$Image,[string]$Out,[string]$Lang='auto',[int]$Scale=2)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1'
  })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

$engine = $null
if ($Lang -and $Lang -ne 'auto') {
  try {
    $language = [Windows.Globalization.Language]::new($Lang)
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
  } catch { }
}
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) { throw '系统没有可用的 OCR 语言包' }

$target = $Image
if ($Scale -gt 1) {
  $src = [System.Drawing.Image]::FromFile($Image)
  $width = [int]($src.Width * $Scale)
  $height = [int]($src.Height * $Scale)
  $bitmap = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($src, 0, 0, $width, $height)
  $graphics.Dispose()
  $src.Dispose()
  $target = Join-Path ([IO.Path]::GetTempPath()) ('shizi-ocr-src-' + [guid]::NewGuid().ToString('N') + '.png')
  $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($target)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$software = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
$text = ($result.Lines | ForEach-Object { $_.Text }) -join "` + '`' + String.raw`n"
[IO.File]::WriteAllText($Out, $text, (New-Object System.Text.UTF8Encoding($false)))
if ($target -ne $Image) { Remove-Item $target -ErrorAction SilentlyContinue }
`;

let scriptPath = '';

function ensureScript(): string {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  const dir = path.join(app.getPath('userData'), 'ocr');
  fs.mkdirSync(dir, { recursive: true });
  scriptPath = path.join(dir, 'winocr.ps1');
  // Windows PowerShell 5.1 按 ANSI 读无 BOM 文件，中文会乱码导致语法错误。
  fs.writeFileSync(scriptPath, `\uFEFF${SCRIPT}`, 'utf8');
  return scriptPath;
}

function runPowerShell(args: string[], timeoutMs = 30000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ...args],
      { windowsHide: true }
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('OCR 超时（30 秒）'));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `OCR 进程退出码 ${code}`));
    });
  });
}

/** Windows OCR 会在汉字之间插入空格，这里按中文习惯收掉。 */
export function normalizeOcrText(input: string): string {
  let text = String(input || '').replace(/\r\n/g, '\n');
  // 连续多次，处理「你 好 世 界」这种逐字空格
  for (let round = 0; round < 3; round += 1) {
    text = text.replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '$1');
  }
  text = text
    .replace(/[ \t]+([，。！？；：、）》」』】])/g, '$1')
    .replace(/([（《「『【，。！？；：、）])[ \t]+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

async function recognizeFile(
  image: string,
  lang = 'auto',
  scale = 2
): Promise<{ text: string; ms: number }> {
  const script = ensureScript();
  const out = path.join(os.tmpdir(), `shizi-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const started = Date.now();
  try {
    await runPowerShell([
      script,
      '-Image',
      image,
      '-Out',
      out,
      '-Lang',
      lang || 'auto',
      '-Scale',
      String(Math.max(1, Math.min(3, Math.round(scale) || 2)))
    ]);
    const raw = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    return { text: normalizeOcrText(raw), ms: Date.now() - started };
  } finally {
    try {
      fs.rmSync(out, { force: true });
    } catch {
      // ignore
    }
  }
}

/** 识别 dataURL（截图/剪贴板图片）。 */
export async function ocrDataUrl(
  dataUrl: string,
  lang = 'auto'
): Promise<{ text: string; ms: number }> {
  if (process.platform !== 'win32') throw new Error('本地 OCR 目前只支持 Windows');
  const match = /^data:image\/([a-z0-9.+-]+);base64,(.*)$/is.exec(String(dataUrl || ''));
  if (!match) throw new Error('不是有效的图片 dataURL');
  const ext = match[1].includes('jpeg') ? 'jpg' : match[1].includes('webp') ? 'webp' : 'png';
  const file = path.join(
    os.tmpdir(),
    `shizi-ocr-in-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  );
  fs.writeFileSync(file, Buffer.from(match[2], 'base64'));
  try {
    return await recognizeFile(file, lang);
  } finally {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // ignore
    }
  }
}

/** 识别本地图片文件。 */
export async function ocrFile(
  file: string,
  lang = 'auto'
): Promise<{ text: string; ms: number }> {
  if (process.platform !== 'win32') throw new Error('本地 OCR 目前只支持 Windows');
  if (!fs.existsSync(file)) throw new Error('图片不存在');
  return recognizeFile(file, lang);
}

export function ocrAvailable(): boolean {
  return process.platform === 'win32';
}

/** 从 PaddleOCR 服务返回的各种结构里尽量取到文字。 */
export function extractPaddleText(payload: unknown): string {
  const texts: string[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (depth > 6 || value == null) return;
    if (typeof value === 'string') {
      if (value.trim()) texts.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      // PaddleOCR 常见结构：[box, [text, score]]
      if (
        value.length >= 2 &&
        Array.isArray(value[1]) &&
        typeof value[1][0] === 'string'
      ) {
        texts.push(String(value[1][0]));
        return;
      }
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      for (const key of ['text', 'texts', 'result', 'results', 'data', 'ocr']) {
        if (key in record) visit(record[key], depth + 1);
      }
    }
  };
  visit(payload, 0);
  return Array.from(new Set(texts)).join('\n');
}

async function paddleOcr(dataUrl: string, url: string): Promise<string> {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is.exec(dataUrl);
  if (!match) throw new Error('不是有效的图片 dataURL');
  const response = await session.defaultSession.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: match[1], img: match[1] }),
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`PaddleOCR 服务 HTTP ${response.status}：${body.slice(0, 160)}`);
  }
  const payload = (await response.json()) as unknown;
  const text = normalizeOcrText(extractPaddleText(payload));
  if (!text) throw new Error('PaddleOCR 没有返回文字');
  return text;
}

/** 按设置选择 OCR 引擎；Paddle 服务失败时回退系统 OCR。 */
export async function ocrDataUrlWithSettings(
  dataUrl: string,
  settings: AppSettings
): Promise<{ text: string; ms: number; engine: 'system' | 'paddle' }> {
  const started = Date.now();
  if (settings.ocr.engine === 'paddle' && settings.ocr.paddleUrl.trim()) {
    try {
      const text = await paddleOcr(dataUrl, settings.ocr.paddleUrl.trim());
      return { text, ms: Date.now() - started, engine: 'paddle' };
    } catch (error) {
      console.warn('[ocr] PaddleOCR 失败，回退系统 OCR:', (error as Error).message);
    }
  }
  const result = await ocrDataUrl(dataUrl, settings.ocr.lang || 'auto');
  return { ...result, engine: 'system' };
}
