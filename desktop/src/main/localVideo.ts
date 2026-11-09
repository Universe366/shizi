import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PageInfo } from '../shared/types';

/** Chromium 能直接播放的容器/编码；其他格式在选择后就提示，不静默失败。 */
export const PLAYABLE_VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'ogg', 'ogv'];

const PLAYER_FILE = 'local-player.html';
const PLAYER_MARKER = '<!-- shizi-local-player v1 -->';

export function isPlayableVideoFile(file: string): boolean {
  const ext = path.extname(file).replace(/^\./, '').toLowerCase();
  return PLAYABLE_VIDEO_EXTENSIONS.includes(ext);
}

export function localVideoTitle(file: string): string {
  return path.basename(file, path.extname(file)) || path.basename(file) || '本地视频';
}

/** 本地播放页放在 userData 里，版本变化时覆盖写入。 */
export function ensureLocalPlayerHtml(): string {
  const target = path.join(app.getPath('userData'), PLAYER_FILE);
  try {
    const existing = fs.readFileSync(target, 'utf8');
    if (existing.includes(PLAYER_MARKER)) return target;
  } catch {
    // 不存在就写
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, playerHtml(), 'utf8');
  return target;
}

/** 标签页实际加载的地址：播放页 + 视频路径/文件名参数。 */
export function localPlayerUrl(file: string): string {
  const player = pathToFileURL(ensureLocalPlayerHtml()).toString();
  const src = pathToFileURL(file).toString();
  return `${player}?src=${encodeURIComponent(src)}&name=${encodeURIComponent(localVideoTitle(file))}`;
}

/** 从播放页地址（或直接的 file:// 地址）还原本地视频路径。 */
export function localFileFromPageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return '';
    if (/\/local-player\.html$/i.test(parsed.pathname)) {
      const src = parsed.searchParams.get('src') || '';
      if (!/^file:/i.test(src)) return '';
      return fileURLToPath(src);
    }
    return fileURLToPath(parsed);
  } catch {
    return '';
  }
}

/** 本地视频的 PageInfo：不依赖页面桥，身份用 file:// URL。 */
export function localVideoInfo(file: string, duration = 0): PageInfo {
  const url = pathToFileURL(file).toString();
  return {
    kind: 'local',
    bvid: null,
    aid: null,
    cid: null,
    epId: null,
    seasonId: null,
    page: 1,
    partTitle: '',
    parts: [],
    title: localVideoTitle(file),
    owner: '本地文件',
    desc: '',
    duration: Number(duration) || 0,
    url,
    signature: `local:${file}`
  };
}

function playerHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>本地视频</title>',
    '<style>',
    'html,body{margin:0;height:100%;background:#0b0d12;color:#e8eaee;overflow:hidden;font-family:"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",system-ui,sans-serif}',
    '#stage{position:relative;height:100%;display:flex;align-items:center;justify-content:center}',
    'video{width:100%;height:100%;object-fit:contain;background:#000;outline:none}',
    '#subs{position:absolute;left:6%;right:6%;bottom:9%;text-align:center;font-size:clamp(18px,2.4vw,34px);line-height:1.45;font-weight:600;text-shadow:0 2px 8px rgba(0,0,0,.9);pointer-events:none;white-space:pre-wrap}',
    '#subs span{background:rgba(0,0,0,.55);padding:2px 10px;border-radius:6px;box-decoration-break:clone}',
    '#bar{position:absolute;top:0;left:0;right:0;display:flex;gap:10px;align-items:center;padding:10px 14px;background:linear-gradient(rgba(0,0,0,.6),transparent);opacity:0;transition:opacity .2s}',
    'body:hover #bar{opacity:1}',
    '#name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:#cfd3da}',
    '#bar button{border:1px solid rgba(255,255,255,.18);background:rgba(20,22,28,.75);color:#e8eaee;border-radius:7px;padding:4px 10px;font-size:12px;cursor:pointer}',
    '#bar button:hover{background:rgba(40,45,56,.9)}',
    '#hint{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:70%;padding:14px 18px;border-radius:10px;background:rgba(20,22,28,.9);color:#f0c8c0;font-size:14px;text-align:center}',
    '</style>',
    '</head>',
    '<body>',
    '<div id="stage">',
    '<video id="video" controls playsinline preload="metadata"></video>',
    '<div id="subs"></div>',
    '<div id="bar"><span id="name"></span><button id="cc" type="button">字幕：开</button></div>',
    '<div id="hint" hidden></div>',
    '</div>',
    '<script>',
    '(function () {',
    "  var params = new URLSearchParams(location.search);",
    "  var src = params.get('src') || '';",
    "  var name = params.get('name') || '';",
    "  var video = document.getElementById('video');",
    "  var subs = document.getElementById('subs');",
    "  var cc = document.getElementById('cc');",
    "  var hint = document.getElementById('hint');",
    '  var lines = [];',
    '  var show = true;',
    "  document.title = name || '本地视频';",
    "  document.getElementById('name').textContent = name || src;",
    '  var storeKey = "shizi.local.volume";',
    '  var posKey = "shizi.local.pos:" + src;',
    '  window.__bsubLocalLines = function (next) {',
    '    lines = Array.isArray(next) ? next : [];',
    '    render();',
    '  };',
    '  function currentLine() {',
    '    var t = video.currentTime || 0;',
    '    for (var i = 0; i < lines.length; i += 1) {',
    '      var line = lines[i];',
    '      var end = line.end || line.start + 4;',
    '      if (t >= line.start && t <= end) return line;',
    '    }',
    '    return null;',
    '  }',
    '  function render() {',
    "    if (!show) { subs.innerHTML = ''; return; }",
    '    var line = currentLine();',
    "    subs.innerHTML = line ? '<span></span>' : '';",
    '    if (line) subs.firstChild.textContent = line.text;',
    '  }',
    '  video.addEventListener("timeupdate", render);',
    '  video.addEventListener("seeked", render);',
    '  window.setInterval(render, 200);',
    '  cc.addEventListener("click", function () {',
    '    show = !show;',
    "    cc.textContent = show ? '字幕：开' : '字幕：关';",
    '    render();',
    '  });',
    '  video.addEventListener("error", function () {',
    '    hint.hidden = false;',
    "    hint.textContent = '这个格式无法直接播放，请换成 mp4 / webm。';",
    '  });',
    '  try {',
    '    var volume = Number(localStorage.getItem(storeKey));',
    '    if (Number.isFinite(volume) && volume > 0) video.volume = Math.min(1, volume);',
    '  } catch (e) {}',
    '  video.addEventListener("loadedmetadata", function () {',
    '    try {',
    '      var pos = Number(localStorage.getItem(posKey));',
    '      if (Number.isFinite(pos) && pos > 3 && pos < (video.duration || 0) - 3) video.currentTime = pos;',
    '    } catch (e) {}',
    '  });',
    '  var saveTimer = 0;',
    '  function savePosition() {',
    '    if (saveTimer) return;',
    '    saveTimer = window.setTimeout(function () {',
    '      saveTimer = 0;',
    '      try {',
    '        localStorage.setItem(posKey, String(video.currentTime || 0));',
    '        localStorage.setItem(storeKey, String(video.volume || 1));',
    '      } catch (e) {}',
    '    }, 400);',
    '  }',
    '  video.addEventListener("timeupdate", savePosition);',
    '  if (src) {',
    '    video.src = src;',
    '    video.play().catch(function () {});',
    '  } else {',
    '    hint.hidden = false;',
    "    hint.textContent = '没有指定本地视频。';",
    '  }',
    '})();',
    '</script>',
    '</body>',
    '</html>'
  ].join('\n');
}
