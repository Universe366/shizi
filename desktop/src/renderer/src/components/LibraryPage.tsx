import { useEffect, useState } from 'react';
import { Clapperboard, Library, X } from 'lucide-react';
import { LibraryPanel } from './LibraryPanel';
import { RendersPanel } from './RendersPanel';

/** 工作台：资料库 + 成片，承接跨视频的检索、导出与合成。 */
export function LibraryPage({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'library' | 'renders'>('library');

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
              资料库与成片：跨视频检索、字幕/总结/笔记、导出与合成都在这里
            </div>
          </div>
        </div>
        <div className="settings-page-head-actions">
          <button className="mini-btn" onClick={onClose} title="关闭工作台（Esc）">
            <X size={12} /> 关闭
          </button>
        </div>
      </header>

      <div className="workbench-tabs">
        <button
          className={`workbench-tab${tab === 'library' ? ' is-active' : ''}`}
          onClick={() => setTab('library')}
        >
          <Library size={13} /> 资料库
        </button>
        <button
          className={`workbench-tab${tab === 'renders' ? ' is-active' : ''}`}
          onClick={() => setTab('renders')}
        >
          <Clapperboard size={13} /> 成片
        </button>
      </div>

      {tab === 'library' ? (
        <div className="library-page-body">
          <LibraryPanel />
        </div>
      ) : (
        <RendersPanel />
      )}
    </div>
  );
}
