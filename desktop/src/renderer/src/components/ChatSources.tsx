import { useState } from 'react';
import { ArrowUpRight, ChevronDown, Globe } from 'lucide-react';
import type { WebReference } from '../../../shared/types';

interface ChatSourcesProps {
  sources: WebReference[];
  engine?: string;
  /** 对应消息下标，用于和正文里的 [n] 互相跳转。 */
  messageIndex: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function initialOf(value: string): string {
  const first = Array.from(String(value || '').trim())[0];
  return first ? first.toUpperCase() : '链';
}

/** 对话底部的参考资料：编号、站点、标题、摘要，和正文 [n] 一一对应。 */
export function ChatSources({ sources, engine, messageIndex }: ChatSourcesProps) {
  const [open, setOpen] = useState(sources.length <= 5);
  if (!sources.length) return null;

  return (
    <div className={`chat-sources-block${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="chat-sources-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Globe size={13} />
        <span className="chat-sources-name">参考资料</span>
        <span className="chat-sources-count">{sources.length}</span>
        {engine && (
          <span className="chat-sources-engine" title={engine}>
            {engine}
          </span>
        )}
        <ChevronDown size={13} className="chat-sources-chevron" />
      </button>

      {open && (
        <div className="chat-source-list">
          {sources.map((reference, index) => {
            const host = reference.site || hostOf(reference.url);
            const title = reference.title || reference.url;
            const date = reference.date ? String(reference.date).slice(0, 10) : '';
            return (
              <button
                key={`${index}-${reference.url}`}
                type="button"
                id={`cite-m${messageIndex}-${index + 1}`}
                className="chat-source"
                title={reference.url}
                onClick={() => void window.bsub.openExternal(reference.url)}
              >
                <span className="chat-source-index">{index + 1}</span>
                <span className="chat-source-favicon" aria-hidden>
                  {initialOf(host || title)}
                </span>
                <span className="chat-source-main">
                  <span className="chat-source-title">{title}</span>
                  <span className="chat-source-meta">
                    {host || '网页'}
                    {date ? ` · ${date}` : ''}
                  </span>
                  {reference.snippet && (
                    <span className="chat-source-snippet">{reference.snippet}</span>
                  )}
                </span>
                <ArrowUpRight size={13} className="chat-source-arrow" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
