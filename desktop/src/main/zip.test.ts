import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { archivePayload, extractZipTo, isZipBuffer, readZip } from './zip';

interface FixtureEntry {
  name: string;
  content: string;
  deflate?: boolean;
}

/** 生成一个最小 ZIP（可选 deflate），用于测试解压逻辑，不引入额外依赖。 */
function makeZip(entries: FixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.content, 'utf8');
    const data = entry.deflate ? zlib.deflateRawSync(raw) : raw;
    const method = entry.deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, eocd]);
}

function makeCrx3(zip: Buffer): Buffer {
  const header = Buffer.from('crx-header', 'utf8');
  const head = Buffer.alloc(12);
  head.write('Cr24', 0, 'ascii');
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(header.length, 8);
  return Buffer.concat([head, header, zip]);
}

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
