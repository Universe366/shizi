import zlib from 'node:zlib';

/**
 * 测试用最小 ZIP / CRX3 构造器。
 *
 * 只被 `*.test.ts` 引用；不要在运行时业务代码里 import。
 * 支持 STORE 与 DEFLATE 两种压缩方式，够覆盖安装/解压相关的测试。
 */

export type ZipFixtureEntry = [string, string] | { name: string; content: string; deflate?: boolean };

interface NormalizedEntry {
  name: string;
  content: string;
  deflate: boolean;
}

function normalizeEntry(entry: ZipFixtureEntry): NormalizedEntry {
  if (Array.isArray(entry)) return { name: entry[0], content: entry[1], deflate: false };
  return { name: entry.name, content: entry.content, deflate: entry.deflate === true };
}

export function makeZipFixture(entries: ZipFixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const raw of entries) {
    const entry = normalizeEntry(raw);
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.from(entry.content, 'utf8');
    const data = entry.deflate ? zlib.deflateRawSync(content) : content;
    const method = entry.deflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
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

/** 在 zip 前拼一个最小 CRX3 头，用来测试 .crx 安装。 */
export function makeCrx3Fixture(zip: Buffer, header = 'header'): Buffer {
  const headerBuffer = Buffer.from(header, 'utf8');
  const head = Buffer.alloc(12);
  head.write('Cr24', 0, 'ascii');
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(headerBuffer.length, 8);
  return Buffer.concat([head, headerBuffer, zip]);
}
