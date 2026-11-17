import { randomBytes } from 'node:crypto';
import { ipcMain } from 'electron';
import type { AgentStatus, Result } from '../../shared/types';
import { failure, type IpcContext } from './shared';
import { agentStatus, startAgent, stopAgent } from '../agent';
import { loadSettings, saveSettings } from '../settings';

interface AgentPatch {
  enabled?: boolean;
  port?: number;
  trusted?: boolean;
}

/** 本地 Agent 网关的开关、端口、信任状态与 Token。 */
export function registerAgentIpc(ctx: IpcContext): void {
  ipcMain.handle('agent:status', (): Result<AgentStatus> => {
    try {
      return { ok: true, data: agentStatus() };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('agent:set', async (_event, patch: AgentPatch): Promise<Result<AgentStatus>> => {
    try {
      const settings = loadSettings();
      const next = { ...settings.agent };
      if (typeof patch?.enabled === 'boolean') next.enabled = patch.enabled;
      if (typeof patch?.trusted === 'boolean') next.trusted = patch.trusted;
      const port = Number(patch?.port);
      if (Number.isFinite(port) && port >= 1024 && port <= 65535) next.port = Math.floor(port);
      saveSettings({ ...settings, agent: next });
      if (!next.enabled) {
        stopAgent();
        return { ok: true, data: agentStatus() };
      }
      return { ok: true, data: await startAgent(ctx.win, ctx.tabs) };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('agent:regenerate-token', async (): Promise<Result<AgentStatus>> => {
    try {
      const settings = loadSettings();
      const token = randomBytes(24).toString('hex');
      saveSettings({ ...settings, agent: { ...settings.agent, token } });
      if (!settings.agent.enabled) return { ok: true, data: agentStatus() };
      return { ok: true, data: await startAgent(ctx.win, ctx.tabs) };
    } catch (error) {
      return failure(error);
    }
  });
}
