import { useEffect } from 'react';
import { Library, X } from 'lucide-react';
import { LibraryPanel } from './LibraryPanel';

/** 库（独立整页）：字幕/总结/笔记/合集/历史/导入/导出，不再挤在侧栏里。 */
export function LibraryPage({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="settings-page library-page">
      <header className="settings-page-head">
        <div className="settings-page-title">
          <Library size={16} />
          <div>
            <div className="settings-page-name">库</div>
            <div className="settings-page-desc">
              已入库的字幕、总结、笔记、合集与历史；跨视频检索和导出都在这里
            </div>
          </div>
        </div>
        <div className="settings-page-head-actions">
          <button className="mini-btn" onClick={onClose} title="关闭库（Esc）">
            <X size={12} /> 关闭
          </button>
        </div>
      </header>
      <div className="library-page-body">
        <LibraryPanel />
      </div>
    </div>
  );
}
