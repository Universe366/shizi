import { useState } from 'react';
import type { StartShortcut } from '../../../../shared/types';
import { faviconOf, hostOf, originOf, tileColor } from './model';

/** 站点图标：优先站点自己的 /favicon.ico，失败时回退到域名生成的字母色块。 */
export function SiteIcon({ item, small = false }: { item: StartShortcut; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const origin = originOf(item.url);
  const color = tileColor(hostOf(item.url) || item.label);
  const showImage = Boolean(origin) && !failed;
  return (
    <span
      className={`start-tile-icon${small ? ' is-small' : ''}${showImage ? ' has-image' : ''}`}
      style={{ background: showImage ? undefined : color.bg, color: color.fg }}
    >
      <span className="start-tile-letter">{item.label.slice(0, 1).toUpperCase()}</span>
      {origin && !failed && (
        <img
          src={faviconOf(item.url)}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
