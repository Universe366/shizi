import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, KeyRound, RotateCw } from 'lucide-react';
import type { AgentStatus } from '../../../../shared/types';
import { SettingsSection } from './SettingsSection';

/** 本地 Agent 网关：开关、端口、信任、Token 与 MCP 配置。 */
export function AgentSection() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [pendingRotate, setPendingRotate] = useState(false);

  const apply = useCallback((next: AgentStatus) => {
    setStatus(next);
    setPort(String(next.port));
  }, []);

  const refresh = useCallback(async () => {
    const result = await window.bsub.getAgentStatus();
    if (result.ok) {
      apply(result.data);
      setError('');
    } else {
      setError(result.error);
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withBusy = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError((failure as Error)?.message || String(failure));
    } finally {
      setBusy('');
    }
  };

  const patch = (input: { enabled?: boolean; port?: number; trusted?: boolean }) =>
    withBusy('patch', async () => {
      const result = await window.bsub.setAgent(input);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      apply(result.data);
    });

  const rotate = () =>
    withBusy('rotate', async () => {
      if (!pendingRotate) {
        setPendingRotate(true);
        setNotice('再点一次「确认重置」会让现有 Agent 立即失效');
        return;
      }
      const result = await window.bsub.regenerateAgentToken();
      setPendingRotate(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      apply(result.data);
      setNotice('Token 已重置，请把新 Token 填到 Agent 配置里');
    });

  const copy = (text: string, label: string) =>
    withBusy(`copy-${label}`, async () => {
      await navigator.clipboard.writeText(text);
      setNotice(`已复制${label}`);
    });

  const mcpConfig = useMemo(() => {
    if (!status) return '';
    return JSON.stringify(
      {
        mcpServers: {
          shizi: {
            url: `http://127.0.0.1:${status.port}/mcp`,
            headers: { Authorization: `Bearer ${status.token}` }
          }
        }
      },
      null,
      2
    );
  }, [status]);

  const maskedToken = status?.token
    ? showToken
      ? status.token
      : `${'•'.repeat(Math.max(0, Math.min(24, status.token.length - 6)))}${status.token.slice(-6)}`
    : '（还没有 Token，启用后自动生成）';

  return (
    <SettingsSection
      title="本地 Agent"
      description="把拾字开放给外部 Agent：本地 HTTP + MCP，默认只读"
      defaultOpen={false}
    >
      <div className="settings-hint">
        开启后在本机 <code>127.0.0.1</code> 上提供 HTTP 与 MCP 接口，供 Claude Code、Codex 等 Agent
        调用。默认只读；写操作（开/关标签、点击网页、改设置）每次都会弹确认，勾选「信任」后不再询问。
        所有请求都要 Bearer Token，审计日志写在数据目录的 <code>agent-audit.log</code>。
      </div>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={status?.enabled === true}
          disabled={!status || busy === 'patch'}
          onChange={(event) => void patch({ enabled: event.target.checked })}
        />
        启用本地 Agent 接口
      </label>

      <div className="settings-hint">
        状态：{status?.running ? `运行中 · 端口 ${status.port}` : status?.enabled ? '已启用但未运行' : '未启用'}
        {status?.error ? ` · ${status.error}` : ''}
        {status?.trusted ? ' · 已信任（不再逐次确认）' : ' · 每次写操作确认'}
      </div>

      <div className="settings-inline">
        <span className="settings-label">端口</span>
        <input
          className="settings-input"
          value={port}
          onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void patch({ port: Number(port) });
          }}
        />
        <button
          className="mini-btn"
          disabled={busy === 'patch' || !port}
          onClick={() => void patch({ port: Number(port) })}
        >
          应用
        </button>
        <button className="mini-btn" disabled={busy === 'refresh'} onClick={() => void withBusy('refresh', refresh)}>
          <RotateCw size={14} /> 刷新
        </button>
      </div>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={status?.trusted === true}
          disabled={!status || busy === 'patch'}
          onChange={(event) => void patch({ trusted: event.target.checked })}
        />
        信任这个 Agent：写操作不再逐次确认
      </label>

      <div className="settings-inline">
        <span className="settings-label">Token</span>
        <code className="agent-token">{maskedToken}</code>
        <button className="mini-btn" onClick={() => setShowToken((value) => !value)}>
          {showToken ? '隐藏' : '显示'}
        </button>
        <button
          className="mini-btn"
          disabled={!status?.token}
          onClick={() => void copy(status?.token || '', 'Token')}
        >
          <Copy size={14} />
        </button>
        <button
          className={`mini-btn${pendingRotate ? ' is-danger' : ''}`}
          disabled={busy === 'rotate'}
          onClick={() => void rotate()}
        >
          <KeyRound size={14} /> {pendingRotate ? '确认重置' : '重置'}
        </button>
      </div>

      {status?.token && (
        <>
          <div className="settings-hint">MCP 配置（复制到支持 HTTP MCP 的客户端）：</div>
          <pre className="agent-config">{mcpConfig}</pre>
          <div className="settings-inline">
            <button className="mini-btn" onClick={() => void copy(mcpConfig, 'MCP 配置')}>
              <Copy size={14} /> 复制配置
            </button>
            <button
              className="mini-btn"
              onClick={() =>
                void copy(
                  `curl -s http://127.0.0.1:${status.port}/v1/agent/info -H "Authorization: Bearer ${status.token}"`,
                  'curl 示例'
                )
              }
            >
              复制 curl
            </button>
          </div>
        </>
      )}

      {error && <div className="settings-hint settings-error">操作失败：{error}</div>}
      {notice && !error && <div className="settings-hint">{notice}</div>}
    </SettingsSection>
  );
}
