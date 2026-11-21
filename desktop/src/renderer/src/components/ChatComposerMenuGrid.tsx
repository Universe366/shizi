import { AtSign, Eraser, FileText, ImagePlus, Plus, Quote, Sparkles, Wrench } from 'lucide-react';

interface Props {
  toolSelection: string[] | null;
  visionEnabled: boolean;
  hasMessages: boolean;
  onToolPanel: (mode: 'tools' | 'prompts' | 'resources') => void;
  onMention: () => void;
  onSlash: () => void;
  onClearContext: () => void;
  onSummary: () => void;
  onCompare: () => void;
  onImage: () => void;
  onFile: () => void;
  onClear: () => void;
}

/** 输入框“更多工具”卡片网格。 */
export function ChatComposerMenuGrid({
  toolSelection,
  visionEnabled,
  hasMessages,
  onToolPanel,
  onMention,
  onSlash,
  onClearContext,
  onSummary,
  onCompare,
  onImage,
  onFile,
  onClear
}: Props) {
  return (
    <div className="chat-menu-grid">
      <button className="chat-menu-card" onClick={() => onToolPanel('tools')}>
        <Wrench size={15} />
        <span className="chat-menu-card-title">MCP 工具</span>
        <span className="chat-menu-card-desc">
          {toolSelection === null ? '全部可用工具' : `已选 ${toolSelection.length} 个`}
        </span>
      </button>
      <button className="chat-menu-card" onClick={() => onToolPanel('prompts')}>
        <Quote size={15} />
        <span className="chat-menu-card-title">MCP 提示词</span>
        <span className="chat-menu-card-desc">插入服务预设的提示词</span>
      </button>
      <button className="chat-menu-card" onClick={() => onToolPanel('resources')}>
        <FileText size={15} />
        <span className="chat-menu-card-title">MCP 资源</span>
        <span className="chat-menu-card-desc">读取内容并放进输入框</span>
      </button>
      <button className="chat-menu-card" onClick={onMention}>
        <AtSign size={15} />
        <span className="chat-menu-card-title">引用历史对话</span>
        <span className="chat-menu-card-desc">输入 @ 也可打开</span>
      </button>
      <button className="chat-menu-card" onClick={onSlash}>
        <Sparkles size={15} />
        <span className="chat-menu-card-title">快捷指令</span>
        <span className="chat-menu-card-desc">输入 / 也可打开</span>
      </button>
      <button className="chat-menu-card" disabled={!hasMessages} onClick={onClearContext}>
        <Eraser size={15} />
        <span className="chat-menu-card-title">清除上下文</span>
        <span className="chat-menu-card-desc">保留消息，只把之后的内容发给模型</span>
      </button>
      <button className="chat-menu-card" onClick={onSummary}>
        <FileText size={15} />
        <span className="chat-menu-card-title">上下文摘要</span>
        <span className="chat-menu-card-desc">查看自动压缩生成的摘要</span>
      </button>
      <button className="chat-menu-card" onClick={onCompare}>
        <Sparkles size={15} />
        <span className="chat-menu-card-title">多模型对比</span>
        <span className="chat-menu-card-desc">两个以上平台并排回答</span>
      </button>
      <button
        className="chat-menu-card"
        disabled={!visionEnabled}
        title={visionEnabled ? '添加图片' : '当前模型未开启图片能力，可在设置里勾选'}
        onClick={onImage}
      >
        <ImagePlus size={15} />
        <span className="chat-menu-card-title">添加图片</span>
        <span className="chat-menu-card-desc">
          {visionEnabled ? '也可直接粘贴或拖入' : '当前模型未开启图片能力'}
        </span>
      </button>
      <button className="chat-menu-card" onClick={onFile}>
        <FileText size={15} />
        <span className="chat-menu-card-title">文本附件</span>
        <span className="chat-menu-card-desc">txt / md / srt，最多 3 个</span>
      </button>
      <button className="chat-menu-card" onClick={onClear}>
        <Plus size={15} />
        <span className="chat-menu-card-title">新对话</span>
        <span className="chat-menu-card-desc">旧对话保留在历史里</span>
      </button>
    </div>
  );
}
