import { Fragment } from 'react';
import { FileText, GitBranch, Pencil, Quote } from 'lucide-react';
import type { ChatMessage } from '../../../shared/types';
import { ChatMessageBody } from './ChatMessageBody';
import { ChatMessageActions } from './ChatMessageActions';
import { ChatRequestDetails } from './ChatRequestDetails';

interface Props {
  messages: ChatMessage[];
  contextStart: number | null;
  highlightIndex: number | null;
  detailsIndex: number | null;
  expandReasoning: boolean;
  onDetails: (index: number) => void;
  onFavorite: (index: number) => void;
  onSpeak: (text: string) => void;
  onCopy: (text: string) => void;
  onQuote: (message: ChatMessage) => void;
  onBranch: (index: number) => void;
  onRegenerate: () => void;
  onEdit: (index: number) => void;
}

/** 对话消息列表：上下文分隔、用户/助手消息、请求详情与操作栏。 */
export function ChatMessageList({
  messages,
  contextStart,
  highlightIndex,
  detailsIndex,
  expandReasoning,
  onDetails,
  onFavorite,
  onSpeak,
  onCopy,
  onQuote,
  onBranch,
  onRegenerate,
  onEdit
}: Props) {
  return (
    <>
      {messages.map((message, index) => (
        <Fragment key={`${message.role}-${index}-${message.content.slice(0, 16)}`}>
          {contextStart === index && (
            <div className="chat-context-divider">
              上下文从这里开始，之前的消息不再发送
            </div>
          )}
          <div
            className={`chat-msg ${message.role}${
              highlightIndex === index ? ' is-search-hit' : ''
            }`}
            data-chat-index={index}
          >
            {message.role === 'assistant' && <div className="chat-avatar">AI</div>}
            <div className="chat-bubble">
              {message.role === 'assistant' ? (
                <>
                  <ChatMessageBody
                    message={message}
                    index={index}
                    expandReasoning={expandReasoning}
                  />
                  {detailsIndex === index && <ChatRequestDetails message={message} />}
                  <ChatMessageActions
                    message={message}
                    isLast={index === messages.length - 1}
                    detailsOpen={detailsIndex === index}
                    onToggleDetails={() => onDetails(index)}
                    onFavorite={() => onFavorite(index)}
                    onSpeak={() => onSpeak(message.content)}
                    onCopy={() => onCopy(message.content)}
                    onQuote={() => onQuote(message)}
                    onBranch={() => onBranch(index)}
                    onRegenerate={onRegenerate}
                  />
                </>
              ) : (
                <>
                  {message.images?.length ? (
                    <div className="chat-images">
                      {message.images.map((src, imageIndex) => (
                        <img
                          key={`${imageIndex}-${src.slice(-12)}`}
                          className="chat-image"
                          src={src}
                          alt=""
                        />
                      ))}
                    </div>
                  ) : null}
                  {message.attachments?.length ? (
                    <div className="chat-attachments">
                      {message.attachments.map((attachment) => (
                        <span
                          key={`${attachment.name}-${attachment.chars}`}
                          className="chat-attachment-chip"
                          title={attachment.name}
                        >
                          <FileText size={10} /> {attachment.name}
                          <span>{attachment.chars.toLocaleString('zh-CN')} 字</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div>{message.content}</div>
                  <div className="chat-msg-actions">
                    <button
                      className="chat-action"
                      title="引用这条消息"
                      onClick={() => onQuote(message)}
                    >
                      <Quote size={11} />
                    </button>
                    <button
                      className="chat-action"
                      title="从这条消息新建分支"
                      onClick={() => onBranch(index)}
                    >
                      <GitBranch size={11} />
                    </button>
                    <button
                      className="chat-action"
                      title="编辑这条消息并重发"
                      onClick={() => onEdit(index)}
                    >
                      <Pencil size={11} />
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Fragment>
      ))}
    </>
  );
}
