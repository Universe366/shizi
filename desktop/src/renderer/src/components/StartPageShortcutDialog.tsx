interface Draft {
  id?: string;
  label: string;
  url: string;
  group: string;
  folder: string;
}

interface Props {
  draft: Draft;
  groups: string[];
  folders: string[];
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}

/** 起始页快捷方式新增/编辑弹窗。 */
export function StartPageShortcutDialog({
  draft,
  groups,
  folders,
  onChange,
  onClose,
  onSave
}: Props) {
  return (
    <div className="sc-modal-mask" onPointerDown={onClose}>
      <form
        className="sc-modal"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <h3>{draft.id ? '编辑快捷方式' : '添加快捷方式'}</h3>
        <label>
          名称
          <input
            value={draft.label}
            placeholder="例如 哔哩哔哩"
            onChange={(event) => onChange({ ...draft, label: event.target.value })}
          />
        </label>
        <label>
          网址
          <input
            value={draft.url}
            placeholder="https://www.bilibili.com/"
            onChange={(event) => onChange({ ...draft, url: event.target.value })}
          />
        </label>
        <label>
          分组
          <input
            value={draft.group}
            list="sc-groups"
            placeholder="可选，例如 学习"
            onChange={(event) => onChange({ ...draft, group: event.target.value })}
          />
          <datalist id="sc-groups">
            {groups.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>
        <label>
          文件夹
          <input
            value={draft.folder}
            list="sc-folders"
            placeholder="可选，例如 视频"
            onChange={(event) => onChange({ ...draft, folder: event.target.value })}
          />
          <datalist id="sc-folders">
            {folders.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>
        <div className="sc-modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="is-primary">
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
