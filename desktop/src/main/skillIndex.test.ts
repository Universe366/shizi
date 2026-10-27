import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('electron', () => ({
  session: { defaultSession: { fetch: fetchMock } }
}));

import { fetchSkillIndex } from './skillIndex';

describe('远程技能索引', () => {
  beforeEach(() => fetchMock.mockReset());

  it('支持数组与 skills 包裹，并过滤无 url 条目', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          skills: [
            { name: '甲', url: 'https://example.com/a.md', version: '1.0.0' },
            { name: '无地址' }
          ]
        })
    });
    const entries = await fetchSkillIndex('https://example.com/skills.json');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: '甲', url: 'https://example.com/a.md' });
  });

  it('拒绝非 JSON 与空索引', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'not json' });
    await expect(fetchSkillIndex('https://example.com/a.json')).rejects.toThrow('合法 JSON');
    fetchMock.mockResolvedValue({ ok: true, text: async () => '[]' });
    await expect(fetchSkillIndex('https://example.com/a.json')).rejects.toThrow('没有技能条目');
  });
});
