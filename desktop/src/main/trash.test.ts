import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LATEST_SCHEMA_VERSION } from './migrations';
import type { PageInfo, SubtitleTrack } from '../shared/types';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: () => state.dir
  }
}));

import {
  addVideoToCollection,
  closeLibrary,
  deleteTrash,
  getSummaryFor,
  getLibraryDetail,
  initLibrary,
  ingestVideo,
  librarySchemaVersion,
  listTrash,
  removeVideos,
  restoreTrash,
  saveNote,
  saveSummary,
  setVideoTags,
  vacuumLibrary
} from './library';
import { listSavedTracks, savedTrackLines, setTrackUrl } from './library/savedTracks';

const info: PageInfo = {
  kind: 'video',
  bvid: 'BV1test00001',
  aid: 1,
  cid: 2,
  epId: null,
  seasonId: null,
  page: 1,
  partTitle: '',
  parts: [],
  title: '回收站测试视频',
  owner: '测试 UP',
  desc: '',
  duration: 62,
  url: 'https://www.bilibili.com/video/BV1test00001',
  signature: 'v:BV1test00001:2'
};

const track: SubtitleTrack = {
  lan: 'zh-CN',
  lanDoc: '中文',
  url: 'https://example.com/2/sub.json',
  isAi: false,
  aiStatus: null,
  source: 'official'
};

describe('回收站与 schema 迁移', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsub-library-'));
    initLibrary();
  });

  afterAll(() => {
    closeLibrary();
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('转写字幕入库后能按视频重新加载', () => {
    const savedInfo = { ...info, bvid: 'BV1test00009', title: '转写保存测试' };
    const result = ingestVideo({
      info: savedInfo,
      track: {
        lan: 'asr',
        lanDoc: '语音转录',
        url: 'library://pending',
        isAi: false,
        aiStatus: null,
        source: 'asr'
      },
      lines: [{ start: 0, end: 2, text: '转写第一句' }]
    });
    setTrackUrl(result.trackId, `library://track/${result.trackId}`);
    const tracks = listSavedTracks(savedInfo);
    expect(tracks.some((item) => item.url === `library://track/${result.trackId}`)).toBe(true);
    expect(savedTrackLines(result.trackId)[0].text).toBe('转写第一句');
    removeVideos([result.videoId]);
    const entry = listTrash().find((item) => item.title === '转写保存测试');
    if (entry) deleteTrash(entry.id);
  });

  it('删除进入回收站，恢复后字幕/总结/笔记/标签/合集都回来', () => {
    const ingested = ingestVideo({
      info,
      track,
      lines: [
        { start: 0, end: 2, text: '第一句字幕' },
        { start: 2, end: 4, text: '第二句字幕' }
      ]
    });
    expect(ingested.videoId).toBeGreaterThan(0);
    expect(ingested.lineCount).toBe(2);

    saveSummary(info, '# 总结\n\n这是总结正文', 'test-model');
    saveNote(ingested.videoId, '这是笔记');
    setVideoTags(ingested.videoId, ['测试标签']);
    addVideoToCollection(ingested.videoId, '测试合集');

    expect(librarySchemaVersion()).toBe(LATEST_SCHEMA_VERSION);

    expect(removeVideos([ingested.videoId])).toBe(1);
    expect(() => getLibraryDetail(ingested.videoId)).toThrow();

    const trash = listTrash();
    expect(trash).toHaveLength(1);
    expect(trash[0].title).toBe('回收站测试视频');
    expect(trash[0].lineCount).toBe(2);
    expect(trash[0].hasSummary).toBe(true);
    expect(trash[0].hasNote).toBe(true);

    const restored = restoreTrash(trash[0].id);
    const detail = getLibraryDetail(restored.videoId);
    expect(detail.video.kind).toBe('video');
    expect(detail.video.source).toBe('bilibili');
    expect(detail.bundle?.lines.map((line) => line.text)).toEqual(['第一句字幕', '第二句字幕']);
    expect(detail.summary?.content).toContain('这是总结正文');
    expect(detail.note?.content).toBe('这是笔记');
    expect(detail.video.tags).toContain('测试标签');
    expect(detail.video.collections).toContain('测试合集');
    expect(listTrash()).toHaveLength(0);

    // 恢复后搜索索引也要能用。
    expect(detail.bundle?.lines[0].text).toContain('第一句');
  });

  it('彻底删除后不再出现在回收站', () => {
    const ingested = ingestVideo({
      info: { ...info, bvid: 'BV1test00002', title: '待彻底删除' },
      track,
      lines: [{ start: 0, end: 1, text: '内容' }]
    });
    removeVideos([ingested.videoId]);
    const trash = listTrash();
    expect(trash.length).toBe(1);
    expect(deleteTrash(trash[0].id)).toBe(true);
    expect(listTrash()).toHaveLength(0);
  });

  it('压缩数据库返回前后大小', () => {
    const result = vacuumLibrary();
    expect(result.before).toBeGreaterThan(0);
    expect(result.after).toBeGreaterThan(0);
  });
});

describe('转写字幕的 cid 回退', () => {
  it('cid 缺失时，只有一条同 bvid 视频才回退加载', () => {
    const savedInfo = { ...info, bvid: 'BV1test00010', cid: 99, title: 'cid 回退测试' };
    const result = ingestVideo({
      info: savedInfo,
      track: {
        lan: 'asr',
        lanDoc: '语音转录',
        url: 'library://pending',
        isAi: false,
        aiStatus: null,
        source: 'asr'
      },
      lines: [{ start: 0, end: 2, text: '回退第一句' }]
    });
    setTrackUrl(result.trackId, 'library://track/' + result.trackId);
    const withoutCid = { ...savedInfo, cid: 0 };
    expect(
      listSavedTracks(withoutCid).some(
        (item) => item.url === 'library://track/' + result.trackId
      )
    ).toBe(true);
    removeVideos([result.videoId]);
    const entry = listTrash().find((item) => item.title === 'cid 回退测试');
    if (entry) deleteTrash(entry.id);
  });
});

describe('页面缺少 bvid 时的回退', () => {
  it('从 URL 提取 bvid，仍能加载已保存转写', () => {
    const savedInfo = { ...info, bvid: 'BV1url000001', cid: 11, title: 'URL 回退测试' };
    const result = ingestVideo({
      info: savedInfo,
      track: {
        lan: 'asr',
        lanDoc: '语音转录',
        url: 'library://pending-x',
        isAi: false,
        aiStatus: null,
        source: 'asr'
      },
      lines: [{ start: 0, end: 1, text: '第一句' }]
    });
    const tracks = listSavedTracks({
      ...savedInfo,
      bvid: '',
      cid: 0,
      url: 'https://www.bilibili.com/video/BV1url000001/'
    });
    expect(tracks.length).toBe(1);
    expect(tracks[0].url).toBe('library://track/' + result.trackId);
    removeVideos([result.videoId]);
    const entry = listTrash().find((item) => item.title === 'URL 回退测试');
    if (entry) deleteTrash(entry.id);
  });
});

describe('旧转写 URL 兼容', () => {
  it('pending URL 会映射成真实 track 地址', () => {
    const savedInfo = { ...info, bvid: 'BV1test00011', cid: 7, title: 'pending 兼容测试' };
    const result = ingestVideo({
      info: savedInfo,
      track: {
        lan: 'asr',
        lanDoc: '语音转录',
        url: 'library://pending-legacy',
        isAi: false,
        aiStatus: null,
        source: 'asr'
      },
      lines: [{ start: 0, end: 2, text: '旧转写第一句' }]
    });
    const tracks = listSavedTracks(savedInfo);
    expect(tracks[0].url).toBe('library://track/' + result.trackId);
    removeVideos([result.videoId]);
    const entry = listTrash().find((item) => item.title === 'pending 兼容测试');
    if (entry) deleteTrash(entry.id);
  });
});

describe('同一个稿件的不同分 P 不串数据', () => {
  it('P1 的转写不会显示在 P2', () => {
    const p1 = {
      ...info,
      bvid: 'BV1part00001',
      cid: 11,
      page: 1,
      title: 'P1',
      url: 'https://www.bilibili.com/video/BV1part00001?p=1'
    };
    const result = ingestVideo({
      info: p1,
      track: { ...track, url: 'library://pending-p1' },
      lines: [{ start: 0, end: 1, text: 'P1 第一句' }]
    });
    setTrackUrl(result.trackId, 'library://track/' + result.trackId);
    const p2 = {
      ...p1,
      cid: 22,
      page: 2,
      url: 'https://www.bilibili.com/video/BV1part00001?p=2'
    };
    expect(listSavedTracks(p2)).toEqual([]);
    expect(listSavedTracks(p1)).toHaveLength(1);
  });

  it('P1 的总结不会显示在 P2', () => {
    const p1 = {
      ...info,
      bvid: 'BV1part00002',
      cid: 33,
      page: 1,
      title: 'P1 总结',
      url: 'https://www.bilibili.com/video/BV1part00002?p=1'
    };
    ingestVideo({
      info: p1,
      track: { ...track, url: 'library://pending-s1' },
      lines: [{ start: 0, end: 1, text: '一句' }]
    });
    saveSummary(p1, '# P1 总结', 'm');
    const p2 = { ...p1, cid: 44, page: 2, url: 'https://www.bilibili.com/video/BV1part00002?p=2' };
    expect(getSummaryFor({ bvid: p2.bvid, cid: p2.cid, epId: null })).toBeNull();
    expect(getSummaryFor({ bvid: p1.bvid, cid: p1.cid, epId: null })?.content).toBe('# P1 总结');
  });

  it('旧版按 cid=0 存的记录仍能被已知 cid 找到', () => {
    const legacy = {
      ...info,
      bvid: 'BV1part00003',
      cid: 0,
      page: 1,
      title: '旧记录',
      url: 'https://www.bilibili.com/video/BV1part00003'
    };
    ingestVideo({
      info: legacy,
      track: { ...track, url: 'library://pending-l1' },
      lines: [{ start: 0, end: 1, text: '旧转写' }]
    });
    saveSummary(legacy, '# 旧总结', 'm');
    expect(listSavedTracks({ ...legacy, cid: 99 })).toHaveLength(1);
    expect(getSummaryFor({ bvid: 'BV1part00003', cid: 99, epId: null })?.content).toBe('# 旧总结');
  });
});

