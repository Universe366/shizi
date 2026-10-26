import fs from 'node:fs';
import { dialog, ipcMain } from 'electron';
import type {
  AppSettings,
  Chapter,
  CorrectionRuleGroup,
  McpServer,
  McpTool,
  McpResource,
  McpPrompt,
  PageInfo,
  QualityReport,
  Result,
  SearchPlatform,
  SkillItem,
  SubtitleLine,
  WebReference
} from '../../shared/types';
import { callMcpTool, getMcpPrompt, listMcpPrompts, listMcpResources, listMcpTools, readMcpResource } from '../mcp';
import { fetchSkillFromUrl, readSkillFile, readSkillFolder } from '../skills';
import { checkSubtitles } from '../quality';
import { generateChapters } from '../chapters';
import { testSearch } from '../search';
import { isMaskedSecret, loadSettings } from '../settings';
import { applyCorrectionToText } from '../correction';

import { failure, type IpcContext } from './shared';

/** MCP / Skills / 搜索测试 / 校对规则 / 字幕质量与章节 相关 IPC。 */
export function registerToolsIpc(ctx: IpcContext): void {
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
