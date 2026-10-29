import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AiUsage,
  ChatAttachment,
  ChatCompareResult,
  ChatConversation,
  ChatMessageSearchHit,
  ChatToolRecord,
  ConversationUsageSummary,
  FavoriteChatMessage,
  StoredChatMessage,
  WebReference
} from '../shared/types';

// ---------------------------------------------------------------------------
// 对话持久化：独立 chat.db（不碰字幕库 schema）。
// 会话按视频/网页分组，消息带来源与思考过程；写失败只影响“历史”，不影响当轮对话。
// ---------------------------------------------------------------------------

let database: DatabaseSync | null = null;

export function chatDbFile(): string {
  return path.join(app.getPath('userData'), 'chat.db');
}

function db(): DatabaseSync | null {
  if (database) return database;
  try {
    fs.mkdirSync(path.dirname(chatDbFile()), { recursive: true });
    database = new DatabaseSync(chatDbFile());
    database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        video_key TEXT NOT NULL DEFAULT '',
        video_title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        reasoning TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        images_json TEXT NOT NULL DEFAULT '[]',
        sources_json TEXT NOT NULL DEFAULT '[]',
        web_engine TEXT NOT NULL DEFAULT '',
        web_notice TEXT NOT NULL DEFAULT '',
        compare_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS conversations_video ON conversations(video_key);
      CREATE TABLE IF NOT EXISTS bridge_conversations (
        conversation_key TEXT PRIMARY KEY,
        conversation_id INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    // 老库没有 tools_json：补列，历史消息按空数组读。
    const columns = database.prepare('PRAGMA table_info(messages)').all() as Array<{
      name?: string;
    }>;
    if (!columns.some((column) => column.name === 'tools_json')) {
      database.exec("ALTER TABLE messages ADD COLUMN tools_json TEXT NOT NULL DEFAULT '[]'");
    }
    if (!columns.some((column) => column.name === 'attachments_json')) {
      database.exec(
        "ALTER TABLE messages ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'"
      );
    }
    if (!columns.some((column) => column.name === 'compare_json')) {
      database.exec("ALTER TABLE messages ADD COLUMN compare_json TEXT NOT NULL DEFAULT '[]'");
    }
    if (!columns.some((column) => column.name === 'usage_json')) {
      database.exec("ALTER TABLE messages ADD COLUMN usage_json TEXT NOT NULL DEFAULT 'null'");
    }
    if (!columns.some((column) => column.name === 'favorite')) {
      database.exec('ALTER TABLE messages ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
    }
    const conversationColumns = database.prepare('PRAGMA table_info(conversations)').all() as Array<{
      name?: string;
    }>;
    if (!conversationColumns.some((column) => column.name === 'profile_id')) {
      database.exec("ALTER TABLE conversations ADD COLUMN profile_id TEXT NOT NULL DEFAULT ''");
    }
    if (!conversationColumns.some((column) => column.name === 'platform_id')) {
      database.exec("ALTER TABLE conversations ADD COLUMN platform_id TEXT NOT NULL DEFAULT ''");
    }
    if (!conversationColumns.some((column) => column.name === 'model')) {
      database.exec("ALTER TABLE conversations ADD COLUMN model TEXT NOT NULL DEFAULT ''");
    }
    return database;
  } catch (error) {
    console.warn('[chat] 打开对话库失败:', (error as Error).message);
    database = null;
    return null;
  }
}

export function closeChatStore(): void {
  try {
    database?.close();
  } catch {
    // ignore
  }
  database = null;
}

/** 备份用：VACUUM INTO 得到一致快照，不需要关库。 */
export function backupChatStore(target: string): boolean {
  try {
    const store = db();
    if (!store) return false;
    store.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    return fs.existsSync(target);
  } catch (error) {
    console.warn('[chat] 备份失败:', (error as Error).message);
    return false;
  }
}

interface ConversationRow {
  id: number;
  title: string;
  video_key: string;
  video_title: string;
  profile_id?: string;
  platform_id?: string;
  model?: string;
  created_at: number;
  updated_at: number;
  message_count?: number;
}

function mapConversation(row: ConversationRow): ChatConversation {
  return {
    id: Number(row.id),
    title: String(row.title || ''),
    videoKey: String(row.video_key || ''),
    videoTitle: String(row.video_title || ''),
    profileId: String(row.profile_id || ''),
    platformId: String(row.platform_id || ''),
    model: String(row.model || ''),
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    messageCount: Number(row.message_count) || 0
  };
}

export function createConversation(input: {
  title?: string;
  videoKey?: string;
  videoTitle?: string;
  profileId?: string;
  platformId?: string;
  model?: string;
}): ChatConversation {
  const now = Date.now();
  const title = String(input.title || '新对话').trim().slice(0, 80) || '新对话';
  const statement = db()?.prepare(
    `INSERT INTO conversations (title, video_key, video_title, profile_id, platform_id, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  if (!statement) throw new Error('对话库不可用');
  const result = statement.run(
    title,
    String(input.videoKey || ''),
    String(input.videoTitle || '').slice(0, 200),
    String(input.profileId || '').slice(0, 60),
    String(input.platformId || '').slice(0, 60),
    String(input.model || '').slice(0, 120),
    now,
    now
  );
  return {
    id: Number(result.lastInsertRowid),
    title,
    videoKey: String(input.videoKey || ''),
    videoTitle: String(input.videoTitle || '').slice(0, 200),
    profileId: String(input.profileId || '').slice(0, 60),
    platformId: String(input.platformId || '').slice(0, 60),
    model: String(input.model || '').slice(0, 120),
    createdAt: now,
    updatedAt: now,
    messageCount: 0
  };
}

/**
 * 插件对话同步：按 conversationKey 建一个专用会话，每次整段替换消息。
 * 只覆盖 bridge_conversations 映射到的会话，不碰桌面端自己的会话。
 */
export function syncBridgeConversation(input: {
  key: string;
  videoKey?: string;
  videoTitle?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; reasoning?: string }>;
}): { conversationId: number; count: number } {
  const store = db();
  if (!store) throw new Error('对话库不可用');
  const key = String(input.key || '').trim();
  if (!key) throw new Error('缺少 conversationKey');
  const now = Date.now();
  const existing = store
    .prepare('SELECT conversation_id FROM bridge_conversations WHERE conversation_key = ?')
    .get(key) as { conversation_id: number } | undefined;
  let conversationId = existing ? Number(existing.conversation_id) : 0;
  if (!conversationId) {
    const conversation = createConversation({
      title: String(input.videoTitle || '插件对话').slice(0, 80),
      videoKey: String(input.videoKey || ''),
      videoTitle: String(input.videoTitle || '')
    });
    conversationId = conversation.id;
    store
      .prepare(
        'INSERT OR REPLACE INTO bridge_conversations (conversation_key, conversation_id, updated_at) VALUES (?, ?, ?)'
      )
      .run(key, conversationId, now);
  }
  store.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  const messages = Array.isArray(input.messages) ? input.messages.slice(-60) : [];
  for (const message of messages) {
    const content = String(message.content || '').trim();
    if (!content) continue;
    appendMessage(conversationId, {
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content,
      reasoning: String(message.reasoning || '')
    });
  }
  store
    .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
    .run(now, conversationId);
  store
    .prepare('UPDATE bridge_conversations SET updated_at = ? WHERE conversation_key = ?')
    .run(now, key);
  return { conversationId, count: messages.length };
}

/** 导出插件写入的桥接会话，供插件首次迁移拉回。 */
export function listBridgeConversations(limit = 200): Array<{
  key: string;
  videoKey: string;
  videoTitle: string;
  updatedAt: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string; reasoning: string }>;
}> {
  try {
    const rows = db()
      ?.prepare(
        `SELECT bc.conversation_key AS key, c.id AS conversation_id, c.video_key AS video_key,
                c.video_title AS video_title, c.updated_at AS updated_at
         FROM bridge_conversations bc
         JOIN conversations c ON c.id = bc.conversation_id
         ORDER BY c.updated_at DESC
         LIMIT ?`
      )
      .all(Math.max(1, Math.min(1000, Math.round(limit)))) as unknown as Array<{
      key: string;
      conversation_id: number;
      video_key: string;
      video_title: string;
      updated_at: number;
    }>;
    return (rows || []).map((row) => ({
      key: String(row.key || ''),
      videoKey: String(row.video_key || ''),
      videoTitle: String(row.video_title || ''),
      updatedAt: Number(row.updated_at) || 0,
      messages: listMessages(Number(row.conversation_id))
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: String(message.content || ''),
          reasoning: String(message.reasoning || '')
        }))
    }));
  } catch {
    return [];
  }
}

/** 导出所有会话：桥接会话沿用插件 key，桌面原生会话用 desktop:<id>。 */
export function listAllConversations(limit = 200): Array<{
  key: string;
  videoKey: string;
  videoTitle: string;
  title: string;
  updatedAt: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string; reasoning: string }>;
}> {
  try {
    const rows = db()
      ?.prepare(
        `SELECT c.*, (SELECT bc.conversation_key FROM bridge_conversations bc WHERE bc.conversation_id = c.id) AS bridge_key
         FROM conversations c
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ?`
      )
      .all(Math.max(1, Math.min(2000, Math.round(limit)))) as unknown as Array<
      ConversationRow & { bridge_key?: string }
    >;
    return (rows || []).map((row) => ({
      key: String(row.bridge_key || `desktop:${row.id}`),
      videoKey: String(row.video_key || ''),
      videoTitle: String(row.video_title || ''),
      title: String(row.title || row.video_title || '桌面对话'),
      updatedAt: Number(row.updated_at) || 0,
      messages: listMessages(Number(row.id))
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: String(message.content || ''),
          reasoning: String(message.reasoning || '')
        }))
    }));
  } catch {
    return [];
  }
}

export function setConversationModel(
  id: number,
  platformId: string,
  model: string
): boolean {
  try {
    const statement = db()?.prepare(
      'UPDATE conversations SET platform_id = ?, model = ? WHERE id = ?'
    );
    if (!statement) return false;
    statement.run(
      String(platformId || '').slice(0, 60),
      String(model || '').slice(0, 120),
      Number(id)
    );
    return true;
  } catch {
    return false;
  }
}

export function listConversations(limit = 50): ChatConversation[] {
  try {
    const rows = db()
      ?.prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ?`
      )
      .all(Math.max(1, Math.min(200, Math.round(limit)))) as unknown as ConversationRow[];
    return (rows || []).map(mapConversation);
  } catch {
    return [];
  }
}

export function latestConversationForVideo(videoKey: string): ChatConversation | null {
  if (!videoKey) return null;
  try {
    const row = db()
      ?.prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c WHERE c.video_key = ? ORDER BY c.updated_at DESC, c.id DESC LIMIT 1`
      )
      .get(videoKey) as ConversationRow | undefined;
    return row ? mapConversation(row) : null;
  } catch {
    return null;
  }
}

interface MessageRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  reasoning: string;
  model: string;
  images_json: string;
  sources_json: string;
  web_engine: string;
  web_notice: string;
  tools_json: string;
  attachments_json: string;
  compare_json: string;
  usage_json?: string;
  favorite?: number;
  conversation_title?: string;
  created_at: number;
}

function parseJsonArray<T>(text: string): T[] {
  try {
    const value = JSON.parse(text || '[]');
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function mapMessage(row: MessageRow): StoredChatMessage {
  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: String(row.content || ''),
    reasoning: String(row.reasoning || ''),
    model: String(row.model || ''),
    images: parseJsonArray<string>(row.images_json),
    sources: parseJsonArray<WebReference>(row.sources_json),
    webEngine: String(row.web_engine || ''),
    webNotice: String(row.web_notice || ''),
    tools: parseJsonArray<ChatToolRecord>(row.tools_json),
    attachments: parseJsonArray<ChatAttachment>(row.attachments_json),
    compare: parseJsonArray<ChatCompareResult>(row.compare_json),
    ...(parseUsage(row.usage_json) ? { usage: parseUsage(row.usage_json) as AiUsage } : {}),
    favorite: Boolean(row.favorite),
    createdAt: Number(row.created_at) || 0
  };
}

function parseUsage(text: string | undefined): AiUsage | null {
  if (!text || text === 'null') return null;
  try {
    const value = JSON.parse(text) as Partial<AiUsage>;
    const inputTokens = Number(value.inputTokens) || 0;
    const outputTokens = Number(value.outputTokens) || 0;
    if (!inputTokens && !outputTokens) return null;
    return {
      inputTokens,
      outputTokens,
      ...(Number(value.cacheReadTokens)
        ? { cacheReadTokens: Number(value.cacheReadTokens) }
        : {})
    };
  } catch {
    return null;
  }
}

export function listMessages(conversationId: number): StoredChatMessage[] {
  try {
    const rows = db()
      ?.prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC'
      )
      .all(Number(conversationId)) as unknown as MessageRow[];
    return (rows || []).map(mapMessage);
  } catch {
    return [];
  }
}

export function appendMessage(
  conversationId: number,
  message: {
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
    model?: string;
    images?: string[];
    sources?: WebReference[];
    webEngine?: string;
    webNotice?: string;
    tools?: ChatToolRecord[];
    attachments?: ChatAttachment[];
    compare?: ChatCompareResult[];
    usage?: AiUsage;
    favorite?: boolean;
  }
): StoredChatMessage {
  const now = Date.now();
  const statement = db()?.prepare(
    `INSERT INTO messages
       (conversation_id, role, content, reasoning, model, images_json, sources_json, web_engine, web_notice, tools_json, attachments_json, compare_json, usage_json, favorite, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  if (!statement) throw new Error('对话库不可用');
  const result = statement.run(
    Number(conversationId),
    message.role,
    String(message.content || '').slice(0, 200000),
    String(message.reasoning || '').slice(0, 100000),
    String(message.model || ''),
    JSON.stringify(message.images || []),
    JSON.stringify(message.sources || []),
    String(message.webEngine || ''),
    String(message.webNotice || ''),
    JSON.stringify(message.tools || []),
    JSON.stringify(message.attachments || []),
    JSON.stringify(message.compare || []),
    JSON.stringify(message.usage || null),
    message.favorite ? 1 : 0,
    now
  );
  try {
    db()
      ?.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(now, Number(conversationId));
  } catch {
    // ignore
  }
  return {
    id: Number(result.lastInsertRowid),
    conversationId: Number(conversationId),
    role: message.role,
    content: String(message.content || ''),
    reasoning: String(message.reasoning || ''),
    model: String(message.model || ''),
    images: message.images || [],
    sources: message.sources || [],
    webEngine: String(message.webEngine || ''),
    webNotice: String(message.webNotice || ''),
    tools: message.tools || [],
    attachments: message.attachments || [],
    compare: message.compare || [],
    ...(message.usage ? { usage: message.usage } : {}),
    favorite: Boolean(message.favorite),
    createdAt: now
  };
}

/** 从某条消息处分叉：复制前 keep 条到新会话，原会话保持不动。 */
export function branchConversation(sourceId: number, keep: number): ChatConversation | null {
  const source = listConversations(200).find((item) => item.id === Number(sourceId));
  if (!source) return null;
  const created = createConversation({
    title: `${source.title} · 分支`,
    videoKey: source.videoKey,
    videoTitle: source.videoTitle,
    profileId: source.profileId,
    platformId: source.platformId,
    model: source.model
  });
  const rows = listMessages(sourceId).slice(0, Math.max(1, Math.round(keep)));
  for (const row of rows) {
    appendMessage(created.id, {
      role: row.role,
      content: row.content,
      reasoning: row.reasoning,
      model: row.model,
      images: row.images,
      sources: row.sources,
      webEngine: row.webEngine,
      webNotice: row.webNotice,
      tools: row.tools,
      attachments: row.attachments,
      compare: row.compare,
      usage: row.usage,
      favorite: row.favorite
    });
  }
  return { ...created, messageCount: rows.length };
}

export function setConversationProfile(id: number, profileId: string): boolean {  try {
    const result = db()
      ?.prepare('UPDATE conversations SET profile_id = ?, updated_at = ? WHERE id = ?')
      .run(String(profileId || '').slice(0, 60), Date.now(), Number(id));
    return Boolean(result && Number(result.changes) > 0);
  } catch {
    return false;
  }
}

/** 只保留前 keep 条消息（重新生成/编辑消息时截断后续内容）。 */
export function truncateMessages(conversationId: number, keep: number): boolean {
  try {
    const store = db();
    if (!store) return false;
    const rows = store
      .prepare(
        'SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC'
      )
      .all(Number(conversationId)) as Array<{ id: number }>;
    const remove = rows.slice(Math.max(0, Math.round(keep)));
    if (!remove.length) return true;
    const statement = store.prepare('DELETE FROM messages WHERE id = ?');
    for (const row of remove) statement.run(Number(row.id));
    store
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(Date.now(), Number(conversationId));
    return true;
  } catch {
    return false;
  }
}

export function renameConversation(id: number, title: string): boolean {  const next = String(title || '').trim().slice(0, 80);
  if (!next) return false;
  try {
    const result = db()
      ?.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(next, Date.now(), Number(id));
    return Boolean(result && Number(result.changes) > 0);
  } catch {
    return false;
  }
}

export function deleteConversation(id: number): boolean {
  try {
    const store = db();
    if (!store) return false;
    store.prepare('DELETE FROM messages WHERE conversation_id = ?').run(Number(id));
    const result = store.prepare('DELETE FROM conversations WHERE id = ?').run(Number(id));
    return Boolean(result && Number(result.changes) > 0);
  } catch {
    return false;
  }
}

export function setMessageFavorite(messageId: number, favorite: boolean): boolean {
  try {
    const result = db()
      ?.prepare('UPDATE messages SET favorite = ? WHERE id = ?')
      .run(favorite ? 1 : 0, Number(messageId));
    return Boolean(result && Number(result.changes) > 0);
  } catch {
    return false;
  }
}

function joinedMessage(row: MessageRow): FavoriteChatMessage {
  return { ...mapMessage(row), conversationTitle: String(row.conversation_title || '未命名对话') };
}

export function listFavoriteMessages(limit = 100): FavoriteChatMessage[] {
  try {
    const rows = db()
      ?.prepare(
        `SELECT m.*, c.title AS conversation_title FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.favorite = 1 ORDER BY m.created_at DESC LIMIT ?`
      )
      .all(Math.max(1, Math.min(500, Math.round(limit)))) as unknown as MessageRow[];
    return (rows || []).map(joinedMessage);
  } catch {
    return [];
  }
}

export function searchMessages(query: string, limit = 50): ChatMessageSearchHit[] {
  const value = String(query || '').trim();
  if (!value) return [];
  try {
    const rows = db()
      ?.prepare(
        `SELECT m.id, m.conversation_id, m.role, m.content, m.created_at,
                c.title AS conversation_title
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE m.content LIKE ? ORDER BY m.created_at DESC LIMIT ?`
      )
      .all(`%${value}%`, Math.max(1, Math.min(200, Math.round(limit)))) as unknown as Array<{
      id: number;
      conversation_id: number;
      role: string;
      content: string;
      created_at: number;
      conversation_title: string;
    }>;
    return (rows || []).map((row) => ({
      messageId: Number(row.id),
      conversationId: Number(row.conversation_id),
      conversationTitle: String(row.conversation_title || '未命名对话'),
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: String(row.content || '').slice(0, 500),
      createdAt: Number(row.created_at) || 0
    }));
  } catch {
    return [];
  }
}

export function usageByConversation(limit = 20): ConversationUsageSummary[] {
  try {
    const rows = db()
      ?.prepare(
        `SELECT m.conversation_id, c.title AS conversation_title, m.usage_json
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE m.usage_json IS NOT NULL AND m.usage_json != 'null'
         ORDER BY m.created_at DESC LIMIT 5000`
      )
      .all() as unknown as Array<{
      conversation_id: number;
      conversation_title: string;
      usage_json: string;
    }>;
    const map = new Map<number, ConversationUsageSummary>();
    for (const row of rows || []) {
      const usage = parseUsage(row.usage_json);
      if (!usage) continue;
      const id = Number(row.conversation_id);
      const current = map.get(id) || {
        conversationId: id,
        title: String(row.conversation_title || '未命名对话'),
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0
      };
      current.requests += 1;
      current.inputTokens += usage.inputTokens;
      current.outputTokens += usage.outputTokens;
      current.cacheReadTokens += usage.cacheReadTokens || 0;
      map.set(id, current);
    }
    return [...map.values()]
      .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
      .slice(0, Math.max(1, Math.min(200, Math.round(limit))));
  } catch {
    return [];
  }
}

export function conversationMarkdown(conversationId: number): string {
  const conversation = listConversations(200).find((item) => item.id === Number(conversationId));
  if (!conversation) return '';
  const rows = listMessages(conversationId);
  const lines = [
    `# ${conversation.title}`,
    '',
    conversation.videoTitle ? `> 来源：${conversation.videoTitle}` : '',
    ''
  ];
  for (const row of rows) {
    lines.push(`## ${row.role === 'user' ? '我' : 'AI'}`);
    lines.push('');
    lines.push(row.content);
    lines.push('');
    if (row.sources.length) {
      lines.push('来源：');
      for (const source of row.sources.slice(0, 5)) {
        lines.push(`- [${source.title || source.url}](${source.url})`);
      }
      lines.push('');
    }
    if (row.tools.length) {
      lines.push('工具：');
      for (const tool of row.tools) {
        lines.push(`- ${tool.name}：${tool.ok ? '完成' : '失败'}${tool.detail ? `（${tool.detail.slice(0, 120)}）` : ''}`);
      }
      lines.push('');
    }
    if (row.attachments.length) {
      lines.push('附件：');
      for (const attachment of row.attachments) {
        lines.push(`- ${attachment.name}（${attachment.chars} 字）`);
      }
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
}
