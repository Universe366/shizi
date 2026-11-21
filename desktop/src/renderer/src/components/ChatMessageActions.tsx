import {
  Copy,
  GitBranch,
  Info,
  Quote,
  RotateCcw,
  Star,
  Volume2
} from 'lucide-react';
import type { ChatMessage } from '../../../shared/types';

interface Props {
  message: ChatMessage;
  isLast: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onFavorite: () => void;
  onSpeak: () => void;
  onCopy: () => void;
  onQuote: () => void;
  onBranch: () => void;
  onRegenerate: () => void;
}

/** 助手回答的操作栏，独立于消息正文渲染。 */
export function ChatMessageActions({
  message,
  isLast,
  detailsOpen,
  onToggleDetails,
  onFavorite,
  onSpeak,
  onCopy,
  onQuote,
  onBranch,
  onRegenerate
}: Props) {
  return (
    <div className="chat-msg-actions">
      <button
        className={`chat-action${detailsOpen ? ' is-active' : ''}`}
        title="请求详情"
        onClick={onToggleDetails}
      >
        <Info size={11} />
      </button>
      {message.id && (
        <button
          className="chat-action"
          title={message.favorite ? '取消收藏' : '收藏这条回答'}
          onClick={onFavorite}
        >
          <Star size={11} fill={message.favorite ? 'currentColor' : 'none'} />
        </button>
      )}
      <button className="chat-action" title="朗读回答" onClick={onSpeak}>
        <Volume2 size={11} />
      </button>
      <button className="chat-action" title="复制回答" onClick={onCopy}>
        <Copy size={11} />
      </button>
      <button className="chat-action" title="引用这条回答" onClick={onQuote}>
        <Quote size={11} />
      </button>
      <button className="chat-action" title="从此回答新建分支" onClick={onBranch}>
        <GitBranch size={11} />
      </button>
      {isLast && (
        <button className="chat-action" title="重新生成" onClick={onRegenerate}>
          <RotateCcw size={11} />
        </button>
      )}
    </div>
  );
}
