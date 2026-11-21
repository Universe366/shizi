import { FileText, Quote, X } from 'lucide-react';
import type { ChatAttachment, ChatMessage } from '../../../shared/types';

interface Props {
  quote: ChatMessage | null;
  attachments: ChatAttachment[];
  onClearQuote: () => void;
  onRemoveAttachment: (index: number) => void;
}

/** 输入区引用与文本附件预览。 */
export function ChatComposerAttachments({
  quote,
  attachments,
  onClearQuote,
  onRemoveAttachment
}: Props) {
  if (!quote && !attachments.length) return null;
  return (
    <div className="chat-attach-row">
      {quote && (
        <span className="chat-quote-chip" title={quote.content.slice(0, 500)}>
          <Quote size={10} />
          引用：{quote.content.replace(/\s+/g, ' ').slice(0, 48)}
          <button title="取消引用" onClick={onClearQuote}>
            <X size={9} />
          </button>
        </span>
      )}
      {attachments.map((attachment, index) => (
        <span key={`${attachment.name}-${index}`} className="chat-attachment-chip">
          <FileText size={10} /> {attachment.name}
          <span>{attachment.chars.toLocaleString('zh-CN')} 字</span>
          <button title="移除附件" onClick={() => onRemoveAttachment(index)}>
            <X size={9} />
          </button>
        </span>
      ))}
    </div>
  );
}
