import { Loader2, Mic, Send, Square } from 'lucide-react';
import { formatTokens } from '../lib/usageStats';

interface Props {
  budgetTokens: number;
  usedBudgetTokens: number;
  budgetExceeded: boolean;
  tokenEstimate: number;
  voiceState: 'idle' | 'recording' | 'transcribing';
  activeTab: boolean;
  streaming: boolean;
  canSend: boolean;
  onVoice: () => void;
  onSend: () => void;
}

/** 输入区右侧：预算、token 估算、语音、发送。 */
export function ChatComposerRight({
  budgetTokens,
  usedBudgetTokens,
  budgetExceeded,
  tokenEstimate,
  voiceState,
  activeTab,
  streaming,
  canSend,
  onVoice,
  onSend
}: Props) {
  return (
    <div className="chat-bar-right">
      {budgetTokens > 0 && (
        <span
          className={`chat-budget${budgetExceeded ? ' is-over' : ''}`}
          title="当前对话已记录的实际输入/输出 token 与预算"
        >
          预算 {formatTokens(usedBudgetTokens)}/{formatTokens(budgetTokens)}
        </span>
      )}
      <span className="chat-token-hint" title="输入 + 对话历史 + 页面正文的粗略估算">
        ≈ {tokenEstimate.toLocaleString('zh-CN')}
      </span>
      <button
        className={`icon-btn${voiceState === 'recording' ? ' is-recording' : ''}`}
        title={
          voiceState === 'recording'
            ? '停止录音并识别'
            : voiceState === 'transcribing'
              ? '正在识别…'
              : '语音输入'
        }
        disabled={!activeTab || streaming || voiceState === 'transcribing'}
        onClick={onVoice}
      >
        {voiceState === 'transcribing' ? (
          <Loader2 size={14} className="spin" />
        ) : voiceState === 'recording' ? (
          <Square size={14} />
        ) : (
          <Mic size={14} />
        )}
      </button>
      <button className="chat-send" disabled={!activeTab || !canSend} onClick={onSend} title="发送">
        <Send size={12} /> 发送
      </button>
    </div>
  );
}
