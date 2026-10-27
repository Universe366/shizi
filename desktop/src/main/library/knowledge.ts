import { createHash } from 'node:crypto';
import { session } from 'electron';
import type {
  AiPlatform,
  KbDocument,
  KbHit,
  KbProgress,
  KbStatus
} from '../../shared/types';
import { aiBaseUrl, aiHeaders, chatOnce, isAnthropicPlatform, isGeminiPlatform } from '../aiClient';
import { activePlatform, loadSettings } from '../settings';
import { requireDb } from './db';
import {
  buildKbContext,
  chunkText,
  cosineSimilarity,
  hybridScore,
  keywordScore
} from '../../shared/kb';

/**
 * 跨视频知识库：
 * 字幕按时间窗口、总结/笔记按段落切块 → 调 OpenAI 兼容 /embeddings → 存 Float32 向量。
 * 检索用余弦相似度；提问把命中的块按 [n] 引用交给对话模型。
 */

interface ChunkRow {
  videoId: number;
  kind: 'subtitle' | 'summary' | 'note' | 'meta';
  startMs: number;
  endMs: number;
  text: string;
  hash: string;
}

function hashOf(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function resolveEmbeddingPlatform(): AiPlatform {
  const settings = loadSettings();
  if (!settings.knowledge.enabled) throw new Error('知识库未启用（设置 → AI 与语音 → 知识库）');
  const platform = settings.knowledge.platformId
    ? settings.ai.platforms.find((item) => item.id === settings.knowledge.platformId)
    : activePlatform(settings);
  if (!platform) throw new Error('知识库没有可用的 embedding 平台');
  if (!platform.baseUrl.trim()) throw new Error('embedding 平台缺少 Base URL');
  if (!platform.apiKey.trim() && !/localhost|127\.0\.0\.1/i.test(platform.baseUrl)) {
    throw new Error('embedding 平台缺少 API Key');
  }
  if (isAnthropicPlatform(platform) || isGeminiPlatform(platform)) {
    throw new Error('知识库需要 OpenAI 兼容的 /embeddings 接口，请选择 OpenAI 兼容平台');
  }
  return platform;
}

/** 收集所有视频的字幕/总结/笔记块。 */
export function collectChunks(): ChunkRow[] {
  const db = requireDb();
  const chunks: ChunkRow[] = [];
  const videos = db.prepare('SELECT id, title, owner FROM videos ORDER BY id ASC').all() as Array<{
    id: number;
    title: string;
    owner: string;
  }>;
  const segmentStatement = db.prepare(
    `SELECT s.start_ms AS startMs, s.end_ms AS endMs, s.text AS text
     FROM segments s JOIN tracks t ON t.id = s.track_id
     WHERE t.video_id = ? ORDER BY s.start_ms ASC`
  );
  const summaryStatement = db.prepare(
    'SELECT content_md AS text FROM summaries WHERE video_id = ? ORDER BY updated_at DESC LIMIT 1'
  );
  const noteStatement = db.prepare('SELECT content_md AS text FROM notes WHERE video_id = ?');

  for (const video of videos) {
    const meta = `${video.title}${video.owner ? ` · ${video.owner}` : ''}`;
    if (meta.trim()) {
      chunks.push({
        videoId: Number(video.id),
        kind: 'meta',
        startMs: 0,
        endMs: 0,
        text: meta.trim(),
        hash: hashOf(`${video.id}|meta|${meta}`)
      });
    }
    const rows = segmentStatement.all(video.id) as Array<{
      startMs: number;
      endMs: number;
      text: string;
    }>;
    let buffer: typeof rows = [];
    let chars = 0;
    const flush = () => {
      if (!buffer.length) return;
      const text = buffer.map((row) => row.text).join(' ').trim();
      if (text) {
        chunks.push({
          videoId: Number(video.id),
          kind: 'subtitle',
          startMs: buffer[0].startMs,
          endMs: buffer[buffer.length - 1].endMs,
          text,
          hash: hashOf(`${video.id}|subtitle|${buffer[0].startMs}|${text}`)
        });
      }
      // 保留最后一句作为下一块的重叠，避免断章。
      buffer = buffer.slice(-1);
      chars = buffer.reduce((total, row) => total + row.text.length, 0);
    };
    for (const row of rows) {
      buffer.push(row);
      chars += row.text.length;
      if (chars >= 600) flush();
    }
    flush();

    const summary = summaryStatement.get(video.id) as { text?: string } | undefined;
    if (summary?.text?.trim()) {
      for (const part of chunkText(summary.text, 1200, 120)) {
        chunks.push({
          videoId: Number(video.id),
          kind: 'summary',
          startMs: 0,
          endMs: 0,
          text: part,
          hash: hashOf(`${video.id}|summary|${part}`)
        });
      }
    }
    const note = noteStatement.get(video.id) as { text?: string } | undefined;
    if (note?.text?.trim()) {
      for (const part of chunkText(note.text, 1200, 120)) {
        chunks.push({
          videoId: Number(video.id),
          kind: 'note',
          startMs: 0,
          endMs: 0,
          text: part,
          hash: hashOf(`${video.id}|note|${part}`)
        });
      }
    }
  }
  return chunks;
}

async function embedTexts(
  platform: AiPlatform,
  model: string,
  inputs: string[]
): Promise<Float32Array[]> {
  const response = await session.defaultSession.fetch(`${aiBaseUrl(platform)}/embeddings`, {
    method: 'POST',
    headers: aiHeaders(platform),
    body: JSON.stringify({ model, input: inputs }),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`embedding 接口 HTTP ${response.status}：${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as {
    data?: Array<{ index?: number; embedding?: number[] }>;
  };
  const rows = [...(json.data || [])].sort((a, b) => (a.index || 0) - (b.index || 0));
  return rows.map((row) => Float32Array.from(row.embedding || []));
}

export function kbStatus(): KbStatus {
  try {
    const db = requireDb();
    const chunks = Number(
      (db.prepare('SELECT COUNT(*) AS n FROM kb_chunks').get() as { n?: number })?.n || 0
    );
    const videos = Number(
      (
        db.prepare('SELECT COUNT(DISTINCT video_id) AS n FROM kb_chunks').get() as {
          n?: number;
        }
      )?.n || 0
    );
    const settings = loadSettings();
    const vectors = Number(
      (
        db
          .prepare('SELECT COUNT(*) AS n FROM kb_vectors WHERE model = ?')
          .get(settings.knowledge.model) as { n?: number }
      )?.n || 0
    );
    return {
      chunks,
      videos,
      model: settings.knowledge.model,
      ready: chunks > 0 && vectors > 0
    };
  } catch {
    return { chunks: 0, videos: 0, model: '', ready: false };
  }
}

/** 知识库文档列表：每个视频贡献了多少块、是否已经有当前模型的向量。 */
export function kbDocuments(): KbDocument[] {
  try {
    const db = requireDb();
    const model = loadSettings().knowledge.model;
    const rows = db
      .prepare(
        `SELECT c.video_id AS videoId, v.title AS title, v.owner AS owner,
           COUNT(*) AS chunks,
           SUM(CASE WHEN c.kind = 'subtitle' THEN 1 ELSE 0 END) AS subtitle,
           SUM(CASE WHEN c.kind = 'summary' THEN 1 ELSE 0 END) AS summary,
           SUM(CASE WHEN c.kind = 'note' THEN 1 ELSE 0 END) AS note,
           SUM(CASE WHEN vec.chunk_id IS NOT NULL THEN 1 ELSE 0 END) AS indexed,
           MAX(c.created_at) AS updatedAt
         FROM kb_chunks c
         JOIN videos v ON v.id = c.video_id
         LEFT JOIN kb_vectors vec ON vec.chunk_id = c.id AND vec.model = ?
         GROUP BY c.video_id
         ORDER BY updatedAt DESC`
      )
      .all(model) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      videoId: Number(row.videoId) || 0,
      title: String(row.title || '未命名'),
      owner: String(row.owner || ''),
      chunks: Number(row.chunks) || 0,
      subtitle: Number(row.subtitle) || 0,
      summary: Number(row.summary) || 0,
      note: Number(row.note) || 0,
      indexed: Number(row.indexed) || 0,
      updatedAt: Number(row.updatedAt) || 0
    }));
  } catch {
    return [];
  }
}

export async function indexKnowledge(
  onProgress: (progress: KbProgress) => void
): Promise<KbStatus> {
  const settings = loadSettings();
  const platform = resolveEmbeddingPlatform();
  const model = settings.knowledge.model;
  if (!model.trim()) throw new Error('请填写 embedding 模型名');
  const db = requireDb();

  onProgress({ phase: 'collect', done: 0, total: 1, message: '正在整理字幕/总结/笔记…' });
  const chunks = collectChunks();
  if (!chunks.length) throw new Error('库里还没有可索引的字幕、总结或笔记');

  db.exec('DELETE FROM kb_vectors');
  db.exec('DELETE FROM kb_chunks');
  const insertChunk = db.prepare(
    `INSERT INTO kb_chunks (video_id, kind, start_ms, end_ms, text, hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertVector = db.prepare(
    'INSERT INTO kb_vectors (chunk_id, model, dim, vector) VALUES (?, ?, ?, ?)'
  );
  const now = Date.now();
  const ids: number[] = [];
  for (const chunk of chunks) {
    const result = insertChunk.run(
      chunk.videoId,
      chunk.kind,
      chunk.startMs,
      chunk.endMs,
      chunk.text.slice(0, 6000),
      chunk.hash,
      now
    );
    ids.push(Number(result.lastInsertRowid));
  }

  const batchSize = 16;
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    const vectors = await embedTexts(
      platform,
      model,
      batch.map((chunk) => chunk.text.slice(0, 4000))
    );
    if (vectors.length !== batch.length) {
      throw new Error(`embedding 返回数量不匹配（${vectors.length}/${batch.length}）`);
    }
    vectors.forEach((vector, index) => {
      const buffer = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
      insertVector.run(ids[offset + index], model, vector.length, buffer);
    });
    onProgress({
      phase: 'embed',
      done: Math.min(chunks.length, offset + batch.length),
      total: chunks.length,
      message: `已向量化 ${Math.min(chunks.length, offset + batch.length)} / ${chunks.length}`
    });
  }

  const status = kbStatus();
  onProgress({
    phase: 'done',
    done: chunks.length,
    total: chunks.length,
    message: `完成：${status.chunks} 块 / ${status.videos} 个视频`
  });
  return status;
}

export async function searchKnowledge(
  question: string,
  limit = 8,
  videoId?: number
): Promise<KbHit[]> {
  const settings = loadSettings();
  const platform = resolveEmbeddingPlatform();
  const model = settings.knowledge.model;
  const db = requireDb();
  const [vector] = await embedTexts(platform, model, [String(question || '').slice(0, 2000)]);
  if (!vector) return [];
  const rows = db
    .prepare(
      `SELECT c.video_id AS videoId, c.kind AS kind, c.start_ms AS startMs, c.end_ms AS endMs,
              c.text AS text, v.title AS title, v.vector AS vector
       FROM kb_vectors v JOIN kb_chunks c ON c.id = v.chunk_id
       JOIN videos vi ON vi.id = c.video_id
       WHERE v.model = ?${videoId ? ' AND c.video_id = ?' : ''}`
    )
    .all(...(videoId ? [model, videoId] : [model])) as unknown as Array<{
    videoId: number;
    kind: string;
    startMs: number;
    endMs: number;
    text: string;
    title: string;
    vector: Uint8Array;
  }>;
  const hits: KbHit[] = [];
  for (const row of rows) {
    const stored = new Float32Array(
      row.vector.buffer,
      row.vector.byteOffset,
      Math.floor(row.vector.byteLength / 4)
    );
    hits.push({
      videoId: Number(row.videoId),
      title: String(row.title || ''),
      kind: String(row.kind || ''),
      startMs: Number(row.startMs) || 0,
      endMs: Number(row.endMs) || 0,
      text: String(row.text || ''),
      score: hybridScore(
        cosineSimilarity(vector, stored),
        keywordScore(question, String(row.text || ''))
      )
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(1, Math.min(20, limit)));
}

export async function askKnowledge(
  question: string,
  videoId?: number
): Promise<{ text: string; hits: KbHit[] }> {
  const clean = String(question || '').trim();
  if (!clean) throw new Error('请输入问题');
  const hits = await searchKnowledge(clean, 8, videoId);
  if (!hits.length) throw new Error('知识库里没有可用的资料，请先在设置里构建索引');
  const settings = loadSettings();
  const platform = settings.ai.platforms.find(
    (item) => item.id === (settings.knowledge.platformId || settings.ai.activeId)
  );
  const chatPlatform = platform || activePlatform(settings);
  const context = buildKbContext(hits);
  const result = await chatOnce(
    chatPlatform,
    [
      {
        role: 'system',
        content:
          '你是本地视频资料库的检索助手。只依据给出的资料回答；资料不够就说不知道，不要编造。' +
          '回答用 Markdown，引用资料时写 [编号]，并在末尾列出实际用到的编号。'
      },
      {
        role: 'user',
        content: `资料：\n${context}\n\n问题：${clean}`
      }
    ],
    { temperature: 0.2, maxTokens: 4000, task: 'chat', timeoutMs: 180000 }
  );
  return { text: result.text, hits };
}
