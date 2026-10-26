import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { dubVideo } from './dub';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-dub-test-'));

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('dubVideo', () => {
  it('用系统语音生成对齐的配音音轨', async () => {
    if (process.platform !== 'win32') return;
    const output = path.join(dir, 'dub.m4a');
    await dubVideo(
      '',
      [
        { start: 0, end: 1.2, text: '你好' },
        { start: 1.4, end: 2.6, text: '这是配音测试' }
      ],
      output,
      { mode: 'audio', title: '测试', voice: 'Microsoft Huihui Desktop' },
      () => undefined
    );
    expect(fs.existsSync(output)).toBe(true);
    expect(fs.statSync(output).size).toBeGreaterThan(1000);
  }, 60000);
});
