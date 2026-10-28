import { Plus, Trash2 } from 'lucide-react';
import type { AppSettings, PromptTemplate } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

interface Props {
  value: AppSettings['ai'];
  onChange: (patch: Partial<AppSettings['ai']>) => void;
}

function newPrompt(): PromptTemplate {
  return {
    id: `chat-prompt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    name: '新指令',
    text: ''
  };
}

/** 对话快捷指令：输入 / 打开，选中后填入输入框。 */
export function ChatPromptsSection({ value, onChange }: Props) {
  const prompts = value.chatPrompts || [];
  const patch = (id: string, next: Partial<PromptTemplate>) => {
    onChange({
      chatPrompts: prompts.map((item) => (item.id === id ? { ...item, ...next } : item))
    });
  };

  return (
    <SettingsSection title="对话快捷指令" defaultOpen={false}>
      <div className="settings-hint">
        在对话输入框输入 <code>/</code> 打开指令面板，选中后把内容填入输入框；可以改成自己的常用提示词。
      </div>
      <div className="settings-inline">
        <button
          className="mini-btn"
          onClick={() => onChange({ chatPrompts: [...prompts, newPrompt()] })}
        >
          <Plus size={12} /> 新增指令
        </button>
      </div>
      {!prompts.length && <div className="settings-hint">还没有快捷指令。</div>}
      {prompts.map((prompt) => (
        <div key={prompt.id} className="assistant-card">
          <div className="settings-inline">
            <input
              className="settings-input"
              value={prompt.name}
              maxLength={40}
              placeholder="指令名称"
              onChange={(event) => patch(prompt.id, { name: event.target.value })}
            />
            <button
              className="mini-btn"
              title="删除指令"
              onClick={() =>
                onChange({
                  chatPrompts: prompts.filter((item) => item.id !== prompt.id)
                })
              }
            >
              <Trash2 size={12} />
            </button>
          </div>
          <textarea
            className="settings-textarea"
            rows={3}
            placeholder="填入输入框的完整提示词…"
            value={prompt.text}
            onChange={(event) => patch(prompt.id, { text: event.target.value })}
          />
        </div>
      ))}
    </SettingsSection>
  );
}
