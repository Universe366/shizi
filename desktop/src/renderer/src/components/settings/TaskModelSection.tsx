import type { AiPlatform, AiTask, AppSettings } from '../../../../shared/types';
import { AI_TASKS } from '../../../../shared/aiTasks';
import { SettingsSection } from './SettingsSection';

interface Props {
  value: AppSettings['ai'];
  updateAi: (patch: Partial<AppSettings['ai']>) => void;
}

/** 按任务覆盖模型：总结用强模型、翻译用便宜模型，其余跟随当前平台。 */
export function TaskModelSection({ value, updateAi }: Props) {
  const current =
    value.platforms.find((platform) => platform.id === value.activeId) || value.platforms[0];
  const enabledPlatforms = value.platforms.filter(
    (platform) => platform.enabled !== false || platform.id === value.activeId
  );

  const patchTask = (task: AiTask, platformId: string, model: string) => {
    const next = { ...(value.taskModels || {}) };
    if (!platformId && !model.trim()) {
      delete next[task];
    } else {
      next[task] = { platformId, model: model.trim() };
    }
    updateAi({ taskModels: next });
  };

  return (
    <SettingsSection title="默认模型" defaultOpen={false}>
      <div className="settings-hint">
        对话、总结默认使用「当前平台」的模型（{current?.name || '未选择'} / {current?.model || '未填模型'}）。
        需要总结用强模型、翻译用便宜模型时，在下面按任务单独指定；留空就跟随当前平台。
      </div>
      <table className="usage-table task-model-table">
        <thead>
          <tr>
            <th>任务</th>
            <th>平台</th>
            <th>模型</th>
          </tr>
        </thead>
        <tbody>
          {AI_TASKS.map((task) => {
            const override = value.taskModels?.[task.id];
            const platformId = override?.platformId || '';
            const platform: AiPlatform | undefined = platformId
              ? value.platforms.find((item) => item.id === platformId)
              : current;
            const models = platform?.models || [];
            const listId = `task-models-${task.id}`;
            return (
              <tr key={task.id}>
                <td title={task.desc}>{task.label}</td>
                <td>
                  <select
                    className="settings-input"
                    value={platformId}
                    onChange={(event) =>
                      patchTask(task.id, event.target.value, override?.model || '')
                    }
                  >
                    <option value="">跟随当前平台</option>
                    {enabledPlatforms.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="settings-input"
                    list={listId}
                    value={override?.model || ''}
                    placeholder={platform?.model || '平台默认模型'}
                    onChange={(event) => patchTask(task.id, platformId, event.target.value)}
                  />
                  <datalist id={listId}>
                    {models.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {Object.keys(value.taskModels || {}).length > 0 && (
        <button className="mini-btn" onClick={() => updateAi({ taskModels: {} })}>
          全部恢复跟随当前平台
        </button>
      )}
    </SettingsSection>
  );
}
