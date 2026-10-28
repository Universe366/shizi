import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'exe' ? path.join(state.dir, 'shizi.exe') : state.dir
  },
  session: { defaultSession: { fetch: vi.fn() } }
}));

import {
  LOCAL_MODELS,
  deleteLocalModel,
  localAsrStatus,
  localModelPath
} from './localAsrSetup';

beforeAll(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-asr-setup-'));
});

afterAll(() => {
  fs.rmSync(state.dir, { recursive: true, force: true });
});

describe('本地 ASR 下载配置', () => {
  it('模型元数据完整（SHA-256 / 大小）', () => {
    for (const id of ['tiny', 'base', 'small', 'medium', 'large-v3-turbo'] as const) {
      expect(LOCAL_MODELS[id].sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(LOCAL_MODELS[id].size).toBeGreaterThan(1_000_000);
      expect(LOCAL_MODELS[id].urls.length).toBeGreaterThan(0);
    }
  });

  it('模型路径落在数据目录下', () => {
    expect(localModelPath('base')).toBe(
      path.join(state.dir, 'models', 'whisper', 'ggml-base.bin')
    );
  });

  it('状态只报告已存在且大小正确的模型', () => {
    const dir = path.join(state.dir, 'models', 'whisper');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ggml-tiny.bin'), Buffer.alloc(10));
    const status = localAsrStatus();
    expect(status.models.tiny).toBeUndefined();
    fs.writeFileSync(path.join(dir, 'ggml-tiny.bin'), Buffer.alloc(LOCAL_MODELS.tiny.size));
    expect(localAsrStatus().models.tiny).toBe(path.join(dir, 'ggml-tiny.bin'));
    expect(deleteLocalModel('tiny')).toBe(true);
    expect(localAsrStatus().models.tiny).toBeUndefined();
  });

  it('未完成的下载计入占用，删除时一并清理', () => {
    const dir = path.join(state.dir, 'models', 'whisper');
    const file = path.join(dir, 'ggml-base.bin');
    fs.writeFileSync(`${file}.download`, Buffer.alloc(1024));
    const status = localAsrStatus();
    expect(status.modelCatalog.find((row) => row.id === 'base')?.partialBytes).toBe(1024);
    expect(status.totalBytes).toBeGreaterThanOrEqual(1024);
    expect(deleteLocalModel('base')).toBe(true);
    expect(fs.existsSync(`${file}.download`)).toBe(false);
  });

  it('清单包含未下载项、体积与占用，标签不带体积后缀', () => {
    const status = localAsrStatus();
    expect(status.modelCatalog.map((row) => row.id)).toEqual([
      'tiny',
      'base',
      'small',
      'medium',
      'large-v3-turbo'
    ]);
    expect(status.modelCatalog.every((row) => row.size > 0)).toBe(true);
    expect(status.modelCatalog[0].label).not.toContain('约');
    expect(status.binaryCatalog.map((row) => row.variant)).toEqual([
      'cpu',
      'vulkan',
      'cuda118',
      'cuda124'
    ]);
    expect(status.totalBytes).toBeGreaterThanOrEqual(0);
  });
});
