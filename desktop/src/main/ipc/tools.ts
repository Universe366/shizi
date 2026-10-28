import fs from 'node:fs';
import { dialog, ipcMain } from 'electron';
import type {
  AppSettings,
  Chapter,
  CorrectionRuleGroup,
  McpOAuth,
  McpServer,
  McpTool,
  McpResource,
  McpPrompt,
  McpPromptOption,
  McpResourceOption,
  McpToolOption,
  PageInfo,
  QualityReport,
  Result,
  SearchPlatform,
  SkillIndexEntry,
  SkillItem,
  SubtitleLine,
  WebReference
} from '../../shared/types';
import {
  callMcpTool,
  getMcpPrompt,
  listAllMcpPrompts,
  listAllMcpResources,
  listAllMcpTools,
  listMcpPrompts,
  listMcpResources,
  listMcpTools,
  readMcpResource,
  setMcpNotificationSink
} from '../mcp';
import { authorizeMcpServer } from '../mcpOAuth';
import {
  restoreMcpSubscriptions,
  unwatchMcpResource,
  watchMcpResource
} from '../mcpSubscriptions';
import { fetchSkillIndex } from '../skillIndex';
import {
  fetchSkillsFromRepo,
  fetchSkillFromUrl,
  readSkillFile,
  readSkillFolder
} from '../skills';
import { checkSubtitles } from '../quality';
import { generateChapters } from '../chapters';
import { testSearch } from '../search';
import { isMaskedSecret, loadSettings } from '../settings';
import { applyCorrectionToText } from '../correction';

import { failure, type IpcContext } from './shared';

/** MCP / Skills / 搜索测试 / 校对规则 / 字幕质量与章节 相关 IPC。 */
export function registerToolsIpc(ctx: IpcContext): void {
  setMcpNotificationSink((server, method, params) => {
    if (method === 'notifications/tools/list_changed') {
      ctx.send('mcp:server-changed', { serverId: server.id, kind: 'tools' });
      return;
    }
    if (method === 'notifications/prompts/list_changed') {
      ctx.send('mcp:server-changed', { serverId: server.id, kind: 'prompts' });
      return;
    }
    if (method === 'notifications/resources/updated') {
      const uri = String(params.uri || '');
      if (!uri) return;
      void readMcpResource(server, uri)
        .then((content) => {
          ctx.send('mcp:resource-updated', {
            serverId: server.id,
            uri,
            content: content.slice(0, 4000),
            at: Date.now()
          });
        })
        .catch(() => undefined);
    }
  });

  ipcMain.handle('mcp:test', async (_event, server: McpServer): Promise<Result<McpTool[]>> => {
    try {
      return { ok: true, data: await listMcpTools(server) };
    } catch (error) {
      return failure<McpTool[]>(error);
    }
  });

  ipcMain.handle(
    'mcp:call',
    async (
      _event,
      payload: { server: McpServer; name: string; args: Record<string, unknown> }
    ): Promise<Result<string>> => {
      try {
        return {
          ok: true,
          data: await callMcpTool(payload.server, payload.name, payload.args || {})
        };
      } catch (error) {
        return failure<string>(error);
      }
    }
  );

  ipcMain.handle('skills:import', async (): Promise<Result<SkillItem | null>> => {
    try {
      const picked = await dialog.showOpenDialog(ctx.win, {
        title: '导入 SKILL.md',
        properties: ['openFile'],
        filters: [{ name: 'Skill', extensions: ['md'] }]
      });
      const file = picked.filePaths[0];
      if (picked.canceled || !file) return { ok: true, data: null };
      return { ok: true, data: readSkillFile(file) };
    } catch (error) {
      return failure<SkillItem | null>(error);
    }
  });

  ipcMain.handle(
    'mcp:all-tools',
    async (): Promise<Result<McpToolOption[]>> => {
      try {
        const settings = loadSettings();
        return { ok: true, data: await listAllMcpTools(settings.mcp.servers) };
      } catch (error) {
        return failure<McpToolOption[]>(error);
      }
    }
  );

  ipcMain.handle(
    'mcp:all-prompts',
    async (): Promise<Result<McpPromptOption[]>> => {
      try {
        const settings = loadSettings();
        return { ok: true, data: await listAllMcpPrompts(settings.mcp.servers) };
      } catch (error) {
        return failure<McpPromptOption[]>(error);
      }
    }
  );

  ipcMain.handle(
    'mcp:all-resources',
    async (): Promise<Result<McpResourceOption[]>> => {
      try {
        const settings = loadSettings();
        return { ok: true, data: await listAllMcpResources(settings.mcp.servers) };
      } catch (error) {
        return failure<McpResourceOption[]>(error);
      }
    }
  );

  const findServer = (serverId: string): McpServer => {
    const server = loadSettings().mcp.servers.find((item) => item.id === serverId);
    if (!server) throw new Error('MCP 服务不存在或已被删除');
    if (!server.enabled) throw new Error('MCP 服务已停用');
    return server;
  };

  ipcMain.handle(
    'mcp:run-prompt',
    async (
      _event,
      payload: { serverId: string; name: string; args?: Record<string, string> }
    ): Promise<Result<string>> => {
      try {
        const server = findServer(String(payload?.serverId || ''));
        return {
          ok: true,
          data: await getMcpPrompt(
            server,
            String(payload?.name || ''),
            payload?.args || {}
          )
        };
      } catch (error) {
        return failure<string>(error);
      }
    }
  );

  ipcMain.handle(
    'mcp:resource-text',
    async (
      _event,
      payload: { serverId: string; uri: string }
    ): Promise<Result<string>> => {
      try {
        const server = findServer(String(payload?.serverId || ''));
        return { ok: true, data: await readMcpResource(server, String(payload?.uri || '')) };
      } catch (error) {
        return failure<string>(error);
      }
    }
  );

  ipcMain.handle(
    'mcp:oauth',
    async (_event, server: McpServer): Promise<Result<McpOAuth>> => {
      try {
        return { ok: true, data: await authorizeMcpServer(server) };
      } catch (error) {
        return failure<McpOAuth>(error);
      }
    }
  );

  ipcMain.handle(
    'mcp:watch-resource',
    async (_event, payload: { server: McpServer; uri: string }): Promise<Result<boolean>> => {
      try {
        await watchMcpResource(payload.server, payload.uri);
        return { ok: true, data: true };
      } catch (error) {
        return failure<boolean>(error);
      }
    }
  );

  ipcMain.handle(
    'mcp:unwatch-resource',
    async (_event, payload: { server: McpServer; uri: string }): Promise<Result<boolean>> => {
      try {
        await unwatchMcpResource(payload.server, payload.uri);
        return { ok: true, data: true };
      } catch (error) {
        return failure<boolean>(error);
      }
    }
  );

  ipcMain.handle(
    'mcp:restore-subscriptions',
    (_event, servers: McpServer[]): Result<boolean> => {
      restoreMcpSubscriptions(Array.isArray(servers) ? servers : []);
      return { ok: true, data: true };
    }
  );

  ipcMain.handle(
    'mcp:resources',
    async (_event, server: McpServer): Promise<Result<McpResource[]>> => {
      try {
        return { ok: true, data: await listMcpResources(server) };
      } catch (error) {
        return failure<McpResource[]>(error);
      }
    }
  );

  ipcMain.handle(
    'mcp:read-resource',
    async (_event, payload: { server: McpServer; uri: string }): Promise<Result<string>> => {
      try {
        return { ok: true, data: await readMcpResource(payload.server, payload.uri) };
      } catch (error) {
        return failure<string>(error);
      }
    }
  );

  ipcMain.handle(
    'mcp:prompts',
    async (_event, server: McpServer): Promise<Result<McpPrompt[]>> => {
      try {
        return { ok: true, data: await listMcpPrompts(server) };
      } catch (error) {
        return failure<McpPrompt[]>(error);
      }
    }
  );

  ipcMain.handle(
    'mcp:prompt',
    async (
      _event,
      payload: { server: McpServer; name: string; args: Record<string, string> }
    ): Promise<Result<string>> => {
      try {
        return {
          ok: true,
          data: await getMcpPrompt(payload.server, payload.name, payload.args || {})
        };
      } catch (error) {
        return failure<string>(error);
      }
    }
  );

  ipcMain.handle(
    'skills:index',
    async (_event, url: string): Promise<Result<SkillIndexEntry[]>> => {
      try {
        return { ok: true, data: await fetchSkillIndex(String(url || '')) };
      } catch (error) {
        return failure<SkillIndexEntry[]>(error);
      }
    }
  );

  ipcMain.handle('skills:import-repo', async (_event, url: string): Promise<Result<SkillItem[]>> => {
    try {
      return { ok: true, data: await fetchSkillsFromRepo(String(url || '')) };
    } catch (error) {
      return failure<SkillItem[]>(error);
    }
  });

  ipcMain.handle('skills:import-url', async (_event, url: string): Promise<Result<SkillItem>> => {
    try {
      return { ok: true, data: await fetchSkillFromUrl(String(url || '')) };
    } catch (error) {
      return failure<SkillItem>(error);
    }
  });

  ipcMain.handle('skills:import-folder', async (): Promise<Result<SkillItem[]>> => {
    try {
      const picked = await dialog.showOpenDialog(ctx.win, {
        title: '导入技能文件夹（读取其中的 SKILL.md）',
        properties: ['openDirectory']
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: true, data: [] };
      return { ok: true, data: readSkillFolder(picked.filePaths[0]) };
    } catch (error) {
      return failure<SkillItem[]>(error);
    }
  });

  ipcMain.handle(
    'quality:check',
    (_event, payload: { info: PageInfo; lines: SubtitleLine[] }): Result<QualityReport> => {
      try {
        if (!payload || !payload.info || !Array.isArray(payload.lines)) {
          throw new Error('缺少字幕数据');
        }
        return { ok: true, data: checkSubtitles(payload.info, payload.lines) };
      } catch (error) {
        return failure<QualityReport>(error);
      }
    }
  );

  ipcMain.handle(
    'chapters:generate',
    async (
      _event,
      payload: { info: PageInfo; lines: SubtitleLine[] }
    ): Promise<Result<Chapter[]>> => {
      try {
        if (!payload || !payload.info || !Array.isArray(payload.lines) || !payload.lines.length) {
          throw new Error('缺少字幕数据');
        }
        return { ok: true, data: await generateChapters(payload.info, payload.lines) };
      } catch (error) {
        return failure<Chapter[]>(error);
      }
    }
  );

  ipcMain.handle(
    'search:test',
    async (
      _event,
      query: string,
      override?: {
        platform?: SearchPlatform;
        search?: AppSettings['search'];
      }
    ): Promise<Result<WebReference[]>> => {
      try {
        const q = String(query || '').trim() || 'B站 视频 总结';
        const saved = loadSettings();
        const candidate = override?.platform;
        if (!candidate) return { ok: true, data: await testSearch(saved, q) };

        // 允许用设置页里尚未保存的平台/协议/Key 做测试；掩码 Key 回退到已保存值。
        const apiKey =
          candidate.apiKey && candidate.apiKey !== '__CLEAR__' && !isMaskedSecret(candidate.apiKey)
            ? candidate.apiKey
            : saved.search.platforms.find((item) => item.id === candidate.id)?.apiKey || '';
        const platform: SearchPlatform = { ...candidate, apiKey };
        const search: AppSettings['search'] = {
          ...saved.search,
          ...(override?.search || {}),
          enabled: true,
          activeId: platform.id,
          platforms: [platform, ...saved.search.platforms.filter((item) => item.id !== platform.id)]
        };
        return { ok: true, data: await testSearch({ ...saved, search }, q) };
      } catch (error) {
        return failure<WebReference[]>(error);
      }
    }
  );

  ipcMain.handle('rules:export', async (_event, group: CorrectionRuleGroup) => {
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: `${String(group?.name || '字幕规则组').replace(/[\\/:*?"<>|]/g, '_')}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) return { ok: true, data: { canceled: true } };
      fs.writeFileSync(
        result.filePath,
        JSON.stringify({ version: 1, groups: [group] }, null, 2),
        'utf8'
      );
      return { ok: true, data: { canceled: false, path: result.filePath } };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('rules:import', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePaths.length) {
        return { ok: true, data: [] as CorrectionRuleGroup[] };
      }
      interface RuleRow {
        name?: unknown;
        enabled?: unknown;
        rules?: unknown;
        pattern?: unknown;
        replacement?: unknown;
        from?: unknown;
        to?: unknown;
        regex?: unknown;
        caseSensitive?: unknown;
      }
      const parsed = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')) as unknown;
      const parsedGroups =
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { groups?: unknown[] }).groups)
          ? (parsed as { groups: unknown[] }).groups
          : null;
      const rows: unknown[] = Array.isArray(parsed) ? parsed : (parsedGroups ?? []);
      const groups: CorrectionRuleGroup[] = rows
        .filter((row): row is RuleRow => Boolean(row) && typeof row === 'object')
        .map((row, index: number) => ({
          id: `group_${Date.now().toString(36)}_${index}`,
          name: String(row.name || `导入规则组 ${index + 1}`).slice(0, 80),
          enabled: row.enabled !== false,
          rules: (Array.isArray(row.rules) ? row.rules : [])
            .filter((rule) => rule && typeof rule === 'object')
            .map((rule, ruleIndex: number) => ({
              id: `rule_${Date.now().toString(36)}_${ruleIndex}`,
              pattern: String((rule as RuleRow).pattern ?? (rule as RuleRow).from ?? ''),
              replacement: String((rule as RuleRow).replacement ?? (rule as RuleRow).to ?? ''),
              regex: (rule as RuleRow).regex === true,
              caseSensitive: (rule as RuleRow).caseSensitive === true
            }))
        }));
      return { ok: true, data: groups };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle(
    'correction:preview',
    (_event, text: string, settings?: AppSettings): Result<string> => {
      try {
        return {
          ok: true,
          data: applyCorrectionToText(String(text || ''), settings || loadSettings())
        };
      } catch (error) {
        return failure(error);
      }
    }
  );
}