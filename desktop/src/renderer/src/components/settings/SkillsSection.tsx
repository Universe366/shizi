import { useRef, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import type {
  AppSettings,
  SkillIndexEntry,
  SkillItem
} from '../../../../shared/types';
import { SKILL_CATALOG } from '../../../../shared/skillCatalog';
import { SettingsSection } from './SettingsSection';

type SkillSettings = AppSettings['skills'];

interface SkillsSectionProps {
  value: SkillSettings;
  onToggle: (enabled: boolean) => void;
  onImport: () => void;
  onImportUrl: (url: string) => void;
  onImportRepo?: (url: string) => void;
  onImportJson?: (items: SkillItem[]) => void;
  onLoadIndex?: (url: string) => Promise<SkillIndexEntry[]>;
  onInstallIndex?: (entry: SkillIndexEntry) => void;
  onIndexUrlChange?: (url: string) => void;
  onImportFolder: () => void;
  onCreate: () => void;
  onUpdate: (id: string, patch: Partial<SkillItem>) => void;
  onRemove: (id: string) => void;
  onRefresh?: (id: string, url: string) => void;
  onRefreshAll?: () => void;
  onInstall?: (template: (typeof SKILL_CATALOG)[number]) => void;
}

/** Skills：技能提示词开关、导入 SKILL.md（文件/链接/文件夹）、新建/编辑/删除技能。 */
export function SkillsSection({
  value,
  onToggle,
  onImport,
  onImportUrl,
  onImportRepo,
  onImportJson,
  onLoadIndex,
  onInstallIndex,
  onIndexUrlChange,
  onImportFolder,
  onCreate,
  onUpdate,
  onRemove,
  onRefresh,
  onRefreshAll,
  onInstall
}: SkillsSectionProps) {
  const [url, setUrl] = useState('');
  const [repo, setRepo] = useState('');
  const [query, setQuery] = useState('');
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [indexUrl, setIndexUrl] = useState(value.indexUrl || '');
  const [indexEntries, setIndexEntries] = useState<SkillIndexEntry[]>([]);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
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
        <button className="mini-btn" onClick={() => setCatalogOpen((value) => !value)}>
          技能库
        </button>
        <button className="mini-btn" onClick={() => setIndexOpen((value) => !value)}>
          远程技能库
        </button>
        <button className="mini-btn" onClick={() => fileRef.current?.click()}>
          导入技能 JSON
        </button>
        <button
          className="mini-btn"
          onClick={() =>
            void window.bsub.writeClipboard(
              JSON.stringify(
                {
                  skills: value.items.map((item) => ({
                    name: item.name,
                    description: item.description,
                    icon: item.icon,
                    body: item.body,
                    enabled: item.enabled,
                    category: item.category,
                    sourceUrl: item.sourceUrl
                  }))
                },
                null,
                2
              )
            )
          }
        >
          导出技能 JSON
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
              const raw = JSON.parse(await file.text()) as unknown;
              const rows = Array.isArray(raw)
                ? raw
                : ((raw as Record<string, unknown>)?.skills as unknown);
              if (!Array.isArray(rows)) throw new Error('没有找到 skills 数组');
              const items = rows
                .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
                .map((row, index) => ({
                  id: `skill-${Date.now()}-${index}`,
                  name: String(row.name || '导入技能').slice(0, 80),
                  description: String(row.description || '').slice(0, 200),
                  icon: String(row.icon || '✨').slice(0, 8),
                  body: String(row.body || ''),
                  enabled: row.enabled !== false,
                  category: row.category ? String(row.category) : undefined,
                  sourceUrl: row.sourceUrl ? String(row.sourceUrl) : undefined,
                  source: 'file' as const
                }))
                .filter((item) => item.body.trim());
              if (!items.length) throw new Error('没有可导入的技能正文');
              onImportJson?.(items);
            } catch (error) {
              window.alert(`导入失败：${(error as Error).message}`);
            }
          }}
        />
        <button
          className="mini-btn"
          disabled={!value.items.some((item) => item.sourceUrl)}
          onClick={onRefreshAll}
        >
          检查全部更新
        </button>
        <button
          className="mini-btn"
          onClick={() => value.items.forEach((item) => onUpdate(item.id, { enabled: true }))}
        >
          启用全部技能
        </button>
        <button
          className="mini-btn"
          onClick={() => value.items.forEach((item) => onUpdate(item.id, { enabled: false }))}
        >
          停用全部技能
        </button>
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

      {indexOpen && (
        <div className="skill-index-panel">
          <div className="settings-inline">
            <input
              className="settings-input"
              placeholder="技能索引 JSON 地址，例如 https://example.com/skills.json"
              spellCheck={false}
              value={indexUrl}
              onChange={(event) => {
                setIndexUrl(event.target.value);
                onIndexUrlChange?.(event.target.value);
              }}
            />
            <button
              className="mini-btn"
              disabled={!indexUrl.trim() || indexLoading}
              onClick={async () => {
                if (!indexUrl.trim()) return;
                setIndexLoading(true);
                setIndexError('');
                try {
                  setIndexEntries((await onLoadIndex?.(indexUrl.trim())) || []);
                } catch (error) {
                  setIndexError((error as Error).message);
                } finally {
                  setIndexLoading(false);
                }
              }}
            >
              {indexLoading ? '读取中…' : '获取索引'}
            </button>
          </div>
          {indexError && <div className="settings-hint">读取失败：{indexError}</div>}
          {indexEntries.map((entry) => (
            <div key={entry.id} className="skill-index-row">
              <span className="skill-catalog-icon">{entry.icon || '✨'}</span>
              <span className="skill-index-main">
                <span className="skill-catalog-name">{entry.name}</span>
                <span className="skill-catalog-desc">{entry.description}</span>
                <span className="skill-index-meta">
                  {[entry.category, entry.author, entry.version && `v${entry.version}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <button className="mini-btn" onClick={() => onInstallIndex?.(entry)}>
                安装
              </button>
            </div>
          ))}
        </div>
      )}

      {catalogOpen && (
        <div className="skill-catalog-grid">
          {SKILL_CATALOG.map((template) => (
            <button
              key={template.id}
              type="button"
              className="skill-catalog-card"
              onClick={() => onInstall?.(template)}
            >
              <span className="skill-catalog-icon">{template.icon}</span>
              <span className="skill-catalog-name">{template.name}</span>
              <span className="skill-catalog-desc">{template.description}</span>
              <span className="skill-catalog-tag">{template.category}</span>
            </button>
          ))}
        </div>
      )}

      <div className="settings-inline">
        <input
          className="settings-input"
          placeholder="https://github.com/owner/repo（批量导入 SKILL.md）"
          spellCheck={false}
          value={repo}
          onChange={(event) => setRepo(event.target.value)}
        />
        <button
          className="mini-btn"
          disabled={!repo.trim()}
          onClick={() => {
            onImportRepo?.(repo.trim());
            setRepo('');
          }}
        >
          从仓库导入
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
            {skill.category && <span className="skill-source">{skill.category}</span>}
            <span className="skill-source">{skill.source}</span>
          </summary>

          <div className="skill-editor">
            <div className="skill-editor-toolbar">
              <label className="skill-enabled">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={(event) => onUpdate(skill.id, { enabled: event.target.checked })}
                />
                启用
              </label>
              <span className="settings-hint">随设置保存</span>
              <button
                className="mini-btn skill-delete"
                title="删除技能"
                onClick={() => onRemove(skill.id)}
              >
                <Trash2 size={12} /> 删除
              </button>
            </div>

            <div className="skill-field-row">
              <div className="skill-field skill-field-icon">
                <div className="settings-label">图标</div>
                <input
                  className="settings-input"
                  maxLength={4}
                  value={skill.icon || ''}
                  onChange={(event) => onUpdate(skill.id, { icon: event.target.value })}
                />
              </div>
              <div className="skill-field">
                <div className="settings-label">名称</div>
                <input
                  className="settings-input"
                  value={skill.name}
                  onChange={(event) => onUpdate(skill.id, { name: event.target.value })}
                />
              </div>
            </div>

            <div className="skill-field">
              <div className="settings-label">描述（什么时候用它）</div>
              <input
                className="settings-input"
                placeholder="触发条件 / 描述"
                value={skill.description}
                onChange={(event) => onUpdate(skill.id, { description: event.target.value })}
              />
            </div>

            <div className="skill-field">
              <div className="settings-label">正文（SKILL.md 内容）</div>
              <textarea
                className="settings-textarea skill-body"
                rows={8}
                value={skill.body}
                onChange={(event) => onUpdate(skill.id, { body: event.target.value })}
              />
            </div>

            <div className="skill-editor-foot">
              <span>来源：{skill.source}</span>
              {skill.sourceUrl && (
                <>
                  <span className="skill-url" title={skill.sourceUrl}>
                    {skill.sourceUrl}
                  </span>
                  <button
                    className="mini-btn"
                    onClick={() => onRefresh?.(skill.id, skill.sourceUrl!)}
                  >
                    检查更新
                  </button>
                </>
              )}
            </div>
          </div>
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
