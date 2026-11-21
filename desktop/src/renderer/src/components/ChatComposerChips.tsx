import { Brain, Captions, Eraser, FileText, Globe } from 'lucide-react';
import { chatWebModeHint, chatWebModeLabel } from '../../../shared/chatModes';

interface Props {
  includePage: boolean;
  includeTranscript: boolean;
  searchEnabled: boolean;
  searchProviderName: string;
  webMode: string;
  deepThink: boolean;
  profileName?: string;
  contextCleared: boolean;
  onIncludePage: (value: boolean) => void;
  onIncludeTranscript: (value: boolean) => void;
  onNextWebMode: () => void;
  onDeepThink: (value: boolean) => void;
  onOpenProfile: () => void;
  onRestoreContext: () => void;
}

/** 输入区左侧的状态胶囊。 */
export function ChatComposerChips({
  includePage,
  includeTranscript,
  searchEnabled,
  searchProviderName,
  webMode,
  deepThink,
  profileName,
  contextCleared,
  onIncludePage,
  onIncludeTranscript,
  onNextWebMode,
  onDeepThink,
  onOpenProfile,
  onRestoreContext
}: Props) {
  return (
    <>
      <button
        className={`chat-chip${includePage ? ' is-on' : ''}`}
        title={includePage ? '本次会带上当前网页正文' : '不带当前网页正文'}
        onClick={() => onIncludePage(!includePage)}
      >
        <FileText size={12} /> 页面
      </button>
      <button
        className={`chat-chip${includeTranscript ? ' is-on' : ''}`}
        title={
          includeTranscript
            ? '本次会带上当前视频字幕；关掉可只做联网问答'
            : '本次不带字幕，只按问题/联网回答'
        }
        onClick={() => onIncludeTranscript(!includeTranscript)}
      >
        <Captions size={12} /> 字幕
      </button>
      <button
        className={`chat-chip${webMode !== 'off' ? ' is-on' : ''}`}
        title={
          searchEnabled
            ? `搜索服务：${searchProviderName || '未选择'}；${chatWebModeHint(webMode as never)}`
            : '联网检索未启用，去设置开启'
        }
        disabled={!searchEnabled}
        onClick={onNextWebMode}
      >
        <Globe size={12} /> 联网 · {chatWebModeLabel(webMode as never)}
      </button>
      <button
        className={`chat-chip${deepThink ? ' is-on' : ''}`}
        title={
          deepThink
            ? '深度思考已开启：DeepSeek 平台使用推理模型'
            : '开启深度思考（DeepSeek 平台使用推理模型）'
        }
        onClick={() => onDeepThink(!deepThink)}
      >
        <Brain size={12} /> 深度思考
      </button>
      {profileName && (
        <button
          className="chat-chip is-on chat-chip-profile"
          title="当前助手档案，点击切换"
          onClick={onOpenProfile}
        >
          {profileName}
        </button>
      )}
      {contextCleared && (
        <button
          className="chat-chip is-on"
          title="之前的消息不再发送给模型，点击恢复"
          onClick={onRestoreContext}
        >
          <Eraser size={12} /> 上下文已清除 ↺
        </button>
      )}
    </>
  );
}
