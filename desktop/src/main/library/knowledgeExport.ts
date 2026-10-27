import type { KbDocument } from '../../shared/types';
import { clock } from '../../shared/kb';
import { kbChunks, kbDocuments } from './knowledge';
import { getLibraryDetail } from './videos';

export type KnowledgeExportFormat = 'markdown' | 'json';

const STATUS_LABEL: Record<string, string> = {
  new: '未学',
  learning: '学习中',
  review: '待复习',
  mastered: '已掌握'
};

function fileStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function documentPayload(doc: KbDocument) {
  const detail = getLibraryDetail(doc.videoId);
  const chunks = kbChunks(doc.videoId, 200);
  return {
    doc,
    url: detail.video?.url || '',
    summary: detail.summary?.content || '',
    note: detail.note?.content || '',
    chunks
  };
}

/** 把知识库导出为 Markdown 或 JSON 文本（不落盘，由 IPC 负责保存对话框）。 */
export function buildKnowledgeExport(format: KnowledgeExportFormat): {
  filename: string;
  content: string;
} {
  const docs = kbDocuments();
  const payload = docs.map(documentPayload);

  if (format === 'json') {
    return {
      filename: `拾字知识库-${fileStamp()}.json`,
      content: JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          documents: payload.map((item) => ({
            videoId: item.doc.videoId,
            title: item.doc.title,
            owner: item.doc.owner,
            url: item.url,
            tags: item.doc.tags,
            status: item.doc.status,
            chunks: item.doc.chunks,
            subtitle: item.doc.subtitle,
            summary: item.doc.summary,
            note: item.doc.note,
            summaryText: item.summary,
            noteText: item.note,
            sections: item.chunks.map((chunk) => ({
              kind: chunk.kind,
              startMs: chunk.startMs,
              text: chunk.text
            }))
          }))
        },
        null,
        2
      )
    };
  }

  const lines: string[] = [
    '# 拾字知识库',
    '',
    `> 导出时间：${new Date().toLocaleString('zh-CN')} · ${payload.length} 篇文档`,
    ''
  ];

  payload.forEach((item, index) => {
    const { doc } = item;
    lines.push(`## ${index + 1}. ${doc.title}`, '');
    const meta = [
      doc.owner ? `UP：${doc.owner}` : '',
      `状态：${STATUS_LABEL[doc.status] || '未学'}`,
      doc.tags.length ? `标签：${doc.tags.join(' / ')}` : '',
      item.url ? `来源：${item.url}` : ''
    ].filter(Boolean);
    if (meta.length) lines.push(meta.join(' · '), '');
    if (item.summary.trim()) {
      lines.push('### 总结', '', item.summary.trim(), '');
    }
    if (item.note.trim()) {
      lines.push('### 笔记', '', item.note.trim(), '');
    }
    const subtitle = item.chunks.filter((chunk) => chunk.kind === 'subtitle');
    if (subtitle.length) {
      lines.push('### 字幕片段', '');
      for (const chunk of subtitle.slice(0, 120)) {
        lines.push(`- [${clock(chunk.startMs)}] ${chunk.text.replace(/\s+/g, ' ').slice(0, 300)}`);
      }
      lines.push('');
    }
  });

  return { filename: `拾字知识库-${fileStamp()}.md`, content: lines.join('\n') };
}
