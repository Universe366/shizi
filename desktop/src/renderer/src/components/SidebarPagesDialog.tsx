import { useEffect, useState } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import type { SidebarPage } from '../../../shared/types';
import { SIDEBAR_PAGE_LIMIT, nextSidebarPageId } from '../../../shared/sidebarPages';

interface Props {
  open: boolean;
  pages: SidebarPage[];
  onClose: () => void;
}

/** 侧栏网页管理：添加/编辑/删除自定义网页。 */
export function SidebarPagesDialog({ open, pages, onClose }: Props) {
  const [list, setList] = useState<SidebarPage[]>(pages);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setList(pages);
    setEditingId(null);
    setTitle('');
    setUrl('');
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

  const resetForm = () => {
    setEditingId(null);
    setTitle('');
    setUrl('');
  };

  const submit = async () => {
    let raw = url.trim();
    if (!raw) {
      setError('请填写网址');
      return;
    }
    // 明确拒绝 javascript:/data:/file: 等协议；其余不带协议的地址补 https://。
    if (/^(javascript|data|file|ftp|mailto|blob|chrome|edge|about):/i.test(raw)) {
      setError('只支持 http/https 网址');
      return;
    }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
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
    const href = parsed.toString();
    if (list.some((item) => item.url === href && item.id !== editingId)) {
      setError('这个网址已经在侧栏里了');
      return;
    }
    if (!editingId && list.length >= SIDEBAR_PAGE_LIMIT) {
      setError(`最多添加 ${SIDEBAR_PAGE_LIMIT} 个侧栏网页`);
      return;
    }
    const page: SidebarPage = {
      id: editingId || nextSidebarPageId(list),
      title: title.trim() || parsed.hostname.replace(/^www\./i, ''),
      url: href
    };
    const next = editingId
      ? list.map((item) => (item.id === editingId ? page : item))
      : [...list, page];
    const ok = await save(next);
    if (ok) resetForm();
  };

  const startEdit = (page: SidebarPage) => {
    setEditingId(page.id);
    setTitle(page.title);
    setUrl(page.url);
    setError('');
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
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
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
            <div
              key={page.id}
              className={`sidebar-pages-row${editingId === page.id ? ' is-editing' : ''}`}
            >
              <div className="sidebar-pages-info">
                <div className="sidebar-pages-title">{page.title}</div>
                <div className="sidebar-pages-url" title={page.url}>
                  {page.url}
                </div>
              </div>
              <button
                className="mini-btn"
                title="编辑这个网页"
                disabled={busy}
                onClick={() => startEdit(page)}
              >
                <Pencil size={13} />
              </button>
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
              if (event.key === 'Enter') void submit();
            }}
          />
          <button className="mini-btn" disabled={busy} onClick={() => void submit()}>
            {editingId ? '保存' : '添加'}
          </button>
          {editingId && (
            <button className="mini-btn" disabled={busy} onClick={resetForm}>
              取消
            </button>
          )}
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
