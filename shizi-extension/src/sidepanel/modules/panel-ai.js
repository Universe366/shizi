// AI 面板：总结（流式 + Markdown 真正渲染）、对话（流式 + 渲染 + 重置 + 建议问题 +
// 拖拽导入文件），生成中可中止。

import { h, clear, button, fmtTime, toast, copyText, setBoolAttr } from './dom.js';
import { store } from './store.js';
import { app, showError, saveHistory, doProviderSearch, doEngineSearch, recountCitations, activePromptText, setLines } from './context.js';
import { renderMarkdownInto, renderInline } from './markdown.js';
import { selectContext, linesToTranscript, fmtClock } from './subtitles.js';
import { searchContextBlockGuarded, engineLabel } from './search.js';
import * as OPT from './optimize.js';
import { buildVerifyClaims, isQueryGroundedIn, contextWindowForQuery, contextualQuery } from '../../shared/verify.js';
import { cleanSearchQuery } from '../../shared/search-router.js';
import { wrapUntrusted } from '../../shared/untrusted.js';
import { Stream, call } from './bridge.js';
import {
  AutoStream,
  DesktopStream,
  desktopAiAllowed,
  desktopAiRequired,
  probeDesktopAi,
  desktopAiState,
  speakViaDesktop
} from './desktop-ai.js';
import { watchChatPersistence, clearChatForVideo, chatKey, loadChatForVideo } from './chat-store.js';
import { chatHistoryAll } from '../../shared/storage.js';
import { buildSummaryPrompt } from '../../shared/core/summary.js';
import katex from '../../../vendor/katex/katex.mjs';
import * as jobs from './jobs.js';
import { TASK_LABEL } from '../../shared/constants.js';
import { promptDialog, popoverMenu, openOverlay, closeOverlays } from './ui.js';

const SUGGESTIONS = [
  '用 5 句话总结这期视频',
  '列出本期提到的所有数字与结论',
  '有哪些值得立刻行动的建议？',
  '用表格整理主要观点及其依据',
  '这期视频有哪些专有名词需要留意？',
  '把内容整理成学习笔记大纲'
];

const state = {
  root: null,
  summaryHost: null,
  chatHost: null,
  inputHost: null,
  attachments: [],
  // 当前选中的技能（Skill）。发送消息时会把它作为附加指令带上。
  activeSkillId: null,
  streaming: false,
  stream: null,
  summaryStreaming: false,
  // 长视频「分段总结」不走流式；用 rid 让用户仍然能点「停止」，
  // 后台 cancel 会 abort 当前那段 ai.chat，下一次循环前检查标记退出。
  summaryRid: '',
  summaryAbortRequested: false,
  summaryError: '',
  summaryStatus: '',
  summaryReasoning: '',
  lastSignature: '',
  // 生成中排队的消息（当前回合结束后自动发出；中止则还回输入框）
  queue: [],
  // 思维链展开状态：用户点过就以他的选择为准，否则用设置里的默认值
  reasonOpen: null,
  reasonClosed: null
};

// ---------------------------------------------------------------------------
// 挂载
// ---------------------------------------------------------------------------

export function init(container) {
  const root = h('div', { class: 'pane', style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } });
  const toolbar = h('div', { class: 'pane-toolbar', id: 'ai-toolbar' });
  const scrollHost = h('div', { class: 'scroll-host', id: 'ai-scroll' });
  const body = h('div', { class: 'ai-scroll' });
  scrollHost.appendChild(body);
  const inputWrap = h('div', { class: 'chat-input-wrap', id: 'chat-input-wrap' });

  root.appendChild(toolbar);
  root.appendChild(scrollHost);
  root.appendChild(inputWrap);
  container.appendChild(root);

  state.root = root;
  // 对话历史落盘：面板关闭/刷新后按视频恢复。
  watchChatPersistence();
  // 后台预热：面板打开时先问一次桌面端能力，首次总结/对话就不用等。
  void probeDesktopAi()
    .then(() => render())
    .catch(() => {});
  state.summaryHost = h('div', { id: 'summary-host' });
  state.chatHost = h('div', { class: 'chat-list', id: 'chat-host' });
  const summarySection = h('div', { class: 'ai-summary-section' }, [
    h('div', { class: 'section-title', text: 'AI 总结' }),
    state.summaryHost
  ]);
  state.sessionsHost = h('div', { class: 'chat-sessions', id: 'chat-sessions' });
  const chatSection = h('div', { class: 'ai-chat-section' }, [
    h('div', { class: 'section-title', text: '与 AI 对话' }),
    state.sessionsHost,
    state.chatHost
  ]);
  body.appendChild(summarySection);
  body.appendChild(chatSection);
  inputWrap.classList.add('ai-chat-section');

  scrollHost.addEventListener('scroll', () => {
    store.setScroll('ai', scrollHost.scrollTop);
  });
  state.scrollHost = scrollHost;

  setupDropZone(root, inputWrap);
  void refreshChatSessions();

  render();
  requestAnimationFrame(() => {
    scrollHost.scrollTop = store.scrollOf('ai', 0);
  });
  return {
    render,
    focusInput,
    sendPending,
    generateSummary,
    sendMessage,
    resetChat,
    stopStream,
    copySummary
  };
}

function setupDropZone(root, inputWrap) {
  const hint = document.getElementById('drag-hint');
  let depth = 0;
  const show = (on) => {
    setBoolAttr(inputWrap, 'data-drop', on);
    if (hint) {
      setBoolAttr(hint, 'data-visible', on);
      hint.style.display = on ? 'flex' : 'none';
    }
  };
  root.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth += 1;
    show(true);
  });
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  root.addEventListener('dragleave', (e) => {
    e.preventDefault();
    depth = Math.max(0, depth - 1);
    if (!depth) show(false);
  });
  root.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    show(false);
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return;
    await addFiles(files);
  });
}

// ---------------------------------------------------------------------------
// 文件导入（图片、文本等）
// ---------------------------------------------------------------------------

async function addFiles(files) {
  for (const file of files) {
    try {
      const item = await readFileAsAttachment(file);
      if (item) state.attachments.push(item);
    } catch (err) {
      toast({ title: `无法读取 ${file.name}`, detail: String(err.message || err) }, 'warn');
    }
  }
  renderInput();
  toast({ title: `已加入 ${state.attachments.length} 个附件`, detail: '发送时会一并提交给 AI' }, 'ok', 1800);
}

async function readFileAsAttachment(file) {
  const type = file.type || '';
  if (type.startsWith('image/')) {
    const dataUrl = await downscaleImage(file, 1280, 0.82);
    return { kind: 'image', name: file.name, size: file.size, dataUrl, mime: 'image/jpeg' };
  }
  const textTypes = ['text/', 'application/json', 'application/xml', 'application/x-subrip'];
  const looksText = textTypes.some((t) => type.startsWith(t)) || /\.(txt|md|markdown|json|csv|srt|vtt|log|yaml|yml)$/i.test(file.name);
  if (looksText || file.size < 512 * 1024) {
    const text = await file.text();
    return { kind: 'text', name: file.name, size: file.size, text: text.slice(0, 20000) };
  }
  // 其它二进制：只记录名字，提示无法读取
  return { kind: 'binary', name: file.name, size: file.size };
}

function downscaleImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const hh = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = hh;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, hh);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

export function render() {
  const st = store.get();
  if (!state.root) return;
  renderToolbar();
  renderSummary();
  renderChat();
  renderInput();
}

// 新总结流程不再本地分段；这里不再预估调用次数。

let summaryWeb = true;
try {
  summaryWeb = localStorage.getItem('summary-web') !== '0';
} catch (err) {
  summaryWeb = true;
}

function renderToolbar() {
  const st = store.get();
  const bar = state.root.querySelector('#ai-toolbar');
  if (!bar) return;
  clear(bar);
  const hasLines = (st.subtitles || []).length > 0;
  const changed = (st.optimize && st.optimize.corrections ? st.optimize.corrections.length : 0) || 0;
  const canRevert = (st.subtitlesOriginal || []).length > 0 && hasLines;

  // 主操作 + 常用操作直接摆出来（用户要求：复制/导出/重置从 ⋯ 里拿出来）。
  // ⋯ 里只留低频的「回退字幕」（它需要先校对过才有意义）。
  //
  // 主按钮要**如实标出这次会不会先校对**：
  // 以前它永远叫「生成总结」，用户点下去才发现还要先联网核对、
  // 多花一轮 AI + 若干次检索。现在按当前设置直接写在按钮上。
  const viaDesktop = desktopAiAllowed(st.settings) && desktopAiState().ready === true;
  bar.appendChild(
    button(
      state.summaryStreaming ? '生成中…' : viaDesktop ? '生成总结（桌面端）' : '生成总结',
      () => generateSummary(),
      {
        small: true,
        primary: true,
        disabled: !hasLines || state.streaming,
        title: hasLines
          ? viaDesktop
            ? '由桌面端生成：提示词、官方分段与联网工具和桌面端一致'
            : '用现有字幕生成总结；需要外部事实时模型会按需联网检索'
          : '需要先有字幕'
      }
    )
  );
  if (state.streaming || state.summaryStreaming) {
    bar.appendChild(button('停止', () => stopStream(), { small: true, danger: true }));
  }
  bar.appendChild(
    button('转写', () => app.panels.actions && app.panels.actions.runTranscribe(), {
      small: true,
      title: '没有官方字幕时，用视频音轨转写后再总结'
    })
  );
  bar.appendChild(
    button('章节', () => app.panels.actions && app.panels.actions.generateChapters(), {
      small: true,
      disabled: !hasLines,
      title: '用 AI 生成可跳转章节'
    })
  );
  const webLabel = h('label', { class: 'note', style: { display: 'inline-flex', alignItems: 'center', gap: '3px' } });
  const webBox = h('input', {
    type: 'checkbox',
    checked: summaryWeb,
    onchange: (e) => {
      summaryWeb = !!e.target.checked;
      try {
        localStorage.setItem('summary-web', summaryWeb ? '1' : '0');
      } catch (err) {
        /* ignore */
      }
      renderToolbar();
    }
  });
  webLabel.appendChild(webBox);
  webLabel.appendChild(h('span', { text: '联网' }));
  bar.appendChild(webLabel);
  bar.appendChild(button('复制总结', () => copySummary(), { small: true, disabled: !st.summary, title: '复制总结全文（Markdown）' }));
  bar.appendChild(button('导出总结', () => exportSummary(), { small: true, disabled: !st.summary, title: '下载为 Markdown 文件' }));
  bar.appendChild(
    button(
      readingAudio ? '停止朗读' : '朗读',
      () => void readSummary(),
      {
        small: true,
        disabled: !st.summary,
        title: desktopAiState().connected
          ? '用桌面端 TTS 朗读总结；失败会用浏览器语音'
          : '用浏览器语音朗读总结'
      }
    )
  );
  bar.appendChild(button('重置对话', () => resetChat(), { small: true, title: '清空对话历史（不影响字幕与总结）' }));
  bar.appendChild(
    popoverMenu(
      [
        {
          icon: '↩️',
          label: canRevert ? `回退字幕${changed ? `（已改 ${changed} 处）` : ''}` : '回退字幕',
          title: '把字幕恢复到 AI 更正之前的样子',
          disabled: !canRevert,
          onClick: () => revertSubtitles()
        }
      ],
      {
        label: '⋯',
        title: '更多操作',
        // 生成总结前这些都没有内容，点开只看到一片灰字会以为菜单坏了 ——
        // 与其留一堆禁用项，不如直接说清「先做什么」。
        emptyText: !hasLines ? '还没有字幕' : '暂无更多操作',
        emptyHint: !hasLines
          ? '先获取字幕或做语音转录'
          : '生成后这里会出现：复制 / 导出 / 回退字幕 / 重置会话'
      }
    )
  );
  bar.appendChild(h('span', { class: 'spacer' }));
  if (!st.readiness?.ok?.ai) bar.appendChild(h('span', { class: 'muted', text: 'AI 未就绪' }));
}

const AGREEMENT_LABEL = { multi: '多来源一致', conflict: '来源冲突', single: '单一来源', none: '未判定' };
const VERDICT_LABEL = { support: '支持', refute: '反驳', irrelevant: '无关', unknown: '未判定' };

function agreementLabel(e) {
  if (e.agreement === 'multi') return e.judged ? '多来源一致' : '多来源';
  return AGREEMENT_LABEL[e.agreement] || '';
}

function renderMathInElement(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.nodeValue || !/\$[^$]+\$/.test(node.nodeValue)) continue;
    const parent = node.parentElement;
    if (parent && parent.closest('code,pre,a,.katex')) continue;
    targets.push(node);
  }
  for (const node of targets) {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    const re = /\$\$([^$]+)\$\$|\$([^$\n]+)\$/g;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const expr = String(m[1] != null ? m[1] : m[2] || '').trim();
      const display = m[1] != null;
      try {
        const span = document.createElement('span');
        span.className = display ? 'katex-block' : 'katex-inline';
        span.innerHTML = katex.renderToString(expr, {
          displayMode: display,
          throwOnError: true,
          strict: 'ignore'
        });
        frag.appendChild(span);
      } catch (err) {
        frag.appendChild(document.createTextNode(m[0]));
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

function annotateCitations(root, refs) {
  if (!root || !Array.isArray(refs) || !refs.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.nodeValue || !/\[\d{1,3}\]/.test(node.nodeValue)) continue;
    const parent = node.parentElement;
    if (parent && parent.closest('code,pre,a,.md-cite')) continue;
    targets.push(node);
  }
  for (const node of targets) {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    const re = /\[(\d{1,3})\]/g;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const index = Number(m[1]) - 1;
      const ref = refs[index];
      const sup = document.createElement('sup');
      sup.className = 'md-cite';
      sup.textContent = m[0];
      if (ref && /^https?:/i.test(String(ref.url || ''))) {
        sup.title = String(ref.title || ref.url);
        sup.style.cursor = 'pointer';
        sup.addEventListener('click', () => call('tab.open', { url: ref.url }).catch(() => {}));
      }
      frag.appendChild(sup);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

function renderSummary() {
  const st = store.get();
  const host = state.summaryHost;
  if (!host) return;
  if (state.summaryStreaming) {
    setBoolAttr(host, 'data-streaming', true);
    host.textContent = '';
    const box = h('div', { class: 'summary-box', dataset: { streaming: 'true' } });
    const pre = h('pre', { class: 'plain-stream' });
    pre.textContent = st.summaryStream || '正在生成…';
    box.appendChild(pre);
    if (state.summaryStatus) {
      box.appendChild(h('div', { class: 'note', text: state.summaryStatus }));
    }
    if (state.summaryReasoning) {
      const details = h('details', { class: 'verify-queries' });
      details.appendChild(h('summary', { text: '思考过程' }));
      details.appendChild(h('div', { class: 'note', style: { whiteSpace: 'pre-wrap' }, text: state.summaryReasoning.slice(0, 4000) }));
      box.appendChild(details);
    }
    host.appendChild(box);
    return;
  }
  setBoolAttr(host, 'data-streaming', false);
  if (!st.summary && state.summaryError) {
    host.textContent = '';
    const box = h('div', { class: 'alert error', style: { margin: '8px 0' } });
    box.appendChild(h('div', { text: state.summaryError }));
    box.appendChild(
      button('重试', () => {
        state.summaryError = '';
        state.summaryStatus = '';
        state.summaryReasoning = '';
        generateSummary();
      }, { small: true, primary: true })
    );
    host.appendChild(box);
    return;
  }
  if (!st.summary) {
    host.textContent = '';
    const hasLines = (st.subtitles || []).length > 0;
    host.appendChild(
      h('div', { class: 'empty', text: hasLines ? '还没有总结。点上方「生成总结」。' : '「生成总结」需要先有字幕；但下方对话可以直接提问，不需要字幕。' })
    );
    if (hasLines) {
      host.appendChild(
        h('div', {
          class: 'note',
          text: '将使用与桌面端一致的提示词与官方分段；需要外部事实时按需联网检索。'
        })
      );
    }
    return;
  }
  host.textContent = '';
  const refs = (Array.isArray(st.summaryReferences) ? st.summaryReferences : []).filter(
    (ref) => ref && /^https?:/i.test(String(ref.url || ''))
  );
  const box = h('div', { class: 'summary-box' });
  renderMarkdownInto(box, st.summary);
  renderMathInElement(box);
  annotateCitations(box, refs);
  // 章节列表（可点击跳转）
  const chapters = (st.video && st.video.chapters) || [];
  if (chapters.length) {
    const chapBox = h('div', { class: 'summary-box' });
    chapBox.appendChild(h('div', { class: 'section-title', text: '章节（点击跳转）' }));
    chapters.forEach((c) => {
      chapBox.appendChild(
        h('div', { class: 'row tight' }, [
          h('button', {
            class: 'btn btn-sm',
            type: 'button',
            text: fmtTime(c.start),
            title: '跳到这一章',
            onclick: () => app.panels.actions && app.panels.actions.seek(c.start)          }),
          h('span', { text: c.title }),
          c.summary ? h('span', { class: 'muted', text: c.summary }) : null
        ])
      );
    });
    host.appendChild(chapBox);
  }
  host.appendChild(box);

  // 桌面端生成总结时带回的外部资料（本地总结仍用 verifyEvidence）。
  if (refs.length) {
    const refBox = h('details', { class: 'verify-queries' });
    refBox.appendChild(h('summary', { text: `外部资料（${refs.length}）` }));
    let refIndex = 0;
    for (const ref of refs.slice(0, 12)) {
      const url = /^https?:/i.test(String((ref && ref.url) || '')) ? String(ref.url) : '';
      if (!url) continue;
      refIndex += 1;
      const row = h('div', { class: 'verify-query' });
      row.appendChild(
        button(`[${refIndex}] ${String((ref && ref.title) || url)}`, () => {
          call('tab.open', { url }).catch(() => {});
        }, { small: true })
      );
      if (ref.site) row.appendChild(h('span', { class: 'muted', text: String(ref.site) }));
      refBox.appendChild(row);
    }
    host.appendChild(refBox);
  }

  const evidence = Array.isArray(st.verifyEvidence) ? st.verifyEvidence : [];
  const failures = Array.isArray(st.verifyFailures) ? st.verifyFailures : [];
  if (evidence.length || failures.length) {
    const details = h('details', { class: 'verify-queries' });
    details.appendChild(
      h('summary', {
        text: evidence.length
          ? `本次联网核对（${evidence.length} 条查询，按字幕原句检索）`
          : `本次联网核对（未获得可用证据）`
      })
    );
    if (evidence.length && st.verifyJudged === false) {
      details.appendChild(
        h('div', { class: 'verify-note', text: '本次未完成语义判定，证据只按词面与域名粗标。' })
      );
    }
    if (failures.length) {
      details.appendChild(
        h('div', {
          class: 'verify-note',
          text: `有 ${failures.length} 条查询失败：${failures.map((f) => f.item).filter(Boolean).join('、')}`
        })
      );
    }
    for (const e of evidence) {
      const line = h('div', { class: 'verify-query' });
      line.appendChild(h('span', { text: `${e.q} · ${e.count || 0} 条证据` }));
      const agree = agreementLabel(e);
      if (agree) {
        line.appendChild(h('span', { class: `verify-badge is-${e.agreement}`, text: agree }));
      }
      // 把检索词对应的字幕原句放出来：让用户一眼看出「为什么搜这一条」。
      if (e.context) {
        line.appendChild(
          h('div', { class: 'verify-context', text: `字幕原文：${String(e.context).slice(0, 140)}` })
        );
      }
      const items = Array.isArray(e.items)
        ? e.items
        : (e.titles || []).map((title) => ({ title, url: '' }));
      for (const item of items) {
        if (!item.title) continue;
        const verdict =
          item.verdict === 'support' || item.verdict === 'refute' ? VERDICT_LABEL[item.verdict] : '';
        if (verdict) {
          line.appendChild(h('span', { class: `verify-verdict is-${item.verdict}`, text: verdict }));
        }
        const link = h('a', {
          class: 'verify-link',
          href: item.url || '#',
          rel: 'noreferrer',
          text: item.title
        });
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (item.url) call('tab.open', { url: item.url }).catch(() => {});
        });
        line.appendChild(link);
        // 只给标题看不出相关性；带一句摘要，用户能自己判断有没有用。
        if (item.text) {
          line.appendChild(
            h('div', { class: 'verify-snippet', text: String(item.text).slice(0, 160) })
          );
        }
        if (item.quote) {
          line.appendChild(h('div', { class: 'verify-quote', text: `依据原文：${item.quote}` }));
        }
        if (item.note) {
          line.appendChild(h('div', { class: 'verify-note', text: `补充：${item.note}` }));
        }
      }
      details.appendChild(line);
    }
    host.appendChild(details);
  }
}

// 思维链折叠块。
//
// 参考 obsidian-yolo 的 AssistantMessageReasoning 设计：三个阶段
//   · requesting —— 已发出请求、还没吐字        →「正在请求…」
//   · thinking   —— 正在输出思维链、正文还没开始 →「思考中…」+ 单行滚动预览
//   · settled    —— 正文开始/结束               →「已思考 N 秒」，可展开看全文
//
// 关键：**默认折叠**。思维链动辄上千字，默认展开会把回答挤到屏幕外。
// 折叠时不渲染正文内容（yolo 也是这么做的：上万字的子树留着只是白占布局）。
export function buildReasoningBlock(msg) {
  const st = store.get();
  const text = String(msg.reasoning || '');
  const hasText = text.trim().length > 0;
  const streaming = !!msg.streaming;
  const hasAnswer = !!(msg.text && msg.text.trim());
  const stage = streaming && !hasText && !hasAnswer ? 'requesting' : streaming && !hasAnswer ? 'thinking' : 'settled';
  const expandedDefault = !!(st.settings && st.settings.ai && st.settings.ai.expandReasoning);
  // 用户手动点过就以用户的选择为准（同一会话内记住）
  const key = msg.reasonId || (msg.reasonId = `r${Math.random().toString(36).slice(2, 8)}`);
  const expanded = state.reasonOpen && state.reasonOpen.has(key) ? true : state.reasonClosed && state.reasonClosed.has(key) ? false : expandedDefault;

  const wrap = h('div', { class: `reason-block is-${stage}`, dataset: { stage } });
  const btn = h('button', { class: 'reason-head', type: 'button' });

  let label;
  if (stage === 'requesting') label = '正在请求…';
  else if (stage === 'thinking') label = '思考中…';
  else if (msg.reasonMs) label = `已思考 ${Math.max(1, Math.round(msg.reasonMs / 1000))} 秒`;
  else label = '思考过程';

  btn.appendChild(h('span', { class: 'reason-icon', text: stage === 'settled' ? '💭' : '🧠' }));
  btn.appendChild(h('span', { class: 'reason-label', text: label }));
  if (hasText) {
    btn.appendChild(h('span', { class: 'reason-chevron', text: expanded ? '▾' : '▸' }));
  }
  btn.disabled = !hasText;
  wrap.appendChild(btn);

  // 折叠时的单行滚动预览：让用户知道模型在想什么，又不占地方
  if (hasText && !expanded) {
    const preview = h('div', { class: 'reason-preview' });
    // 只取末尾一段（思考内容可能很长）
    const tail = text.replace(/\s+/g, ' ').trim().slice(-260);
    preview.textContent = tail;
    wrap.appendChild(preview);
  }

  // 展开态才挂载全文 —— 折叠时留着整棵子树只是白占布局
  if (hasText && expanded) {
    const body = h('div', { class: 'reason-body' });
    renderMarkdownInto(body, text);
    wrap.appendChild(body);
  }

  if (hasText) {
    btn.addEventListener('click', () => {
      state.reasonOpen = state.reasonOpen || new Set();
      state.reasonClosed = state.reasonClosed || new Set();
      if (expanded) {
        state.reasonOpen.delete(key);
        state.reasonClosed.add(key);
      } else {
        state.reasonClosed.delete(key);
        state.reasonOpen.add(key);
      }
      renderChat();
    });
  }
  return wrap;
}

// 「是否真的还在生成」。
//
// `state.streaming` 是个纯内存标志。如果某条流既没收到 onEnd、也没收到 onError
// （例如 service worker 被回收、页面被挂起、连接静默断开），这个标志会**永远卡在
// true** —— 后果是回车变成「排队」、发送按钮一直不可用，用户完全没法继续对话。
//
// 这里做个自愈：如果标志为 true，但既没有 stream 对象、又超过一段时间没有新内容，
// 就判定它已经失效并复位。
const BUSY_STALE_MS = 15000;
function isBusy() {
  if (!state.streaming) return false;
  const stale = !state.stream && Date.now() - (state.lastStreamActivity || 0) > BUSY_STALE_MS;
  if (stale) {
    state.streaming = false;
    state.stream = null;
  }
  return state.streaming;
}

function touchStream() {
  state.lastStreamActivity = Date.now();
}

// 测试用：把生成状态复位（真实环境里由 onEnd / onError 负责）
export function resetStreamStateForTest() {
  state.streaming = false;
  state.stream = null;
  state.queue = [];
  state.lastStreamActivity = 0;
}

// ---------------------------------------------------------------------------
// 消息级操作
// ---------------------------------------------------------------------------

function msgAction(label, onclick) {
  return h('button', { class: 'msg-action', type: 'button', text: label, onclick });
}

async function copyMessage(msg) {
  await copyText(msg.text || '');
  toast({ title: '已复制这条回复' }, 'ok', 1500);
}

// 重新生成：删掉这条 AI 回复及其之后的对话，用最后一条用户消息重跑
export async function regenerateAt(msg) {
  if (state.streaming) {
    toast({ title: '正在生成中，请先停止' }, 'warn', 2000);
    return;
  }
  const st = store.get();
  const idx = st.chat.indexOf(msg);
  if (idx < 0) return;
  // 往前找最近的用户消息
  let userIdx = -1;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (st.chat[i].role === 'user') {
      userIdx = i;
      break;
    }
  }
  if (userIdx < 0) {
    toast({ title: '找不到对应的问题', detail: '无法重新生成。' }, 'warn', 2500);
    return;
  }
  const question = st.chat[userIdx].text || '';
  // 截断到该问题之前，然后重新问 —— 相当于「从这条消息重跑」
  store.set({ chat: st.chat.slice(0, userIdx) });
  await sendMessage(question, { alreadyInHistory: false, regenerating: true });
}

// 编辑重发：把用户消息放回输入框，并截断其后所有对话
export function editAndResend(msg) {
  if (state.streaming) {
    toast({ title: '正在生成中，请先停止' }, 'warn', 2000);
    return;
  }
  const st = store.get();
  const idx = st.chat.indexOf(msg);
  if (idx < 0) return;
  const text = msg.text || '';
  // 截断这条消息**及其之后**的所有内容，让用户改完重新走一遍
  store.set({ chat: st.chat.slice(0, idx) });
  if (state.inputArea) {
    state.inputArea.value = text;
    state.inputArea.focus();
  }
  render();
  toast({ title: '已取回输入框', detail: '修改后回车重新发送（其后的对话已清除）' }, 'ok', 3000);
}

// 全局 Esc 停止生成（参考 obsidian-yolo：Esc 全局取消所有在跑的 AI 任务）
if (typeof document !== 'undefined' && !document.__bsubEscBound) {
  document.__bsubEscBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.streaming) {
      e.preventDefault();
      stopStream();
    }
  });
}

function renderChat() {
  const st = store.get();
  const host = state.chatHost;
  if (!host) return;
  host.textContent = '';
  if (!st.chat.length) {
    host.appendChild(h('div', { class: 'empty', text: '基于当前视频的字幕提问，回复会按 Markdown 渲染。' }));
  }
  for (const msg of st.chat) {
    const el = h('div', { class: 'msg', dataset: { role: msg.role } });
    el.appendChild(h('div', { class: 'msg-role', text: msg.role === 'user' ? '我' : msg.role === 'assistant' ? 'AI' : '系统' }));

    // 思维链：**独立折叠块**，与最终回答彻底分开
    if (msg.role === 'assistant' && (msg.reasoning || (msg.streaming && !msg.text))) {
      el.appendChild(buildReasoningBlock(msg));
    }

    if (msg.role === 'assistant' && msg.streaming) {
      setBoolAttr(el, 'data-streaming', true);
      // 有思维链时正文还没开始 —— 上面那块已经在显示「思考中」，这里不必再占位
      if (msg.text) {
        const pre = h('pre', { class: 'plain-stream' });
        pre.textContent = msg.text;
        el.appendChild(pre);
      }
    } else if (msg.role === 'user') {
      el.appendChild(h('div', { style: { whiteSpace: 'pre-wrap' }, text: msg.text }));
    } else {
      const body = h('div');
      renderMarkdownInto(body, msg.text || '');
      el.appendChild(body);
    }
    if (msg.attachments && msg.attachments.length) {
      const row = h('div', { class: 'attachments' });
      for (const a of msg.attachments) {
        if (a.kind === 'image') {
          const img = h('img', { class: 'md-img', src: a.dataUrl, alt: a.name, style: { maxHeight: '80px' } });
          row.appendChild(img);
        } else {
          row.appendChild(h('span', { class: 'attach', text: a.name }));
        }
      }
      el.appendChild(row);
    }

    // 消息级操作（参考 obsidian-yolo 的「停止/重试/编辑问题」）：
    //   · AI 消息 → 复制、重新生成
    //   · 用户消息 → 编辑后重新发送（会截断其后的对话）
    if (!msg.streaming) {
      const acts = h('div', { class: 'msg-actions' });
      if (msg.role === 'assistant' && msg.text) {
        acts.appendChild(msgAction('复制', () => copyMessage(msg)));
        acts.appendChild(msgAction('重新生成', () => regenerateAt(msg)));
      }
      if (msg.role === 'user') {
        acts.appendChild(msgAction('编辑重发', () => editAndResend(msg)));
      }
      if (acts.childNodes.length) el.appendChild(acts);
    }

    host.appendChild(el);
  }
  renderQueueBar(host);
}

function renderInput() {
  const wrap = state.root.querySelector('#chat-input-wrap');
  if (!wrap) return;
  clear(wrap);
  if (state.attachments.length) {
    const row = h('div', { class: 'attachments' });
    state.attachments.forEach((a, i) => {
      const chip = h('span', { class: 'attach' }, [
        h('span', { text: `${a.kind === 'image' ? '🖼' : '📄'} ${a.name}` }),
        h('button', {
          type: 'button',
          text: '×',
          title: '移除',
          onclick: () => {
            state.attachments.splice(i, 1);
            renderInput();
          }
        })
      ]);
      row.appendChild(chip);
    });
    wrap.appendChild(row);
  }

  const suggest = h('div', { class: 'suggestions' });
  for (const s of SUGGESTIONS.slice(0, 4)) {
    suggest.appendChild(h('button', { class: 'q-btn', type: 'button', text: s, onclick: () => sendMessage(s) }));
  }
  wrap.appendChild(suggest);

  const row = h('div', { class: 'row tight' });
  const area = h('textarea', {
    class: 'input',
    id: 'chat-input',
    placeholder: (store.get().subtitles || []).length
      ? '基于这期视频提问…（回车发送，Shift+回车换行）'
      : '直接提问即可 —— 没有字幕也能聊（回车发送，Shift+回车换行）',
    style: { flex: '1 1 auto', minHeight: '52px' }
  });
  // 回车行为可配置（参考 obsidian-yolo 的「Use Enter to start a new line」）：
  //   默认 sendOnEnter = true  → 回车发送、Shift+回车换行
  //   改成 false               → 回车换行、Ctrl/Cmd+回车发送
  const sendOnEnter = !(store.get().settings?.ai?.sendOnEnter === false);
  area.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const mod = e.ctrlKey || e.metaKey;
    if (sendOnEnter) {
      // Shift / Alt 换行；Ctrl+回车保留为兼容（老手感）
      if (e.shiftKey || e.altKey) return;
      e.preventDefault();
      submit();
      return;
    }
    // 反过来的模式：回车换行，只有 Ctrl/Cmd+回车才发送
    if (mod && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      submit();
    }
  });
  function submit() {
    const v = area.value;
    if (!String(v || '').trim()) return;
    // 正在生成时**不丢弃**，而是排队 —— 参考 yolo：可以继续输入并发送，
    // 消息排在当前回合结束后自动发出。
    if (isBusy()) {
      enqueueMessage(v);
      area.value = '';
      return;
    }
    sendMessage(v);
    area.value = '';
  }
  area.addEventListener('paste', async (e) => {
    const items = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (items.length) {
      e.preventDefault();
      await addFiles(items);
    }
  });
  row.appendChild(area);
  const col = h('div', { class: 'row tight' }, [
    button('发送', () => submit(), { small: true, primary: true, title: '回车发送 / Shift+回车换行' }),
    button('停止', () => stopStream(), { small: true, danger: true, disabled: !state.streaming })
  ]);
  row.appendChild(col);
  wrap.appendChild(row);

  // ---- 工具条：上传文件 / 联网 / Skills / MCP + 模型切换 ----
  wrap.appendChild(buildChatToolbar());
  state.inputArea = area;
}

// 对话输入区下方的工具条。
// 四个图标分别是：📎 上传文件、🌐 联网、✨ Skills、🔌 MCP；
// 右侧是当前模型下拉（可直接切换已配置的 AI 平台 / 模型）。
function buildChatToolbar() {
  const st = store.get();
  const s = st.settings || {};
  // 首次渲染时 settings 可能还没加载好 —— 工具条退化为「只有上传文件」，
  // 不要让整个对话面板挂掉。
  const search = s.search || {};
  const skills = s.skills || { items: [] };
  const mcp = s.mcp || { enabled: false, servers: [] };
  const ai = s.ai || { platforms: [] };
  const bar = h('div', { class: 'chat-toolbar' });

  // 📎 上传文件
  const fileInput = h('input', {
    type: 'file',
    multiple: true,
    style: { display: 'none' }
  });
  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (files.length) await addFiles(files);
    fileInput.value = '';
  });
  bar.appendChild(fileInput);
  bar.appendChild(
    iconBtn('📎', '上传文件（也可直接拖入或粘贴）', () => fileInput.click(), {
      badge: state.attachments.length ? String(state.attachments.length) : ''
    })
  );

  // 🌐 联网
  const webOn = search.autoSearchOnChat !== false || search.alwaysSearchOnChat === true;
  bar.appendChild(
    iconBtn('🌐', webOn ? '联网：开（点击关闭）' : '联网：关（点击开启）', () => {
      const cur = store.get().settings;
      const next = !(cur.search.autoSearchOnChat !== false || cur.search.alwaysSearchOnChat === true);
      updateSettings((cfg) => {
        cfg.search.autoSearchOnChat = next;
        if (!next) cfg.search.alwaysSearchOnChat = false;
      });
      toast({ title: next ? '已开启联网' : '已关闭联网', detail: next ? '提问涉及外部信息时会自动检索网页' : '对话将只基于字幕回答' }, 'ok', 2500);
      render();
    }, { active: webOn })
  );

  // ✨ Skills
  const skillCount = (skills.items || []).length;
  bar.appendChild(
    iconBtn('✨', `Skills（${skillCount} 个可用）`, () => openSkillPicker(), { active: !!state.activeSkillId, badge: state.activeSkillId ? '1' : '' })
  );

  // 🔌 MCP
  const mcpOn = !!mcp.enabled;
  const mcpCount = (mcp.servers || []).filter((x) => x.enabled !== false).length;
  bar.appendChild(
    iconBtn('🔌', mcpOn ? `MCP：开（${mcpCount} 个服务）` : 'MCP：关（点击开启）', () => {
      const cur = store.get().settings;
      const next = !(cur.mcp && cur.mcp.enabled);
      updateSettings((cfg) => {
        cfg.mcp.enabled = next;
      });
      toast({
        title: next ? '已开启 MCP' : '已关闭 MCP',
        detail: next ? (mcpCount ? '下次提问将把工具交给模型' : '还没有配置服务，请到 设置 → MCP 服务 添加') : '模型将不再调用外部工具'
      }, next && !mcpCount ? 'warn' : 'ok', 3500);
      render();
    }, { active: mcpOn, disabled: false })
  );

  // 模型切换
  //
  // 只列**已配置**的平台（填过 API Key 的）——
  // 之前把所有内置平台和它们的种子模型都列出来，几十个用不了的条目
  // 混在一起，等于没有筛选。当前正在用的平台始终保留在列表里，
  // 否则用户会看到下拉框里选不中自己当前用的模型。
  const platforms = ai.platforms || [];
  const cur = platforms.find((p) => p.id === ai.activeId) || platforms[0];
  const configured = platforms.filter(
    (p) => String(p.apiKey || '').trim() || (cur && p.id === cur.id)
  );
  const sel = h('select', { class: 'model-select', title: '切换已配置的 AI 平台 / 模型' });
  if (!configured.length) {
    const opt = h('option', { value: '', text: '尚未配置任何 AI 平台' });
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
  }
  for (const p of configured) {
    // 关键：把**当前实际在用的模型**并进候选列表。
    // 否则当 p.model 不在 p.models 里（例如用户手填过模型名、
    // 或选过一个后来被清出种子列表的模型）时：
    //   · 下拉框显示的是 p.models 的第一项
    //   · 而真实请求用的是 p.model
    // 于是「对话里显示的模型 ≠ 实际用的模型」—— 这就是用户报的
    // 「对话旁边的模型名与设置里选的不一样」。
    const raw = Array.isArray(p.models) && p.models.length ? p.models.slice() : [];
    if (p.model && !raw.includes(p.model)) raw.unshift(p.model);
    const models = raw.length ? raw : [p.model].filter(Boolean);
    const hasKey = !!String(p.apiKey || '').trim();
    for (const m of models) {
      const opt = h('option', {
        value: `${p.id}::${m}`,
        text: `${p.id === ai.activeId ? '' : `${p.name} · `}${m}${hasKey ? '' : '（未配 Key）'}${m === p.model ? '' : ''}`
      });
      if (p.id === (cur && cur.id) && m === (cur && cur.model)) opt.selected = true;
      sel.appendChild(opt);
    }
  }
  sel.addEventListener('change', () => {
    const [pid, model] = String(sel.value).split('::');
    updateSettings((cfg) => {
      cfg.ai.activeId = pid;
      const target = cfg.ai.platforms.find((x) => x.id === pid);
      if (target && model) target.model = model;
    });
    toast({ title: '已切换模型', detail: `${pid} · ${model}` }, 'ok', 2200);
    render();
  });
  bar.appendChild(sel);

  return bar;
}

function iconBtn(icon, title, onclick, opts = {}) {
  const b = h('button', {
    class: `chat-icon${opts.active ? ' active' : ''}`,
    type: 'button',
    title,
    text: icon,
    onclick
  });
  if (opts.disabled) b.disabled = true;
  if (opts.badge) b.appendChild(h('span', { class: 'chat-icon-badge', text: opts.badge }));
  return b;
}

// 对话界面里的小开关（联网 / MCP / 模型）需要即时生效并持久化。
// 设置页的草稿机制在这里不适用（用户期望点一下立刻生效），所以直接改后保存。
async function updateSettings(mutator) {
  const st = store.get();
  const next = structuredCloneSafe(st.settings);
  mutator(next);
  delete next.__readiness;
  store.set({ settings: next });
  try {
    await call('settings.set', { settings: next });
  } catch (err) {
    toast({ title: '设置保存失败', detail: (err && err.message) || '稍后可在设置页重试' }, 'warn', 3500);
  }
}

function structuredCloneSafe(v) {
  try {
    return structuredClone(v);
  } catch (err) {
    return JSON.parse(JSON.stringify(v));
  }
}

// ---------------------------------------------------------------------------
// 判断「联网能力」的真实状态。对话与总结共用，避免两处判断不一致。
export function searchCapabilityOf(settings) {
  const search = (settings && settings.search) || {};
  const platforms = search.platforms || [];
  const active = platforms.find((p) => p.id === search.activeId) || platforms[0] || null;
  // 复用 AI Key 的平台（DeepSeek 搜索）：AI 那边填了 Key 就等于检索已配置
  let reusedKey = '';
  if (active && active.reuseAiKey) {
    const ai = ((settings.ai && settings.ai.platforms) || []).find((p) => p.id === active.reuseAiKey);
    reusedKey = (ai && ai.apiKey) || '';
  }
  const hasSearchKey = !!(active && (String(active.apiKey || '').trim() || String(reusedKey).trim()));
  const keylessOn = search.keylessFallback !== false;
  return {
    active,
    hasSearchKey,
    keylessOn,
    webCapable: hasSearchKey || keylessOn,
    searchOn: search.autoSearchOnChat !== false,
    alwaysSearch: search.alwaysSearchOnChat === true,
    providerName: active ? active.name || '' : ''
  };
}

// 判断「这个问题值不值得联网检索」。
//
// 除了时效/事实类关键词，还专门覆盖两类容易漏掉的提问：
//   · 用户直接问「你能联网吗 / 帮我查一下」—— 这时他就是要联网，
//     不搜的话模型只能回答「我查不到」，体验很差
//   · 要求核实/求证（「对不对」「准确吗」「核实一下」）
export function needsWebSearch(question) {
  const q = String(question || '');
  if (!q.trim()) return false;
  // ① 明确要求检索 / 询问联网能力
  const asksToSearch = /查一下|搜一下|帮我查|搜索一下|上网查|联网|上网|能不能查|可以查/i;
  if (asksToSearch.test(q)) return true;
  // ② 要求核实 / 求证
  const asksToVerify = /核实|求证|验证|确认一下|准确吗|对不对|是真的吗|有没有错|事实核查|查证/i;
  if (asksToVerify.test(q)) return true;
  // ③ 明确的「外部事实/时效」信号。
  // 这里刻意**不放**「为什么 / 多少 / 对比 / 区别」这类泛问句 ——
  // 它们大多能靠视频字幕回答，搜了反而是一堆无关网页。
  const recencyOrFact =
    /最新|最近|现在|目前|今年|今天|今日|昨天|本周|本月|新闻|动态|进展|价格|股价|汇率|多少人|是谁|什么时候|哪一年|几点|官网|地址|链接|出处|来源/i;
  if (recencyOrFact.test(q)) return true;
  return false;
}

// 用户是否在明确引用「上一轮 / 检索面板里的结果」。
// 只有这种情况才复用旧结果；否则旧结果会被塞进新问题，看起来就是「搜的东西跟问题对不上」。
export function referencesPreviousSearch(question) {
  const q = String(question || '');
  if (!q.trim()) return false;
  return /(?:上面|上述|刚才|刚刚|之前|前面|上一轮|这些|那些)[^。！？\n]{0,8}(?:来源|资料|结果|网页|链接|搜索|检索)|(?:搜到|搜过|检索到)的|根据(?:这些|以上|上面)/.test(
    q
  );
}

// 把 AI 生成的检索词解析成干净的数组。
// 兼容三种输出：JSON 数组、{"queries":[...]}、每行一条（允许编号/项目符号）。
export function parseSearchQueries(text, max = 6) {
  const raw = String(text || '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  if (!raw) return [];
  let arr = [];
  const parse = (candidate) => {
    try {
      const json = JSON.parse(candidate);
      if (Array.isArray(json)) return json;
      if (json && Array.isArray(json.queries)) return json.queries;
    } catch (err) {
      /* 不是 JSON */
    }
    return null;
  };
  arr = parse(raw) || [];
  if (!arr.length) {
    // 模型偶尔会在 JSON 前后加解释；取最外层数组/对象再试。
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start >= 0 && end > start) arr = parse(raw.slice(start, end + 1)) || [];
  }
  if (!arr.length) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) arr = parse(raw.slice(start, end + 1)) || [];
  }
  if (!arr.length) arr = raw.split(/\n+/);
  const out = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const q = item
      // 只去掉真正的列表前缀（- / 1. / (1)），不要把「6710 亿」这种数字开头吃掉
      .replace(/^\s*(?:[-*•·]+\s*|\(\d{1,2}\)\s*|\d{1,2}[.、)）]\s*)/u, '')
      .replace(/^["“”'']+|["“”'']+$/gu, '')
      .trim();
    if (q.length < 3 || q.length > 100) continue;
    if (/https?:\/\//i.test(q) || /^(无|没有|无法|none|null)$/i.test(q)) continue;
    if (out.some((x) => x.toLowerCase() === q.toLowerCase())) continue;
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

// 从字幕里抽一段有代表性的节选（开头 / 中间 / 结尾），给 AI 生成检索词用。
function sampleSubtitleText(lines, maxChars = 3600) {
  const list = Array.isArray(lines) ? lines : [];
  if (!list.length) return '';
  const per = Math.ceil(maxChars / 3);
  const take = (arr) =>
    arr
      .map((l) => String(l.text || ''))
      .join('\n')
      .slice(0, per);
  const third = Math.max(1, Math.floor(list.length / 3));
  return [take(list.slice(0, third)), take(list.slice(third, third * 2)), take(list.slice(third * 2))]
    .filter(Boolean)
    .join('\n…\n');
}

// 让 AI 根据标题 + 字幕节选生成 3~6 条具体检索词。
// 失败/空结果由调用方回退到规则抽取，不影响校对主流程。
async function buildSearchQueries(lines, settings, video, rid) {
  const sample = sampleSubtitleText(lines);
  if (!sample) return [];
  // 先把全文里值得核实的「实体 + 具体说法」抽出来，连同原句一起交给模型。
  // 只给 3600 字节选的话，模型很容易只按标题和几个数字编查询。
  const candidates = buildVerifyClaims(lines, 16);
  const candidateBlock = candidates.length
    ? `全文里值得核实的候选（按语境抽取，可直接改写，不要另编）：\n${candidates
        .map((c) => `- ${c.label}：${c.context}`)
        .join('\n')}`
    : '';
  const system = [
    '你是检索词生成助手。根据视频标题、字幕节选与候选句，生成 3~6 条适合外部事实验证的搜索查询。',
    '要求：',
    '1. 每条查询都要还原字幕里的一个**具体说法**：实体 + 要核实的限定（时间 / 数字 / 版本 / 因果），',
    '   例如「DeepSeek V4 2026 年 3 月发布」「DeepSeek V4 6710 亿参数」；',
    '2. 不要只输出实体名（「DeepSeek」），也不要写行业空话（「AI 行业趋势」「最新进展」）；',
    '3. 实体必须在视频里真实出现过，不要编造视频没提过的公司 / 产品 / 人物，也不要把两个视频外的概念拼在一起；',
    '4. 每条 8~30 字，不要解释，不要编号；',
    '5. 优先基于下面给出的候选句来写，保留候选里的实体与具体说法；',
    '6. 只输出 JSON 字符串数组，例如 ["DeepSeek V4 发布时间", "6710 亿参数量"]。'
  ].join('\n');
  const user = [
    `视频标题：${(video && video.title) || ''}${video && video.partTitle ? ` · ${video.partTitle}` : ''}`,
    `字幕节选：\n${sample}`,
    candidateBlock
  ]
    .filter(Boolean)
    .join('\n\n');
  const res = await call(
    'ai.chat',
    {
      rid,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      platformId: settings.ai.activeId,
      temperature: 0.2,
      maxTokens: 300
    },
    { timeoutMs: 120000 }
  );
  const parsed = parseSearchQueries((res && res.text) || '', 6);
  if (!parsed.length) return [];
  // 检索词必须能在视频原文里找到落点：至少一个实体/数字/中文词出现过。
  // 用全部字幕而不是上面 3600 字的节选 —— 模型漏掉的实体可能在后半段。
  const source = [
    (video && video.title) || '',
    (video && video.partTitle) || '',
    (Array.isArray(lines) ? lines : []).map((l) => String(l.text || '')).join('\n')
  ]
    .filter(Boolean)
    .join('\n');
  const grounded = parsed.filter((q) => isQueryGroundedIn(q, source));
  // 不只把模型给的短查询原样发出去：找到它在字幕里的原句，
  // 用整句作为检索词（同一句只搜一次），这样查询自带上下文。
  const out = [];
  const seen = new Set();
  for (const q of grounded) {
    const context = contextWindowForQuery(lines, q);
    const query = contextualQuery(q, context);
    const key = String(query || q).replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: q, query, context });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 阶段 1：校对字幕
// ---------------------------------------------------------------------------

// 对字幕做「术语 / 逻辑 / 时间 / 事实」校对，并**把修正写回字幕**。
//
// 用户明确要求的流程：
//   点生成总结 → 查字幕里的错误（联网）→ 更正 → 用更正后的字幕生成总结
//   且「原有字幕文件已经发生修改，但是可以回退至原有的字幕」
//
// 因此这里做三件事：
//   ① 把**原始字幕**备份到 `st.subtitlesOriginal`（回退用，只备份一次，
//      避免二次校对把「已更正版」当成原文备份）
//   ② 抽出待核实项 → 联网逐条核对 → 让模型给出修正
//   ③ 应用修正并写回 store，同时生成一份「改了哪些」的报告
// 旧「生成总结前校对字幕」流程已移除；字幕优化走独立的 optimizeWithAi。
export async function revertSubtitles() {
  const st = store.get();
  const orig = st.subtitlesOriginal;
  if (!orig || !orig.length) {
    toast({ title: '没有可回退的原始字幕' }, 'warn');
    return false;
  }
  setLines(orig.map((l) => ({ ...l })), { label: '回退字幕到原始版本' });
  store.set({ optimize: { ...(st.optimize || {}), corrections: [], pending: false } });
  await saveHistory();
  toast({ title: '已回退到原始字幕', detail: 'AI 的更正已撤销。' }, 'ok', 3000);
  render();
  return true;
}

// ---------------------------------------------------------------------------
// 证据语义判定
// ---------------------------------------------------------------------------
//
// 词面相关性只能判断「像不像在说同一件事」，判断不了「到底支持还是反驳」。
// 这里用**一次** AI 调用同时做两件事：
//   ① 给每条证据标 support / refute / irrelevant；
//   ② 为「多来源一致」的条目顺带产出 0~3 条可写进总结的外部补充。
// 所以它替代的是原来独立的 buildSummarySupplement 调用，不额外增加请求数。

const VERDICT_SET = new Set(['support', 'refute', 'irrelevant']);
// 兼容模型偶尔输出中文标签
const VERDICT_ALIAS = {
  '支持': 'support',
  '反驳': 'refute',
  '矛盾': 'refute',
  '无关': 'irrelevant',
  '不相关': 'irrelevant'
};

// 旧校对证据判定/外部补充已移除。
export function buildCapabilityBlock(info = {}) {
  const {
    webCapable = false,
    searchOn = true,
    alwaysSearch = false,
    hasSearchKey = false,
    searchProviderName = '',
    searchUsed = false,
    searchResultCount = 0,
    searchFailNote = '',
    evidenceLabel = '参考资料',
    hasSubtitles = false,
    subtitleCount = 0,
    attachmentCount = 0,
    mcpOn = false,
    mcpServerCount = 0,
    skillsCount = 0,
    activeSkill = ''
  } = info;

  const lines = [];
  lines.push('【你当前的能力（这是事实描述；关于「你能不能…」的问题请据此回答，不要凭训练印象否认）】');

  // 联网
  //
  // 这段措辞必须与**实际行为**一致。之前写「会自动检索网页，结果会附在下面」，
  // 但检索是按关键词触发的 —— 问题没命中关键词时模型收到空资料，
  // 只能回一句「系统提示说会附参考资料，但这次并没有」。
  // 那是我们的提示在撒谎，不是模型出错。
  if (webCapable && (searchOn || searchUsed)) {
    const channel = hasSearchKey
      ? `已配置检索平台${searchProviderName ? `（${searchProviderName}）` : ''}`
      : '使用免费检索引擎（Bing / AnySearch / Exa，无需 Key）';
    if (searchUsed && searchResultCount > 0) {
      lines.push(`· 联网检索：**可用**（${channel}），**本轮已经检索过**，${searchResultCount} 条来源见下方${evidenceLabel}。`);
    } else if (alwaysSearch) {
      lines.push(`· 联网检索：**可用**（${channel}），已设为每轮都检索。下方参考资料若为空说明这次检索失败。`);
    } else {
      lines.push(
        `· 联网检索：**可用**（${channel}）。` +
          '检索是按需触发的：只有提问含外部/时效信息时才自动检索。\n' +
          '  └ **本轮没有进行检索，所以下面不会有网页资料**。' +
          '如果确实需要联网，请告诉用户「这需要联网确认」，建议他把问题问得更明确（例如加「查一下」）；' +
          '否则就基于已有知识回答，并说明可能过时。**绝对不要声称自己查过网页。**'
      );
    }
  } else if (webCapable && !searchOn) {
    lines.push('· 联网检索：**用户已关闭**（对话区的 🌐 开关处于关闭状态）。需要时请提示用户打开它。');
  } else {
    lines.push(
      '· 联网检索：**当前不可用**（既没有配置检索平台的 Key，也关闭了免费引擎兜底）。' +
        '如果用户需要联网，请引导他到 设置 → 联网检索 填 Key 或开启「免费引擎兜底」。'
    );
  }
  if (searchFailNote) {
    lines.push(`  └ 注意：本轮尝试联网但失败了（${searchFailNote}），所以这次没有网页资料可用。`);
  }

  // 视频字幕
  if (hasSubtitles) {
    lines.push(`· 视频字幕：**已加载**（${subtitleCount} 行），已在下方给出原文，你可以基于视频内容回答。`);
  } else {
    lines.push('· 视频字幕：**尚未加载**，所以你现在看不到视频内容；不要编造视频里说过的话。');
  }

  // 附件
  if (attachmentCount > 0) {
    lines.push(`· 用户本轮上传了 ${attachmentCount} 个文件/图片，已作为消息附件发送。`);
  }

  // MCP 工具
  if (mcpOn && mcpServerCount > 0) {
    lines.push(
      `· 外部工具（MCP）：**已启用**，连接了 ${mcpServerCount} 个服务。` +
        '你能调用的工具见请求里的 tools 定义；需要外部数据或操作时请直接调用，不要声称自己做不到。'
    );
  } else if (mcpServerCount > 0) {
    lines.push('· 外部工具（MCP）：已配置但**用户关闭了**（对话区的 🔌 开关）。');
  } else {
    lines.push('· 外部工具（MCP）：未配置。');
  }

  // Skills
  if (activeSkill) {
    lines.push(`· 技能：本轮已选定「${activeSkill}」，请按该技能的正文要求执行。`);
  } else if (skillsCount > 0) {
    lines.push(`· 技能：有 ${skillsCount} 个可用技能（对话区点 ✨ 选择），本轮未选定。`);
  }

  lines.push(
    '注意：上面只是「这个浏览器扩展能给模型提供什么」。' +
      '你本身仍然是语言模型；请准确区分「我能推理」与「这个扩展给我接了联网/工具」。'
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 消息队列（生成中继续输入）
// ---------------------------------------------------------------------------
//
// 参考 obsidian-yolo：生成过程中可以继续打字并发送，消息排队，
// 当前回合结束后自动发出；**中止时未发出的消息要还回输入框**，不能丢。

function enqueueMessage(text) {
  const q = state.queue || (state.queue = []);
  q.push({ id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, text });
  toast({ title: '已排队', detail: '当前回答结束后会自动发送' }, 'ok', 2000);
  renderChat();
}

function dequeueNext() {
  const q = state.queue || [];
  const next = q.shift();
  state.queue = q;
  return next || null;
}

// 中止时把队列还回输入框（而不是静默丢弃）
function restoreQueueToInput() {
  const q = state.queue || [];
  if (!q.length) return;
  const text = q.map((x) => x.text).join('\n\n');
  state.queue = [];
  if (state.inputArea) {
    state.inputArea.value = state.inputArea.value ? `${state.inputArea.value}\n\n${text}` : text;
  }
  toast({ title: '已把排队的消息放回输入框', detail: `${q.length} 条未发送` }, 'warn', 3000);
}

// 渲染队列条（显示待发送的消息，可单条移除）
function renderQueueBar(host) {
  const q = state.queue || [];
  if (!q.length) return;
  const bar = h('div', { class: 'queue-bar' });
  bar.appendChild(h('span', { class: 'queue-title', text: `排队中 ${q.length} 条` }));
  for (const item of q) {
    const row = h('div', { class: 'queue-item' });
    row.appendChild(h('span', { class: 'queue-text', text: item.text }));
    row.appendChild(
      h('button', {
        class: 'queue-del',
        type: 'button',
        title: '移除这条',
        text: '×',
        onclick: () => {
          state.queue = (state.queue || []).filter((x) => x.id !== item.id);
          renderChat();
        }
      })
    );
    bar.appendChild(row);
  }
  host.appendChild(bar);
}

// Skills 选择面板
function openSkillPicker() {
  const s = store.get().settings || {};
  const overlay = h('div', { class: 'skill-overlay' });
  const box = h('div', { class: 'skill-box' });
  box.appendChild(h('div', { class: 'skill-head', text: '选择技能（点击即填入并发送）' }));
  box.appendChild(
    h('button', {
      class: 'q-btn',
      type: 'button',
      text: '✖ 不使用技能',
      onclick: () => {
        state.activeSkillId = null;
        overlay.remove();
        render();
      }
    })
  );
  for (const sk of (s.skills && s.skills.items) || []) {
    const item = h('button', {
      class: `skill-item${state.activeSkillId === sk.id ? ' active' : ''}`,
      type: 'button',
      onclick: () => {
        state.activeSkillId = sk.id;
        overlay.remove();
        const area = state.inputArea;
        const text = area && area.value.trim() ? `${sk.body}\n\n${area.value.trim()}` : sk.body;
        if (area) area.value = '';
        sendMessage(text);
        render();
      }
    });
    item.appendChild(h('span', { class: 'skill-icon', text: sk.icon || '✨' }));
    const mid = h('span', { class: 'skill-mid' });
    mid.appendChild(h('span', { class: 'skill-name', text: sk.name || sk.id }));
    if (sk.desc) mid.appendChild(h('span', { class: 'skill-desc', text: sk.desc }));
    item.appendChild(mid);
    box.appendChild(item);
  }
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  render();
}

export function focusInput() {
  if (state.inputArea) state.inputArea.focus();
}

export function sendPending() {
  const st = store.get();
  const last = st.chat[st.chat.length - 1];
  if (last && last.role === 'user') {
    // 由 askAboutLine 预置了问题：直接发送最后一条用户消息
    sendMessage(last.text, { alreadyInHistory: true });
  }
}

// ---------------------------------------------------------------------------
// 总结
// ---------------------------------------------------------------------------

// 生成总结。
//
// opts.skipProofread：跳过阶段 1 的联网校对，直接用现有字幕生成。
//   为什么要有这个开关：联网核对要逐条搜索，是最耗时的一段（可能几十秒）。
//   用户要求加一个「快速总结」按钮来跳过它。
// ---------------------------------------------------------------------------
// 长视频的分段总结（map-reduce）
// ---------------------------------------------------------------------------
//
// 用户报：「2 小时的视频官方字幕是全的，但总结到某个时间点后就没有了。」
//
// 根因就在下面这行（曾经写的）：
//     const ctx = selectContext(correctedLines, '', 40000);
// 传空问题时 `selectContext` 会走
//     return { text: full.slice(0, maxChars), truncated: true }
// 也就是**只取前 40000 字符**。
// 2 小时视频的字幕转写约 6.6 万字符 → 只喂进去约 61%，
// 于是总结自然只覆盖到大约 73 分钟处。
//
// 字幕本身是**完整的**（validateLines 只校验覆盖率，从不截断），
// 截断完全发生在「喂给 AI」这一步。
//
// 修法：超过上限就**分段总结再合并**（map-reduce），
// 而不是把剩下的部分丢掉。

// 按行分段，每段不超过 maxChars，尽量在行边界切
// 分段提示词已随分段总结一起移除。
export function subtitleSpan(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  if (!arr.length) return null;
  let first = Infinity;
  let last = 0;
  let count = 0;
  for (const l of arr) {
    const from = Number(l && l.from);
    if (Number.isFinite(from)) {
      if (from < first) first = from;
      if (from > last) last = from;
      count += 1;
    }
    const to = Number(l && l.to);
    if (Number.isFinite(to) && to > last) last = to;
  }
  if (!count) return null;
  return { first: first === Infinity ? 0 : first, last, count };
}

// 时长为 [时:分:秒]（超过 1 小时时带小时）。
// 不能直接用 fmtClock —— 它输出 [分:秒]，2 小时视频会变成「103:43」，
// 读起来不像时间点。
export function hmsClock(s) {
  const v = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(v / 3600);
  const mm = String(Math.floor((v % 3600) / 60)).padStart(2, '0');
  const ss = String(v % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function describeSpan(span, durationSeconds) {
  if (!span) return '';
  const dur = Number(durationSeconds) || 0;
  const head = `本视频**已获取到**的字幕时间范围：${hmsClock(span.first)} ~ ${hmsClock(span.last)}（共 ${span.count} 行）`;
  const tail = dur ? `；视频总时长 ${hmsClock(dur)}` : '';
  return head + tail;
}

// 插件本地的新总结流程：与桌面端一致，不做前置校对/分段。
async function generateSummaryLocalNew() {
  const st = store.get();
  const settings = st.settings || {};
  const lines = st.subtitles || [];
  if (!lines.length) return null;
  const video = st.video || {};
  const task = jobs.beginTask(TASK_LABEL.summarize, { detail: '整理提示词…' });
  state.summaryAbortRequested = false;
  state.summaryStreaming = true;
  state.streaming = true;
  state.summaryError = '';
  state.summaryStatus = '';
  state.summaryReasoning = '';
  state.stream = null;
  store.set({ summaryStream: '', summaryReferences: [] });
  render();
  try {
    const official = Array.isArray(video.viewPoints)
      ? video.viewPoints
          .map((point) => ({
            from: Number(point.from != null ? point.from : point.start) || 0,
            to: Number(point.to != null ? point.to : point.end) || 0,
            content: String(point.content || point.title || '').trim()
          }))
          .filter((point) => point.content && point.to > point.from)
      : [];
    const prompt = buildSummaryPrompt({
      info: { ...video, viewPoints: official },
      promptText: activePromptText(),
      formatRules: (settings.prompt && settings.prompt.summaryFormatRules) || '',
      glossary: ((settings.optimize && settings.optimize.glossary) || []).map((item) => ({
        from: String(item.term || ''),
        to: '',
        note: String(item.note || '')
      })),
      useVideoMeta: !(settings.summary && settings.summary.useVideoMeta === false)
    });
    const messages = [
      { role: 'system', content: prompt.system },
      {
        role: 'user',
        content: [
          prompt.user,
          '',
          '下面是这期视频的字幕原文（已提供的全部，请据此整理，不要推测缺失部分）：',
          linesToTranscript(lines)
        ].join('\n')
      }
    ];
    const stream = new Stream();
    state.stream = stream;
    const localRefs = [];
    let streamedChars = 0;
    task.set(50, '正在生成总结…');
    stream.start(
      'ai.summarize',
      {
        messages,
        platformId: settings.ai.activeId,
        temperature: settings.ai.temperature,
        maxTokens: settings.ai.maxTokens,
        webTools: summaryWeb && searchCapabilityOf(settings).webCapable
      },
      {
        onLog: (_level, text) => {
          state.summaryStatus = String(text || '联网中…');
          task.set(50, state.summaryStatus);
          renderSummary();
        },
        onReasoning: (piece) => {
          state.summaryStatus = '模型思考中…';
          if (!state.summaryReasoning) renderSummary();
          state.summaryReasoning += String(piece || '');
        },
        onTool: (event) => {
          if (!event) return;
          if (event.phase === 'start') {
            state.summaryStatus = `调用工具：${event.name || '工具'}`;
            task.set(50, state.summaryStatus);
            renderSummary();
          }
          if (event.phase === 'end' && event.name === 'web_search' && event.text) {
            const lines = String(event.text).split('\n');
            for (let i = 0; i < lines.length; i += 1) {
              const hit = /^\[\d+\]\s*(.*)$/.exec(lines[i].trim());
              const url = (lines[i + 1] || '').trim();
              if (hit && /^https?:\/\//i.test(url) && !localRefs.some((ref) => ref.url === url)) {
                localRefs.push({ title: hit[1] || url, url });
              }
            }
            store.set({ summaryReferences: localRefs.slice(0, 12) });
          }
        },
        onDelta: (text) => {
          const cur = store.get();
          store.set({ summaryStream: (cur.summaryStream || '') + text });
          streamedChars += text.length;
          task.set(Math.min(95, 60 + Math.log10(streamedChars + 1) * 11), `生成中（已 ${streamedChars} 字）`);
          renderSummary();
          scrollAiBottom();
        },
        onEnd: async () => {
          const bodyText = store.get().summaryStream || '';
          state.summaryStreaming = false;
          state.streaming = false;
          state.stream = null;
          state.summaryRid = '';
          state.summaryAbortRequested = false;
          const chapters = official.length
            ? official.map((point) => ({
                title: point.content,
                start: point.from,
                end: point.to,
                summary: ''
              }))
            : video.chapters || [];
          store.set({
            summary: bodyText,
            summaryStream: '',
            video: { ...video, chapters }
          });
          recountCitations(bodyText);
          await saveHistory();
          task.set(100, `完成（${bodyText.length} 字）`);
          task.end();
          render();
          toast({ title: '总结完成', detail: '已按 Markdown 渲染' }, 'ok');
        },
        onError: (payload) => {
          state.summaryStreaming = false;
          state.streaming = false;
          state.stream = null;
          state.summaryRid = '';
          state.summaryAbortRequested = false;
          task.end();
          const partial = store.get().summaryStream || '';
          if (partial) {
            store.set({ summary: partial, summaryStream: '' });
            toast({ title: '总结中断，已保留已生成的部分', detail: payload.detail }, 'warn', 5000);
          } else {
            state.summaryError = `${payload.title || '总结失败'}${payload.detail ? `：${payload.detail}` : ''}`;
            showError(Object.assign(new Error(payload.title), { payload }));
          }
          render();
        }
      }
    );
    return { text: store.get().summary || '' };
  } catch (err) {
    state.summaryStreaming = false;
    state.streaming = false;
    state.stream = null;
    task.end();
    showError(err, '总结失败');
    return null;
  }
}

export async function generateSummary(opts = {}) {
  const st = store.get();
  if (state.streaming) {
    toast({ title: '正在生成中，请先停止或等待完成' }, 'warn', 2500);
    return;
  }
  if (!(st.subtitles || []).length) {
    toast(
      {
        title: '生成总结需要字幕',
        detail: '请先获取字幕（顶部「获取字幕」）或做语音转录。如果只是想提问，直接在下方对话框输入即可（不需要字幕）。'
      },
      'warn',
      5000
    );
    return;
  }
  const settings = st.settings;
  const officialPoints = Array.isArray(st.video && st.video.viewPoints)
    ? st.video.viewPoints
        .map((point) => ({
          from: Number(point.from != null ? point.from : point.start) || 0,
          to: Number(point.to != null ? point.to : point.end) || 0,
          content: String(point.content || point.title || '').trim()
        }))
        .filter((point) => point.content && point.to > point.from)
    : [];
  if (officialPoints.length && !(Array.isArray(st.video.chapters) && st.video.chapters.length)) {
    store.set({
      video: {
        ...st.video,
        chapters: officialPoints.map((point) => ({
          title: point.content,
          start: point.from,
          end: point.to,
          summary: ''
        }))
      }
    });
  }

  const allowDesktop = opts.forceLocal !== true && desktopAiAllowed(settings);
  const desktopAi = allowDesktop ? await probeDesktopAi() : { ready: false };
  const useDesktop =
    allowDesktop && (desktopAi.ready === true || desktopAiRequired(settings));
  // 插件独立运行：直接走新流程（不做前置校对、不做分段）。
  if (!useDesktop) return generateSummaryLocalNew();

  // 桌面端执行：只传原始视频/字幕，提示词、官方分段、联网工具都由桌面端统一处理。
  const task = jobs.beginTask(TASK_LABEL.summarize, { detail: '准备中…' });
  state.summaryAbortRequested = false;
  state.summaryRid = '';
  state.summaryStreaming = true;
  state.streaming = true;
  state.summaryError = '';
  state.summaryStatus = '';
  state.summaryReasoning = '';
  store.set({ summaryStream: '', summaryReferences: [] });
  render();

  const stream = new DesktopStream();
  state.stream = stream;
  let streamedChars = 0;
  task.set(10, '桌面端准备中…');
  stream.start(
    'ai.summarize',
    {
      platformId: settings.ai.activeId,
      temperature: settings.ai.temperature,
      maxTokens: settings.ai.maxTokens,
      video: st.video,
      lines: st.subtitles,
      web: true
    },
    {
      onLog: (_level, text) => {
        state.summaryStatus = String(text || '桌面端准备中…');
        task.set(20, state.summaryStatus);
        renderSummary();
      },
      onReasoning: (piece) => {
        state.summaryStatus = '桌面端模型思考中…';
        if (!state.summaryReasoning) renderSummary();
        state.summaryReasoning += String(piece || '');
      },
      onTool: (event) => {
        if (!event) return;
        if (event.phase === 'start') {
          state.summaryStatus = `桌面端调用工具：${event.name || '工具'}`;
          task.set(45, state.summaryStatus);
          renderSummary();
        }
      },
      onDelta: (text) => {
        const cur = store.get();
        store.set({ summaryStream: (cur.summaryStream || '') + text });
        streamedChars += text.length;
        task.set(Math.min(95, 60 + Math.log10(streamedChars + 1) * 11), `生成中（已 ${streamedChars} 字）`);
        renderSummary();
        scrollAiBottom();
      },
      onEnd: async (event) => {
        const bodyText = store.get().summaryStream || '';
        state.summaryStreaming = false;
        state.streaming = false;
        state.stream = null;
        state.summaryRid = '';
        state.summaryAbortRequested = false;
        const chapters = officialPoints.length
          ? officialPoints.map((point) => ({
              title: point.content,
              start: point.from,
              end: point.to,
              summary: ''
            }))
          : st.video.chapters || [];
        store.set({
          summary: bodyText,
          summaryStream: '',
          summaryReferences: Array.isArray(event && event.references) ? event.references : [],
          video: { ...st.video, chapters }
        });
        recountCitations(bodyText);
        await saveHistory();
        task.set(100, `完成（${bodyText.length} 字）`);
        task.end();
        render();
        toast({ title: '总结完成', detail: `已按 Markdown 渲染（${bodyText.length} 字）` }, 'ok');
      },
      onError: (payload) => {
        const aborted = state.summaryAbortRequested || (payload && payload.kind === 'aborted');
        state.summaryStreaming = false;
        state.streaming = false;
        state.stream = null;
        state.summaryRid = '';
        state.summaryAbortRequested = false;
        task.end();
        const partial = store.get().summaryStream || '';
        if (partial) {
          store.set({ summary: partial, summaryStream: '' });
          toast({ title: '总结中断，已保留已生成的部分', detail: payload.detail }, 'warn', 5000);
          render();
          return;
        }
        if (useDesktop && !aborted) {
          toast(
            {
              title: '桌面端生成失败，改用插件本地 AI',
              detail: (payload && payload.detail) || '桌面端不可用'
            },
            'warn',
            4500
          );
          render();
          void generateSummary({ ...opts, forceLocal: true });
          return;
        }
        state.summaryError = `${payload.title || '总结失败'}${payload.detail ? `：${payload.detail}` : ''}`;
        showError(Object.assign(new Error(payload.title), { payload }));
        render();
      }
    }
  );
}

function stopStream() {
  // 生成总结的「校对 / 分段」阶段没有流式对象，靠 summaryAbortRequested +
  // rid（如已有在跑的单次 ai.chat）来终止。
  // 以前这里要求 summaryRid 非空，校对阶段按了完全没反应。
  if (state.summaryStreaming && !state.stream) {
    state.summaryAbortRequested = true;
    if (state.summaryRid) call('cancel', { rid: state.summaryRid }, { timeoutMs: 8000 }).catch(() => {});
    toast({ title: '正在终止生成总结…' }, 'warn', 1500);
    return;
  }
  if (state.stream) {
    state.stream.cancel();
    // 中止时把队列还回输入框（参考 yolo：不丢排队的消息）
    restoreQueueToInput();
    renderChat();
    toast({ title: '已请求终止生成' }, 'warn', 1500);
  }
}

async function copySummary() {
  const st = store.get();
  await copyText(st.summary || '');
  toast({ title: '已复制总结' }, 'ok', 1500);
}

async function exportSummary() {
  const st = store.get();
  const { downloadFile } = await import('./dom.js');
  const name = `${(st.video?.title || '视频').replace(/[\\/:*?"<>|]/g, '_')}-总结.md`;
  downloadFile(name, st.summary || '', 'text/markdown;charset=utf-8');
  toast({ title: `已导出 ${name}` }, 'ok');
}

// ---------------------------------------------------------------------------
// 对话
// ---------------------------------------------------------------------------

let readingAudio = null;

function stopReading() {
  if (readingAudio) {
    try {
      readingAudio.pause();
      readingAudio.currentTime = 0;
    } catch (err) {
      /* ignore */
    }
    readingAudio = null;
  }
  try {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  } catch (err) {
    /* ignore */
  }
  renderToolbar();
}

async function readSummary() {
  const text = String(store.get().summary || '').trim();
  if (!text) return;
  if (readingAudio) {
    stopReading();
    return;
  }
  let desktopError = '';
  if (desktopAiState().connected) {
    try {
      const out = await speakViaDesktop(text);
      if (out && out.dataUrl) {
        const audio = new Audio(out.dataUrl);
        readingAudio = audio;
        audio.onended = () => {
          readingAudio = null;
          renderToolbar();
        };
        audio.onerror = () => {
          readingAudio = null;
          renderToolbar();
        };
        await audio.play();
        renderToolbar();
        return;
      }
    } catch (err) {
      readingAudio = null;
      desktopError = (err && err.message) || String(err);
    }
  }
  try {
    if (typeof speechSynthesis === 'undefined') throw new Error('当前浏览器不支持语音朗读');
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.onend = () => {
      readingAudio = null;
      renderToolbar();
    };
    readingAudio = { pause: () => speechSynthesis.cancel(), currentTime: 0 };
    speechSynthesis.speak(utterance);
    if (desktopError) toast({ title: '桌面端朗读失败，已改用浏览器语音', detail: desktopError }, 'warn', 3200);
    renderToolbar();
  } catch (err) {
    toast(
      {
        title: '朗读失败',
        detail: desktopError || (err && err.message) || '当前环境不支持语音朗读'
      },
      'warn',
      3200
    );
  }
}

function sessionLabel(row) {
  const meta = row.meta || {};
  const title = meta.title || meta.videoTitle || '';
  if (title) return String(title).slice(0, 80);
  const first = (row.messages || []).find((message) => message.role === 'user' && message.text);
  return first ? String(first.text).slice(0, 60) : '未命名对话';
}

async function refreshChatSessions() {
  try {
    const rows = await chatHistoryAll();
    store.set({
      chatSessions: rows
        .filter((row) => row && Array.isArray(row.messages) && row.messages.length)
        .slice(0, 60)
    });
  } catch (err) {
    store.set({ chatSessions: [] });
  }
  renderChatSessions();
}

function renderChatSessions() {
  const host = state.sessionsHost;
  if (!host) return;
  clear(host);
  const rows = (store.get().chatSessions || []).filter(
    (row) => row.key !== chatKey(store.get().video)
  );
  if (!rows.length) return;
  host.appendChild(
    h('div', { class: 'chat-sessions-title', text: `历史对话（${rows.length}）` })
  );
  for (const row of rows.slice(0, 12)) {
    host.appendChild(
      button(
        `${sessionLabel(row)}${row.meta && row.meta.importedFrom === 'desktop' ? ' · 桌面' : ''}`,
        () => void openChatSession(row),
        { small: true, title: '查看历史对话' }
      )
    );
  }
}

async function openChatSession(row) {
  if (!row) return;
  if (row.key === chatKey(store.get().video)) {
    await loadChatForVideo(store.get().video);
    renderChat();
    scrollAiBottom();
    return;
  }
  const body = h('div', {
    class: 'chat-session-preview',
    style: { maxHeight: '60vh', overflow: 'auto', display: 'grid', gap: '8px' }
  });
  for (const message of row.messages || []) {
    body.appendChild(
      h('div', { class: 'note', style: { whiteSpace: 'pre-wrap' } }, [
        h('strong', { text: message.role === 'assistant' ? 'AI：' : '你：' }),
        h('span', { text: String(message.text || '') })
      ])
    );
  }
  openOverlay(sessionLabel(row), body, [{ label: '关闭', onClick: () => closeOverlays() }], {
    width: 'min(640px, 92vw)'
  });
}

export function resetChat() {
  if (state.streaming) stopStream();
  void clearChatForVideo();
  store.set({ chat: [] });
  render();
  toast({ title: '会话已重置', detail: '字幕与总结不受影响。' }, 'ok');
}

export async function sendMessage(text, opts = {}) {
  const question = String(text || '').trim();
  if (!question) return;
  const st = store.get();
  // 桌面端 AI 可用时，即使插件自己没配 Key 也能对话/总结。
  const allowDesktop = desktopAiAllowed(st.settings);
  const desktopAi = allowDesktop ? await probeDesktopAi() : { ready: false };
  const useDesktop =
    allowDesktop && (desktopAi.ready === true || desktopAiRequired(st.settings));
  if (!st.readiness?.ok?.ai && !useDesktop) {
    const issue = (st.readiness?.issues || []).find((i) => i.area === 'ai');
    showError(
      Object.assign(new Error('AI 未配置'), {
        payload: {
          kind: 'nokey',
          title: 'AI 暂时不可用',
          detail: issue ? issue.text : '当前 AI 平台缺少 API Key、模型或接口地址。',
          action: '打开 设置 → AI 平台，补齐配置后点「测试连接」。'
        }
      })
    );
    return;
  }
  // 字幕不是必须的 —— 没有字幕时也能正常对话（纯问答 / 联网检索 /
  // 归纳粘贴内容 / 调用 MCP 工具）。有字幕时才把字幕作为上下文附加。
  const hasSubtitles = (st.subtitles || []).length > 0;

  const attachments = state.attachments.slice();
  state.attachments = [];
  const history = opts.alreadyInHistory ? st.chat : [...st.chat, { role: 'user', text: question, attachments }];
  if (opts.alreadyInHistory) {
    history[history.length - 1] = { ...history[history.length - 1], attachments };
  }
  const placeholderIndex = history.length;
  store.set({ chat: [...history, { role: 'assistant', text: '', streaming: true }] });
  state.streaming = true;
  render();
  scrollAiBottom();

  const settings = st.settings;
  const webOn =
    settings.search.autoSearchOnChat !== false || settings.search.alwaysSearchOnChat === true;
  const ctx = selectContext(st.subtitles, question, 30000);

  // 「联网到底能不能用」的真实判断：
  //   配了检索平台的 Key        → 能（走用户的正式渠道）
  //   没配 Key 但开了免费引擎兜底 → 也能（Bing/AnySearch/Exa）
  //   两者都没有                 → 真的不能
  const cap = searchCapabilityOf(settings);

  // 对话时按需自动检索。
  //
  // 注意：**不再默认沿用 `st.search.results`**。
  // 旧结果属于上一次检索（可能是另一个问题，甚至另一个视频），
  // 直接塞进新问题就是用户看到的「搜的东西跟问题对不上」。
  // 只有用户明确在问「这些来源 / 刚才搜到的」时才复用。
  let searchResults = [];
  let searchUsed = false;
  let searchFailNote = '';
  let relevanceQuery = '';
  if (!useDesktop && settings.search.autoSearchOnChat !== false && question) {
    const needsWeb = needsWebSearch(question);
    // 问题里有明显的外部信息需求时，或用户希望每轮都搜时，才真正发起检索
    const shouldSearch = needsWeb || settings.search.alwaysSearchOnChat === true;
    if (shouldSearch && !cap.webCapable) {
      // 明确告知「为什么没联网」，而不是静默跳过
      toast(
        {
          title: '未能联网：没有可用的检索方式',
          detail: '打开 设置 → 联网检索，填入 Key，或开启「免费引擎兜底」（无需 Key 即可联网）。'
        },
        'warn',
        6000
      );
    } else if (shouldSearch) {
      try {
        // 复用已有的检索流程（它自己会写回 store.search）
        await doProviderSearch(question);
        const after = store.get().search || {};
        if (Array.isArray(after.results) && after.results.length) {
          searchResults = after.results;
          searchUsed = true;
          // 用去掉「帮我查一下」这类前缀后的问题判断相关性
          relevanceQuery = cleanSearchQuery(question) || question;
        }
      } catch (err) {
        // 检索失败不影响对话本身，但要让模型知道「这次没查到」
        const detail = (err && err.payload && err.payload.title) || (err && err.message) || '检索失败';
        searchFailNote = detail;
        toast({ title: '联网检索失败，已跳过', detail }, 'warn', 3500);
      }
    } else if (referencesPreviousSearch(question)) {
      // 用户明确在问检索面板 / 上一轮的结果：这时才复用，
      // 且不再按当前问句过滤 —— 「总结一下这些来源」本身没有实体词。
      const prev = Array.isArray(st.search.results) ? st.search.results : [];
      if (prev.length) {
        searchResults = prev;
        searchUsed = true;
      }
    }
  }
  const searchBlock = searchContextBlockGuarded(searchResults, store.get().search.counts, relevanceQuery);
  // 系统提示按「有没有字幕」分两种形态。
  // 没有字幕时不再注入空字幕块，并如实告知模型当前没有字幕 ——
  // 这样它不会瞎编视频内容，而是当作普通问答来回答。
  const systemParts = [activePromptText(), settings.prompt.chatPrefix || ''];

  // ---- 能力自述 ----
  // 用户问「你能不能联网」时，模型只能凭训练印象猜，然后答「不能」——
  // 因为它**看不到**扩展里其实有联网开关和检索结果。
  // 这里把「当前实际可用的能力」如实告诉它，它才能正确回答能力类问题。
  systemParts.push(
    buildCapabilityBlock({
      webCapable: cap.webCapable,
      searchOn: cap.searchOn,
      alwaysSearch: cap.alwaysSearch,
      hasSearchKey: cap.hasSearchKey,
      keylessOn: cap.keylessOn,
      searchProviderName: searchUsed ? store.get().search.provider || '' : '',
      searchUsed,
      searchResultCount: (searchResults || []).length,
      searchFailNote,
      hasSubtitles,
      subtitleCount: (st.subtitles || []).length,
      attachmentCount: attachments.length,
      mcpOn: !!(settings.mcp && settings.mcp.enabled),
      mcpServerCount: ((settings.mcp && settings.mcp.servers) || []).filter((x) => x.enabled !== false).length,
      skillsCount: ((settings.skills && settings.skills.items) || []).length,
      activeSkill: (((settings.skills && settings.skills.items) || []).find((x) => x.id === state.activeSkillId) || {}).name || ''
    })
  );

  if (hasSubtitles) {
    if (ctx.truncated) systemParts.push('（字幕较长，已按与问题的相关性截取）');
    systemParts.push(`【视频字幕原文】\n${ctx.text}`);
  } else {
    systemParts.push(
      '【当前没有这期视频的字幕】\n' +
        '用户尚未提取字幕。请把它当作普通对话来回答：可以凭借你已有的知识、联网检索结果或用户提供的内容作答；' +
        '不要编造视频里没有出现过的具体内容。'
    );
  }
  if (searchBlock) systemParts.push(searchBlock);
  const messages = [
    {
      role: 'system',
      content: systemParts.filter(Boolean).join('\n\n')
    }
  ];
  const recent = history.filter((m) => m.role !== 'system').slice(-14);
  for (const m of recent) {
    if (m === history[history.length - 1] && m.role === 'user') {
      messages.push({ role: 'user', content: buildUserContent(m.text, attachments) });
    } else {
      messages.push({ role: m.role, content: m.text });
    }
  }

  const stream = useDesktop ? new AutoStream() : new Stream();
  state.stream = stream;
  touchStream();
  const streamedTools = [];
  stream.start(
    'ai.chat',
    {
      messages,
      platformId: settings.ai.activeId,
      temperature: settings.ai.temperature,
      maxTokens: settings.ai.maxTokens,
      // 桌面端自己取字幕/页面并按它的系统提示词回答；本地 Stream 忽略这些字段。
      video: st.video,
      lines: st.subtitles,
      web: webOn
    },
    {
      // MCP 工具运行时，服务端会先推来一段「工具调用过程」文本；这里把它
      // 折叠成一行留痕，而不是混进正文 —— 用户能看到「模型动了手」，
      // 又不影响阅读回答。
      onTool: (ev) => {
        streamedTools.push(ev);
      },
      onApproval: (request) =>
        new Promise((resolve) => {
          const body = h('div');
          body.appendChild(h('div', { text: `工具：${request.name || 'MCP 工具'}` }));
          body.appendChild(
            h('div', {
              class: 'note muted',
              text: String(request.detail || '').slice(0, 800)
            })
          );
          openOverlay(
            '允许调用这个工具？',
            body,
            [
              {
                label: '拒绝',
                onClick: () => {
                  closeOverlays();
                  resolve(false);
                }
              },
              {
                label: '允许',
                primary: true,
                onClick: () => {
                  closeOverlays();
                  resolve(true);
                }
              }
            ],
            { width: '420px' }
          );
        }),
      onDelta: (text2) => {
        touchStream();
        const cur = store.get();
        const chat = [...cur.chat];
        const last = chat[chat.length - 1];
        if (last && last.role === 'assistant') {
          const prefix = streamedTools.length && !last.toolTrace
            ? `> 🔧 已调用工具：${streamedTools.map((x) => x.name).join('、')}\n\n`
            : '';
          chat[chat.length - 1] = {
            ...last,
            // 正文一开始输出，就说明「思考阶段」结束了 → 记下耗时
            reasonMs: last.reasonMs || (last.reasoning ? Date.now() - (last.reasonStart || Date.now()) : 0),
            toolTrace: streamedTools.length ? streamedTools.map((x) => x.name) : last.toolTrace,
            text: (last.text || '') + (prefix || '') + text2
          };
          store.set({ chat });
        }
        renderChat();
        scrollAiBottom();
      },
      // 思维链单独累加，绝不混进正文
      onReasoning: (piece) => {
        touchStream();
        const cur = store.get();
        const chat = [...cur.chat];
        const last = chat[chat.length - 1];
        if (last && last.role === 'assistant') {
          chat[chat.length - 1] = {
            ...last,
            reasoning: (last.reasoning || '') + piece,
            reasonStart: last.reasonStart || Date.now()
          };
          store.set({ chat });
        }
        renderChat();
        scrollAiBottom();
      },
      onEnd: async () => {
        const cur = store.get();
        const chat = [...cur.chat];
        const last = chat[chat.length - 1];
        if (last && last.role === 'assistant') {
          chat[chat.length - 1] = {
            ...last,
            streaming: false,
            reasonMs: last.reasonMs || (last.reasoning ? Date.now() - (last.reasonStart || Date.now()) : 0)
          };
        }
        state.streaming = false;
        state.stream = null;
        store.set({ chat });
        recountCitations(chat.map((c) => c.text).join('\n'));
        render();
        await saveHistory();
        setTimeout(() => void refreshChatSessions(), 800);
        // 队列里还有消息 → 自动发出下一条
        const next = dequeueNext();
        if (next) {
          renderChat();
          setTimeout(() => sendMessage(next.text), 120);
        }
      },
      onError: (payload) => {
        const cur = store.get();
        const chat = [...cur.chat];
        const last = chat[chat.length - 1];
        if (last && last.role === 'assistant') {
          chat[chat.length - 1] = {
            ...last,
            streaming: false,
            text: (last.text || '') + `\n\n> ⚠️ ${payload.title}：${payload.detail || ''}`
          };
        }
        state.streaming = false;
        state.stream = null;
        store.set({ chat });
        render();
        if (!(last && last.text)) showError(Object.assign(new Error(payload.title), { payload }));
      }
    }
  );
}

function buildUserContent(text, attachments) {
  if (!attachments.length) return text;
  const parts = [{ type: 'text', text }];
  for (const a of attachments) {
    if (a.kind === 'image') parts.push({ type: 'image_url', image_url: { url: a.dataUrl } });
    else if (a.kind === 'text') parts.push({ type: 'text', text: `【附件 ${a.name}】\n${a.text}` });
    else parts.push({ type: 'text', text: `【附件 ${a.name}】（二进制文件，无法直接读取）` });
  }
  return parts;
}

function scrollAiBottom() {
  const host = state.scrollHost;
  if (!host) return;
  host.scrollTop = host.scrollHeight;
  store.setScroll('ai', host.scrollTop);
}
