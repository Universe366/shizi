import { Download, Pencil, Trash2 } from 'lucide-react';
import type { AiPlatform, AssistantProfile, ChatConversation } from '../../../shared/types';

interface Props {
  conversations: ChatConversation[];
  conversationId: number | null;
  historyQuery: string;
  editingConversationId: number | null;
  editingTitle: string;
  profiles: AssistantProfile[];
  platforms: AiPlatform[];
  onHistoryQuery: (value: string) => void;
  onRefresh: () => void;
  onOpen: (conversation: ChatConversation) => void;
  onStartRename: (conversation: ChatConversation) => void;
  onEditingTitle: (value: string) => void;
  onSaveTitle: () => void;
  onCancelRename: () => void;
  onExport: (id: number) => void;
  onRemove: (id: number) => void;
}

/** 历史对话面板：搜索、重命名、导出 Markdown、删除。 */
export function ChatHistoryPanel({
  conversations,
  conversationId,
  historyQuery,
  editingConversationId,
  editingTitle,
  profiles,
  platforms,
  onHistoryQuery,
  onRefresh,
  onOpen,
  onStartRename,
  onEditingTitle,
  onSaveTitle,
  onCancelRename,
  onExport,
  onRemove
}: Props) {
  const keyword = historyQuery.trim().toLowerCase();
  const visible = conversations.filter((conversation) => {
    if (!keyword) return true;
    return `${conversation.title} ${conversation.videoTitle}`
      .toLowerCase()
      .includes(keyword);
  });

  return (
    <div className="chat-history-panel">
      <div className="chat-history-head">
        <span>历史对话（{conversations.length}）</span>
        <button className="mini-btn" onClick={onRefresh}>
          刷新
        </button>
      </div>
      <input
        className="settings-input chat-history-search"
        placeholder="搜索标题 / 视频"
        value={historyQuery}
        spellCheck={false}
        onChange={(event) => onHistoryQuery(event.target.value)}
      />
      {!conversations.length && (
        <div className="settings-hint">还没有历史对话，发第一句话就会保存。</div>
      )}
      {visible.map((conversation) => (
        <div
          key={conversation.id}
          className={`chat-history-row${conversationId === conversation.id ? ' is-active' : ''}`}
        >
          {editingConversationId === conversation.id ? (
            <input
              className="settings-input chat-history-rename"
              autoFocus
              value={editingTitle}
              onChange={(event) => onEditingTitle(event.target.value)}
              onBlur={onSaveTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSaveTitle();
                if (event.key === 'Escape') onCancelRename();
              }}
            />
          ) : (
            <button className="chat-history-main" onClick={() => onOpen(conversation)}>
              <span className="chat-history-title">{conversation.title}</span>
              <span className="chat-history-meta">
                {[
                  conversation.videoTitle,
                  profiles.find((profile) => profile.id === conversation.profileId)?.name,
                  conversation.model
                    ? `${
                        platforms.find((platform) => platform.id === conversation.platformId)
                          ?.name || conversation.platformId
                      } / ${conversation.model}`
                    : '',
                  `${conversation.messageCount} 条`,
                  new Date(conversation.updatedAt).toLocaleString('zh-CN')
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          )}
          <button className="chat-action" title="重命名" onClick={() => onStartRename(conversation)}>
            <Pencil size={11} />
          </button>
          <button className="chat-action" title="导出 Markdown" onClick={() => onExport(conversation.id)}>
            <Download size={11} />
          </button>
          <button className="chat-action" title="删除对话" onClick={() => onRemove(conversation.id)}>
            <Trash2 size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
