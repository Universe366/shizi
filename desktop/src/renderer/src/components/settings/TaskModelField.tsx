import type { AiTask, AppSettings } from '../../../../shared/types';
import { AI_TASKS } from '../../../../shared/aiTasks';

interface Props {
  ai: AppSettings['ai'];
  onChange: (patch: Partial<AppSettings['ai']>) => void;
  task: AiTask;
  label?: string;
  hint?: string;
}

/**
 * 单个功能的「使用平台 / 模型」下拉。
 *
 * 默认跟随「AI 与模型」当前选中的平台与模型；只有需要给某个功能单独换
 * 更强/更便宜的模型时才在这里指定，不影响其他功能。
 */
export function TaskModelField({ ai, onChange, task, label, hint }: Props) {
  const enabledPlatforms = ai.platforms.filter(
    (platform) => platform.enabled !== false || platform.id === ai.activeId
  );
  const active =
    ai.platforms.find((platform) => platform.id === ai.activeId) || ai.platforms[0];
  const override = ai.taskModels?.[task];
  const selectedPlatform = override?.platformId
    ? ai.platforms.find((platform) => platform.id === override.platformId && platform.enabled !== false)
    : active;
  const models = (
    selectedPlatform?.models?.length ? selectedPlatform.models : [selectedPlatform?.model]
  ).filter(Boolean) as string[];
  const listId = `task-model-${task}`;
  const meta = AI_TASKS.find((item) => item.id === task);

  const patch = (platformId: string, model: string) => {
    const next = { ...(ai.taskModels || {}) };
    const value = model.trim();
    if (!platformId && !value) delete next[task];
    else next[task] = { platformId, model: value };
    onChange({ taskModels: next });
  };

  return (
    <div className="settings-field">
      <div className="settings-label">{label || `${meta?.label || task}使用的平台 / 模型（可选）`}</div>
      <div className="settings-inline">
        <select
          className="settings-input"
          value={override?.platformId || ''}
          onChange={(event) => patch(event.target.value, override?.model || '')}
        >
          <option value="">跟随当前平台（{active?.name || '未选择'}）</option>
          {enabledPlatforms.map((platform) => (
            <option key={platform.id} value={platform.id}>
              {platform.name}
            </option>
          ))}
        </select>
        <input
          className="settings-input"
          list={listId}
          value={override?.model || ''}
          placeholder={selectedPlatform?.model || '平台默认模型'}
          spellCheck={false}
          onChange={(event) => patch(override?.platformId || '', event.target.value)}
        />
        <datalist id={listId}>
          {models.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
        {override && (
          <button className="mini-btn" onClick={() => patch('', '')}>
            跟随当前平台
          </button>
        )}
      </div>
      <div className="settings-hint">
        {hint || `${meta?.desc || '这个功能'}；留空则跟随「AI 与模型」当前选中的平台与模型。`}
      </div>
    </div>
  );
}
