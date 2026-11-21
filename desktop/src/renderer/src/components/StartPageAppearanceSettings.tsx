import { Upload } from 'lucide-react';

interface Wallpaper {
  id: string;
  label: string;
}

interface Props {
  wallpapers: Wallpaper[];
  wallpaper: string;
  customWallpaper: boolean;
  dim: number;
  iconSize: 'small' | 'medium' | 'large';
  labels: boolean;
  showSeconds: boolean;
  onWallpaper: (id: string) => void;
  onUpload: () => void;
  onResetWallpaper: () => void;
  onDim: (value: number) => void;
  onIconSize: (value: 'small' | 'medium' | 'large') => void;
  onLabels: (value: boolean) => void;
  onShowSeconds: (value: boolean) => void;
}

/** 起始页外观：壁纸、暗度、图标大小、标签与时钟。 */
export function StartPageAppearanceSettings({
  wallpapers,
  wallpaper,
  customWallpaper,
  dim,
  iconSize,
  labels,
  showSeconds,
  onWallpaper,
  onUpload,
  onResetWallpaper,
  onDim,
  onIconSize,
  onLabels,
  onShowSeconds
}: Props) {
  return (
    <>
      <section>
        <h4>背景</h4>
        <div className="sc-wall-grid">
          {wallpapers.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sc-wall sc-wall-${item.id}${wallpaper === item.id ? ' is-active' : ''}`}
              onClick={() => onWallpaper(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="sc-inline-actions">
          <button type="button" className="sc-secondary" onClick={onUpload}>
            <Upload size={13} /> 上传图片
          </button>
          {customWallpaper && (
            <button type="button" className="sc-secondary" onClick={onResetWallpaper}>
              恢复默认背景
            </button>
          )}
        </div>
        <label className="sc-field">
          <span>背景暗度 {Math.round(dim * 100)}%</span>
          <input
            type="range"
            min={0}
            max={0.7}
            step={0.05}
            value={dim}
            onChange={(event) => onDim(Number(event.target.value))}
          />
        </label>
      </section>

      <section>
        <h4>布局</h4>
        <div className="sc-segment">
          {([
            ['small', '小图标'],
            ['medium', '中图标'],
            ['large', '大图标']
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={iconSize === id ? 'is-active' : ''}
              onClick={() => onIconSize(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="sc-check">
          <input
            type="checkbox"
            checked={labels}
            onChange={(event) => onLabels(event.target.checked)}
          />
          显示快捷方式名称
        </label>
        <label className="sc-check">
          <input
            type="checkbox"
            checked={showSeconds}
            onChange={(event) => onShowSeconds(event.target.checked)}
          />
          时钟显示秒
        </label>
      </section>
    </>
  );
}
