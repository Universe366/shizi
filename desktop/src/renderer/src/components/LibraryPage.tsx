import { useEffect, useState } from 'react';
import { BookOpen, Clapperboard, FileCog, Library, X } from 'lucide-react';
import { LibraryPanel } from './LibraryPanel';
import { StudioPanel } from './StudioPanel';
import { KnowledgePanel } from './KnowledgePanel';
import { FileConvertPanel } from './FileConvertPanel';

/** 工作台：资料库 + 知识库问答 + 文件转换 + 成片与本地处理。 */
export function LibraryPage({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'library' | 'knowledge' | 'convert' | 'studio'>('library');

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
              资料库、本地视频处理与成片；跨视频检索、字幕/总结/笔记、导出与合成都在这里
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
          className={`workbench-tab${tab === 'knowledge' ? ' is-active' : ''}`}
          onClick={() => setTab('knowledge')}
        >
          <BookOpen size={13} /> 知识库
        </button>
        <button
          className={`workbench-tab${tab === 'convert' ? ' is-active' : ''}`}
          onClick={() => setTab('convert')}
        >
          <FileCog size={13} /> 文件转换
        </button>
        <button
          className={`workbench-tab${tab === 'studio' ? ' is-active' : ''}`}
          onClick={() => setTab('studio')}
        >
          <Clapperboard size={13} /> 成片与处理
        </button>
      </div>

      {tab === 'library' ? (
        <div className="library-page-body">
          <LibraryPanel />
        </div>
      ) : tab === 'knowledge' ? (
        <div className="library-page-body">
          <KnowledgePanel />
        </div>
      ) : tab === 'convert' ? (
        <div className="library-page-body">
          <FileConvertPanel />
        </div>
      ) : (
        <div className="studio-panel">
          <StudioPanel />
        </div>
      )}
    </div>
  );
}
