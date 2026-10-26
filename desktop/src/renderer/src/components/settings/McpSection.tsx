import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { AppSettings, McpPrompt, McpResource, McpServer, McpTool } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

type McpSettings = AppSettings['mcp'];

interface McpSectionProps {
  value: McpSettings;
  testing: string;
  tools: Record<string, McpTool[]>;
  resources: Record<string, McpResource[]>;
  prompts: Record<string, McpPrompt[]>;
  args: string;
  result: string;
  onChange: (next: McpSettings) => void;
  onArgs: (value: string) => void;
  onAddServer: () => void;
  onUpdateServer: (id: string, patch: Partial<McpServer>) => void;
  onRemoveServer: (id: string) => void;
  onTest: (server: McpServer) => void;
  onCall: (server: McpServer, tool: McpTool) => void;
  onReadResource: (server: McpServer, uri: string) => void;
  onGetPrompt: (server: McpServer, name: string) => void;
}

/** MCP 服务：服务列表、连接测试、工具/资源/提示词、超时/轮数与手动调用参数。 */
export function McpSection({
  value,
  testing,
  tools,
  resources,
  prompts,
  args,
  result,
  onChange,
  onArgs,
  onAddServer,
  onUpdateServer,
  onRemoveServer,
  onTest,
  onCall,
  onReadResource,
  onGetPrompt
}: McpSectionProps) {
  return (
    <SettingsSection title="MCP 服务" defaultOpen={false}>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
        />
        启用 MCP
      </label>
      <div className="settings-inline">
        <span className="settings-label" style={{ flex: 1 }}>
          服务列表
        </span>
        <button className="mini-btn" onClick={onAddServer}>
          <Plus size={12} /> 服务
        </button>
      </div>

      {value.servers.map((server) => (
        <div key={server.id} className="mcp-card">
          <div className="settings-inline">
            <input
              className="settings-input"
              value={server.name}
              onChange={(event) => onUpdateServer(server.id, { name: event.target.value })}
            />
            <label className="settings-check">
              <input
                type="checkbox"
                checked={server.enabled}
                onChange={(event) => onUpdateServer(server.id, { enabled: event.target.checked })}
              />
              启用
            </label>
            <button className="mini-btn" onClick={() => onRemoveServer(server.id)}>
              <Trash2 size={12} />
            </button>
          </div>
          <select
            className="settings-input"
            value={server.transport}
            onChange={(event) =>
              onUpdateServer(server.id, {
                transport: event.target.value as McpServer['transport']
              })
            }
          >
            <option value="http">HTTP JSON-RPC</option>
            <option value="sse">SSE 传输</option>
            <option value="stdio">本地进程（stdio）</option>
          </select>

          {server.transport === 'stdio' ? (
            <>
              <div className="settings-hint">
                会以当前用户身份启动本机命令，只添加你信任的服务。
              </div>
              <input
                className="settings-input"
                placeholder="启动命令，例如 npx / uvx / node"
                value={server.command || ''}
                spellCheck={false}
                onChange={(event) => onUpdateServer(server.id, { command: event.target.value })}
              />
              <div className="settings-label">参数（每行一个）</div>
              <textarea
                className="settings-textarea"
                rows={3}
                spellCheck={false}
                value={(server.args || []).join('\n')}
                onChange={(event) =>
                  onUpdateServer(server.id, {
                    args: event.target.value
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean)
                  })
                }
              />
              <div className="settings-label">工作目录（可选）</div>
              <input
                className="settings-input"
                value={server.cwd || ''}
                spellCheck={false}
                onChange={(event) => onUpdateServer(server.id, { cwd: event.target.value })}
              />
              <div className="settings-label">环境变量（KEY=VALUE，每行一个）</div>
              <textarea
                className="settings-textarea"
                rows={2}
                spellCheck={false}
                value={Object.entries(server.env || {})
                  .map(([key, value]) => `${key}=${value}`)
                  .join('\n')}
                onChange={(event) => {
                  const env: Record<string, string> = {};
                  for (const line of event.target.value.split('\n')) {
                    const index = line.indexOf('=');
                    if (index <= 0) continue;
                    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
                  }
                  onUpdateServer(server.id, { env });
                }}
              />
            </>
          ) : (
            <>
              <input
                className="settings-input"
                placeholder="https://example.com/mcp"
                value={server.url}
                spellCheck={false}
                onChange={(event) => onUpdateServer(server.id, { url: event.target.value })}
              />
              <input
                className="settings-input"
                type="password"
                placeholder="Token（可选）"
                value={server.token}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => onUpdateServer(server.id, { token: event.target.value })}
              />
            </>
          )}
          <button
            className="mini-btn"
            disabled={testing === server.id}
            onClick={() => onTest(server)}
          >
            {testing === server.id ? <Loader2 size={12} className="spin" /> : '连接 / 列出工具'}
          </button>
          {tools[server.id]?.length ? (
            <div className="mcp-tools">
              {tools[server.id].map((tool) => {
                const allowed = server.toolNames || [];
                const checked = !allowed.length || allowed.includes(tool.name);
                return (
                  <span key={tool.name} className="mcp-tool-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      title="允许在对话中使用这个工具"
                      onChange={(event) => {
                        const all = tools[server.id].map((item) => item.name);
                        const next = new Set(allowed.length ? allowed : all);
                        if (event.target.checked) next.add(tool.name);
                        else next.delete(tool.name);
                        const names = [...next];
                        onUpdateServer(server.id, {
                          toolNames: names.length === all.length ? [] : names
                        });
                      }}
                    />
                    <button
                      className="mcp-tool"
                      title={tool.description}
                      onClick={() => onCall(server, tool)}
                    >
                      {tool.name}
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
          {resources[server.id]?.length ? (
            <div className="mcp-tools">
              {resources[server.id].map((resource) => (
                <button
                  key={resource.uri}
                  className="mcp-tool"
                  title={`${resource.uri}\n${resource.description}`}
                  onClick={() => onReadResource(server, resource.uri)}
                >
                  资源 · {resource.name}
                </button>
              ))}
            </div>
          ) : null}
          {prompts[server.id]?.length ? (
            <div className="mcp-tools">
              {prompts[server.id].map((prompt) => (
                <button
                  key={prompt.name}
                  className="mcp-tool"
                  title={prompt.description}
                  onClick={() => onGetPrompt(server, prompt.name)}
                >
                  提示词 · {prompt.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}

      <div className="settings-inline">
        <div className="settings-field">
          <div className="settings-label">单次工具调用超时（秒）</div>
          <input
            className="settings-input"
            type="number"
            min={5}
            max={300}
            value={Math.round((value.callTimeoutMs || 60000) / 1000)}
            onChange={(event) =>
              onChange({ ...value, callTimeoutMs: (Number(event.target.value) || 60) * 1000 })
            }
          />
        </div>
        <div className="settings-field">
          <div className="settings-label">最多工具轮数</div>
          <input
            className="settings-input"
            type="number"
            min={1}
            max={12}
            value={value.maxToolRounds || 6}
            onChange={(event) => onChange({ ...value, maxToolRounds: Number(event.target.value) || 6 })}
          />
        </div>
      </div>

      <div className="settings-label">调用参数（JSON）</div>
      <textarea
        className="settings-textarea"
        rows={3}
        value={args}
        spellCheck={false}
        onChange={(event) => onArgs(event.target.value)}
      />
      {result && <pre className="correction-preview">{result}</pre>}
      <div className="settings-hint">
        点击工具名用上方参数手动调用；对话时会自动把已启用的 MCP 工具接进工具循环。
      </div>
    </SettingsSection>
  );
}
