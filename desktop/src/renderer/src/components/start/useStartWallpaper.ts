import { useEffect, useRef, useState } from 'react';
import type { StartWallpaperMedia } from '../../../../shared/types';
import {
  imageLuminance,
  inkForLuminance,
  videoLuminance,
  wallpaperMediaFromUrl,
  type InkMode,
  type WallpaperId
} from './model';
import { clearWallpaperBlob, loadWallpaperBlob, saveWallpaperBlob } from './wallpaperStore';

export interface BingGalleryItem {
  url: string;
  copyright: string;
  date: string;
}

const INK_KEY = 'start-ink-mode';
const BING_FAV_KEY = 'start-bing-favorites';
const ROTATE_KEY = 'start-bing-rotate';
const GALLERY_KEY = 'start-gallery-source';

export type GallerySource = 'bing' | 'gradient' | 'picsum' | 'wallhaven';

function readGallerySource(): GallerySource {
  try {
    const value = localStorage.getItem(GALLERY_KEY);
    return value === 'gradient' || value === 'picsum' || value === 'wallhaven'
      ? value
      : 'bing';
  } catch {
    return 'bing';
  }
}

const GRADIENTS = [
  { name: '暮色', from: '#1e3a8a', to: '#f472b6' },
  { name: '青岚', from: '#064e3b', to: '#a7f3d0' },
  { name: '暖沙', from: '#7c2d12', to: '#fde68a' },
  { name: '夜航', from: '#0f172a', to: '#334155' },
  { name: '薄荷', from: '#134e4a', to: '#99f6e4' },
  { name: '紫雾', from: '#4c1d95', to: '#c4b5fd' },
  { name: '落日', from: '#9a3412', to: '#fb923c' },
  { name: '深海', from: '#082f49', to: '#38bdf8' }
];

function gradientImage(from: string, to: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs><rect width="1920" height="1080" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function readInkMode(): 'auto' | InkMode {
  try {
    const value = localStorage.getItem(INK_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

function readBingFavorites(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BING_FAV_KEY) || '[]');
    return Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string').slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

function readRotateMinutes(): number {
  try {
    const value = Number(localStorage.getItem(ROTATE_KEY));
    return [0, 5, 15, 30, 60].includes(value) ? value : 0;
  } catch {
    return 0;
  }
}

interface WallpaperOptions {
  patchGeneral: (patch: Record<string, unknown>) => Promise<void>;
  showNotice: (text: string, undo?: () => void) => void;
}

/** 起始页壁纸：预设 / 本地上传 / 直链 / 必应图库 / 收藏轮播 / 墨色。 */
export function useStartWallpaper({ patchGeneral, showNotice }: WallpaperOptions) {
  const [wallpaper, setWallpaper] = useState<WallpaperId>('aurora');
  const [wallpaperImage, setWallpaperImage] = useState('');
  const [wallpaperMedia, setWallpaperMedia] = useState<StartWallpaperMedia | null>(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [ink, setInk] = useState<InkMode | null>(null);
  const [inkMode, setInkMode] = useState<'auto' | InkMode>(readInkMode);
  const [wallpaperBroken, setWallpaperBroken] = useState(false);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const [bingWallpaper, setBingWallpaper] = useState<{ url: string; copyright: string } | null>(
    null
  );
  const [bingGallery, setBingGallery] = useState<BingGalleryItem[]>([]);
  const [bingGalleryState, setBingGalleryState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [bingSelection, setBingSelection] = useState<{ url: string; copyright: string } | null>(
    null
  );
  const [bingFavorites, setBingFavorites] = useState<string[]>(readBingFavorites);
  const [rotateMinutes, setRotateMinutes] = useState(readRotateMinutes);
  const [gallerySource, setGallerySource] = useState<GallerySource>(readGallerySource);
  const applyBingRef = useRef<(image: BingGalleryItem, silent: boolean) => void>(() => undefined);
  const patchRef = useRef(patchGeneral);
  patchRef.current = patchGeneral;
  const noticeRef = useRef(showNotice);
  noticeRef.current = showNotice;

  useEffect(() => {
    if (!wallpaperOpen || bingGallery.length || bingGalleryState === 'error') return;
    if (gallerySource === 'gradient') {
      setBingGallery(
        GRADIENTS.map((item) => ({
          url: gradientImage(item.from, item.to),
          copyright: `拾字渐变 · ${item.name}`,
          date: ''
        }))
      );
      setBingGalleryState('idle');
      return;
    }
    let alive = true;
    void window.bsub
      .startGallery?.(gallerySource)
      .then((response) => {
        if (!alive) return;
        if (response?.ok && response.data.length) setBingGallery(response.data);
        else setBingGalleryState('error');
      })
      .catch(() => {
        if (alive) setBingGalleryState('error');
      });
    return () => {
      alive = false;
    };
  }, [wallpaperOpen, bingGallery.length, bingGalleryState, gallerySource]);

  useEffect(() => {
    if (!rotateMinutes || wallpaper !== 'bing' || wallpaperMedia || wallpaperImage) return;
    const pool: BingGalleryItem[] = bingFavorites.length
      ? bingFavorites.map(
          (url) =>
            bingGallery.find((item) => item.url === url) || {
              url,
              copyright: '',
              date: ''
            }
        )
      : bingGallery;
    if (pool.length < 2) return;
    const timer = window.setInterval(() => {
      const index = pool.findIndex((item) => item.url === bingSelection?.url);
      applyBingRef.current(pool[(index + 1) % pool.length], true);
    }, rotateMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [
    rotateMinutes,
    wallpaper,
    wallpaperMedia,
    wallpaperImage,
    bingFavorites,
    bingGallery,
    bingSelection
  ]);

  useEffect(() => {
    if (wallpaper !== 'bing' || wallpaperImage) return;
    let alive = true;
    void window.bsub.startBingWallpaper().then((response) => {
      if (alive && response.ok) setBingWallpaper(response.data);
    });
    return () => {
      alive = false;
    };
  }, [wallpaper, wallpaperImage]);

  useEffect(() => {
    let alive = true;
    let created = '';
    if (!wallpaperMedia) {
      setMediaUrl('');
      return;
    }
    if (wallpaperMedia.source === 'url') {
      setMediaUrl(wallpaperMedia.url || '');
      return;
    }
    void loadWallpaperBlob()
      .then((blob) => {
        if (!alive || !blob) return;
        created = URL.createObjectURL(blob);
        setMediaUrl(created);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [wallpaperMedia]);

  useEffect(() => {
    let alive = true;
    const videoSource = wallpaperMedia?.kind === 'video' ? mediaUrl : '';
    const imageSource = wallpaperMedia
      ? mediaUrl
      : wallpaperImage ||
        (wallpaper === 'bing' ? bingSelection?.url || bingWallpaper?.url || '' : '');
    if (!videoSource && !imageSource) {
      setInk(null);
      return;
    }
    const crossOrigin =
      Boolean(wallpaperMedia && wallpaperMedia.source === 'url') || wallpaper === 'bing';
    const task = videoSource ? videoLuminance(videoSource) : imageLuminance(imageSource, crossOrigin);
    void task.then((value) => {
      if (alive) setInk(inkForLuminance(value));
    });
    return () => {
      alive = false;
    };
  }, [wallpaperMedia, mediaUrl, wallpaperImage, wallpaper, bingWallpaper, bingSelection]);

  const videoBackground = wallpaperMedia?.kind === 'video' ? mediaUrl : '';
  const backgroundImage = wallpaperMedia
    ? wallpaperMedia.kind === 'video'
      ? ''
      : mediaUrl
    : wallpaperImage ||
      (wallpaper === 'bing' ? bingSelection?.url || bingWallpaper?.url || '' : '');
  const fallbackBackground =
    wallpaper === 'bing' && bingSelection ? bingWallpaper?.url || '' : '';
  const displayBackground = wallpaperBroken ? fallbackBackground : backgroundImage;
  const displayVideo = wallpaperBroken ? '' : videoBackground;
  const effectiveInk = inkMode === 'auto' ? ink : inkMode;
  const wallpaperPreview = wallpaperMedia ? mediaUrl : wallpaperImage;
  const wallpaperPreviewKind = wallpaperMedia?.kind || 'image';

  useEffect(() => {
    if (!backgroundImage) {
      setWallpaperBroken(false);
      return;
    }
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (alive) setWallpaperBroken(false);
    };
    image.onerror = () => {
      if (alive) setWallpaperBroken(true);
    };
    image.src = backgroundImage;
    return () => {
      alive = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [backgroundImage]);

  const applyWallpaperFile = (file: File) => {
    const isVideo = file.type.startsWith('video/');
    const isGif = file.type === 'image/gif';
    if (isVideo || isGif) {
      if (file.size > 60 * 1024 * 1024) {
        noticeRef.current('文件超过 60MB，换个小一点的');
        return;
      }
      void saveWallpaperBlob(file)
        .then(() => {
          const media: StartWallpaperMedia = { kind: isVideo ? 'video' : 'gif', source: 'file' };
          setWallpaperMedia(media);
          setWallpaperImage('');
          setWallpaperOpen(false);
          void patchRef.current({ startWallpaperMedia: media, startWallpaperImage: '' });
          noticeRef.current(isVideo ? '视频壁纸已应用' : 'GIF 壁纸已应用');
        })
        .catch(() => noticeRef.current('壁纸保存失败，换个小一点的文件'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const max = 2560;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        setWallpaperImage(dataUrl);
        setWallpaperMedia(null);
        setWallpaperOpen(false);
        void clearWallpaperBlob().catch(() => undefined);
        void patchRef.current({ startWallpaperImage: dataUrl, startWallpaperMedia: undefined });
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const applyWallpaperUrl = (raw: string) => {
    const media = wallpaperMediaFromUrl(raw);
    if (!media) {
      noticeRef.current('请输入有效的 http(s) 图片 / GIF / 视频地址');
      return;
    }
    setWallpaperMedia(media);
    setWallpaperImage('');
    setWallpaperOpen(false);
    void clearWallpaperBlob().catch(() => undefined);
    void patchRef.current({ startWallpaperMedia: media, startWallpaperImage: '' });
    noticeRef.current('壁纸已应用');
  };

  const applyBingImage = (image: BingGalleryItem, silent = false) => {
    setWallpaper('bing');
    setBingSelection({ url: image.url, copyright: image.copyright });
    setWallpaperImage('');
    setWallpaperMedia(null);
    setMediaUrl('');
    setInk(null);
    if (!silent) setWallpaperOpen(false);
    void clearWallpaperBlob().catch(() => undefined);
    void patchRef.current({
      startWallpaper: 'bing',
      startWallpaperImage: '',
      startWallpaperMedia: undefined,
      startBingImage: image.url,
      startBingCopyright: image.copyright
    });
    if (!silent) noticeRef.current('已应用必应图库壁纸');
  };
  applyBingRef.current = applyBingImage;

  const toggleBingFavorite = (url: string) => {
    setBingFavorites((current) => {
      const next = current.includes(url)
        ? current.filter((item) => item !== url)
        : [...current, url].slice(0, 30);
      try {
        localStorage.setItem(BING_FAV_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const changeRotateMinutes = (minutes: number) => {
    const next = [0, 5, 15, 30, 60].includes(minutes) ? minutes : 0;
    setRotateMinutes(next);
    try {
      localStorage.setItem(ROTATE_KEY, String(next));
    } catch {
      // ignore
    }
  };

  const applyBackup = (prefs: { bingFavorites?: string[]; rotateMinutes?: number }) => {
    if (prefs.bingFavorites) {
      const list = prefs.bingFavorites.slice(0, 30);
      setBingFavorites(list);
      try {
        localStorage.setItem(BING_FAV_KEY, JSON.stringify(list));
      } catch {
        // ignore
      }
    }
    if (typeof prefs.rotateMinutes === 'number') changeRotateMinutes(prefs.rotateMinutes);
  };

  const changeGallerySource = (source: GallerySource) => {
    setGallerySource(source);
    setBingGallery([]);
    setBingGalleryState('idle');
    try {
      localStorage.setItem(GALLERY_KEY, source);
    } catch {
      // ignore
    }
  };

  const resetBingImage = () => {
    setBingSelection(null);
    void patchRef.current({ startBingImage: undefined, startBingCopyright: undefined });
    noticeRef.current('已恢复每日一图');
  };

  const clearCustomWallpaper = () => {
    setWallpaperMedia(null);
    setWallpaperImage('');
    setMediaUrl('');
    setInk(null);
    void clearWallpaperBlob().catch(() => undefined);
    void patchRef.current({ startWallpaperMedia: undefined, startWallpaperImage: '' });
  };

  const pickWallpaper = (next: WallpaperId) => {
    setWallpaper(next);
    setWallpaperImage('');
    setWallpaperMedia(null);
    setMediaUrl('');
    setInk(null);
    setWallpaperOpen(false);
    void clearWallpaperBlob().catch(() => undefined);
    void patchRef.current({
      startWallpaper: next,
      startWallpaperImage: '',
      startWallpaperMedia: undefined
    });
  };

  const changeInkMode = (next: 'auto' | InkMode) => {
    setInkMode(next);
    try {
      localStorage.setItem(INK_KEY, next);
    } catch {
      // ignore
    }
  };

  return {
    wallpaper,
    setWallpaper,
    wallpaperImage,
    setWallpaperImage,
    wallpaperMedia,
    setWallpaperMedia,
    mediaUrl,
    setMediaUrl,
    ink,
    setInk,
    inkMode,
    bingWallpaper,
    bingGallery,
    bingGalleryState,
    gallerySource,
    changeGallerySource,
    bingSelection,
    setBingSelection,
    bingFavorites,
    rotateMinutes,
    wallpaperOpen,
    setWallpaperOpen,
    effectiveInk,
    backgroundImage,
    videoBackground,
    displayBackground,
    displayVideo,
    wallpaperPreview,
    wallpaperPreviewKind,
    setWallpaperBroken,
    applyWallpaperFile,
    applyWallpaperUrl,
    applyBingImage,
    pickBingImage: (image: BingGalleryItem) => applyBingImage(image, false),
    resetBingImage,
    toggleBingFavorite,
    changeRotateMinutes,
    changeInkMode,
    clearCustomWallpaper,
    pickWallpaper,
    applyBackup,
    retryBingGallery: () => setBingGalleryState('idle')
  };
}
