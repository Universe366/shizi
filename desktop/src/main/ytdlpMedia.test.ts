import { describe, expect, it, vi } from 'vitest';

vi.mock('./onlineVideo', () => ({ ensureYtDlp: vi.fn() }));

import { cookieFileContent } from './ytdlpMedia';

describe('yt-dlp cookies', () => {
  it('按 Netscape 格式输出，HttpOnly 加前缀', () => {
    const text = cookieFileContent([
      {
        name: 'SID',
        value: 'abc',
        domain: '.douyin.com',
        path: '/',
        secure: true,
        expirationDate: 1700000000
      },
      {
        name: 'token',
        value: 'xyz',
        domain: 'www.douyin.com',
        httpOnly: true
      }
    ]);
    expect(text.startsWith('# Netscape HTTP Cookie File')).toBe(true);
    expect(text).toContain('.douyin.com\tTRUE\t/\tTRUE\t1700000000\tSID\tabc');
    expect(text).toContain('#HttpOnly_www.douyin.com\tFALSE\t/\tFALSE\t0\ttoken\txyz');
  });

  it('跳过没有域名/名字的条目', () => {
    const text = cookieFileContent([
      { name: '', value: 'x', domain: '.a.com' },
      { name: 'n', value: 'v', domain: '' }
    ]);
    expect(text.trim().split('\n')).toHaveLength(2);
  });
});
