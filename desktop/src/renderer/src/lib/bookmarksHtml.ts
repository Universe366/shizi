import type { Bookmark, BookmarkFolder } from '../../../shared/types';

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 生成 Chrome / Edge 可导入的 bookmarks.html。
 * 书签栏条目放在顶层，文件夹按名字展开（嵌套层级由文件夹名里的「 / 」表达）。
 */
export function buildBookmarksHtml(bookmarks: Bookmark[], folders: BookmarkFolder[]): string {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>书签</TITLE>',
    '<H1>书签</H1>',
    '<DL><p>'
  ];

  const bar = bookmarks.filter((item) => !item.folder);
  lines.push('  <DT><H3>书签栏</H3>');
  lines.push('  <DL><p>');
  for (const item of bar) {
    lines.push(`    <DT><A HREF="${escapeHtml(item.url)}">${escapeHtml(item.title || item.url)}</A>`);
  }
  lines.push('  </DL><p>');

  for (const folder of folders) {
    const inside = bookmarks.filter((item) => item.folder === folder.name);
    lines.push(`  <DT><H3>${escapeHtml(folder.name)}</H3>`);
    lines.push('  <DL><p>');
    for (const item of inside) {
      lines.push(`    <DT><A HREF="${escapeHtml(item.url)}">${escapeHtml(item.title || item.url)}</A>`);
    }
    lines.push('  </DL><p>');
  }

  lines.push('</DL><p>');
  return lines.join('\n');
}
