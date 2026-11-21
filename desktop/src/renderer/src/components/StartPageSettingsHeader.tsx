export type StartSheetTab = 'look' | 'search' | 'links' | 'widgets' | 'data';

const TABS: Array<[StartSheetTab, string]> = [
  ['look', '外观'],
  ['search', '搜索'],
  ['links', '快捷方式'],
  ['widgets', '小组件'],
  ['data', '数据']
];

interface TabsProps {
  value: StartSheetTab;
  onChange: (value: StartSheetTab) => void;
}

export function StartPageSettingsTabs({ value, onChange }: TabsProps) {
  return (
    <div className="sc-sheet-tabs" role="tablist">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          className={value === id ? 'is-active' : ''}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

interface OpenProps {
  onOpenSettings: () => void;
  onOpenLibrary: () => void;
  onOpenHistory: () => void;
  onOpenBookmarks: () => void;
  onOpenDownloads: () => void;
  onOpenTasks: () => void;
  onOpenGlobalSearch: () => void;
}

export function StartPageOpenLinks(props: OpenProps) {
  return (
    <section>
      <h4>打开</h4>
      <div className="sc-sheet-actions">
        <button type="button" onClick={props.onOpenSettings}>完整设置</button>
        <button type="button" onClick={props.onOpenLibrary}>工作台</button>
        <button type="button" onClick={props.onOpenHistory}>历史记录</button>
        <button type="button" onClick={props.onOpenBookmarks}>书签</button>
        <button type="button" onClick={props.onOpenDownloads}>下载</button>
        <button type="button" onClick={props.onOpenTasks}>任务</button>
        <button type="button" onClick={props.onOpenGlobalSearch}>全局搜索</button>
      </div>
      <div className="sc-hint">更多设置（主题、代理、快捷键、数据目录）在「完整设置」里。</div>
    </section>
  );
}
