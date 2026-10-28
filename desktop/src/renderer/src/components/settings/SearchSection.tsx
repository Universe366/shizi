import { useRef, useState } from 'react';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import type { AppSettings, SearchPlatform, SearchTimeRange, WebReference } from '../../../../shared/types';
import { parseUblacklist } from '../../../../shared/searchBlacklist';
import {
  capabilityKey,
  effectiveModelCapabilities
} from '../../../../shared/modelCapabilities';
import { SearchDiagnostics } from './SearchDiagnostics';
import { SettingsSection } from './SettingsSection';

interface SearchSectionProps {
  draft: AppSettings;
  activeSearch: SearchPlatform | null | undefined;
  updateSearch: (patch: Partial<AppSettings['search']>) => void;
  updateSearchPlatform: (patch: Partial<SearchPlatform>) => void;
  addSearchPlatform: () => void;
  removeSearchPlatform: () => void;
  setEditingSearchId: (id: string) => void;
  showKey: Record<string, boolean>;
  setShowKey: (
    updater: (previous: Record<string, boolean>) => Record<string, boolean>
  ) => void;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchTesting: boolean;
  searchResults: WebReference[] | null;
  onTestSearch: () => void;
}

/**
 * 联网检索设置：只暴露三件事——用哪个搜索、什么时候自动搜、总结前要不要核对。
 * 协议/Key、结果数、缓存、黑名单等放进折叠项，新手不用先理解它们。
 */
export function SearchSection({
  draft,
  activeSearch,
  updateSearch,
  updateSearchPlatform,
  addSearchPlatform,
  removeSearchPlatform,
  setEditingSearchId,
  showKey,
  setShowKey,
  searchQuery,
  setSearchQuery,
  searchTesting,
  searchResults,
  onTestSearch
}: SearchSectionProps) {
  const search = draft.search;
  const mode = search.alwaysSearchOnChat
    ? 'always'
    : search.autoSearchOnChat
      ? 'smart'
      : 'manual';
  const fetchPlatform =
    search.fetchPlatforms?.find((item) => item.id === search.fetchActiveId) ||
    search.fetchPlatforms?.[0];
  const [fetchTestUrl, setFetchTestUrl] = useState('https://example.com');
  const [fetchTesting, setFetchTesting] = useState(false);
  const [fetchResult, setFetchResult] = useState<string>('');
  const [blacklistNotice, setBlacklistNotice] = useState('');
  const [cacheNotice, setCacheNotice] = useState('');
  const blacklistInputRef = useRef<HTMLInputElement>(null);
  const activeAi = draft.ai.platforms.find((item) => item.id === draft.ai.activeId);
  const builtinSupported = activeAi
    ? effectiveModelCapabilities(
        activeAi.kind,
        activeAi.model,
        draft.ai.capabilities?.[capabilityKey(activeAi.id, activeAi.model)]
      ).web
    : false;

  return (
    <SettingsSection title="联网检索" defaultOpen={false}>
      <div className="settings-hint">
        只配三件事：用哪个搜索、什么时候自动搜、总结前要不要核对。其余保持默认即可。
      </div>
      <div className="settings-inline">
        <button
          className="mini-btn"
          onClick={() => {
            const existingExa = search.platforms.find((platform) => platform.id === 'exa');
            const exa: SearchPlatform = {
              ...(existingExa || {
                id: 'exa',
                apiKey: '',
                homepage: 'https://exa.ai/',
                keyUrl: 'https://dashboard.exa.ai/api-keys',
                reuseAiKey: ''
              }),
              name: 'Exa MCP（免 Key，推荐）',
              kind: 'exa',
              baseUrl: 'https://mcp.exa.ai/mcp'
            };
            const platforms = existingExa
              ? search.platforms.map((platform) => (platform.id === 'exa' ? exa : platform))
              : [...search.platforms, exa];
            const existingJina = (search.fetchPlatforms || []).find(
              (platform) => platform.id === 'jina'
            );
            const jina: SearchPlatform = {
              ...(existingJina || { id: 'jina', apiKey: '' }),
              name: 'Jina Reader（免 Key）',
              kind: 'jina',
              baseUrl: 'https://r.jina.ai'
            };
            const fetchPlatforms = existingJina
              ? (search.fetchPlatforms || []).map((platform) =>
                  platform.id === 'jina' ? jina : platform
                )
              : [...(search.fetchPlatforms || []), jina];
            updateSearch({
              activeId: 'exa',
              platforms,
              fetchActiveId: 'jina',
              fetchPlatforms
            });
          }}
          title="切换为 Cherry 同款默认：Exa MCP 搜索 + Jina 读取网页"
        >
          使用推荐默认（Exa MCP + Jina）
        </button>
      </div>

      <label className="settings-check">
        <input
          type="checkbox"
          checked={search.enabled}
          onChange={(event) => updateSearch({ enabled: event.target.checked })}
        />
        启用联网检索（对话「联网」/ 总结核对 / 优化核对）
      </label>

      <div className="settings-group">
        <div className="settings-group-title">1. 搜索服务商</div>
        <div className="settings-group-desc">
          决定「搜什么」；没有 Key 时会自动用免费引擎兜底。
        </div>

        <div className="settings-inline">
          <select
            className="settings-input"
            value={activeSearch?.id || ''}
            onChange={(event) => setEditingSearchId(event.target.value)}
          >
            {search.platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
                {platform.id === search.activeId ? '（使用中）' : ''}
                {!platform.apiKey && !platform.reuseAiKey ? ' · 免 Key' : ''}
              </option>
            ))}
          </select>
          {activeSearch && activeSearch.id !== search.activeId && (
            <button
              className="mini-btn primary"
              onClick={() => updateSearch({ activeId: activeSearch.id })}
            >
              设为使用中
            </button>
          )}
          <button className="mini-btn" title="新增检索平台" onClick={addSearchPlatform}>
            <Plus size={12} />
          </button>
          <button
            className="mini-btn"
            title="删除当前检索平台"
            disabled={search.platforms.length <= 1}
            onClick={removeSearchPlatform}
          >
            <Trash2 size={12} />
          </button>
        </div>

        {activeSearch && activeSearch.id !== search.activeId && (
          <div className="settings-hint">
            正在编辑「{activeSearch.name}」；点「设为使用中」后，对话与总结才会用它。
          </div>
        )}

        <div className="settings-inline">
          <input
            className="settings-input"
            value={searchQuery}
            spellCheck={false}
            placeholder="输入一个词，测试当前服务"
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button className="mini-btn primary" disabled={searchTesting} onClick={() => onTestSearch()}>
            {searchTesting ? <Loader2 size={12} className="spin" /> : <Search size={12} />} 测试检索
          </button>
        </div>
        {searchResults && (
          <div className="settings-hint">
            {searchResults.length
              ? `找到 ${searchResults.length} 条：${searchResults
                  .slice(0, 3)
                  .map((item) => item.title)
                  .join(' / ')}`
              : '没有检索到结果，检查 Key、协议或网络。'}
          </div>
        )}

        {activeSearch && (
          <details className="settings-advanced">
            <summary>服务配置（协议 / 地址 / Key）</summary>
            <div className="settings-label">平台名称</div>
            <input
              className="settings-input"
              value={activeSearch.name}
              onChange={(event) => updateSearchPlatform({ name: event.target.value })}
            />

            <div className="settings-label">协议</div>
            <select
              className="settings-input"
              value={activeSearch.kind}
              onChange={(event) => updateSearchPlatform({ kind: event.target.value })}
            >
              <option value="deepseek-search">DeepSeek 搜索</option>
              <option value="tavily">Tavily</option>
              <option value="bocha">博查 Bocha</option>
              <option value="serper">Serper（Google）</option>
              <option value="zhipu">智谱 Web 搜索</option>
              <option value="metaso">秘塔搜索</option>
              <option value="baidu">百度千帆 AI 搜索</option>
              <option value="brave">Brave</option>
              <option value="exa">Exa（MCP，免 Key）</option>
              <option value="jina">Jina 搜索</option>
              <option value="searxng">SearXNG</option>
              <option value="anysearch">AnySearch</option>
              <option value="custom">自定义（GET ?q=）</option>
            </select>

            <div className="settings-label">接口地址</div>
            <input
              className="settings-input"
              value={activeSearch.baseUrl}
              spellCheck={false}
              onChange={(event) => updateSearchPlatform({ baseUrl: event.target.value })}
            />

            <div className="settings-label">API Key</div>
            <div className="settings-inline">
              <input
                className="settings-input"
                type={showKey[activeSearch.id] ? 'text' : 'password'}
                value={activeSearch.apiKey === '__CLEAR__' ? '' : activeSearch.apiKey}
                placeholder="留空保存不改动"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => updateSearchPlatform({ apiKey: event.target.value })}
              />
              <button
                className="mini-btn"
                onClick={() =>
                  setShowKey((previous) => ({
                    ...previous,
                    [activeSearch.id]: !previous[activeSearch.id]
                  }))
                }
              >
                {showKey[activeSearch.id] ? '隐藏' : '显示'}
              </button>
              <button
                className="mini-btn"
                onClick={() => updateSearchPlatform({ apiKey: '__CLEAR__' })}
              >
                清除
              </button>
            </div>

            <div className="settings-label">复用 AI Key（可选）</div>
            <select
              className="settings-input"
              value={activeSearch.reuseAiKey || ''}
              onChange={(event) => updateSearchPlatform({ reuseAiKey: event.target.value })}
            >
              <option value="">不重用</option>
              {draft.ai.platforms.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.name}
                </option>
              ))}
            </select>

            {(activeSearch.homepage || activeSearch.keyUrl) && (
              <div className="settings-inline">
                {activeSearch.homepage && (
                  <button className="mini-btn" onClick={() => window.open(activeSearch.homepage, '_blank')}>
                    官网
                  </button>
                )}
                {activeSearch.keyUrl && (
                  <button className="mini-btn" onClick={() => window.open(activeSearch.keyUrl!, '_blank')}>
                    申请 Key
                  </button>
                )}
              </div>
            )}
          </details>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-group-title">2. URL 获取服务商</div>
        <div className="settings-group-desc">
          决定 web_fetch 怎么打开网页：内置抓取免 Key；Jina 免费；Tavily / Exa / Firecrawl 需要 Key。第三方读取失败会自动回退内置抓取。
        </div>
        <select
          className="settings-input"
          value={fetchPlatform?.kind || 'direct'}
          onChange={(event) => {
            const kind = event.target.value;
            const presets: Record<string, { name: string; baseUrl: string }> = {
              direct: { name: '内置抓取（免 Key）', baseUrl: '' },
              jina: { name: 'Jina Reader', baseUrl: 'https://r.jina.ai' },
              tavily: { name: 'Tavily Extract', baseUrl: 'https://api.tavily.com' },
              exa: { name: 'Exa Contents', baseUrl: 'https://api.exa.ai' },
              firecrawl: { name: 'Firecrawl', baseUrl: 'https://api.firecrawl.dev' },
              custom: { name: '自定义 URL 获取', baseUrl: '' }
            };
            const preset = presets[kind] || presets.direct;
            const existing = (search.fetchPlatforms || []).find((item) => item.id === kind);
            const next = existing
              ? { ...existing, name: preset.name }
              : {
                  id: kind,
                  name: preset.name,
                  kind,
                  baseUrl: preset.baseUrl,
                  apiKey: ''
                };
            updateSearch({
              fetchActiveId: kind,
              fetchPlatforms: [
                ...(search.fetchPlatforms || []).filter((item) => item.id !== kind),
                next
              ]
            });
          }}
        >
          <option value="direct">内置抓取（免 Key）</option>
          <option value="jina">Jina Reader（免 Key）</option>
          <option value="tavily">Tavily Extract</option>
          <option value="exa">Exa Contents</option>
          <option value="firecrawl">Firecrawl</option>
          <option value="custom">自定义 URL 获取（{'{url}'} 占位）</option>
        </select>
        {fetchPlatform && fetchPlatform.kind !== 'direct' && (
          <>
            <div className="settings-label">API Key</div>
            <input
              className="settings-input"
              type="password"
              value={fetchPlatform.apiKey}
              placeholder="留空保存不改动"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) =>
                updateSearch({
                  fetchPlatforms: (search.fetchPlatforms || []).map((item) =>
                    item.id === fetchPlatform.id
                      ? { ...item, apiKey: event.target.value }
                      : item
                  )
                })
              }
            />
            <details className="settings-advanced">
              <summary>接口地址（一般不用改）</summary>
              <input
                className="settings-input"
                value={fetchPlatform.baseUrl}
                spellCheck={false}
                onChange={(event) =>
                  updateSearch({
                    fetchPlatforms: (search.fetchPlatforms || []).map((item) =>
                      item.id === fetchPlatform.id
                        ? { ...item, baseUrl: event.target.value }
                        : item
                    )
                  })
                }
              />
            </details>
          </>
        )}

        <div className="settings-inline">
          <input
            className="settings-input"
            value={fetchTestUrl}
            spellCheck={false}
            placeholder="https://example.com"
            onChange={(event) => setFetchTestUrl(event.target.value)}
          />
          <button
            className="mini-btn"
            type="button"
            disabled={fetchTesting}
            onClick={async () => {
              setFetchTesting(true);
              setFetchResult('');
              try {
                const response = await window.bsub.testFetchPage?.({
                  url: fetchTestUrl,
                  platform: fetchPlatform
                });
                if (response?.ok) {
                  setFetchResult(
                    `成功：${response.data.title || '无标题'} · ${response.data.chars} 字` +
                      (response.data.preview ? `\n${response.data.preview}` : '')
                  );
                } else {
                  setFetchResult(`失败：${response?.error || '未知原因'}`);
                }
              } catch (error) {
                setFetchResult(`失败：${(error as Error).message}`);
              } finally {
                setFetchTesting(false);
              }
            }}
          >
            {fetchTesting ? <Loader2 size={12} className="spin" /> : null} 测试抓取
          </button>
        </div>
        {fetchResult && <div className="settings-hint">{fetchResult}</div>}
      </div>

      <div className="settings-group">
        <div className="settings-group-title">3. 优先使用模型内置 Web 工具</div>
        <div className="settings-group-desc">
          开启后，Gemini / Claude 直接用厂商内置搜索；其他模型自动回退到上面的搜索服务商。
        </div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={search.preferModelWeb === true}
            onChange={(event) => updateSearch({ preferModelWeb: event.target.checked })}
          />
          优先使用模型内置 Web 工具
        </label>
        <div className="settings-hint">
          {activeAi
            ? `当前对话模型：${activeAi.name}（${
                builtinSupported ? '支持内置联网' : '不支持，开启后会自动回退到搜索服务商'
              }）`
            : '还没有配置对话模型，开启后会回退到搜索服务商。'}
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">4. 什么时候自动搜</div>
        <div className="settings-group-desc">
          默认手动：只有你在对话里点「联网」才搜。
        </div>

        <label className="settings-check">
          <input
            type="radio"
            name="search-mode"
            checked={mode === 'manual'}
            onChange={() => updateSearch({ alwaysSearchOnChat: false, autoSearchOnChat: false })}
          />
          手动：我点「联网」才搜
        </label>
        <label className="settings-check">
          <input
            type="radio"
            name="search-mode"
            checked={mode === 'smart'}
            onChange={() => updateSearch({ alwaysSearchOnChat: false, autoSearchOnChat: true })}
          />
          智能：问题像需要最新事实时才搜
        </label>
        <label className="settings-check">
          <input
            type="radio"
            name="search-mode"
            checked={mode === 'always'}
            onChange={() => updateSearch({ alwaysSearchOnChat: true })}
          />
          每轮都搜（最准，但每次消耗检索额度）
        </label>

        {mode === 'smart' && (
          <label className="settings-check">
            <input
              type="checkbox"
              checked={search.autoSearchAi === true}
              onChange={(event) => updateSearch({ autoSearchAi: event.target.checked })}
            />
            用 AI 判断（更准，每次多一次小调用）
          </label>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-group-title">5. 总结前核对</div>
        <div className="settings-group-desc">
          从字幕里挑数字、时间、版本等硬信息逐条找证据；故事/观点类视频会自动跳过。
        </div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={search.verifySummary !== false}
            onChange={(event) => updateSearch({ verifySummary: event.target.checked })}
          />
          总结前联网核对字幕（推荐）
        </label>
        {search.verifySummary !== false && (
          <details className="settings-advanced">
            <summary>核对细节</summary>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={search.aiQueryGeneration !== false}
                onChange={(event) => updateSearch({ aiQueryGeneration: event.target.checked })}
              />
              让 AI 挑选待核实项（关闭则只按数字/术语抽取）
            </label>
            <div className="settings-field">
              <div className="settings-label">每次核对条数</div>
              <input
                className="settings-input"
                type="number"
                min={1}
                max={20}
                value={search.verifyItemCount || 8}
                onChange={(event) =>
                  updateSearch({ verifyItemCount: Number(event.target.value) || 8 })
                }
              />
            </div>
            <div className="settings-field">
              <div className="settings-label">每项读取正文篇数（1–5）</div>
              <input
                className="settings-input"
                type="number"
                min={1}
                max={5}
                value={search.verifyReadPages || 1}
                onChange={(event) =>
                  updateSearch({
                    verifyReadPages: Math.min(
                      5,
                      Math.max(1, Number(event.target.value) || 1)
                    )
                  })
                }
              />
            </div>
            <div className="settings-label">额外核实查询（每行一条，可留空）</div>
            <textarea
              className="settings-input"
              rows={3}
              placeholder='例如：DeepSeek V4 发布时间'
              value={search.extraVerifyQueries || ''}
              onChange={(event) => updateSearch({ extraVerifyQueries: event.target.value })}
            />
          </details>
        )}
      </div>

      <details className="settings-advanced">
        <summary>总结时带哪些参考</summary>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={search.useVideoMeta !== false}
            onChange={(event) => updateSearch({ useVideoMeta: event.target.checked })}
          />
          视频简介（标题、UP 主、简介）
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={search.useComments === true}
            onChange={(event) => updateSearch({ useComments: event.target.checked })}
          />
          热门评论（仅作观众观点参考）
        </label>
        <div className="settings-inline">
          <div className="settings-field">
            <div className="settings-label">总结读取正文篇数（1–10）</div>
            <input
              className="settings-input"
              type="number"
              min={1}
              max={10}
              value={search.summaryReadPages || 2}
              onChange={(event) =>
                updateSearch({
                  summaryReadPages: Math.min(
                    10,
                    Math.max(1, Number(event.target.value) || 2)
                  )
                })
              }
            />
          </div>
          <div className="settings-field">
            <div className="settings-label">参考资料字符预算</div>
            <input
              className="settings-input"
              type="number"
              min={2000}
              max={20000}
              step={1000}
              value={search.summaryReferenceChars || 6000}
              onChange={(event) =>
                updateSearch({
                  summaryReferenceChars: Math.min(
                    20000,
                    Math.max(2000, Number(event.target.value) || 6000)
                  )
                })
              }
            />
          </div>
        </div>
        <div className="settings-hint">
          只影响视频 / 字幕总结；读取篇数越多、预算越大，总结越慢也越费 token。
        </div>
      </details>

      <details className="settings-advanced">
        <summary>高级设置（一般不用改）</summary>
        <div className="settings-hint">这些项影响检索质量、速度和额度；不确定时保持默认。</div>
        <div className="settings-inline">
          <div className="settings-field">
            <div className="settings-label">每次结果数</div>
            <input
              className="settings-input"
              type="number"
              min={1}
              max={100}
              value={search.maxResults}
              onChange={(event) => updateSearch({ maxResults: Number(event.target.value) || 5 })}
            />
          </div>
          <div className="settings-field">
            <div className="settings-label">对话检索条数</div>
            <input
              className="settings-input"
              type="number"
              min={1}
              max={4}
              value={search.planQueries ?? 3}
              onChange={(event) => updateSearch({ planQueries: Number(event.target.value) || 3 })}
            />
          </div>
          <div className="settings-field">
            <div className="settings-label">时间范围</div>
            <select
              className="settings-input"
              value={search.timeRange}
              onChange={(event) =>
                updateSearch({ timeRange: event.target.value as SearchTimeRange })
              }
            >
              <option value="any">不限</option>
              <option value="year">最近一年</option>
              <option value="month">最近一月</option>
              <option value="week">最近一周</option>
            </select>
          </div>
        </div>

        <label className="settings-check">
          <input
            type="checkbox"
            checked={search.fetchPages === true}
            onChange={(event) => updateSearch({ fetchPages: event.target.checked })}
          />
          抓取前 3 条结果的网页正文（更完整，慢几秒）
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={search.includeContent}
            onChange={(event) => updateSearch({ includeContent: event.target.checked })}
          />
          包含网页正文（平台支持时）
        </label>
        <div className="settings-field">
          <div className="settings-label">搜索结果压缩</div>
          <select
            className="settings-input"
            value={search.snippetMode === 'none' ? 'none' : 'truncate'}
            onChange={(event) =>
              updateSearch({
                snippetMode: event.target.value === 'none' ? 'none' : 'truncate'
              })
            }
          >
            <option value="truncate">截断（省 token）</option>
            <option value="none">不压缩（保留完整摘要，更费 token）</option>
          </select>
        </div>
        {search.snippetMode !== 'none' && (
          <div className="settings-field">
            <div className="settings-label">每条结果保留字符数（{search.snippetChars || 2000}）</div>
            <input
              className="settings-input"
              type="number"
              min={200}
              max={20000}
              step={100}
              value={search.snippetChars || 2000}
              onChange={(event) =>
                updateSearch({ snippetChars: Number(event.target.value) || 2000 })
              }
            />
          </div>
        )}
        <label className="settings-check">
          <input
            type="checkbox"
            checked={search.keylessFallback !== false}
            onChange={(event) => updateSearch({ keylessFallback: event.target.checked })}
          />
          配置的服务失败时用免费引擎兜底
        </label>
        {search.keylessFallback !== false && (
          <div className="settings-field">
            <div className="settings-label">兜底顺序（exa / anysearch / searxng）</div>
            <input
              className="settings-input"
              value={(search.keylessOrder || []).join(', ')}
              placeholder="exa, anysearch"
              onChange={(event) =>
                updateSearch({
                  keylessOrder: event.target.value
                    .split(/[,\s]+/)
                    .map((item) => item.trim().toLowerCase())
                    .filter((item) => ['exa', 'anysearch', 'searxng'].includes(item))
                })
              }
            />
          </div>
        )}
        <div className="settings-field">
          <div className="settings-label">检索结果缓存（分钟，0 = 关闭）</div>
          <input
            className="settings-input"
            type="number"
            min={0}
            max={60}
            value={search.cacheMinutes}
            onChange={(event) => updateSearch({ cacheMinutes: Number(event.target.value) || 0 })}
          />
        </div>
        <div className="settings-inline">
          <button
            className="mini-btn"
            onClick={async () => {
              const response = await window.bsub.searchClearCache?.();
              setCacheNotice(response?.ok ? '已清空检索缓存' : response?.error || '清空失败');
            }}
          >
            清空检索缓存
          </button>
          {cacheNotice && <span className="settings-hint">{cacheNotice}</span>}
        </div>
        <div className="settings-inline">
          <div className="settings-label">域名黑名单（每行一条，支持 * 与 /正则/）</div>
          <button
            className="mini-btn"
            onClick={() => blacklistInputRef.current?.click()}
            title="导入 ublacklist 导出的 txt / JSON"
          >
            导入 ublacklist
          </button>
        </div>
        <input
          ref={blacklistInputRef}
          type="file"
          accept=".txt,.json,text/plain,application/json"
          style={{ display: 'none' }}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
              const rules = parseUblacklist(await file.text());
              const merged = [
                ...new Set([...(search.blacklist || []), ...rules])
              ].slice(0, 5000);
              updateSearch({ blacklist: merged });
              setBlacklistNotice(
                `已导入 ${rules.length} 条规则，当前共 ${merged.length} 条`
              );
            } catch (error) {
              setBlacklistNotice(`导入失败：${(error as Error).message}`);
            }
          }}
        />
        <textarea
          className="settings-textarea"
          rows={3}
          spellCheck={false}
          placeholder="*://*.example.com/*"
          value={(search.blacklist || []).join('\n')}
          onChange={(event) =>
            updateSearch({
              blacklist: event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 5000)
            })
          }
        />
        {blacklistNotice && <div className="settings-hint">{blacklistNotice}</div>}
        <div className="settings-hint">
          支持 ublacklist 的纯文本导出（一行一条）或 JSON（rules 数组）；导入会与现有规则合并去重。
        </div>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={search.verify}
            onChange={(event) => updateSearch({ verify: event.target.checked })}
          />
          AI 优化字幕时也联网核对改动（较慢）
        </label>
      </details>

      <SearchDiagnostics />
    </SettingsSection>
  );
}
