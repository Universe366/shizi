import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { WebReference } from '../../../shared/types';

interface InlineOptions {
  citations?: WebReference[];
  citePrefix?: string;
}

function inline(text: string, keyPrefix: string, options: InlineOptions = {}): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern =
    /(\$\$[^$]+\$\$|\$[^$\n]+\$|\\\([^)]+\\\)|\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\[\d{1,2}\])/g;
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];

    if (token.startsWith('$$') || token.startsWith('$') || token.startsWith('\\(')) {
      const display = token.startsWith('$$');
      const expr = display
        ? token.slice(2, -2)
        : token.startsWith('$')
          ? token.slice(1, -1)
          : token.slice(2, -2);
      // 中文句子里的 $5 到 $10 会被误判成公式；含中文的就不当公式。
      if (!display && /[\u4e00-\u9fff]/.test(expr)) {
        nodes.push(token);
        last = match.index + token.length;
        continue;
      }
      nodes.push(
        <span
          key={`${keyPrefix}-math-${index++}`}
          className={display ? 'math-block-inline' : 'math-inline'}
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(expr, {
              displayMode: display,
              throwOnError: false,
              strict: 'ignore'
            })
          }}
        />
      );
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b-${index++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-c-${index++}`}>{token.slice(1, -1)}</code>);
    } else {
      const cite = /^\[(\d{1,2})\]$/.exec(token);
      const reference = cite ? options.citations?.[Number(cite[1]) - 1] : undefined;
      if (cite && reference) {
        const marker = cite[1];
        nodes.push(
          <sup key={`${keyPrefix}-cite-${index++}`}>
            <button
              type="button"
              className="cite-ref"
              title={`${reference.title || reference.url}${
                reference.site ? ` · ${reference.site}` : ''
              }`}
              onClick={() => {
                const id = `cite-${options.citePrefix || 'default'}-${marker}`;
                const target = document.getElementById(id);
                if (target) {
                  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                  target.classList.add('is-flash');
                  window.setTimeout(() => target.classList.remove('is-flash'), 1200);
                  return;
                }
                void window.bsub.openExternal(reference.url);
              }}
            >
              {marker}
            </button>
          </sup>
        );
      } else {
        const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(token);
        if (link) {
        nodes.push(
          <a
            key={`${keyPrefix}-a-${index++}`}
            href={link[2]}
            onClick={(event) => {
              event.preventDefault();
              void window.bsub.newTab(link[2]);
            }}
          >
            {link[1]}
          </a>
        );
        } else {
          nodes.push(token);
        }
      }
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitTableRow(line: string): string[] {
  const text = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return text.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function Markdown({
  content,
  citations,
  citePrefix
}: {
  content: string;
  citations?: WebReference[];
  citePrefix?: string;
}) {
  const renderInline = (text: string, keyPrefix: string) =>
    inline(text, keyPrefix, { citations, citePrefix });
  // 模型偶尔输出 <br> 或单独的 CR；先归一化，避免整段渲染成一行。
  const lines = content
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .split('\n');
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  let key = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, index) => (
      <li key={`li-${key}-${index}`}>{renderInline(item, `li-${key}-${index}`)}</li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={`list-${key++}`}>{items}</ol>
      ) : (
        <ul key={`list-${key++}`}>{items}</ul>
      )
    );
    list = null;
  };

  const flushCode = () => {
    if (!code) return;
    blocks.push(
      <pre key={`code-${key++}`}>
        <code>{code.join('\n')}</code>
      </pre>
    );
    code = null;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trimEnd();

    if (line.trim().startsWith('```')) {
      if (code) flushCode();
      else {
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(rawLine);
      continue;
    }
    if (!line.trim()) {
      flushList();
      continue;
    }

    if (line.trim().startsWith('$$')) {
      flushList();
      let expr = line.trim().slice(2);
      if (expr.endsWith('$$')) {
        expr = expr.slice(0, -2);
      } else {
        let cursor = lineIndex + 1;
        const parts = [expr];
        while (cursor < lines.length) {
          const current = lines[cursor].trim();
          if (current.endsWith('$$')) {
            parts.push(current.slice(0, -2));
            lineIndex = cursor;
            break;
          }
          parts.push(lines[cursor]);
          cursor += 1;
        }
        expr = parts.join('\n');
      }
      blocks.push(
        <div
          className="math-block"
          key={`math-${key++}`}
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(expr, {
              displayMode: true,
              throwOnError: false,
              strict: 'ignore'
            })
          }}
        />
      );
      continue;
    }

    if (line.includes('|') && isTableSeparator(lines[lineIndex + 1] || '')) {
      flushList();
      const header = splitTableRow(line);
      const rows: string[][] = [];
      let cursor = lineIndex + 2;
      while (cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim()) {
        rows.push(splitTableRow(lines[cursor]));
        cursor += 1;
      }
      blocks.push(
        <div className="md-table-wrap" key={`table-${key++}`}>
          <table>
            <thead>
              <tr>
                {header.map((cell, index) => (
                  <th key={`th-${index}`}>{renderInline(cell, `th-${key}-${index}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`tr-${rowIndex}`}>
                  {header.map((_, cellIndex) => (
                    <td key={`td-${rowIndex}-${cellIndex}`}>
                      {renderInline(row[cellIndex] || '', `td-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      lineIndex = cursor - 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushList();
      const body = renderInline(heading[2], `h-${key}`);
      const level = Math.min(6, heading[1].length);
      const tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(React.createElement(tag, { key: `h-${key++}` }, body));
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushList();
      blocks.push(<blockquote key={`quote-${key++}`}>{renderInline(quote[1], `q-${key}`)}</blockquote>);
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushList();
      blocks.push(<hr key={`hr-${key++}`} />);
      continue;
    }

    flushList();
    blocks.push(<p key={`p-${key++}`}>{renderInline(line, `p-${key}`)}</p>);
  }

  flushList();
  flushCode();

  return <div className="markdown">{blocks}</div>;
}