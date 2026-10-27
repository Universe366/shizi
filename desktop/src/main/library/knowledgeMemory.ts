import type { KbCard, KbHit, KbQaEntry } from '../../shared/types';
import { nextReviewSchedule, type KbReviewGrade } from '../../shared/kbReview';
import { requireDb } from './db';

function parseHits(raw: unknown): KbHit[] {
  try {
    const value = JSON.parse(String(raw || '[]'));
    return Array.isArray(value) ? (value as KbHit[]) : [];
  } catch {
    return [];
  }
}

/** 保存一条问答（含引用视频），用于历史与「哪些问题引用过这篇」。 */
export function saveKbQa(input: {
  question: string;
  answer: string;
  mode: 'ask' | 'search';
  scopeLabel: string;
  hits: KbHit[];
}): number {
  const db = requireDb();
  const question = String(input.question || '').trim().slice(0, 2000);
  if (!question) throw new Error('问题为空');
  const hits = (input.hits || []).slice(0, 20);
  const info = db
    .prepare(
      `INSERT INTO kb_qa (question, answer, mode, scope_label, hits_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      question,
      String(input.answer || '').slice(0, 20000),
      input.mode === 'search' ? 'search' : 'ask',
      String(input.scopeLabel || '全部文档').slice(0, 120),
      JSON.stringify(hits),
      Date.now()
    );
  const id = Number(info.lastInsertRowid);
  const mention = db.prepare('INSERT OR IGNORE INTO kb_mentions (qa_id, video_id) VALUES (?, ?)');
  for (const videoId of new Set(hits.map((hit) => Number(hit.videoId)).filter((value) => value > 0))) {
    mention.run(id, videoId);
  }
  return id;
}

export function listKbQa(options: { limit?: number; videoId?: number } = {}): KbQaEntry[] {
  const db = requireDb();
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 20));
  const rows = options.videoId
    ? (db
        .prepare(
          `SELECT q.* FROM kb_qa q JOIN kb_mentions m ON m.qa_id = q.id
           WHERE m.video_id = ? ORDER BY q.id DESC LIMIT ?`
        )
        .all(Number(options.videoId), limit) as Array<Record<string, unknown>>)
    : (db.prepare('SELECT * FROM kb_qa ORDER BY id DESC LIMIT ?').all(limit) as Array<
        Record<string, unknown>
      >);
  return rows.map((row) => ({
    id: Number(row.id),
    question: String(row.question || ''),
    answer: String(row.answer || ''),
    mode: row.mode === 'search' ? 'search' : 'ask',
    scopeLabel: String(row.scope_label || '全部文档'),
    hits: parseHits(row.hits_json),
    createdAt: Number(row.created_at) || 0
  }));
}

function mapCard(row: Record<string, unknown>): KbCard {
  return {
    id: Number(row.id),
    videoId: row.video_id ? Number(row.video_id) : null,
    front: String(row.front || ''),
    back: String(row.back || ''),
    dueAt: Number(row.due_at) || 0,
    intervalDays: Number(row.interval_days) || 0,
    streak: Number(row.streak) || 0,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0
  };
}

export function createKbCard(input: {
  videoId?: number | null;
  front: string;
  back: string;
  dueAt?: number;
}): KbCard {
  const db = requireDb();
  const front = String(input.front || '').trim().slice(0, 500);
  const back = String(input.back || '').trim().slice(0, 4000);
  if (!front || !back) throw new Error('卡片正面和背面都要有内容');
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO kb_cards (video_id, front, back, due_at, interval_days, streak, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
    )
    .run(Number(input.videoId) || null, front, back, Number(input.dueAt) || now, now, now);
  const row = db.prepare('SELECT * FROM kb_cards WHERE id = ?').get(Number(info.lastInsertRowid)) as
    | Record<string, unknown>
    | undefined;
  return mapCard(row || {});
}

export function listKbCards(options: { dueOnly?: boolean; limit?: number; videoId?: number } = {}): KbCard[] {
  const db = requireDb();
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const where: string[] = [];
  const params: Array<number> = [];
  if (options.dueOnly) {
    where.push('due_at <= ?');
    params.push(Date.now());
  }
  if (options.videoId) {
    where.push('video_id = ?');
    params.push(Number(options.videoId));
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM kb_cards ${clause} ORDER BY due_at ASC, id DESC LIMIT ?`)
    .all(...params, limit) as Array<Record<string, unknown>>;
  return rows.map(mapCard);
}

export function reviewKbCard(id: number, grade: KbReviewGrade): KbCard {
  const db = requireDb();
  const current = db.prepare('SELECT * FROM kb_cards WHERE id = ?').get(Number(id)) as
    | Record<string, unknown>
    | undefined;
  if (!current) throw new Error('卡片不存在');
  const card = mapCard(current);
  const next = nextReviewSchedule(card, grade);
  db.prepare(
    'UPDATE kb_cards SET due_at = ?, interval_days = ?, streak = ?, updated_at = ? WHERE id = ?'
  ).run(next.dueAt, next.intervalDays, next.streak, Date.now(), card.id);
  return { ...card, ...next, updatedAt: Date.now() };
}

export function deleteKbCard(id: number): boolean {
  const db = requireDb();
  const info = db.prepare('DELETE FROM kb_cards WHERE id = ?').run(Number(id));
  return Number(info.changes) > 0;
}
