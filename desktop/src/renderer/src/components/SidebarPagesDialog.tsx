import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { SidebarPage } from '../../../shared/types';
import { nextSidebarPageId } from '../../../shared/sidebarPages';

interface Props {
  open: boolean;
  pages: SidebarPage[];
  onClose: () => void;
}

/** 侧栏网页管理：添加/删除自定义网页。 */
export function SidebarPagesDialog({ open, pages, onClose }: Props) {
  const [list, setList] = useState<SidebarPage[]>(pages);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setList(pages);
    setError('');
    setNotice('');
  }, [open, pages]);

  const save = async (next: SidebarPage[]) => {
    setBusy(true);
    const response = await window.bsub.saveSidebarPages(next);
    setBusy(false);
    if (!response.ok) {
      setError(response.error || '保存失败');
      return false;
    }
    setList(response.data);
    setError('');
    return true;
  };

  const add = async () => {
    const raw = url.trim();
    if (!raw) {
      setError('请填写网址');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      setError('网址格式不对');
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      setError('只支持 http/https 网址');
      return;
    }
    const ok = await save([
      ...list,
      {
        id: nextSidebarPageId(list),
        title: title.trim() || parsed.hostname.replace(/^www\./i, ''),
        url: parsed.toString()
      }
    ]);
    if (ok) {
      setTitle('');
      setUrl('');
    }
  };

  if (!open) return null;

  return (
    <div
      className="sidebar-pages-backdrop"
      role="dialog"
      aria-label="侧栏网页"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sidebar-pages-card">
        <div className="sidebar-pages-head">
          <strong>侧栏网页</strong>
          <button className="mini-btn" title="关闭" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
        <div className="settings-hint">
          侧栏网页使用独立的登录分区，与普通标签页互不影响；不活跃 30 分钟会自动休眠，切回时重新加载。
        </div>
        <div className="sidebar-pages-list">
          {list.map((page) => (
            <div key={page.id} className="sidebar-pages-row">
              <div className="sidebar-pages-info">
                <div className="sidebar-pages-title">{page.title}</div>
                <div className="sidebar-pages-url" title={page.url}>
                  {page.url}
                </div>
              </div>
              <button
                className="mini-btn"
                title="删除这个网页"
                disabled={busy}
                onClick={() => void save(list.filter((item) => item.id !== page.id))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {!list.length && <div className="settings-hint">还没有网页，可以在下面添加。</div>}
        </div>
        <div className="sidebar-pages-add">
          <input
            className="settings-input"
            placeholder="名称（可留空）"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <input
            className="settings-input"
            placeholder="https://chat.deepseek.com/"
            value={url}
            spellCheck={false}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void add();
            }}
          />
          <button className="mini-btn" disabled={busy} onClick={() => void add()}>
            添加
          </button>
        </div>
        {error && <div className="sidebar-pages-error">{error}</div>}
        {notice && <div className="settings-hint">{notice}</div>}
        <div className="sidebar-pages-foot">
          <button
            className="mini-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const response = await window.bsub.clearSidebarWebData();
              setBusy(false);
              setNotice(response.ok ? '已清除侧栏网页的登录数据' : response.error || '清除失败');
            }}
          >
            清除登录数据
          </button>
        </div>
      </div>
    </div>
  );
}
