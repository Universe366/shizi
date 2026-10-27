import { Check, ImagePlus, Sparkles, Trash2, X } from 'lucide-react';
import { WALLPAPERS, type WallpaperId } from './model';

interface WallpaperDrawerProps {
  open: boolean;
  wallpaper: WallpaperId;
  wallpaperImage: string;
  bingWallpaper: { url: string; copyright: string } | null;
  blur: number;
  dim: number;
  minimal: boolean;
  onPick: (id: WallpaperId) => void;
  onUpload: (file: File) => void;
  onClear: () => void;
  onBlur: (value: number) => void;
  onDim: (value: number) => void;
  onMinimal: (value: boolean) => void;
  onClose: () => void;
}

/** 外观抽屉：壁纸、背景效果、极简模式。 */
export function WallpaperDrawer({
  open,
  wallpaper,
  wallpaperImage,
  bingWallpaper,
  blur,
  dim,
  minimal,
  onPick,
  onUpload,
  onClear,
  onBlur,
  onDim,
  onMinimal,
  onClose
}: WallpaperDrawerProps) {
  if (!open) return null;

  return (
    <div className="start-drawer-backdrop" onMouseDown={onClose}>
      <aside className="start-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header className="start-drawer-head">
          <span>外观</span>
          <button className="start-icon-btn" title="关闭" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        <section className="start-drawer-section">
          <div className="start-drawer-label">壁纸</div>
          <div className="start-wallpaper-grid">
            {WALLPAPERS.map((item) => {
              const active = !wallpaperImage && wallpaper === item.id;
              return (
                <button
                  key={item.id}
                  className={`start-wallpaper-thumb start-wallpaper-${item.id}${active ? ' is-active' : ''}`}
                  title={item.label}
                  onClick={() => onPick(item.id)}
                >
                  {item.id === 'bing' && bingWallpaper && (
                    <img src={bingWallpaper.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  )}
                  <span className="start-wallpaper-name">{item.label}</span>
                  {active && (
                    <span className="start-wallpaper-check">
                      <Check size={12} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="start-drawer-row">
            <label className="start-upload">
              <ImagePlus size={14} /> 上传图片
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
            {wallpaperImage && (
              <button className="start-link-btn is-danger" onClick={onClear}>
                <Trash2 size={13} /> 清除自定义壁纸
              </button>
            )}
          </div>
        </section>

        <section className="start-drawer-section">
          <div className="start-drawer-label">
            背景效果
            <span className="start-drawer-value">
              {blur}px · {Math.round(dim * 100)}%
            </span>
          </div>
          <label className="start-range">
            <span>模糊</span>
            <input
              type="range"
              min={0}
              max={24}
              step={2}
              value={blur}
              onChange={(event) => onBlur(Number(event.target.value))}
            />
          </label>
          <label className="start-range">
            <span>遮罩</span>
            <input
              type="range"
              min={0}
              max={80}
              step={5}
              value={Math.round(dim * 100)}
              onChange={(event) => onDim(Number(event.target.value) / 100)}
            />
          </label>
        </section>

        <section className="start-drawer-section">
          <button
            className={`start-switch-row${minimal ? ' is-on' : ''}`}
            onClick={() => onMinimal(!minimal)}
          >
            <span className="start-switch-row-icon">
              <Sparkles size={14} />
            </span>
            <span className="start-switch-row-text">
              极简模式
              <em>只保留时钟、搜索和快捷方式</em>
            </span>
            <span className="start-switch" aria-hidden="true" />
          </button>
        </section>
      </aside>
    </div>
  );
}
