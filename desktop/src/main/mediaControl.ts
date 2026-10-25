/**
 * 注入到每个页面：播放倍速控制。
 *
 * 参考 Global Speed 的交互：预设 + 步进 + 数值输入 + 滑块 + 音调开关 + 快捷键 + OSD。
 * 页面视图是原生 WebContentsView，会盖住 React 层，所以面板只能放在页面里；
 * 用 Shadow DOM + CSSOM 隔离，避免被站点样式或 CSP 影响。
 *
 * 主进程通过 `window.__shiziMedia.setState(...)` 下发状态；
 * 页面通过 `__bsubMediaAction` binding 把动作回传主进程（见 tabs.ts）。
 */
export const MEDIA_CONTROL_SCRIPT = String.raw`
(() => {
  if (window.__shiziMedia) return;

  var isTop = window.top === window;
  var MIN = 0.25, MAX = 16, SMALL = 0.1, BIG = 1;
  var SLIDER_MIN = 0.25, SLIDER_MAX = 4, SLIDER_STEP = 0.05;
  var PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 16];

  var state = {
    rate: 1,
    pitch: true,
    remember: true,
    singleKey: false,
    widget: true,
    site: '',
    panel: false
  };

  var host = null, shadow = null, panel = null, valueEl = null, numInput = null;
  var slider = null, siteEl = null, hintEl = null, emptyEl = null;
  var hintLeft = null, hintRight = null;
  var pitchBtn = null, rememberBtn = null, presetEls = [];
  var osd = null, badge = null;
  var osdTimer = 0, commitTimer = 0, lastPostAt = 0, lastKeyAt = 0, mounted = false;
  var syncTimer = 0;

  function clamp(value) {
    var number = Number(value);
    if (!isFinite(number)) return 1;
    var rounded = Math.round(number * 100) / 100;
    return Math.min(MAX, Math.max(MIN, rounded));
  }

  function fmt(value) {
    return String(Number(clamp(value).toFixed(2))) + '\u00d7';
  }

  function fixed(value) {
    return clamp(value).toFixed(2);
  }

  function mediaEls() {
    return Array.prototype.slice.call(document.querySelectorAll('video,audio'));
  }

  function applyMedia() {
    var list = mediaEls();
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      try {
        if (Math.abs(el.playbackRate - state.rate) > 0.001) el.playbackRate = state.rate;
        if ('preservesPitch' in el) el.preservesPitch = state.pitch;
        if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = state.pitch;
      } catch (error) {
        // 某些媒体元素（直播/DRM）不允许改倍速，忽略。
      }
    }
  }

  function post(action, extra) {
    try {
      if (typeof window.__bsubMediaAction !== 'function') return;
      var payload = { action: action };
      if (extra) {
        for (var key in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, key)) payload[key] = extra[key];
        }
      }
      window.__bsubMediaAction(JSON.stringify(payload));
    } catch (error) {
      // binding 不可用时只改当前页面，不影响播放。
    }
  }

  function pushRate(commit) {
    var now = Date.now();
    if (commit) {
      lastPostAt = 0;
      post('rate', { rate: state.rate, commit: true });
      return;
    }
    if (now - lastPostAt < 90) return;
    lastPostAt = now;
    post('rate', { rate: state.rate, commit: false });
  }

  function showOsd() {
    if (!osd || !isTop) return;
    osd.textContent = fmt(state.rate);
    osd.classList.add('is-show');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () {
      osd.classList.remove('is-show');
    }, 1100);
  }

  function applyRate(value, commit) {
    state.rate = clamp(value);
    applyMedia();
    showOsd();
    render();
    pushRate(commit === true);
  }

  function toggleSetting(name) {
    if (name === 'pitch') {
      state.pitch = !state.pitch;
      applyMedia();
      post('pitch', { value: state.pitch });
    } else if (name === 'remember') {
      state.remember = !state.remember;
      post('remember', { value: state.remember });
    }
    render();
  }

  function mk(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function adopt(root, css) {
    try {
      if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in root) {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        root.adoptedStyleSheets = [sheet];
        return;
      }
    } catch (error) {
      // 退回到 <style>。
    }
    var style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);
  }

  var CSS = [
    ':host{all:initial}',
    ':host{',
    '  --panel-bg:rgba(28,28,32,.97);',
    '  --fg:#f5f5f7;',
    '  --sub:rgba(255,255,255,.52);',
    '  --line:rgba(255,255,255,.1);',
    '  --chip:rgba(255,255,255,.07);',
    '  --chip-hover:rgba(255,255,255,.14);',
    '  --active-bg:#ffffff;',
    '  --active-fg:#141416;',
    '  --on:#5ec97f;',
    '  --osd-bg:rgba(20,20,24,.86);',
    '  --osd-fg:#ffffff;',
    '}',
    '@media (prefers-color-scheme: light){',
    '  :host{',
    '    --panel-bg:rgba(252,252,250,.98);',
    '    --fg:#17171a;',
    '    --sub:rgba(0,0,0,.5);',
    '    --line:rgba(0,0,0,.09);',
    '    --chip:rgba(0,0,0,.055);',
    '    --chip-hover:rgba(0,0,0,.09);',
    '    --active-bg:#17171a;',
    '    --active-fg:#ffffff;',
    '    --on:#2f9e5f;',
    '    --osd-bg:rgba(255,255,255,.94);',
    '    --osd-fg:#17171a;',
    '  }',
    '}',
    '.panel{',
    "  position:absolute;top:10px;right:14px;width:302px;max-width:calc(100vw - 28px);",
    '  box-sizing:border-box;padding:14px;border-radius:16px;',
    '  background:var(--panel-bg);color:var(--fg);border:1px solid var(--line);',
    '  box-shadow:0 20px 52px rgba(0,0,0,.45);backdrop-filter:blur(22px);',
    '  -webkit-backdrop-filter:blur(22px);pointer-events:auto;user-select:none;',
    "  font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;",
    '  display:none;',
    '}',
    '.head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;',
    '  font:inherit;color:inherit;}',
    '.kicker{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--fg);}',
    '.site{display:block;margin-top:2px;font-size:11px;color:var(--sub);max-width:170px;',
    '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.value{font-size:24px;line-height:1;font-weight:650;letter-spacing:-.03em;font-variant-numeric:tabular-nums;}',
    '.close{all:unset;box-sizing:border-box;width:24px;height:24px;border-radius:7px;',
    '  display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--sub);',
    '  font-size:15px;line-height:1;margin:-2px -2px 0 0;}',
    '.close:hover{background:var(--chip-hover);color:var(--fg);}',
    '.presets{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:14px;}',
    '.preset{all:unset;box-sizing:border-box;text-align:center;padding:7px 0;border-radius:9px;',
    '  cursor:pointer;background:var(--chip);color:var(--fg);font-size:12px;font-weight:500;',
    '  font-variant-numeric:tabular-nums;transition:background .13s ease,color .13s ease,transform .13s ease;}',
    '.preset:hover{background:var(--chip-hover);}',
    '.preset.is-active{background:var(--active-bg);color:var(--active-fg);font-weight:650;transform:scale(1.04);}',
    '.steps{display:grid;grid-template-columns:38px 38px 1fr 38px 38px;gap:6px;margin-top:10px;align-items:center;}',
    '.step{all:unset;box-sizing:border-box;height:32px;border-radius:9px;background:var(--chip);',
    '  color:var(--fg);cursor:pointer;display:flex;align-items:center;justify-content:center;',
    '  font-size:15px;line-height:1;}',
    '.step:hover{background:var(--chip-hover);}',
    '.num{all:unset;box-sizing:border-box;height:32px;width:100%;text-align:center;border-radius:9px;',
    '  background:var(--chip);border:1px solid var(--line);color:var(--fg);',
    '  font-size:15px;font-weight:650;font-variant-numeric:tabular-nums;cursor:text;}',
    '.num:focus{border-color:var(--fg);}',
    '.slider{all:unset;box-sizing:border-box;width:100%;height:18px;margin-top:12px;cursor:pointer;display:block;',
    '  -webkit-appearance:none;appearance:none;}',
    '.slider::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:var(--chip-hover);}',
    '.slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;',
    '  margin-top:-5px;border-radius:50%;background:var(--fg);border:none;box-shadow:0 1px 4px rgba(0,0,0,.35);}',
    '.toggles{display:flex;gap:6px;margin-top:12px;}',
    '.toggle{all:unset;box-sizing:border-box;flex:1;display:flex;align-items:center;gap:6px;',
    '  padding:8px 9px;border-radius:9px;background:var(--chip);color:var(--sub);',
    '  cursor:pointer;font-size:12px;line-height:1;white-space:nowrap;}',
    '.toggle:hover{background:var(--chip-hover);}',
    '.toggle .dot{width:6px;height:6px;border-radius:50%;background:var(--sub);opacity:.55;flex:none;}',
    '.toggle.is-on{color:var(--fg);background:var(--chip-hover);}',
    '.toggle.is-on .dot{background:var(--on);opacity:1;}',
    '.empty{margin-top:10px;padding:7px 9px;border-radius:8px;background:var(--chip);',
    '  color:var(--sub);font-size:11px;display:none;}',
    '.hint{display:flex;justify-content:space-between;gap:8px;margin-top:11px;color:var(--sub);',
    '  font-size:11px;line-height:1.3;}',
    '.osd{',
    '  position:absolute;top:16px;left:50%;transform:translate(-50%,-8px);display:flex;',
    '  align-items:center;justify-content:center;min-width:62px;padding:8px 15px;border-radius:999px;',
    '  background:var(--osd-bg);color:var(--osd-fg);font:600 17px/1 -apple-system,BlinkMacSystemFont,',
    "  'Segoe UI','Microsoft YaHei',sans-serif;letter-spacing:-.02em;",
    '  font-variant-numeric:tabular-nums;box-shadow:0 8px 24px rgba(0,0,0,.28);',
    '  opacity:0;pointer-events:none;transition:opacity .16s ease,transform .16s ease;',
    '}',
    '.osd.is-show{opacity:1;transform:translate(-50%,0);}',
    '.badge{',
    '  all:unset;box-sizing:border-box;position:absolute;right:18px;bottom:18px;padding:6px 10px;',
    '  border-radius:999px;background:var(--osd-bg);color:var(--osd-fg);cursor:pointer;',
    "  font:600 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;",
    '  font-variant-numeric:tabular-nums;box-shadow:0 6px 18px rgba(0,0,0,.26);',
    '  opacity:.82;pointer-events:auto;transition:opacity .16s ease,transform .16s ease;display:none;',
    '}',
    '.badge:hover{opacity:1;}',
    '.preset:focus-visible,.step:focus-visible,.toggle:focus-visible,.close:focus-visible,.badge:focus-visible{',
    '  outline:2px solid var(--fg);outline-offset:2px;}'
  ].join('\n');

  function buildPanel() {
    panel = mk('div', 'panel');

    var head = mk('div', 'head');
    var left = mk('div');
    var kicker = mk('div', 'kicker', '\u64ad\u653e\u901f\u5ea6');
    siteEl = mk('span', 'site');
    kicker.appendChild(siteEl);
    left.appendChild(kicker);
    valueEl = mk('div', 'value', '1\u00d7');
    var close = mk('button', 'close', '\u2715');
    close.type = 'button';
    close.setAttribute('data-act', 'close');
    close.title = '\u5173\u95ed';
    head.appendChild(left);
    head.appendChild(valueEl);
    head.appendChild(close);

    var presets = mk('div', 'presets');
    presetEls = PRESETS.map(function (rate) {
      var button = mk('button', 'preset', String(rate));
      button.type = 'button';
      button.setAttribute('data-rate', String(rate));
      presets.appendChild(button);
      return button;
    });

    var steps = mk('div', 'steps');
    var stepDefs = [
      { step: -BIG, label: '\u00ab', title: '\u51cf 1' },
      { step: -SMALL, label: '\u2039', title: '\u51cf 0.1' },
      { step: SMALL, label: '\u203a', title: '\u52a0 0.1' },
      { step: BIG, label: '\u00bb', title: '\u52a0 1' }
    ];
    var stepButtons = stepDefs.map(function (def) {
      var button = mk('button', 'step', def.label);
      button.type = 'button';
      button.title = def.title;
      button.setAttribute('data-step', String(def.step));
      return button;
    });
    numInput = mk('input', 'num');
    numInput.setAttribute('type', 'text');
    numInput.setAttribute('inputmode', 'decimal');
    numInput.setAttribute('autocomplete', 'off');
    numInput.setAttribute('spellcheck', 'false');
    numInput.setAttribute('aria-label', '\u64ad\u653e\u901f\u5ea6');
    steps.appendChild(stepButtons[0]);
    steps.appendChild(stepButtons[1]);
    steps.appendChild(numInput);
    steps.appendChild(stepButtons[2]);
    steps.appendChild(stepButtons[3]);

    slider = mk('input', 'slider');
    slider.setAttribute('type', 'range');
    slider.setAttribute('min', String(SLIDER_MIN));
    slider.setAttribute('max', String(SLIDER_MAX));
    slider.setAttribute('step', String(SLIDER_STEP));
    slider.setAttribute('aria-label', '\u64ad\u653e\u901f\u5ea6\u6ed1\u6746');

    var toggles = mk('div', 'toggles');
    pitchBtn = mk('button', 'toggle');
    pitchBtn.type = 'button';
    pitchBtn.setAttribute('data-toggle', 'pitch');
    pitchBtn.appendChild(mk('span', 'dot'));
    pitchBtn.appendChild(mk('span', null, '\u4fdd\u6301\u97f3\u8c03'));
    rememberBtn = mk('button', 'toggle');
    rememberBtn.type = 'button';
    rememberBtn.setAttribute('data-toggle', 'remember');
    rememberBtn.appendChild(mk('span', 'dot'));
    rememberBtn.appendChild(mk('span', null, '\u8bb0\u4f4f\u672c\u7ad9'));
    toggles.appendChild(pitchBtn);
    toggles.appendChild(rememberBtn);

    emptyEl = mk('div', 'empty', '\u5f53\u524d\u9875\u9762\u6ca1\u6709\u53ef\u8c03\u901f\u7684\u89c6\u9891\uff0c\u8bbe\u7f6e\u4f1a\u4fdd\u7559\u3002');

    hintEl = mk('div', 'hint');
    hintLeft = mk('span');
    hintRight = mk('span');
    hintEl.appendChild(hintLeft);
    hintEl.appendChild(hintRight);

    panel.appendChild(head);
    panel.appendChild(presets);
    panel.appendChild(steps);
    panel.appendChild(slider);
    panel.appendChild(toggles);
    panel.appendChild(emptyEl);
    panel.appendChild(hintEl);
    shadow.appendChild(panel);

    panel.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      event.stopPropagation();
      var preset = target.closest('[data-rate]');
      if (preset) {
        applyRate(Number(preset.getAttribute('data-rate')), true);
        return;
      }
      var step = target.closest('[data-step]');
      if (step) {
        applyRate(state.rate + Number(step.getAttribute('data-step')), true);
        return;
      }
      if (target.closest('[data-act="close"]')) {
        closePanel();
        return;
      }
      var toggle = target.closest('[data-toggle]');
      if (toggle) toggleSetting(toggle.getAttribute('data-toggle'));
    });

    panel.addEventListener('pointerdown', function (event) {
      event.stopPropagation();
    });

    panel.addEventListener('wheel', function (event) {
      if (event.deltaMode !== 0) return;
      var delta = (event.deltaY / 1000) * -0.15;
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      applyRate(state.rate + delta, false);
      clearTimeout(commitTimer);
      commitTimer = setTimeout(function () {
        pushRate(true);
      }, 260);
    }, { passive: false });

    slider.addEventListener('input', function () {
      applyRate(Number(slider.value), false);
    });
    slider.addEventListener('change', function () {
      pushRate(true);
    });

    function commitInput() {
      var value = parseFloat(String(numInput.value).replace(',', '.'));
      if (isFinite(value)) applyRate(value, true);
      else render();
    }

    numInput.addEventListener('change', commitInput);
    numInput.addEventListener('blur', commitInput);
    numInput.addEventListener('keydown', function (event) {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commitInput();
        numInput.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        render();
        numInput.blur();
      }
    });

    host.addEventListener('keydown', function (event) {
      event.stopPropagation();
    });
    host.addEventListener('pointerdown', function (event) {
      event.stopPropagation();
    });
    // 面板上的鼠标事件不要再冒泡给播放器/站点（否则点面板会被当成点视频）。
    host.addEventListener('mousedown', function (event) {
      event.stopPropagation();
    });
    host.addEventListener('mouseup', function (event) {
      event.stopPropagation();
    });
  }

  function buildOsd() {
    osd = mk('div', 'osd', '1\u00d7');
    shadow.appendChild(osd);
  }

  function buildBadge() {
    badge = mk('button', 'badge', '1\u00d7');
    badge.type = 'button';
    badge.title = '\u8c03\u6574\u64ad\u653e\u901f\u5ea6';
    badge.addEventListener('click', function (event) {
      event.stopPropagation();
      openPanel();
    });
    shadow.appendChild(badge);
  }

  function ensureUi() {
    if (!isTop || mounted) return;
    if (!document.documentElement) return;
    mounted = true;
    host = document.createElement('div');
    host.id = '__shizi_media_ui__';
    host.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483647;pointer-events:none;';
    shadow = host.attachShadow({ mode: 'open' });
    adopt(shadow, CSS);
    buildOsd();
    buildBadge();
    buildPanel();
    mountHost();
    document.addEventListener('fullscreenchange', mountHost, true);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
  }

  function mountHost() {
    if (!host) return;
    var root = document.fullscreenElement || document.documentElement;
    // 原生 <video> 全屏时不能往里塞子节点，保持挂在 documentElement 上。
    if (root && (root.tagName === 'VIDEO' || root.tagName === 'AUDIO')) root = document.documentElement;
    if (!root || root.nodeType !== 1) root = document.documentElement;
    if (!root || !root.appendChild) return;
    try {
      if (host.parentNode !== root) root.appendChild(host);
    } catch (error) {
      // ignore
    }
  }

  function render() {
    if (!isTop || !mounted) return;

    valueEl.textContent = fmt(state.rate);
    for (var i = 0; i < presetEls.length; i++) {
      var active = Math.abs(PRESETS[i] - state.rate) < 0.001;
      presetEls[i].className = 'preset' + (active ? ' is-active' : '');
    }
    var focused = shadow.activeElement === numInput;
    if (!focused) numInput.value = fixed(state.rate);
    slider.value = String(Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, state.rate)));
    siteEl.textContent = state.site ? '\u00b7 ' + state.site : '';
    siteEl.style.display = state.site ? 'inline' : 'none';

    pitchBtn.className = 'toggle' + (state.pitch ? ' is-on' : '');
    rememberBtn.className = 'toggle' + (state.remember ? ' is-on' : '');
    pitchBtn.title = state.pitch
      ? '\u53d8\u901f\u4e0d\u53d8\u8c03'
      : '\u53d8\u901f\u4e5f\u6539\u53d8\u97f3\u8c03';
    rememberBtn.title = state.remember
      ? '\u4e0b\u6b21\u6253\u5f00\u8fd9\u4e2a\u7ad9\u70b9\u81ea\u52a8\u7528 ' + fmt(state.rate)
      : '\u4e0d\u8bb0\u4f4f\u672c\u7ad9\u500d\u901f';

    hintLeft.textContent = state.singleKey ? 'A / D \u8c03\u901f \u00b7 S \u590d\u4f4d' : 'Alt+Shift+\u2191/\u2193 \u8c03\u901f';
    hintRight.textContent = state.singleKey ? '\u70b9\u89d2\u6807\u6253\u5f00' : '0 \u590d\u4f4d \u00b7 S \u5f00\u5173';

    emptyEl.style.display = mediaEls().length === 0 ? 'block' : 'none';

    panel.style.display = state.panel ? 'block' : 'none';
    var showBadge = state.widget && state.rate !== 1 && !state.panel;
    badge.style.display = showBadge ? 'block' : 'none';
    badge.textContent = fmt(state.rate);
  }

  function openPanel() {
    ensureUi();
    if (!isTop) return;
    state.panel = true;
    render();
  }

  function closePanel() {
    state.panel = false;
    render();
  }

  function togglePanel() {
    if (!isTop) return;
    if (state.panel) closePanel();
    else openPanel();
  }

  function isEditable(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    if (!el || !el.closest) return false;
    return Boolean(el.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="textbox"]'));
  }

  function onDocumentPointerDown(event) {
    if (!state.panel) return;
    var target = event.target;
    if (host && target && (target === host || (host.contains && host.contains(target)))) return;
    closePanel();
  }

  function onKeyDown(event) {
    if (!isTop) return;
    if (event.defaultPrevented) return;
    var key = String(event.key || '');
    if (key === 'Escape' && state.panel) {
      event.preventDefault();
      closePanel();
      return;
    }
    if (isEditable(event.target)) return;

    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
      if (key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        applyRate(state.rate + SMALL, true);
        return;
      }
      if (key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        applyRate(state.rate - SMALL, true);
        return;
      }
      if (key === '0' || key === ')') {
        event.preventDefault();
        event.stopPropagation();
        applyRate(1, true);
        return;
      }
      if (key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        togglePanel();
        return;
      }
    }

    if (!state.singleKey) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    var lower = key.toLowerCase();
    if (lower !== 'a' && lower !== 'd' && lower !== 's') return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    // 长按产生的重复事件节流，单击不受影响。
    if (event.repeat) {
      var now = Date.now();
      if (now - lastKeyAt < 55) return;
      lastKeyAt = now;
    }
    if (lower === 'a') applyRate(state.rate - SMALL, true);
    else if (lower === 'd') applyRate(state.rate + SMALL, true);
    else applyRate(1, true);
  }

  window.__shiziMedia = {
    setState: function (next) {
      if (!next) return;
      state.rate = clamp(next.rate);
      state.pitch = next.pitch !== false;
      state.remember = next.remember !== false;
      state.singleKey = next.singleKey === true;
      state.widget = next.widget !== false;
      state.site = String(next.site || '');
      if (typeof next.panel === 'boolean') state.panel = next.panel;
      // 1× 代表“不干预”，避免把站点自带倍速控件改过的值强行拉回来。
      if (state.rate !== 1) applyMedia();
      if (isTop) {
        ensureUi();
        render();
      }
    },
    getState: function () {
      return {
        rate: state.rate,
        pitch: state.pitch,
        remember: state.remember,
        singleKey: state.singleKey,
        widget: state.widget,
        site: state.site,
        panel: state.panel
      };
    },
    openPanel: openPanel,
    closePanel: closePanel,
    togglePanel: togglePanel,
    destroy: function () {
      if (syncTimer) clearInterval(syncTimer);
      syncTimer = 0;
      clearTimeout(osdTimer);
      clearTimeout(commitTimer);
      document.removeEventListener('fullscreenchange', mountHost, true);
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      if (host && host.parentNode) host.parentNode.removeChild(host);
      host = null;
      shadow = null;
      mounted = false;
      delete window.__shiziMedia;
    }
  };

  // 站点在播放开始/切换视频时会重置 playbackRate，这里持续兜底。
  // 只有倍速不等于 1 时才持续纠正，避免和 B 站自带的倍速控件打架。
  function enforce() {
    if (state.rate === 1) return;
    applyMedia();
  }

  document.addEventListener('play', enforce, true);
  document.addEventListener('loadedmetadata', enforce, true);
  document.addEventListener('ratechange', function (event) {
    if (state.rate === 1) return;
    var target = event.target;
    if (!target || typeof target.playbackRate !== 'number') return;
    if (Math.abs(target.playbackRate - state.rate) > 0.01) applyMedia();
  }, true);
  syncTimer = setInterval(function () {
    if (state.rate === 1 && state.pitch) return;
    applyMedia();
  }, 2500);

  if (isTop) {
    if (document.documentElement) ensureUi();
    else document.addEventListener('DOMContentLoaded', ensureUi, { once: true });
  }
})();
`;
