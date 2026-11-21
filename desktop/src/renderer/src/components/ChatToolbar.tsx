import { History, List, Plus, Search, Square, Star } from 'lucide-react';

interface Props {
  activeTab: boolean;
  isVideoPage: boolean;
  streaming: boolean;
  hasMessages: boolean;
  hasUserMessages: boolean;
  onSummarize: () => void;
  onSaveAnswer: () => void;
  onSearch: () => void;
  onOutline: () => void;
  onCrossSearch: () => void;
  onFavorites: () => void;
  onHistory: () => void;
  onClear: () => void;
  onStop: () => void;
}

/** 对话顶部工具栏：总结/入库/搜索/大纲/跨对话/收藏/历史/新对话/停止。 */
export function ChatToolbar({
  activeTab,
  isVideoPage,
  streaming,
  hasMessages,
  hasUserMessages,
  onSummarize,
  onSaveAnswer,
  onSearch,
  onOutline,
  onCrossSearch,
  onFavorites,
  onHistory,
  onClear,
  onStop
}: Props) {
  return (
    <div className="panel-toolbar">
      <div className="panel-title">对话</div>
      <div className="toolbar-actions">
        {activeTab && !isVideoPage && (
          <button
            className="mini-btn"
            disabled={streaming}
            title="总结当前网页，并把结果存入本地库"
            onClick={onSummarize}
          >
            总结本页
          </button>
        )}
        {activeTab && !isVideoPage && hasMessages && (
          <button
            className="mini-btn"
            disabled={streaming}
            title="把最近一条回答存为这个网页的总结"
            onClick={onSaveAnswer}
          >
            存入库
          </button>
        )}
        <button
          className="mini-btn"
          disabled={!hasMessages}
          onClick={onSearch}
          title="在当前对话内搜索"
        >
          <Search size={12} /> 搜索
        </button>
        <button
          className="mini-btn"
          disabled={!hasUserMessages}
          onClick={onOutline}
          title="按提问列出对话大纲"
        >
          <List size={12} /> 大纲
        </button>
        <button
          className="mini-btn"
          onClick={onCrossSearch}
          title="在所有历史对话里搜索消息"
        >
          <Search size={12} /> 跨对话
        </button>
        <button className="mini-btn" onClick={onFavorites} title="收藏的消息">
          <Star size={12} /> 收藏
        </button>
        <button
          className="mini-btn"
          disabled={streaming}
          onClick={onHistory}
          title="历史对话"
        >
          <History size={12} /> 历史
        </button>
        <button
          className="mini-btn"
          disabled={(!hasMessages && !streaming) || streaming}
          onClick={onClear}
          title="开始新对话（旧对话保留在历史里）"
        >
          <Plus size={12} /> 新对话
        </button>
        {streaming && (
          <button className="mini-btn" onClick={onStop} title="停止回答">
            <Square size={11} /> 停止
          </button>
        )}
      </div>
    </div>
  );
}
