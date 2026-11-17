import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { archivePayload, extractZipTo, isZipBuffer, readZip } from './zip';
import { makeCrx3Fixture, makeZipFixture } from './zipFixture';

const makeZip = makeZipFixture;
const makeCrx3 = makeCrx3Fixture;

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-zip-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('ZIP / CRX 解压', () => {
  it('读取 STORE 与 DEFLATE 条目', () => {
    const zip = makeZip([
      { name: 'manifest.json', content: '{"a":1}' },
      { name: 'index.html', content: '<h1>hi</h1>', deflate: true }
    ]);
    expect(isZipBuffer(zip)).toBe(true);
    const entries = readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual(['manifest.json', 'index.html']);
    expect(entries[1].data.toString('utf8')).toBe('<h1>hi</h1>');
  });

  it('识别 CRX3 并剥掉签名头', () => {
    const zip = makeZip([{ name: 'manifest.json', content: '{}' }]);
    const crx = makeCrx3(zip);
    expect(archivePayload(crx).equals(zip)).toBe(true);
    expect(readZip(archivePayload(crx))[0].name).toBe('manifest.json');
  });

  it('解压到目录，并自动进入唯一顶层目录', () => {
    const zip = makeZip([
      { name: 'demo/manifest.json', content: '{}' },
      { name: 'demo/ui/index.html', content: '<html></html>', deflate: true }
    ]);
    const target = tempDir();
    const root = extractZipTo(zip, target);
    expect(root).toBe(path.join(target, 'demo'));
    expect(fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8')).toBe('<html></html>');
  });

  it('拒绝越界路径', () => {
    const zip = makeZip([{ name: '../evil.txt', content: 'x' }]);
    expect(() => extractZipTo(zip, tempDir())).toThrow('越界');
  });

  it('坏包给出明确错误', () => {
    expect(() => readZip(Buffer.from('not a zip'))).toThrow('不是有效的 ZIP');
  });
});
