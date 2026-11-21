import { Pencil, X } from 'lucide-react';
import { moveQueueItem } from '../../../shared/chatContext';
import type { ChatAttachment, ChatMessage } from '../../../shared/types';

export interface QueueItem {
  text: string;
  images: string[];
  attachments: ChatAttachment[];
  quote: ChatMessage | null;
}

interface Props {
  queue: QueueItem[];
  paused: boolean;
  onPaused: (value: boolean) => void;
  onEdit: (item: QueueItem) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onReorder: (next: QueueItem[]) => void;
}

/** 输入区排队消息：拖拽排序、编辑、移出、暂停/清空。 */
export function ChatComposerQueue({
  queue,
  paused,
  onPaused,
  onEdit,
  onRemove,
  onClear,
  onReorder
}: Props) {
  let dragFrom: number | null = null;
  const reorder = (to: number) => {
    if (dragFrom === null) return;
    onReorder(moveQueueItem(queue, dragFrom, to));
    dragFrom = null;
  };
  return (
    <div className="chat-queue">
      <span className="chat-queue-label">排队 {queue.length}</span>
      {queue.map((item, index) => (
        <span
          key={`${index}-${item.text.slice(0, 8)}`}
          className="chat-queue-chip"
          title={item.text || '附件'}
          draggable
          onDragStart={() => {
            dragFrom = index;
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            reorder(index);
          }}
          onDragEnd={() => {
            dragFrom = null;
          }}
        >
          {item.text.replace(/\s+/g, ' ').slice(0, 22) || '附件'}
          <button title="编辑这条排队消息" onClick={() => onEdit(item)}>
            <Pencil size={9} />
          </button>
          <button title="移出队列" onClick={() => onRemove(index)}>
            <X size={9} />
          </button>
        </span>
      ))}
      <button className="mini-btn" onClick={() => onPaused(!paused)}>
        {paused ? '继续' : '暂停'}
      </button>
      <button className="mini-btn" onClick={onClear}>
        清空
      </button>
    </div>
  );
}
