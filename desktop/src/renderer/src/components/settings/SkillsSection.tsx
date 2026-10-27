import { useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import type { AppSettings, SkillItem } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type SkillSettings = AppSettings['skills'];

interface SkillsSectionProps {
  value: SkillSettings;
  onToggle: (enabled: boolean) => void;
  onImport: () => void;
  onImportUrl: (url: string) => void;
  onImportFolder: () => void;
  onCreate: () => void;
  onUpdate: (id: string, patch: Partial<SkillItem>) => void;
  onRemove: (id: string) => void;
}

/** Skills：技能提示词开关、导入 SKILL.md（文件/链接/文件夹）、新建/编辑/删除技能。 */
export function SkillsSection({
  value,
  onToggle,
  onImport,
  onImportUrl,
  onImportFolder,
  onCreate,
  onUpdate,
  onRemove
}: SkillsSectionProps) {
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const enabledCount = value.items.filter((item) => item.enabled).length;
  const visible = value.items.filter((skill) => {
    const text = `${skill.name} ${skill.description} ${skill.body}`.toLowerCase();
    return !query.trim() || text.includes(query.trim().toLowerCase());
  });

  return (
    <SettingsSection title="Skills" defaultOpen={false}>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onToggle(event.target.checked)}
        />
        启用技能提示词
      </label>
      <div className="settings-hint">
        已启用 {enabledCount} / {value.items.length} 个；技能会注入总结和对话的系统提示词。
      </div>

      <div className="settings-inline">
        <button className="mini-btn" onClick={onImport}>
          <Plus size={12} /> 导入 SKILL.md
        </button>
        <button className="mini-btn" onClick={onImportFolder}>
          <Plus size={12} /> 导入文件夹
        </button>
        <button className="mini-btn" onClick={onCreate}>
          <Plus size={12} /> 新建技能
        </button>
      </div>

      <div className="settings-inline">
        <input
          className="settings-input"
          placeholder="https://raw.githubusercontent.com/.../SKILL.md"
          spellCheck={false}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button
          className="mini-btn"
          disabled={!url.trim()}
          onClick={() => {
            onImportUrl(url.trim());
            setUrl('');
          }}
        >
          从链接导入
        </button>
      </div>

      {value.items.length > 0 && (
        <div className="settings-inline">
          <input
            className="settings-input"
            placeholder="搜索技能…"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Search size={13} style={{ color: 'var(--faint)' }} />
        </div>
      )}

      {visible.map((skill) => (
        <details key={skill.id} className="skill-card">
          <summary className="skill-card-head">
            <span className="skill-icon">{skill.icon || '✨'}</span>
            <span className="skill-name">{skill.name || '未命名技能'}</span>
            <span className={`skill-badge${skill.enabled ? ' is-on' : ''}`}>
              {skill.enabled ? '已启用' : '已停用'}
            </span>
            <span className="skill-source">{skill.source}</span>
          </summary>

          <div className="settings-inline">
            <input
              className="settings-input"
              value={skill.name}
              onChange={(event) => onUpdate(skill.id, { name: event.target.value })}
            />
            <label className="settings-check">
              <input
                type="checkbox"
                checked={skill.enabled}
                onChange={(event) => onUpdate(skill.id, { enabled: event.target.checked })}
              />
              启用
            </label>
            <button className="mini-btn" title="删除技能" onClick={() => onRemove(skill.id)}>
              <Trash2 size={12} />
            </button>
          </div>
          <input
            className="settings-input"
            placeholder="触发条件 / 描述"
            value={skill.description}
            onChange={(event) => onUpdate(skill.id, { description: event.target.value })}
          />
          <textarea
            className="settings-textarea"
            rows={6}
            value={skill.body}
            onChange={(event) => onUpdate(skill.id, { body: event.target.value })}
          />
          <div className="settings-hint">来源：{skill.source}</div>
          <div className="settings-hint">展开后直接编辑正文；改动即时保存。</div>
        </details>
      ))}

      {!visible.length && (
        <div className="settings-hint">
          {value.items.length ? '没有匹配的技能。' : '还没有技能：可以导入 SKILL.md 或新建一个。'}
        </div>
      )}
    </SettingsSection>
  );
}
