import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dir: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => state.dir }
}));

import {
  appendMessage,
  closeChatStore,
  conversationMarkdown,
  createConversation,
  deleteConversation,
  latestConversationForVideo,
  listConversations,
  listMessages,
  renameConversation,
  setConversationProfile,
  truncateMessages
} from './chatStore';

describe('对话持久化', () => {
  beforeAll(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shizi-chat-'));
  });

  beforeEach(() => {
    closeChatStore();
  });

  afterAll(() => {
    closeChatStore();
    fs.rmSync(state.dir, { recursive: true, force: true });
  });

  it('创建会话、追加消息并按视频取最新', () => {
    const conversation = createConversation({
      title: '第一个对话',
      videoKey: 'BV1',
      videoTitle: '测试视频'
    });
    appendMessage(conversation.id, { role: 'user', content: '问一句' });
    appendMessage(conversation.id, {
      role: 'assistant',
      content: '答一句',
      reasoning: '想一想',
      sources: [{ title: '来源', url: 'https://example.com', snippet: '摘要' }],
      tools: [{ name: 'search_library', ok: true, detail: '找到 2 条', at: Date.now() }]
    });

    const messages = listMessages(conversation.id);
    expect(messages.length).toBe(2);
    expect(messages[1].sources[0].url).toBe('https://example.com');
    expect(messages[1].reasoning).toBe('想一想');
    expect(messages[1].tools[0]).toMatchObject({ name: 'search_library', ok: true });

    const latest = latestConversationForVideo('BV1');
    expect(latest?.id).toBe(conversation.id);
    expect(latest?.title).toBe('第一个对话');

    const list = listConversations(10);
    expect(list[0].messageCount).toBe(2);
  });

  it('重命名与删除', () => {
    const conversation = createConversation({ title: '旧名字', videoKey: 'BV2' });
    expect(renameConversation(conversation.id, '新名字')).toBe(true);
    expect(listConversations(10).find((item) => item.id === conversation.id)?.title).toBe(
      '新名字'
    );
    appendMessage(conversation.id, { role: 'user', content: 'x' });
    expect(deleteConversation(conversation.id)).toBe(true);
    expect(listMessages(conversation.id)).toEqual([]);
    expect(latestConversationForVideo('BV2')).toBeNull();
  });

  it('按条数截断消息（重新生成/编辑）', () => {
    const conversation = createConversation({ title: '截断', videoKey: 'BV4' });
    appendMessage(conversation.id, { role: 'user', content: 'a' });
    appendMessage(conversation.id, { role: 'assistant', content: 'b' });
    appendMessage(conversation.id, { role: 'user', content: 'c' });
    truncateMessages(conversation.id, 1);
    const rows = listMessages(conversation.id);
    expect(rows.length).toBe(1);
    expect(rows[0].content).toBe('a');
    truncateMessages(conversation.id, 5);
    expect(listMessages(conversation.id).length).toBe(1);
  });

  it('会话记录助手档案并可更新', () => {
    const conversation = createConversation({ title: '带档案', profileId: 'p1' });
    expect(latestConversationForVideo('')).toBeNull();
    expect(listConversations(10).find((item) => item.id === conversation.id)?.profileId).toBe(
      'p1'
    );
    expect(setConversationProfile(conversation.id, 'p2')).toBe(true);
    expect(listConversations(10).find((item) => item.id === conversation.id)?.profileId).toBe(
      'p2'
    );
  });

  it('导出 Markdown 带标题、对话与来源', () => {
    const conversation = createConversation({
      title: '导出测试',
      videoKey: 'BV3',
      videoTitle: '视频标题'
    });
    appendMessage(conversation.id, { role: 'user', content: '问题' });
    appendMessage(conversation.id, {
      role: 'assistant',
      content: '回答',
      sources: [{ title: '站点', url: 'https://site.test', snippet: '' }]
    });
    const markdown = conversationMarkdown(conversation.id);
    expect(markdown).toContain('# 导出测试');
    expect(markdown).toContain('## 我');
    expect(markdown).toContain('## AI');
    expect(markdown).toContain('[站点](https://site.test)');
  });
});
