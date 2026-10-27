import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { KbHit, PageInfo } from '../shared/types';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir
  }
}));

import { closeLibrary, initLibrary, ingestVideo } from './library';
import {
  createKbCard,
  deleteKbCard,
  listKbCards,
  listKbQa,
  reviewKbCard,
  saveKbQa
} from './library/knowledgeMemory';

const info: PageInfo = {
  kind: 'video',
  bvid: 'BV1mem000001',
  aid: 1,
  cid: 2,
  epId: null,
  seasonId: null,
  page: 1,
  partTitle: '',
  parts: [],
  title: '记忆测试视频',
  owner: '测试 UP',
  desc: '',
  duration: 60,
  url: 'https://www.bilibili.com/video/BV1mem000001',
  signature: 'v:BV1mem000001:2'
};

const hits: KbHit[] = [
  {
    videoId: 0,
    title: '记忆测试视频',
    kind: 'subtitle',
    startMs: 65000,
    endMs: 70000,
    text: '本地 ASR 的一段',
    score: 0.9
  }
];

let videoId = 0;

beforeAll(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-kbmem-'));
  initLibrary();
  const ingested = ingestVideo({
    info,
    track: {
      lan: 'zh-CN',
      lanDoc: '中文',
      url: 'https://example.com/2/sub.json',
      isAi: false,
      aiStatus: null,
      source: 'official'
    },
    lines: [{ start: 0, end: 2, text: '第一句' }]
  });
  videoId = ingested.videoId;
});

afterAll(() => {
  closeLibrary();
  fs.rmSync(state.dir, { recursive: true, force: true });
});

describe('knowledge memory', () => {
  it('保存问答并可按视频查回（双向链接）', () => {
    const withVideo = hits.map((hit) => ({ ...hit, videoId }));
    const id = saveKbQa({
      question: '本地 ASR 讲了什么',
      answer: '讲了依赖',
      mode: 'ask',
      scopeLabel: '记忆测试视频',
      hits: withVideo
    });
    expect(id).toBeGreaterThan(0);
    const all = listKbQa({ limit: 10 });
    expect(all[0]).toMatchObject({ question: '本地 ASR 讲了什么', answer: '讲了依赖' });
    const byVideo = listKbQa({ videoId, limit: 10 });
    expect(byVideo.some((entry) => entry.id === id)).toBe(true);
    expect(byVideo[0].hits[0].startMs).toBe(65000);
  });

  it('复习卡片创建、排期与删除', () => {
    const card = createKbCard({ videoId, front: '正面', back: '背面', dueAt: 1 });
    expect(card.id).toBeGreaterThan(0);
    expect(listKbCards({ dueOnly: true }).some((item) => item.id === card.id)).toBe(true);

    const good = reviewKbCard(card.id, 'good');
    expect(good.intervalDays).toBe(1);
    expect(good.streak).toBe(1);
    expect(good.dueAt).toBeGreaterThan(Date.now());

    const again = reviewKbCard(card.id, 'again');
    expect(again.intervalDays).toBe(0);
    expect(again.streak).toBe(0);

    expect(deleteKbCard(card.id)).toBe(true);
    expect(listKbCards({}).some((item) => item.id === card.id)).toBe(false);
  });

  it('卡片必须有正面和背面', () => {
    expect(() => createKbCard({ front: '', back: 'x' })).toThrow();
  });
});
