import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import type {
  AppSettings,
  SearchPlatform,
  SearchTimeRange,
  WebReference
} from '../../../../shared/types';
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

/** 联网检索：平台选择/协议/Key、结果数与时间范围、核对与兜底配置。 */
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
  return (
<SettingsSection title="联网检索" defaultOpen={false}>
  <div className="settings-hint">
    决定什么时候让 AI 联网、用哪个检索服务，以及总结前要不要逐条核对字幕。
    不配置 Key 也能用免 Key 引擎。
  </div>

  <label className="settings-check">
    <input
      type="checkbox"
      checked={draft.search.enabled}
      onChange={(event) => updateSearch({ enabled: event.target.checked })}
    />
    启用联网检索（对话「联网」/ 总结核对 / 优化核对）
  </label>

  <div className="settings-group">
    <div className="settings-group-title">用哪个检索服务</div>
    <div className="settings-group-desc">配了 Key 更稳定；没配 Key 时会自动使用免费引擎兜底。</div>

    <div className="settings-inline">
      <select
        className="settings-input"
        value={activeSearch?.id || ''}
        onChange={(event) => setEditingSearchId(event.target.value)}
      >
        {draft.search.platforms.map((platform) => (
          <option key={platform.id} value={platform.id}>
            {platform.name}
            {platform.id === draft.search.activeId ? '（使用中）' : ''}
            {!platform.apiKey && !platform.reuseAiKey ? ' · 未配 Key' : ''}
          </option>
        ))}
      </select>
      {activeSearch && activeSearch.id !== draft.search.activeId && (
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
        disabled={draft.search.platforms.length <= 1}
        onClick={removeSearchPlatform}
      >
        <Trash2 size={12} />
      </button>
    </div>
    {activeSearch && activeSearch.id !== draft.search.activeId && (
      <div className="settings-hint">
        正在编辑「{activeSearch.name}」；点「设为使用中」后，对话联网与总结核对才会用这个平台。
      </div>
    )}

    {activeSearch && (
      <>
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

        <div className="settings-label">检索 API Key</div>
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
          onChange={(event) =>
            updateSearchPlatform({ reuseAiKey: event.target.value })
          }
        >
          <option value="">不重用</option>
          {draft.ai.platforms.map((platform) => (
            <option key={platform.id} value={platform.id}>
              {platform.name}
            </option>
          ))}
        </select>

        <div className="settings-label">试搜一次（用当前表单，未保存也生效）</div>
        <div className="settings-inline">
          <input
            className="settings-input"
            value={searchQuery}
            spellCheck={false}
            placeholder="测试查询"
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

        {(activeSearch.homepage || activeSearch.keyUrl) && (
          <div className="settings-inline">
            {activeSearch.homepage && (
              <button
                className="mini-btn"
                onClick={() => void window.bsub.newTab(activeSearch.homepage!)}
              >
                官网
              </button>
            )}
            {activeSearch.keyUrl && (
              <button
                className="mini-btn"
                onClick={() => void window.bsub.newTab(activeSearch.keyUrl!)}
              >
                获取 Key
              </button>
            )}
          </div>
        )}

        <details className="settings-advanced">
          <summary>预设的官网 / 申请 Key 链接</summary>
          <div className="settings-label">官网地址</div>
          <input
            className="settings-input"
            value={activeSearch.homepage || ''}
            placeholder="https://"
            onChange={(event) => updateSearchPlatform({ homepage: event.target.value })}
          />
          <div className="settings-label">申请 Key 链接</div>
          <input
            className="settings-input"
            value={activeSearch.keyUrl || ''}
            placeholder="https://"
            onChange={(event) => updateSearchPlatform({ keyUrl: event.target.value })}
          />
        </details>
      </>
    )}
  </div>

  <div className="settings-group">
    <div className="settings-group-title">结果处理</div>
    <div className="settings-group-desc">
      摘要太长会挤占上下文；抓正文更完整但会慢几秒。黑名单命中后直接丢弃该结果。
    </div>
    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.search.fetchPages === true}
        onChange={(event) => updateSearch({ fetchPages: event.target.checked })}
      />
      抓取前 3 条结果的网页正文（替换默认摘要）
    </label>
    <div className="settings-field">
      <div className="settings-label">每条结果保留字符数（{draft.search.snippetChars || 2000}）</div>
      <input
        className="settings-input"
        type="number"
        min={200}
        max={20000}
        step={100}
        value={draft.search.snippetChars || 2000}
        onChange={(event) => updateSearch({ snippetChars: Number(event.target.value) || 2000 })}
      />
    </div>
    <div className="settings-label">域名黑名单（每行一条，支持 * 通配与 /正则/）</div>
    <textarea
      className="settings-textarea"
      rows={3}
      spellCheck={false}
      placeholder="*://*.example.com/*"
      value={(draft.search.blacklist || []).join('\n')}
      onChange={(event) =>
        updateSearch({
          blacklist: event.target.value
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 100)
        })
      }
    />
  </div>

  <div className="settings-group">
    <div className="settings-group-title">什么时候自动联网</div>
    <div className="settings-group-desc">
      默认不自动联网，只有你在对话里点「联网」时才搜。打开后按问题内容判断。
    </div>
    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.search.autoSearchOnChat === true}
        onChange={(event) => updateSearch({ autoSearchOnChat: event.target.checked })}
      />
      对话自动联网（问题涉及最新/是谁/多少钱等）
    </label>
    {draft.search.autoSearchOnChat === true && (
      <label className="settings-check">
        <input
          type="checkbox"
          checked={draft.search.autoSearchAi === true}
          onChange={(event) => updateSearch({ autoSearchAi: event.target.checked })}
        />
        用 AI 判断是否需要联网（更准，但每次多一次小调用）
      </label>
    )}
    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.search.alwaysSearchOnChat === true}
        onChange={(event) => updateSearch({ alwaysSearchOnChat: event.target.checked })}
      />
      每轮对话都联网（最准，但每次都消耗检索额度）
    </label>
  </div>

  <div className="settings-group">
    <div className="settings-group-title">总结前核对（推荐开启）</div>
    <div className="settings-group-desc">
      会从字幕里挑具体数字/术语逐条检索，再让 AI 修正；代价是总结会慢几十秒。
    </div>
    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.search.verifySummary !== false}
        onChange={(event) => updateSearch({ verifySummary: event.target.checked })}
      />
      总结前联网核对字幕
    </label>
    {draft.search.verifySummary !== false && (
      <details className="settings-advanced">
        <summary>核对细节</summary>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={draft.search.aiQueryGeneration !== false}
            onChange={(event) =>
              updateSearch({ aiQueryGeneration: event.target.checked })
            }
          />
          让 AI 挑选待核实项（关闭则只用规则抽数字/术语，省一次小调用）
        </label>
        <div className="settings-field">
          <div className="settings-label">每次核对条数</div>
          <input
            className="settings-input"
            type="number"
            min={1}
            max={20}
            value={draft.search.verifyItemCount || 8}
            onChange={(event) =>
              updateSearch({ verifyItemCount: Number(event.target.value) || 8 })
            }
          />
        </div>
        <div className="settings-label">额外核实查询（每行一条，可留空）</div>
        <textarea
          className="settings-input"
          rows={3}
          placeholder="例如：DeepSeek V4 发布时间"
          value={draft.search.extraVerifyQueries || ''}
          onChange={(event) =>
            updateSearch({ extraVerifyQueries: event.target.value })
          }
        />
      </details>
    )}
  </div>

  <div className="settings-group">
    <div className="settings-group-title">总结时带哪些参考</div>
    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.search.useVideoMeta !== false}
        onChange={(event) => updateSearch({ useVideoMeta: event.target.checked })}
      />
      带视频简介（标题、UP 主、简介）
    </label>
    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.search.useComments === true}
        onChange={(event) => updateSearch({ useComments: event.target.checked })}
      />
      带热门评论（仅作观众观点参考，默认关闭）
    </label>
  </div>

  <details className="settings-advanced">
    <summary>高级设置</summary>
    <div className="settings-hint">
      这些选项会影响检索质量、额度和速度；不确定时保持默认即可。
    </div>
    <div className="settings-inline">
      <div className="settings-field">
        <div className="settings-label">每次结果数</div>
        <input
          className="settings-input"
          type="number"
          min={1}
          max={10}
          value={draft.search.maxResults}
          onChange={(event) => updateSearch({ maxResults: Number(event.target.value) || 5 })}
        />
      </div>
      <div className="settings-field">
        <div className="settings-label">时间范围</div>
        <select
          className="settings-input"
          value={draft.search.timeRange}
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
        checked={draft.search.includeContent}
        onChange={(event) => updateSearch({ includeContent: event.target.checked })}
      />
      包含网页正文（支持的平台；更完整但更慢）
    </label>

    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.search.verify}
        onChange={(event) => updateSearch({ verify: event.target.checked })}
      />
      AI 优化字幕时也联网核对改动（较慢，消耗检索与 AI 额度）
    </label>

    <label className="settings-check">
      <input
        type="checkbox"
        checked={draft.search.keylessFallback !== false}
        onChange={(event) => updateSearch({ keylessFallback: event.target.checked })}
      />
      配置的平台失败时用免费引擎兜底
    </label>
    {draft.search.keylessFallback !== false && (
      <div className="settings-field">
        <div className="settings-label">兜底顺序（exa / anysearch / searxng，逗号分隔）</div>
        <input
          className="settings-input"
          value={(draft.search.keylessOrder || []).join(', ')}
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
        value={draft.search.cacheMinutes}
        onChange={(event) =>
          updateSearch({ cacheMinutes: Number(event.target.value) || 0 })
        }
      />
    </div>
  </details>
</SettingsSection>
  );
}
