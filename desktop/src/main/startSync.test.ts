import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  START_SYNC_FILE,
  pullStartData,
  pushStartData,
  startSyncStatus
} from './startSync';

describe('startSync', () => {
  let dir = '';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-start-sync-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('写入后可以读回，状态带修改时间', () => {
    const payload = { app: 'shizi-start', version: 1, shortcuts: [] };
    const pushed = pushStartData(dir, payload);
    expect(pushed.path.endsWith(START_SYNC_FILE)).toBe(true);

    const pulled = pullStartData(dir);
    expect(pulled.data).toMatchObject({ app: 'shizi-start', version: 1 });

    const status = startSyncStatus(dir);
    expect(status.exists).toBe(true);
    expect(status.modifiedAt).toBeTypeOf('number');
  });

  it('拒绝非起始页数据', () => {
    expect(() => pushStartData(dir, { app: 'other' })).toThrow();
    fs.writeFileSync(path.join(dir, START_SYNC_FILE), JSON.stringify({ app: 'other' }));
    expect(() => pullStartData(dir)).toThrow();
  });

  it('没有同步文件夹时报错', () => {
    expect(() => pushStartData('', { app: 'shizi-start' })).toThrow();
  });
});
