import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => state.dir }
}));

import { normalizeOcrText, ocrDataUrl } from './ocr';

/** CI/其它机器没有中文 OCR 语言包时跳过集成用例，只跑纯函数测试。 */
function hasChineseOcr(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]; [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }"
      ],
      { encoding: 'utf8', timeout: 15000 }
    );
    return result.status === 0 && /zh/i.test(result.stdout || '');
  } catch {
    return false;
  }
}

const chineseOcr = hasChineseOcr();

describe('本地 OCR', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-ocr-test-'));
  });

  afterAll(() => {
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('中文空格与标点归一化', () => {
    expect(normalizeOcrText('拾 字 本 地 OCR 测 试')).toBe('拾字本地 OCR 测试');
    expect(normalizeOcrText('你 好 ， 世 界 ！')).toBe('你好，世界！');
  });

  it.skipIf(!chineseOcr)(
    '系统 OCR 能识别中文截图',
    async () => {
      const image = path.join(state.dir, 'sample.png');
      const script = [
        'Add-Type -AssemblyName System.Drawing',
        '$bmp=New-Object System.Drawing.Bitmap(720,220)',
        '$g=[System.Drawing.Graphics]::FromImage($bmp)',
        '$g.Clear([System.Drawing.Color]::White)',
        "$font=New-Object System.Drawing.Font('Microsoft YaHei',36)",
        '$brush=[System.Drawing.Brushes]::Black',
        "$g.DrawString('拾字 OCR 测试 2026',$font,$brush,20,60)",
        '$g.Dispose()',
        `$bmp.Save('${image.replace(/\\/g, '\\\\')}',[System.Drawing.Imaging.ImageFormat]::Png)`,
        '$bmp.Dispose()'
      ].join(';');
      const made = spawnSync('powershell.exe', ['-NoProfile', '-Command', script]);
      expect(made.status).toBe(0);
      const dataUrl = `data:image/png;base64,${fs.readFileSync(image).toString('base64')}`;
      const result = await ocrDataUrl(dataUrl);
      expect(result.text).toContain('拾字');
      expect(result.ms).toBeGreaterThan(0);
    },
    60000
  );
});
