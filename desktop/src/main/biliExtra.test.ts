import { describe, expect, it } from 'vitest';
import { mixinKey, wbiQuery } from './biliExtra';

describe('B 站 WBI 签名', () => {
  it('mixinKey 按固定表重排', () => {
    expect(
      mixinKey(
        '7cd084941338484aae1ad9425b84077c',
        '4932caff0ff746eab6f01bf08b70ac45'
      )
    ).toBe('ea1db124af3c7062474693fa704f4ff8');
  });

  it('签名 query 排序并带 w_rid', () => {
    const query = wbiQuery({ cid: 123, bvid: 'BV1xx411c7mD' }, 'abcdefghijklmnopqrstuvwxyz123456');
    expect(query.startsWith('bvid=BV1xx411c7mD&cid=123&wts=')).toBe(true);
    expect(query).toMatch(/&w_rid=[0-9a-f]{32}$/);
  });
});
