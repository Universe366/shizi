import { Plus, Trash2 } from 'lucide-react';
import type { AppSettings } from '../../../../shared/types';
import { DEFAULT_SUMMARY_FORMAT_RULES } from '../../../../shared/summaryFormat';
import { SettingsSection } from './SettingsSection';
import { TaskModelField } from './TaskModelField';

type PromptSettings = AppSettings['prompt'];

interface PromptSectionProps {
  value: PromptSettings;
  ai: AppSettings['ai'];
  onAiChange: (patch: Partial<AppSettings['ai']>) => void;
  onPatch: (patch: Partial<PromptSettings>) => void;
  onAddTemplate: () => void;
  onRemoveTemplate: () => void;
  onUpdateTemplate: (patch: { name?: string; text?: string }) => void;
}

/** 提示词模板：模板选择/新增/删除、模板正文，以及对话/翻译/优化/章节提示词。 */
export function PromptSection({
  value,
  ai,
  onAiChange,
  onPatch,
  onAddTemplate,
  onRemoveTemplate,
  onUpdateTemplate
}: PromptSectionProps) {
  const activeTemplate = value.templates.find((item) => item.id === value.activeId) || value.templates[0];

  return (
    <SettingsSection title="总结提示词模板" defaultOpen={false}>
      <div className="settings-inline">
        <select
          className="settings-input"
          aria-label="总结模板"
          value={value.activeId}
          onChange={(event) => onPatch({ activeId: event.target.value })}
        >
          {value.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        <button className="mini-btn" title="新增模板" onClick={onAddTemplate}>
          <Plus size={12} />
        </button>
        <button
          className="mini-btn"
          title="删除当前模板"
          disabled={value.templates.length <= 1}
          onClick={onRemoveTemplate}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="settings-label">模板名称</div>
      <input
        className="settings-input"
        value={activeTemplate?.name || ''}
        onChange={(event) => onUpdateTemplate({ name: event.target.value })}
      />

      <textarea
        className="settings-textarea"
        rows={9}
        value={activeTemplate?.text || ''}
        onChange={(event) => onUpdateTemplate({ text: event.target.value })}
      />

      <div className="settings-label">总结格式规则</div>
      <div className="settings-hint">
        留空则不追加任何格式规则：最终系统提示词只有上面的模板（以及配置了才有的术语表）。
      </div>
      <textarea
        className="settings-textarea"
        rows={14}
        value={value.summaryFormatRules ?? DEFAULT_SUMMARY_FORMAT_RULES}
        onChange={(event) => onPatch({ summaryFormatRules: event.target.value })}
      />

      <TaskModelField
        ai={ai}
        onChange={onAiChange}
        task="summary"
        label="总结使用的平台 / 模型（可选）"
        hint="留空则跟随「AI 与模型」当前选中的平台与模型；想让总结用更强/更便宜的模型时再单独指定。"
      />

      <div className="settings-label">对话提示词</div>
      <textarea
        className="settings-textarea"
        rows={5}
        value={value.chat}
        onChange={(event) => onPatch({ chat: event.target.value })}
      />

      <div className="settings-label">翻译提示词</div>
      <textarea
        className="settings-textarea"
        rows={6}
        value={value.translate}
        onChange={(event) => onPatch({ translate: event.target.value })}
      />

      <div className="settings-label">AI 优化提示词</div>
      <textarea
        className="settings-textarea"
        rows={6}
        value={value.optimize}
        onChange={(event) => onPatch({ optimize: event.target.value })}
      />

      <div className="settings-label">章节提示词</div>
      <textarea
        className="settings-textarea"
        rows={5}
        value={value.chapters}
        onChange={(event) => onPatch({ chapters: event.target.value })}
      />

      <TaskModelField
        ai={ai}
        onChange={onAiChange}
        task="chapters"
        label="章节与断句使用的平台 / 模型（可选）"
        hint="留空则跟随「AI 与模型」当前选中的平台与模型。"
      />
    </SettingsSection>
  );
}
