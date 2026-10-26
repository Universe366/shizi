import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  ChatAttachment,
  ChatConversation,
  ChatToolRecord,
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
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS conversations_video ON conversations(video_key);
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
    const conversationColumns = database.prepare('PRAGMA table_info(conversations)').all() as Array<{
      name?: string;
    }>;
    if (!conversationColumns.some((column) => column.name === 'profile_id')) {
      database.exec("ALTER TABLE conversations ADD COLUMN profile_id TEXT NOT NULL DEFAULT ''");
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
}): ChatConversation {
  const now = Date.now();
  const title = String(input.title || '新对话').trim().slice(0, 80) || '新对话';
  const statement = db()?.prepare(
    `INSERT INTO conversations (title, video_key, video_title, profile_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  if (!statement) throw new Error('对话库不可用');
  const result = statement.run(
    title,
    String(input.videoKey || ''),
    String(input.videoTitle || '').slice(0, 200),
    String(input.profileId || '').slice(0, 60),
    now,
    now
  );
  return {
    id: Number(result.lastInsertRowid),
    title,
    videoKey: String(input.videoKey || ''),
    videoTitle: String(input.videoTitle || '').slice(0, 200),
    profileId: String(input.profileId || '').slice(0, 60),
    createdAt: now,
    updatedAt: now,
    messageCount: 0
  };
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
    createdAt: Number(row.created_at) || 0
  };
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
  }
): StoredChatMessage {
  const now = Date.now();
  const statement = db()?.prepare(
    `INSERT INTO messages
       (conversation_id, role, content, reasoning, model, images_json, sources_json, web_engine, web_notice, tools_json, attachments_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    profileId: source.profileId
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
      attachments: row.attachments
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
