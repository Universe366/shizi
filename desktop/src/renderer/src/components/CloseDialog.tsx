import { useEffect, useRef, useState } from 'react';
import { Minimize2, Power, X } from 'lucide-react';

/** 关闭窗口确认：与应用内弹窗风格一致，替代系统原生对话框。 */
export function CloseDialog({
  open,
  onChoose
}: {
  open: boolean;
  onChoose: (choice: 'tray' | 'quit' | 'cancel', remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const sent = useRef(false);

  useEffect(() => {
    if (open) sent.current = false;
  }, [open]);

  const choose = (choice: 'tray' | 'quit' | 'cancel') => {
    if (sent.current) return;
    sent.current = true;
    try {
      onChoose(choice, remember);
    } catch {
      sent.current = false;
    }
  };

  useEffect(() => {
    if (!open) return;
    window.bsub.closeShown?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') choose('cancel');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, remember, onChoose]);

  if (!open) return null;

  return (
    <div
      className="confirm-backdrop close-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) choose('cancel');
      }}
    >
      <div className="confirm-card close-card" role="dialog" aria-modal="true" aria-label="关闭拾字">
        <div className="close-card-head">
          <span className="close-card-icon">
            <X size={16} />
          </span>
          <div>
            <div className="confirm-title">要关闭拾字吗？</div>
            <div className="confirm-desc">最小化后会留在系统托盘，随时可以点图标回来。</div>
          </div>
        </div>

        <label className="settings-check close-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          记住我的选择，下次不再询问
        </label>

        <div className="close-actions">
          <button className="close-action" onClick={() => choose('tray')}>
            <Minimize2 size={15} />
            <span>
              <strong>最小化到托盘</strong>
              <small>后台继续运行，保留标签与任务</small>
            </span>
          </button>
          <button className="close-action is-danger" onClick={() => choose('quit')}>
            <Power size={15} />
            <span>
              <strong>退出应用</strong>
              <small>结束所有标签页与下载任务</small>
            </span>
          </button>
        </div>

        <div className="close-card-foot">
          <button className="mini-btn" onClick={() => choose('cancel')}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
