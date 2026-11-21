import path from 'node:path';
import { BrowserWindow, nativeTheme } from 'electron';

let overlay: BrowserWindow | null = null;

interface ShowOptions {
  current: number;
  anchor: { x: number; y: number; width: number; height: number };
}

function panelHtml(current: number, dark: boolean): string {
  const bg = dark ? '#1c1f26' : '#ffffff';
  const fg = dark ? '#eef1f5' : '#20242b';
  const muted = dark ? '#9aa3b2' : '#6d7480';
  const border = dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)';
  const active = dark ? 'rgba(120,170,255,.2)' : 'rgba(40,110,220,.12)';
  const accent = dark ? '#8ab4ff' : '#2f6fdc';
  const presets = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3]
    .map((value) => {
      const on = Math.abs(current - value) < 0.001 ? ' class="on"' : '';
      return '<button data-zoom="' + value + '"' + on + '>' + Math.round(value * 100) + '%</button>';
    })
    .join('');
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '*{box-sizing:border-box}html,body{margin:0;background:transparent;font:12px -apple-system,BlinkMacSystemFont,Segoe UI,Microsoft YaHei,sans-serif;color:' + fg + '}' +
    '.panel{width:236px;padding:10px;border:1px solid ' + border + ';border-radius:12px;background:' + bg + ';box-shadow:0 18px 45px rgba(0,0,0,.32);user-select:none}' +
    '.head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;color:' + muted + ';font-size:11px}' +
    '.row{display:grid;grid-template-columns:34px 1fr 34px;gap:6px;align-items:center}' +
    'button{all:unset;box-sizing:border-box;display:grid;place-items:center;height:30px;border:1px solid ' + border + ';border-radius:7px;color:' + fg + ';cursor:pointer;background:transparent}' +
    'button:hover{border-color:' + accent + ';color:' + accent + '}' +
    '.value{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}' +
    '.presets{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:8px}' +
    '.presets button{height:25px;font-size:11px;color:' + muted + '}' +
    '.presets button.on{border-color:' + accent + ';background:' + active + ';color:' + accent + '}' +
    '</style></head><body data-current="' + current + '"><div class="panel">' +
    '<div class="head"><span>页面缩放</span><span>100% 基准</span></div>' +
    '<div class="row"><button data-step="-">−</button><button class="value" data-reset>' + Math.round(current * 100) + '%</button><button data-step="+">＋</button></div>' +
    '<div class="presets">' + presets + '</div>' +
    '</div><script>' +
    'const act=v=>{window.bsub.setZoom(v);window.close()};' +
    'document.querySelectorAll("[data-zoom]").forEach(b=>b.onclick=()=>act(Number(b.dataset.zoom)));' +
    'document.querySelector("[data-reset]").onclick=()=>act(1);' +
    'const current=Number(document.body.dataset.current);' +
    'document.querySelectorAll("[data-step]").forEach(b=>b.onclick=()=>act(current+(b.dataset.step==="+"?0.1:-0.1)));' +
    'window.addEventListener("keydown",e=>{if(e.key==="Escape")window.close()});' +
    '</script></body></html>';
}

export async function showZoomOverlay(
  parent: BrowserWindow,
  options: ShowOptions
): Promise<boolean> {
  if (!parent || parent.isDestroyed()) return false;
  overlay?.destroy();
  overlay = null;
  try {
    const win = new BrowserWindow({
      parent,
      modal: false,
      frame: false,
      transparent: true,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    overlay = win;
    const dark = nativeTheme.shouldUseDarkColors;
    const content = parent.getContentBounds();
    const width = 256;
    const height = 186;
    const x = Math.max(
      content.x + 8,
      Math.min(
        content.x + content.width - width - 8,
        content.x + options.anchor.x + options.anchor.width - width
      )
    );
    const y = Math.max(
      content.y + 8,
      Math.min(
        content.y + content.height - height - 8,
        content.y + options.anchor.y + options.anchor.height + 6
      )
    );
    win.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
    win.on('blur', () => win.destroy());
    win.on('closed', () => {
      if (overlay === win) overlay = null;
    });
    const loaded = new Promise<boolean>((resolve) => {
      win.webContents.once('did-finish-load', () => resolve(true));
      win.webContents.once('did-fail-load', () => resolve(false));
    });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(panelHtml(options.current, dark)));
    const ok = await loaded;
    if (!ok) {
      win.destroy();
      return false;
    }
    win.show();
    win.focus();
    return true;
  } catch {
    overlay?.destroy();
    overlay = null;
    return false;
  }
}

export function closeOverlay(): void {
  overlay?.destroy();
  overlay = null;
}

function findHtml(dark: boolean): string {
  const bg = dark ? '#1c1f26' : '#ffffff';
  const fg = dark ? '#eef1f5' : '#20242b';
  const muted = dark ? '#9aa3b2' : '#6d7480';
  const border = dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)';
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '*{box-sizing:border-box}html,body{margin:0;background:transparent;font:12px -apple-system,BlinkMacSystemFont,Segoe UI,Microsoft YaHei,sans-serif;color:' + fg + '}' +
    '.bar{display:flex;align-items:center;gap:5px;width:360px;padding:6px;border:1px solid ' + border + ';border-radius:10px;background:' + bg + ';box-shadow:0 12px 32px rgba(0,0,0,.26)}' +
    'input{flex:1;min-width:0;height:24px;padding:0 7px;border:1px solid ' + border + ';border-radius:5px;outline:none;background:transparent;color:' + fg + ';font:inherit}' +
    'button{all:unset;box-sizing:border-box;display:grid;place-items:center;min-width:24px;height:24px;padding:0 5px;border:1px solid ' + border + ';border-radius:5px;color:' + muted + ';cursor:pointer}' +
    'button:hover{color:' + fg + ';border-color:' + (dark ? '#8ab4ff' : '#2f6fdc') + '}' +
    '.count{min-width:44px;text-align:center;color:' + muted + ';font-variant-numeric:tabular-nums;font-size:11px}' +
    '</style></head><body><div class="bar">' +
    '<input id="q" placeholder="在页面中查找" autofocus>' +
    '<span class="count" id="count"></span>' +
    '<button id="prev" title="上一个">↑</button><button id="next" title="下一个">↓</button><button id="close" title="关闭">✕</button>' +
    '</div><script>' +
    'const q=document.getElementById("q"),count=document.getElementById("count");' +
    'const search=()=>{const v=q.value.trim();if(!v){count.textContent="";window.bsub.stopFind();return}window.bsub.findInPage(v)};' +
    'let timer=0;q.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(search,140)});' +
    'q.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();const v=q.value.trim();if(v)window.bsub.findInPage(v,{forward:!e.shiftKey,findNext:true})}else if(e.key==="Escape"){window.bsub.stopFind();window.close()}});' +
    'document.getElementById("next").onclick=()=>{const v=q.value.trim();if(v)window.bsub.findInPage(v,{forward:true,findNext:true})};' +
    'document.getElementById("prev").onclick=()=>{const v=q.value.trim();if(v)window.bsub.findInPage(v,{forward:false,findNext:true})};' +
    'document.getElementById("close").onclick=()=>{window.bsub.stopFind();window.close()};' +
    'window.bsub.onFindResult(r=>{count.textContent=r.matches?String(r.activeMatchOrdinal)+"/"+String(r.matches):"0"});' +
    'q.focus();' +
    '</script></body></html>';
}

/** 主页面查找条 Overlay：直接浮在网页上方，不隐藏 WebContentsView。 */
export async function showFindOverlay(parent: BrowserWindow): Promise<boolean> {
  if (!parent || parent.isDestroyed()) return false;
  overlay?.destroy();
  overlay = null;
  try {
    const win = new BrowserWindow({
      parent,
      modal: false,
      frame: false,
      transparent: true,
      show: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    overlay = win;
    const content = parent.getContentBounds();
    const width = 372;
    const height = 48;
    win.setBounds({
      x: Math.round(content.x + content.width - width - 12),
      y: Math.round(content.y + 12),
      width,
      height
    });
    win.on('blur', () => win.destroy());
    win.on('closed', () => {
      if (overlay === win) overlay = null;
    });
    const loaded = new Promise<boolean>((resolve) => {
      win.webContents.once('did-finish-load', () => resolve(true));
      win.webContents.once('did-fail-load', () => resolve(false));
    });
    await win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(findHtml(nativeTheme.shouldUseDarkColors))
    );
    const ok = await loaded;
    if (!ok) {
      win.destroy();
      return false;
    }
    win.show();
    win.focus();
    return true;
  } catch {
    overlay?.destroy();
    overlay = null;
    return false;
  }
}
