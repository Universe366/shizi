import type {
  McpPromptOption,
  McpResourceOption,
  McpToolOption
} from '../../../shared/types';
import { describeMcpParameters } from '../../../shared/mcpSchema';

export type ChatPromptForm = {
  option: McpPromptOption;
  args: Record<string, string>;
} | null;

interface Props {
  open: boolean;
  mode: 'tools' | 'prompts' | 'resources';
  notice: string;
  busy: boolean;
  profileId: string;
  toolOptions: McpToolOption[];
  promptOptions: McpPromptOption[];
  resourceOptions: McpResourceOption[];
  toolSelection: string[] | null;
  promptForm: ChatPromptForm;
  onOpenTools: () => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onToggleTool: (id: string) => void;
  onPromptForm: (value: ChatPromptForm) => void;
  onPickPrompt: (option: McpPromptOption) => void;
  onRunPrompt: (option: McpPromptOption, args: Record<string, string>) => void;
  onInsertResource: (option: McpResourceOption) => void;
}

/** 输入区 MCP 工具 / 提示词 / 资源面板。 */
export function ChatMcpToolPanel({
  open,
  mode,
  notice,
  busy,
  profileId,
  toolOptions,
  promptOptions,
  resourceOptions,
  toolSelection,
  promptForm,
  onOpenTools,
  onSelectAll,
  onSelectNone,
  onToggleTool,
  onPromptForm,
  onPickPrompt,
  onRunPrompt,
  onInsertResource
}: Props) {
  if (!open) return null;
  return (
    <div className="chat-tool-panel">
      <div className="chat-tool-panel-head">
        <span>
          {mode === 'tools'
            ? `本轮可用工具（${toolSelection === null ? '全部' : toolSelection.length}）`
            : mode === 'prompts'
              ? 'MCP 提示词'
              : 'MCP 资源'}
        </span>
        {mode !== 'tools' && (
          <button className="mini-btn" onClick={onOpenTools}>
            工具
          </button>
        )}
        {mode === 'tools' && (
          <>
            <button className="mini-btn" onClick={onSelectAll}>
              全选
            </button>
            <button className="mini-btn" onClick={onSelectNone}>
              不用 MCP
            </button>
          </>
        )}
      </div>
      {notice && (
        <div className="settings-hint" style={{ color: 'var(--danger)' }}>
          {notice}
        </div>
      )}
      {busy && <div className="settings-hint">读取中…</div>}
      {mode === 'tools' && (
        <>
          {profileId && (
            <div className="settings-hint">
              当前使用助手档案，工具由档案的「MCP 工具」设置决定；想手动勾选请先切回「无助手档案」。
            </div>
          )}
          {!toolOptions.length && (
            <div className="settings-hint">
              没有可用工具：先在「设置 → 插件与集成 → MCP」添加并启用服务。
            </div>
          )}
          {toolOptions.map((tool) => {
            const checked = toolSelection === null || toolSelection.includes(tool.id);
            const params = describeMcpParameters(tool.inputSchema);
            return (
              <div key={tool.id} className="chat-tool-item">
                <label className="chat-tool-option" title={tool.description}>
                  <input type="checkbox" checked={checked} onChange={() => onToggleTool(tool.id)} />
                  <span>
                    {tool.serverName} · {tool.name}
                  </span>
                </label>
                {params.length > 0 && (
                  <details className="chat-tool-schema">
                    <summary>{params.length} 个参数</summary>
                    <div className="chat-tool-params">
                      {params.map((param) => (
                        <div key={param.name} className="chat-tool-param">
                          <div className="chat-tool-param-head">
                            <code>{param.name}</code>
                            <span>
                              {param.type}
                              {param.required ? ' · 必填' : ''}
                            </span>
                          </div>
                          {param.description && (
                            <div className="chat-tool-param-desc">{param.description}</div>
                          )}
                          {param.enumValues.length > 0 && (
                            <div className="chat-tool-param-desc">
                              可选值：{param.enumValues.join(' / ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </>
      )}
      {mode === 'prompts' &&
        (promptForm ? (
          <div className="chat-mcp-form">
            <div className="chat-tool-panel-head">
              <span>
                {promptForm.option.serverName} · {promptForm.option.name}
              </span>
              <button className="mini-btn" onClick={() => onPromptForm(null)}>
                返回
              </button>
            </div>
            {promptForm.option.description && (
              <div className="settings-hint">{promptForm.option.description}</div>
            )}
            {promptForm.option.arguments.map((arg) => (
              <label key={arg.name} className="chat-mcp-field">
                <span>
                  {arg.name}
                  {arg.required ? ' *' : ''}
                </span>
                <input
                  className="settings-input"
                  value={promptForm.args[arg.name] || ''}
                  placeholder={arg.description || ''}
                  onChange={(event) =>
                    onPromptForm({
                      option: promptForm.option,
                      args: { ...promptForm.args, [arg.name]: event.target.value }
                    })
                  }
                />
              </label>
            ))}
            <button
              className="mini-btn primary"
              disabled={
                busy ||
                promptForm.option.arguments.some(
                  (arg) => arg.required && !String(promptForm.args[arg.name] || '').trim()
                )
              }
              onClick={() => onRunPrompt(promptForm.option, promptForm.args)}
            >
              运行并插入
            </button>
          </div>
        ) : (
          <>
            {!promptOptions.length && !busy && (
              <div className="settings-hint">没有提示词：服务需要提供 prompts 能力并已启用。</div>
            )}
            {promptOptions.map((option) => (
              <button
                key={option.id}
                className="chat-mcp-item"
                title={option.description}
                onClick={() => onPickPrompt(option)}
              >
                <span>
                  {option.serverName} · {option.name}
                </span>
                {option.arguments.length > 0 && (
                  <span className="chat-mcp-meta">{option.arguments.length} 个参数</span>
                )}
              </button>
            ))}
          </>
        ))}
      {mode === 'resources' && (
        <>
          {!resourceOptions.length && !busy && (
            <div className="settings-hint">没有资源：服务需要提供 resources 能力并已启用。</div>
          )}
          {resourceOptions.map((option) => (
            <button
              key={option.id}
              className="chat-mcp-item"
              title={option.description || option.uri}
              onClick={() => onInsertResource(option)}
            >
              <span>
                {option.serverName} · {option.name}
              </span>
              <span className="chat-mcp-meta">{option.mimeType || 'resource'}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
