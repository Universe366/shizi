import { CloudSun, Command, Settings, X } from 'lucide-react';

interface TopbarProps {
  weatherOn: boolean;
  weather: { temperature: number; city?: string; description: string } | null;
  city: string;
  onCommand: () => void;
  onSettings: () => void;
  onClose: () => void;
}

export function StartPageTopbar({
  weatherOn,
  weather,
  city,
  onCommand,
  onSettings,
  onClose
}: TopbarProps) {
  return (
    <header className="sc-topbar">
      <div className="sc-weather">
        {weatherOn && weather && (
          <>
            <CloudSun size={16} />
            <span className="sc-weather-temp">{Math.round(weather.temperature)}°</span>
            <span className="sc-weather-city">{weather.city || city}</span>
            <span className="sc-weather-desc">{weather.description}</span>
          </>
        )}
      </div>
      <div className="sc-actions">
        <button type="button" className="sc-icon-btn" title="命令面板" onClick={onCommand}>
          <Command size={16} />
        </button>
        <button type="button" className="sc-icon-btn" title="自定义起始页" onClick={onSettings}>
          <Settings size={16} />
        </button>
        <button type="button" className="sc-icon-btn" title="关闭起始页（Esc）" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </header>
  );
}

interface ClockProps {
  time: string;
  greeting: string;
  dateText: string;
}

export function StartPageClock({ time, greeting: text, dateText }: ClockProps) {
  return (
    <>
      <div className="sc-clock">{time}</div>
      <div className="sc-sub">
        {text}，{dateText}
      </div>
    </>
  );
}
