import type {
  ChatCompressionSummary,
  ChatMessage,
  ChatMessageSearchHit,
  FavoriteChatMessage
} from '../../../shared/types';

interface Props {
  messages: ChatMessage[];
  messageSearchOpen: boolean;
  messageSearchQuery: string;
  onMessageSearchQuery: (value: string) => void;
  onCloseMessageSearch: () => void;
  outlineOpen: boolean;
  onCloseOutline: () => void;
  crossSearchOpen: boolean;
  crossQuery: string;
  crossLoading: boolean;
  crossHits: ChatMessageSearchHit[];
  onCrossQuery: (value: string) => void;
  onCrossSearch: () => void;
  onCloseCross: () => void;
  favoritesOpen: boolean;
  favorites: FavoriteChatMessage[];
  onRefreshFavorites: () => void;
  onCloseFavorites: () => void;
  summaryOpen: boolean;
  compressionSummary: ChatCompressionSummary | null;
  onRefreshSummary: () => void;
  onCloseSummary: () => void;
  onClearSummary: () => void;
  onJump: (index: number) => void;
  onOpenConversation: (conversationId: number, messageId?: number) => void;
}

/** 对话内搜索、大纲、跨对话搜索、收藏、压缩摘要五个辅助面板。 */
export function ChatAuxPanels({
  messages,
  messageSearchOpen,
  messageSearchQuery,
  onMessageSearchQuery,
  onCloseMessageSearch,
  outlineOpen,
  onCloseOutline,
  crossSearchOpen,
  crossQuery,
  crossLoading,
  crossHits,
  onCrossQuery,
  onCrossSearch,
  onCloseCross,
  favoritesOpen,
  favorites,
  onRefreshFavorites,
  onCloseFavorites,
  summaryOpen,
  compressionSummary,
  onRefreshSummary,
  onCloseSummary,
  onClearSummary,
  onJump,
  onOpenConversation
}: Props) {
  const searchQuery = messageSearchQuery.trim().toLowerCase();
  const searchResults = searchQuery
    ? messages
        .map((message, index) => ({ message, index }))
        .filter(({ message }) =>
          `${message.role === 'assistant' ? 'AI' : '用户'} ${message.content}`
            .toLowerCase()
            .includes(searchQuery)
        )
        .slice(0, 60)
    : [];

  return (
    <>
      {messageSearchOpen && (
        <div className="chat-history-panel chat-search-panel">
          <div className="chat-history-head">
            <span>对话内搜索</span>
            <button className="mini-btn" onClick={onCloseMessageSearch}>
              关闭
            </button>
          </div>
          <input
            autoFocus
            className="settings-input chat-history-search"
            placeholder="搜索当前对话…"
            value={messageSearchQuery}
            spellCheck={false}
            onChange={(event) => onMessageSearchQuery(event.target.value)}
          />
          {searchQuery && !searchResults.length && (
            <div className="settings-hint">没有匹配的消息</div>
          )}
          {searchResults.map(({ message, index }) => {
            const raw = message.content.replace(/\s+/g, ' ');
            const position = raw.toLowerCase().indexOf(searchQuery);
            const start = Math.max(0, position - 30);
            const snippet = `${start > 0 ? '…' : ''}${raw.slice(start, start + 120)}${
              raw.length > start + 120 ? '…' : ''
            }`;
            return (
              <button key={index} className="chat-search-result" onClick={() => onJump(index)}>
                <span className="chat-search-role">
                  {message.role === 'assistant' ? 'AI' : '用户'}
                </span>
                <span className="chat-search-snippet">{snippet}</span>
              </button>
            );
          })}
        </div>
      )}

      {outlineOpen && (
        <div className="chat-history-panel chat-outline-panel">
          <div className="chat-history-head">
            <span>对话大纲</span>
            <button className="mini-btn" onClick={onCloseOutline}>
              关闭
            </button>
          </div>
          {messages.map((message, index) => {
            if (message.role !== 'user') return null;
            const answer = messages
              .slice(index + 1)
              .find((item) => item.role === 'assistant' && item.content.trim());
            const answerLine = answer
              ? answer.content
                  .replace(/[#>*`-]/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 100)
              : '';
            return (
              <button
                key={index}
                className="chat-search-result chat-outline-item"
                onClick={() => onJump(index)}
              >
                <span className="chat-search-role">
                  {messages.slice(0, index + 1).filter((item) => item.role === 'user').length}
                </span>
                <span className="chat-search-snippet">
                  <span>{message.content.replace(/\s+/g, ' ').slice(0, 120) || '附件提问'}</span>
                  {answerLine && <span className="chat-outline-answer">{answerLine}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {crossSearchOpen && (
        <div className="chat-history-panel chat-cross-panel">
          <div className="chat-history-head">
            <span>跨对话搜索</span>
            <button
              className="mini-btn"
              disabled={!crossQuery.trim() || crossLoading}
              onClick={onCrossSearch}
            >
              搜索
            </button>
            <button className="mini-btn" onClick={onCloseCross}>
              关闭
            </button>
          </div>
          <input
            autoFocus
            className="settings-input chat-history-search"
            placeholder="在所有历史对话里搜索消息…"
            value={crossQuery}
            spellCheck={false}
            onChange={(event) => onCrossQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              onCrossSearch();
            }}
          />
          {crossLoading && <div className="settings-hint">正在搜索…</div>}
          {!crossLoading && crossQuery.trim() && !crossHits.length && (
            <div className="settings-hint">没有匹配的消息</div>
          )}
          {crossHits.map((hit) => (
            <button
              key={`${hit.conversationId}-${hit.messageId}`}
              className="chat-search-result"
              onClick={() => onOpenConversation(hit.conversationId, hit.messageId)}
            >
              <span className="chat-search-role">
                {hit.role === 'assistant' ? 'AI' : '用户'}
              </span>
              <span className="chat-search-snippet">
                {hit.conversationTitle} · {hit.content.replace(/\s+/g, ' ').slice(0, 100)}
              </span>
            </button>
          ))}
        </div>
      )}

      {favoritesOpen && (
        <div className="chat-history-panel chat-favorites-panel">
          <div className="chat-history-head">
            <span>收藏消息（{favorites.length}）</span>
            <button className="mini-btn" onClick={onRefreshFavorites}>
              刷新
            </button>
            <button className="mini-btn" onClick={onCloseFavorites}>
              关闭
            </button>
          </div>
          {!favorites.length && (
            <div className="settings-hint">还没有收藏：在回答下方点星标即可收藏。</div>
          )}
          {favorites.map((favorite) => (
            <button
              key={favorite.id}
              className="chat-search-result"
              onClick={() => onOpenConversation(favorite.conversationId, favorite.id)}
            >
              <span className="chat-search-role">
                {favorite.role === 'assistant' ? 'AI' : '用户'}
              </span>
              <span className="chat-search-snippet">
                {favorite.conversationTitle} ·{' '}
                {favorite.content.replace(/\s+/g, ' ').slice(0, 100)}
              </span>
            </button>
          ))}
        </div>
      )}

      {summaryOpen && (
        <div className="chat-history-panel chat-summary-panel">
          <div className="chat-history-head">
            <span>上下文压缩摘要</span>
            <button className="mini-btn" onClick={onRefreshSummary}>
              刷新
            </button>
            <button className="mini-btn" onClick={onCloseSummary}>
              关闭
            </button>
          </div>
          {compressionSummary ? (
            <>
              <div className="settings-hint">
                已压缩 {compressionSummary.covered} 条旧消息；之后的请求会带上这段摘要。
              </div>
              <pre className="chat-summary-text">{compressionSummary.summary}</pre>
              <button className="mini-btn" onClick={onClearSummary}>
                清除摘要
              </button>
            </>
          ) : (
            <div className="settings-hint">
              当前没有压缩摘要：对话未超过阈值，或摘要已被清除。
            </div>
          )}
        </div>
      )}
    </>
  );
}
