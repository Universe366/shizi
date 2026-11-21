import { Plus, X } from 'lucide-react';

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export function StartPageNotesWidget({
  value,
  onChange,
  onHide
}: {
  value: string;
  onChange: (value: string) => void;
  onHide: () => void;
}) {
  return (
    <article className="sc-card sc-notes">
      <header>
        <span>便签</span>
        <button type="button" onClick={onHide}>隐藏</button>
      </header>
      <textarea
        value={value}
        placeholder="随手记点什么…"
        onChange={(event) => onChange(event.target.value)}
      />
    </article>
  );
}

export function StartPageTodoWidget({
  todos,
  draft,
  onDraft,
  onAdd,
  onToggle,
  onRemove
}: {
  todos: TodoItem[];
  draft: string;
  onDraft: (value: string) => void;
  onAdd: () => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <article className="sc-card">
      <header>
        <span>待办</span>
        <span>{todos.filter((item) => !item.done).length} 项</span>
      </header>
      <form
        className="sc-todo-add"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd();
        }}
      >
        <input value={draft} placeholder="添加一项待办，回车确认" onChange={(event) => onDraft(event.target.value)} />
        <button type="submit" title="添加">
          <Plus size={13} />
        </button>
      </form>
      <div className="sc-todo-list">
        {todos.slice(0, 5).map((item) => (
          <label key={item.id} className={item.done ? 'is-done' : ''}>
            <input type="checkbox" checked={item.done} onChange={() => onToggle(item.id)} />
            <span>{item.text}</span>
            <button type="button" title="删除" onClick={() => onRemove(item.id)}>
              <X size={11} />
            </button>
          </label>
        ))}
      </div>
    </article>
  );
}

export function StartPagePomodoroWidget({
  phase,
  left,
  running,
  onToggle,
  onReset
}: {
  phase: 'work' | 'short' | 'long';
  left: number;
  running: boolean;
  onToggle: () => void;
  onReset: () => void;
}) {
  return (
    <article className="sc-card sc-pomodoro">
      <header>
        <span>番茄钟</span>
        <span>{phase === 'work' ? '专注' : phase === 'short' ? '短休' : '长休'}</span>
      </header>
      <div className="sc-pomodoro-time">
        {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
      </div>
      <div className="sc-pomodoro-actions">
        <button type="button" onClick={onToggle}>{running ? '暂停' : '开始'}</button>
        <button type="button" onClick={onReset}>重置</button>
      </div>
    </article>
  );
}
