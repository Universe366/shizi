import { describe, expect, it } from 'vitest';
import {
  clearMediaFor,
  mediaCandidatesFor,
  mediaUrlFor,
  noteMediaRequest
} from './mediaSniffer';

describe('media sniffer', () => {
  it('音频优先，保留请求头，忽略 HLS 清单', () => {
    const id = 9001;
    noteMediaRequest(id, 'https://v.douyinvod.com/x/media-video-avc1/?a=1', {
      Referer: 'https://www.douyin.com/'
    });
    noteMediaRequest(id, 'https://v.douyinvod.com/x/media-audio-und-mp4a/?a=1', {
      Cookie: 's_v_web_id=abc',
      Range: 'bytes=0-100'
    });
    noteMediaRequest(id, 'https://v.douyinvod.com/x/index.m3u8');
    const candidates = mediaCandidatesFor(id);
    expect(candidates[0].kind).toBe('audio');
    expect(candidates[0].headers.Cookie).toContain('s_v_web_id');
    expect(candidates[0].headers.Range).toBeUndefined();
    expect(mediaUrlFor(id)).toContain('media-audio');
    clearMediaFor(id);
    expect(mediaUrlFor(id)).toBe('');
  });

  it('只有视频 mp4 时退回视频', () => {
    noteMediaRequest(9002, 'https://example.com/a.mp4');
    expect(mediaUrlFor(9002)).toBe('https://example.com/a.mp4');
    clearMediaFor(9002);
  });
});
