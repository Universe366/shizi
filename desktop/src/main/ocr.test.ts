import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  dir: '',
  fetched: [] as string[]
}));

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  session: {
    defaultSession: {
      fetch: async (url: string) => {
        state.fetched.push(url);
        return new Response(
          JSON.stringify({
            results: [{ data: [{ text: '第一行' }, { text: '第二行' }] }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
    }
  }
}));

import { extractPaddleText, normalizeOcrText, ocrDataUrl, ocrDataUrlWithSettings } from './ocr';
import type { AppSettings } from '../shared/types';

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

  it('Paddle 响应解析与引擎路由', async () => {
    expect(
      extractPaddleText({
        results: [{ data: [{ text: '第一行' }, { text: '第二行' }] }]
      })
    ).toContain('第一行');
    expect(extractPaddleText({ text: '单行' })).toBe('单行');
    expect(extractPaddleText([[[[0, 0], [1, 1]], ['框选文字', 0.99]]])).toContain('框选文字');

    const settings = {
      ocr: { engine: 'paddle', lang: 'auto', paddleUrl: 'http://127.0.0.1:8866/ocr' }
    } as unknown as AppSettings;
    const result = await ocrDataUrlWithSettings(
      'data:image/png;base64,iVBORw0KGgo=',
      settings
    );
    expect(result.engine).toBe('paddle');
    expect(result.text).toContain('第一行');
    expect(state.fetched[0]).toBe('http://127.0.0.1:8866/ocr');
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
