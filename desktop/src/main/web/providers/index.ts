import type { AppSettings, SearchPlatform, WebReference } from '../../../shared/types';
import { searchBaidu } from './baidu';
import { searchBocha } from './bocha';
import { searchBrave } from './brave';
import { searchCustom } from './custom';
import { searchDeepSeek } from './deepseek';
import { searchExa } from './exa';
import { searchJina } from './jina';
import { searchMetaso } from './metaso';
import { searchSearxng } from './searxng';
import { searchSerper } from './serper';
import { searchTavily } from './tavily';
import { searchZhipu } from './zhipu';
import { searchAnySearch } from './anysearch';

export type ProviderKind =
  | 'deepseek-search'
  | 'tavily'
  | 'bocha'
  | 'serper'
  | 'zhipu'
  | 'metaso'
  | 'baidu'
  | 'brave'
  | 'exa'
  | 'anysearch'
  | 'jina'
  | 'searxng'
  | 'custom';

export interface ProviderSpec {
  kind: ProviderKind;
  label: string;
  search(settings: AppSettings, platform: SearchPlatform, query: string): Promise<WebReference[]>;
}

const SPECS: Record<ProviderKind, ProviderSpec> = {
  'deepseek-search': { kind: 'deepseek-search', label: 'DeepSeek 搜索', search: searchDeepSeek },
  tavily: { kind: 'tavily', label: 'Tavily', search: searchTavily },
  bocha: { kind: 'bocha', label: '博查 Bocha', search: searchBocha },
  serper: { kind: 'serper', label: 'Serper', search: searchSerper },
  zhipu: { kind: 'zhipu', label: '智谱 Web 搜索', search: searchZhipu },
  metaso: { kind: 'metaso', label: '秘塔搜索', search: searchMetaso },
  baidu: { kind: 'baidu', label: '百度 AI 搜索', search: searchBaidu },
  brave: { kind: 'brave', label: 'Brave', search: searchBrave },
  // Exa 走 MCP 文本协议，不需要 platform 参数。
  exa: { kind: 'exa', label: 'Exa', search: (_settings, _platform, query) => searchExa(query, _settings) },
  anysearch: { kind: 'anysearch', label: 'AnySearch', search: searchAnySearch },
  jina: { kind: 'jina', label: 'Jina', search: searchJina },
  searxng: { kind: 'searxng', label: 'SearXNG', search: searchSearxng },
  custom: { kind: 'custom', label: '自定义搜索', search: searchCustom }
};

export function providerSpec(kind: string | undefined): ProviderSpec {
  return SPECS[(kind || 'custom') as ProviderKind] || SPECS.custom;
}

export function providerLabel(kind: string | undefined): string {
  return providerSpec(kind).label;
}

/** 按 platform.kind 调度到具体协议模块：检索层唯一入口。 */
export async function runProviderSearch(
  settings: AppSettings,
  platform: SearchPlatform,
  query: string
): Promise<WebReference[]> {
  return providerSpec(platform.kind).search(settings, platform, query);
}

export { freePlatform } from './shared';
