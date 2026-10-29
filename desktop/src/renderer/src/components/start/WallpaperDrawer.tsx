import { useState } from 'react';
import { Check, ImagePlus, Link2, Sparkles, Trash2, X } from 'lucide-react';
import {
  WALLPAPERS,
  formatBingDate,
  type ClockOptions,
  type StartWallpaperMedia,
  type WallpaperId
} from './model';

const MEDIA_LABELS: Record<StartWallpaperMedia['kind'], string> = {
  image: '图片',
  gif: 'GIF 动图',
  video: '视频'
};

interface WallpaperDrawerProps {
  open: boolean;
  wallpaper: WallpaperId;
  wallpaperImage: string;
  wallpaperMedia: StartWallpaperMedia | null;
  wallpaperPreview: string;
  wallpaperPreviewKind: StartWallpaperMedia['kind'];
  bingGallery: Array<{ url: string; copyright: string; date: string }>;
  bingSelection: { url: string; copyright: string } | null;
  onPickBing: (image: { url: string; copyright: string; date: string }) => void;
  onResetBing: () => void;
  inkMode: 'auto' | 'light' | 'dark';
  onInkMode: (mode: 'auto' | 'light' | 'dark') => void;
  clock: ClockOptions;
  onClock: (patch: Partial<ClockOptions>) => void;
  bingWallpaper: { url: string; copyright: string } | null;
  blur: number;
  dim: number;
  minimal: boolean;
  onPick: (id: WallpaperId) => void;
  onUpload: (file: File) => void;
  onUploadUrl: (url: string) => void;
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
  wallpaperMedia,
  wallpaperPreview,
  wallpaperPreviewKind,
  bingGallery,
  bingSelection,
  onPickBing,
  onResetBing,
  inkMode,
  onInkMode,
  clock,
  onClock,
  bingWallpaper,
  blur,
  dim,
  minimal,
  onPick,
  onUpload,
  onUploadUrl,
  onClear,
  onBlur,
  onDim,
  onMinimal,
  onClose
}: WallpaperDrawerProps) {
  const [urlDraft, setUrlDraft] = useState('');

  if (!open) return null;

  const applyUrl = () => {
    if (!urlDraft.trim()) return;
    onUploadUrl(urlDraft.trim());
    setUrlDraft('');
  };

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
              const active = !wallpaperImage && !wallpaperMedia && wallpaper === item.id;
              return (
                <button
                  key={item.id}
                  className={`start-wallpaper-thumb start-wallpaper-${item.id}${active ? ' is-active' : ''}`}
                  title={
                    item.id === 'bing' && bingWallpaper?.copyright
                      ? `${item.label} · ${bingWallpaper.copyright}`
                      : item.label
                  }
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

          <div className="start-drawer-label">必应图库</div>
          {bingGallery.length ? (
            <div className="start-bing-grid">
              {bingGallery.map((image) => (
                <button
                  key={image.url}
                  className={`start-bing-thumb${
                    bingSelection?.url === image.url ? ' is-active' : ''
                  }`}
                  title={image.copyright}
                  onClick={() => onPickBing(image)}
                >
                  <img src={image.url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  <span>{formatBingDate(image.date)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="start-drawer-hint">图库加载中…</div>
          )}
          {bingSelection && (
            <button className="start-link-btn" onClick={onResetBing}>
              恢复每日一图
            </button>
          )}

          {wallpaper === 'bing' && bingWallpaper?.copyright && (
            <div className="start-drawer-hint">{bingWallpaper.copyright}</div>
          )}

          <div className="start-drawer-row">
            <label className="start-upload">
              <ImagePlus size={14} /> 上传图片 / GIF / 视频
              <input
                type="file"
                accept="image/*,video/mp4,video/webm,video/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
            {(wallpaperImage || wallpaperMedia) && (
              <button className="start-link-btn is-danger" onClick={onClear}>
                <Trash2 size={13} /> 清除自定义壁纸
              </button>
            )}
          </div>

          {wallpaperPreview && (
            <div className="start-drawer-preview">
              {wallpaperPreviewKind === 'video' ? (
                <video src={wallpaperPreview} muted loop autoPlay playsInline />
              ) : (
                <img src={wallpaperPreview} alt="" />
              )}
              <span>
                {wallpaperMedia
                  ? `${MEDIA_LABELS[wallpaperMedia.kind]} · ${
                      wallpaperMedia.source === 'url' ? '直链' : '本地文件'
                    }`
                  : '自定义图片'}
              </span>
            </div>
          )}

          <div className="start-drawer-url">
            <Link2 size={13} />
            <input
              value={urlDraft}
              placeholder="或粘贴图片 / GIF / 视频直链"
              aria-label="壁纸直链"
              onChange={(event) => setUrlDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applyUrl();
              }}
            />
            <button onClick={applyUrl} disabled={!urlDraft.trim()}>
              应用
            </button>
          </div>

          <div className="start-drawer-hint">
            {wallpaperMedia
              ? `当前：${MEDIA_LABELS[wallpaperMedia.kind]} · ${
                  wallpaperMedia.source === 'url' ? '直链' : '本地文件'
                }`
              : 'GIF / 视频会保存在本机，不上传；直链需要允许跨域才能自动配色。'}
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
          <div className="start-ink-row">
            <span className="start-ink-label">文字配色</span>
            <div className="start-ink-toggle">
              {(
                [
                  ['auto', '自动'],
                  ['light', '浅色字'],
                  ['dark', '深色字']
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={inkMode === id ? 'is-active' : ''}
                  onClick={() => onInkMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="start-drawer-section">
          <div className="start-drawer-label">时钟</div>
          <label className="start-check-row">
            <input
              type="checkbox"
              checked={clock.seconds}
              onChange={(event) => onClock({ seconds: event.target.checked })}
            />
            显示秒
          </label>
          <label className="start-check-row">
            <input
              type="checkbox"
              checked={clock.hour12}
              onChange={(event) => onClock({ hour12: event.target.checked })}
            />
            12 小时制
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
