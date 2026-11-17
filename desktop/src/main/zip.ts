import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * 极简 ZIP / CRX 读取器。
 *
 * 只做扩展/插件安装需要的子集：STORE + DEFLATE、无加密、非 ZIP64。
 * 好处是不用给运行时增加一个解压依赖；代价是遇到 ZIP64/加密包会直接报错。
 */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const CRX_MAGIC = 'Cr24';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface ZipLimits {
  maxEntries: number;
  maxBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 5000,
  maxBytes: 300 * 1024 * 1024
};

/** CRX3/CRX2 前面是一段签名头，真正的 zip 从 payload 开始；普通 zip 原样返回。 */
export function archivePayload(buffer: Buffer): Buffer {
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === CRX_MAGIC) {
    if (buffer.length < 12) throw new Error('CRX 文件头不完整');
    const version = buffer.readUInt32LE(4);
    if (version === 3) {
      if (buffer.length < 12) throw new Error('CRX3 文件头不完整');
      const headerLength = buffer.readUInt32LE(8);
      const start = 12 + headerLength;
      if (start >= buffer.length) throw new Error('CRX3 文件头长度异常');
      return buffer.subarray(start);
    }
    if (version === 2) {
      if (buffer.length < 16) throw new Error('CRX2 文件头不完整');
      const publicKeyLength = buffer.readUInt32LE(8);
      const signatureLength = buffer.readUInt32LE(12);
      const start = 16 + publicKeyLength + signatureLength;
      if (start >= buffer.length) throw new Error('CRX2 文件头长度异常');
      return buffer.subarray(start);
    }
    throw new Error('只支持 CRX2 / CRX3 格式');
  }
  return buffer;
}

/** 判断缓冲区是不是 zip（本地文件头签名）。 */
export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === LOC_SIG;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIG) return offset;
  }
  return -1;
}

export function readZip(buffer: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    throw new Error('暂不支持 ZIP64 压缩包');
  }
  if (count > limits.maxEntries) throw new Error('压缩包内文件数量过多');
  if (centralOffset + centralSize > buffer.length) throw new Error('ZIP 目录超出文件范围');

  const entries: ZipEntry[] = [];
  let total = 0;
  let offset = centralOffset;

  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CEN_SIG) {
      throw new Error('ZIP 中央目录损坏');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;

    if (!name || name.endsWith('/')) continue;
    if (flags & 0x1) throw new Error('不支持加密的压缩包');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOC_SIG) {
      throw new Error(`ZIP 条目损坏：${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error(`ZIP 条目越界：${name}`);
    const raw = buffer.subarray(dataStart, dataEnd);

    let data: Buffer;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      try {
        data = zlib.inflateRawSync(raw);
      } catch {
        throw new Error(`ZIP 条目解压失败：${name}`);
      }
    } else {
      throw new Error(`不支持的压缩方式（${method}）：${name}`);
    }
    if (uncompressedSize !== 0 && data.length !== uncompressedSize) {
      throw new Error(`ZIP 条目大小不符：${name}`);
    }
    total += data.length;
    if (total > limits.maxBytes) throw new Error('压缩包解压后体积过大');
    entries.push({ name, data });
  }

  return entries;
}

/**
 * 解压到目录：拒绝绝对路径与 `..` 越界；顶层只有一个目录时返回该目录，
 * 方便「zip 里套一层文件夹」的常见包结构。
 */
export function extractZipTo(buffer: Buffer, targetDir: string): string {
  const entries = readZip(archivePayload(buffer));
  const root = path.resolve(targetDir);
  fs.mkdirSync(root, { recursive: true });

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/');
    if (name.startsWith('__MACOSX/') || name === '.DS_Store') continue;
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
      throw new Error(`压缩包包含绝对路径：${entry.name}`);
    }
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`压缩包包含越界路径：${entry.name}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
  }

  // zip 里只有一个顶层目录时，返回它（Chrome 商店的包通常长这样）
  const top = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((item) => item.name !== '__MACOSX' && item.name !== '.DS_Store');
  if (top.length === 1 && top[0].isDirectory()) {
    return path.join(root, top[0].name);
  }
  return root;
}
