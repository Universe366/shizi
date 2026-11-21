import { Download, Trash2, Upload } from 'lucide-react';
import { SEARCH_ENGINES, isSearchEngineId } from '../../../shared/searchEngines';

interface SearchProps {
  engine: string;
  onChange: (value: string) => void;
  onClearHistory: () => void;
}

export function StartPageSearchSettings({ engine, onChange, onClearHistory }: SearchProps) {
  return (
    <section>
      <h4>搜索引擎</h4>
      <select
        className="sc-select"
        value={engine}
        onChange={(event) => {
          const next = event.target.value;
          if (isSearchEngineId(next)) onChange(next);
        }}
      >
        {SEARCH_ENGINES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <div className="sc-hint">自定义引擎的模板在「完整设置 → 外观与浏览器」里配置。</div>
      <button type="button" className="sc-secondary" onClick={onClearHistory}>
        <Trash2 size={13} /> 清空搜索历史
      </button>
    </section>
  );
}

interface BackupProps {
  onExport: () => void;
  onImport: () => void;
}

export function StartPageBackupSettings({ onExport, onImport }: BackupProps) {
  return (
    <section>
      <h4>备份</h4>
      <div className="sc-inline-actions">
        <button type="button" className="sc-secondary" onClick={onExport}>
          <Download size={13} /> 导出起始页
        </button>
        <button type="button" className="sc-secondary" onClick={onImport}>
          <Upload size={13} /> 导入起始页
        </button>
      </div>
      <div className="sc-hint">备份包含快捷方式、背景、搜索引擎与城市。</div>
    </section>
  );
}
