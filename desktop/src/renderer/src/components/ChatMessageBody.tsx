import { useState } from 'react';
import type { ChatMessage } from '../../../shared/types';
import { formatTokens } from '../lib/usageStats';
import { Markdown } from './Markdown';
import { ChatSources } from './ChatSources';

function safeSources(sources: ChatMessage['sources']) {
  return (sources || []).filter(
    (item) => item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url)
  );
}

function ReasoningBlock({ text, defaultOpen }: { text: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="chat-reasoning"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>💭 思考过程</summary>
      <pre>{text}</pre>
    </details>
  );
}

interface Props {
  message: ChatMessage;
  index: number;
  expandReasoning: boolean;
}

/** 助手消息正文：推理、对比、Markdown、来源、工具与用量。 */
export function ChatMessageBody({ message, index, expandReasoning }: Props) {
  return (
    <>
      {message.reasoning && (
        <ReasoningBlock text={message.reasoning} defaultOpen={expandReasoning} />
      )}
      {message.compare?.length ? (
        <div className="chat-compare-inline">
          {message.compare.map((result) => (
            <div
              key={`${result.platformId}:${result.model}`}
              className="chat-compare-inline-col"
            >
              <div className="chat-compare-inline-title">
                {result.platformName}
                <span>{result.model}</span>
              </div>
              {result.error ? (
                <div className="compare-error">{result.error}</div>
              ) : (
                <Markdown content={result.text} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <Markdown
          content={message.content}
          citations={safeSources(message.sources)}
          citePrefix={`m${index}`}
        />
      )}
      <ChatSources
        sources={safeSources(message.sources)}
        engine={message.webEngine}
        messageIndex={index}
      />
      {typeof message.webNotice === 'string' && message.webNotice && (
        <div className="chat-web-notice" title={message.webNotice}>
          {message.webNotice}
        </div>
      )}
      {message.tools?.length ? (
        <details className="chat-tool-history">
          <summary>工具调用 {message.tools.length} 次</summary>
          <div className="chat-tool-cards">
            {message.tools.map((tool, toolIndex) => (
              <div
                key={`${tool.name}-${toolIndex}`}
                className={`chat-tool-card${tool.ok ? '' : ' is-error'}`}
              >
                <div className="chat-tool-head">
                  <span className="chat-tool-name">{tool.name}</span>
                  <span className="chat-tool-state">{tool.ok ? '完成' : '失败'}</span>
                </div>
                {tool.detail && <div className="chat-tool-detail">{tool.detail}</div>}
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {message.usage && (
        <div
          className="chat-usage"
          title={`输入 ${message.usage.inputTokens.toLocaleString('zh-CN')} · 输出 ${message.usage.outputTokens.toLocaleString('zh-CN')}${
            message.usage.cacheReadTokens
              ? ` · 缓存命中 ${message.usage.cacheReadTokens.toLocaleString('zh-CN')}`
              : ''
          }`}
        >
          输入 {formatTokens(message.usage.inputTokens)} · 输出{' '}
          {formatTokens(message.usage.outputTokens)}
        </div>
      )}
    </>
  );
}
