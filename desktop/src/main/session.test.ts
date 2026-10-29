// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMP || '.';
  return { dir: `${base}/shizi-session-test-${process.pid}-${Date.now()}` };
});

vi.mock('electron', () => ({
  app: { getPath: () => mock.dir }
}));

import { loadSession, saveSession } from './session';

afterAll(() => {
  fs.rmSync(mock.dir, { recursive: true, force: true });
});

describe('session', () => {
  it('关闭全部标签后写空会话会删除旧文件', () => {
    saveSession([{ url: 'https://example.com/a', title: 'A' }], 'https://example.com/a');
    const file = path.join(mock.dir, 'session.json');
    expect(fs.existsSync(file)).toBe(true);
    expect(loadSession()?.tabs).toHaveLength(1);

    saveSession([], '', []);
    expect(fs.existsSync(file)).toBe(false);
    expect(loadSession()).toBeNull();
  });
});
