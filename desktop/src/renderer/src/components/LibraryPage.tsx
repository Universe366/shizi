import { useEffect } from 'react';
import { Library, X } from 'lucide-react';
import { LibraryPanel } from './LibraryPanel';

/** 工作台：只剩资料库。文件转换与成片处理已移除（本地视频直接用侧栏打开）。 */
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
            <div className="settings-page-name">工作台</div>
            <div className="settings-page-desc">
              字幕、总结与视频资料库；跨视频检索、导出与清理都在这里。
            </div>
          </div>
        </div>
        <div className="settings-page-head-actions">
          <button className="mini-btn" onClick={onClose} title="关闭工作台（Esc）">
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
