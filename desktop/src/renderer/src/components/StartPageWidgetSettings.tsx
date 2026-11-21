interface Props {
  weatherOn: boolean;
  city: string;
  hotOn: boolean;
  showRecent: boolean;
  showTabs: boolean;
  showNotes: boolean;
  showTodo: boolean;
  showPomodoro: boolean;
  showQuote: boolean;
  onWeather: (value: boolean) => void;
  onCity: (value: string) => void;
  onCityBlur: () => void;
  onHot: (value: boolean) => void;
  onRecent: (value: boolean) => void;
  onTabs: (value: boolean) => void;
  onNotes: (value: boolean) => void;
  onTodo: (value: boolean) => void;
  onPomodoro: (value: boolean) => void;
  onQuote: (value: boolean) => void;
}

/** 起始页小组件开关与天气城市。 */
export function StartPageWidgetSettings({
  weatherOn,
  city,
  hotOn,
  showRecent,
  showTabs,
  showNotes,
  showTodo,
  showPomodoro,
  showQuote,
  onWeather,
  onCity,
  onCityBlur,
  onHot,
  onRecent,
  onTabs,
  onNotes,
  onTodo,
  onPomodoro,
  onQuote
}: Props) {
  return (
    <section>
      <h4>小组件</h4>
      <label className="sc-check">
        <input
          type="checkbox"
          checked={weatherOn}
          onChange={(event) => onWeather(event.target.checked)}
        />
        天气
      </label>
      <label className="sc-field">
        <span>天气城市</span>
        <input value={city} onChange={(event) => onCity(event.target.value)} onBlur={onCityBlur} />
      </label>
      <label className="sc-check">
        <input type="checkbox" checked={hotOn} onChange={(event) => onHot(event.target.checked)} />
        B 站热搜
      </label>
      <label className="sc-check">
        <input
          type="checkbox"
          checked={showRecent}
          onChange={(event) => onRecent(event.target.checked)}
        />
        最近打开
      </label>
      <label className="sc-check">
        <input
          type="checkbox"
          checked={showTabs}
          onChange={(event) => onTabs(event.target.checked)}
        />
        打开的标签
      </label>
      <label className="sc-check">
        <input
          type="checkbox"
          checked={showNotes}
          onChange={(event) => onNotes(event.target.checked)}
        />
        便签
      </label>
      <label className="sc-check">
        <input
          type="checkbox"
          checked={showTodo}
          onChange={(event) => onTodo(event.target.checked)}
        />
        待办
      </label>
      <label className="sc-check">
        <input
          type="checkbox"
          checked={showPomodoro}
          onChange={(event) => onPomodoro(event.target.checked)}
        />
        番茄钟
      </label>
      <label className="sc-check">
        <input
          type="checkbox"
          checked={showQuote}
          onChange={(event) => onQuote(event.target.checked)}
        />
        每日一句
      </label>
    </section>
  );
}
