// 库：显示桌面端本地库的只读镜像。
//
// 数据由 desktop-link 自动同步到 IndexedDB；这里只负责渲染与打开，
// 不直接读桌面端，也不改桌面库。离线时显示上次缓存。

import { h, clear, button, toast, copyText, fmtTime } from './dom.js';
import { store } from './store.js';
import { call } from './bridge.js';
import {
  linkStatus,
  onLinkChange,
  syncLibrary,
  fetchLibraryDetail,
  saveLibrarySummary,
  saveLibraryNote,
  saveLibraryTags,
  saveLibraryCollections
} from './desktop-link.js';
import { openOverlay, closeOverlays, promptDialog } from './ui.js';
import { renderMarkdownInto } from './markdown.js';

let host = null;
let query = '';
let lastSig = '';
let syncing = false;

function signatureOf(st) {
  const lib = st.desktopLibrary || {};
  const link = linkStatus();
  return [
    (lib.items || []).length,
    lib.syncedAt || 0,
    lib.error || '',
    lib.offline ? 'off' : 'on',
    link.state,
    syncing ? 'sync' : '',
    query
  ].join('|');
}

function detailMeta(item) {
  return [
    item.owner ? String(item.owner) : '',
    item.duration ? fmtTime(item.duration) : '',
    item.lineCount ? item.lineCount + ' 行' : '',
    item.trackCount > 1 ? item.trackCount + ' 轨' : ''
  ]
    .filter(Boolean)
    .join(' · ');
}

function showDetail(detail) {
  const item = detail.item || {};
  const body = h('div', { class: 'lib-detail' });
  body.appendChild(h('div', { class: 'lib-detail-meta', text: detailMeta(item) }));

  // 标签 / 合集：整组编辑后回写桌面。
  const chipRow = (title, current, save, apply) => {
    const row = h('div', { class: 'lib-detail-meta lib-detail-chips' });
    row.appendChild(
      h('span', {
        text: `${title}：${current.length ? current.join('、') : '无'}`
      })
    );
    row.appendChild(
      button(
        '编辑',
        () => {
          promptDialog(
            `编辑${title}`,
            current.join(', '),
            async (text) => {
              const names = String(text || '')
                .split(/[,，、\n]/)
                .map((name) => name.trim())
                .filter(Boolean)
                .slice(0, 30);
              try {
                const result = await save(names);
                apply(result);
                toast({ title: `${title}已保存` }, 'ok', 1600);
                showDetail(detail);
              } catch (err) {
                toast({ title: `${title}保存失败`, detail: String((err && err.message) || err) }, 'error', 4000);
              }
            },
            { placeholder: '用逗号分隔；留空表示清空' }
          );
        },
        { small: true }
      )
    );
    return row;
  };
  body.appendChild(
    chipRow(
      '标签',
      Array.isArray(item.tags) ? item.tags : [],
      (names) => saveLibraryTags(item.uid, names),
      (result) => {
        detail.item.tags = (result && result.tags) || [];
      }
    )
  );
  body.appendChild(
    chipRow(
      '合集',
      Array.isArray(item.collections) ? item.collections : [],
      (names) => saveLibraryCollections(item.uid, names),
      (result) => {
        detail.item.collections = (result && result.collections) || [];
      }
    )
  );

  const addSection = (title, initial, updatedAt, save, emptyText, onSaved) => {
    const wrap = h('section', { class: 'lib-detail-section' });
    const head = h('div', { class: 'lib-detail-section-head' });
    head.appendChild(h('span', { class: 'lib-detail-section-title', text: title }));
    if (updatedAt) {
      head.appendChild(
        h('span', {
          class: 'lib-detail-time',
          text: new Date(updatedAt).toLocaleString()
        })
      );
    }
    wrap.appendChild(head);

    const view = h('div', { class: 'lib-detail-content' });
    const editor = h('div', { class: 'lib-detail-editor', style: { display: 'none' } });
    let current = String(initial || '');

    const renderView = () => {
      clear(view);
      if (current.trim()) {
        if (title === '总结') renderMarkdownInto(view, current);
        else view.textContent = current;
      } else {
        view.appendChild(h('div', { class: 'note muted', text: emptyText || '还没有内容' }));
      }
    };
    renderView();
    wrap.appendChild(view);

    const area = h('textarea', {
      class: 'lib-detail-textarea',
      rows: 10,
      placeholder: title === '总结' ? '写总结（Markdown）' : '写笔记（Markdown）'
    });
    area.value = current;
    const hint = h('div', { class: 'note muted', text: '' });
    const saveBtn = button(
      '保存到桌面',
      async () => {
        const text = area.value;
        saveBtn.disabled = true;
        hint.textContent = '正在保存…';
        try {
          const result = await save(text);
          if (result && result.conflict) {
            hint.textContent = '桌面端已被修改，正在重新载入…';
            toast({ title: '保存冲突', detail: result.error || '请重新编辑' }, 'warn', 3500);
            await openDetail(item);
            return;
          }
          if (onSaved) onSaved(result);
          current = text;
          renderView();
          editor.style.display = 'none';
          hint.textContent = '';
          toast({ title: '已保存到桌面' }, 'ok', 1800);
          await syncLibrary();
        } catch (err) {
          hint.textContent = String((err && err.message) || err);
          toast({ title: '保存失败', detail: hint.textContent }, 'error', 4000);
        } finally {
          saveBtn.disabled = false;
        }
      },
      { small: true }
    );
    const cancelBtn = button(
      '取消',
      () => {
        area.value = current;
        editor.style.display = 'none';
        hint.textContent = '';
      },
      { small: true }
    );
    const editBtn = button(
      '编辑',
      () => {
        area.value = current;
        editor.style.display = 'block';
        hint.textContent = '';
        area.focus();
      },
      { small: true }
    );

    head.appendChild(editBtn);
    editor.appendChild(area);
    const actions = h('div', { class: 'lib-detail-actions' }, [saveBtn, cancelBtn]);
    editor.appendChild(actions);
    editor.appendChild(hint);
    wrap.appendChild(editor);
    return wrap;
  };

  body.appendChild(
    addSection(
      '总结',
      detail.summary && detail.summary.content,
      detail.summary && detail.summary.updatedAt,
      (text) =>
        saveLibrarySummary(
          item.uid,
          text,
          (detail.summary && detail.summary.updatedAt) || 0,
          (detail.summary && detail.summary.model) || 'plugin'
        ),
      '桌面端还没有这条总结',
      (result) => {
        if (result && result.summary) detail.summary = result.summary;
      }
    )
  );
  body.appendChild(
    addSection(
      '笔记',
      detail.note && detail.note.content,
      detail.note && detail.note.updatedAt,
      (text) => saveLibraryNote(item.uid, text, (detail.note && detail.note.updatedAt) || 0),
      '还没有笔记',
      (result) => {
        detail.note = (result && result.note) || null;
      }
    )
  );

  openOverlay(item.title || '条目详情', body, [{ label: '关闭', onClick: closeOverlays }], {
    width: 'min(580px, 92vw)'
  });
}

async function openDetail(item) {
  const loading = h('div', { class: 'note', text: '正在读取桌面端详情…' });
  openOverlay(item.title || '条目详情', loading, [{ label: '关闭', onClick: closeOverlays }], {
    width: 'min(580px, 92vw)'
  });
  try {
    const detail = await fetchLibraryDetail(item.uid);
    showDetail(detail);
  } catch (err) {
    clear(loading);
    loading.appendChild(
      h('div', {
        class: 'note',
        text: `读取失败：${(err && err.message) || err}`
      })
    );
  }
}

function openItem(item) {
  const url = String((item && item.url) || '');
  if (!/^https?:/i.test(url)) {
    toast({ title: '这条没有可打开的链接' }, 'warn');
    return;
  }
  call('tab.open', { url }).catch((err) => {
    toast({ title: '打开失败', detail: String((err && err.message) || err) }, 'error');
  });
}

function summaryText(item) {
  const text = String((item && item.summaryPreview) || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > 120 ? text.slice(0, 120) + '…' : text;
}

function renderRow(item) {
  const meta = [
    item.owner ? String(item.owner) : '',
    item.duration ? fmtTime(item.duration) : '',
    item.lineCount ? item.lineCount + ' 行' : '',
    item.trackCount > 1 ? item.trackCount + ' 轨' : ''
  ]
    .filter(Boolean)
    .join(' · ');

  const tags = Array.isArray(item.tags) ? item.tags : [];
  const collections = Array.isArray(item.collections) ? item.collections : [];

  const row = h('article', { class: 'lib-row' });
  const head = h('div', { class: 'lib-row-head' });
  const title = h('button', {
    class: 'lib-title',
    type: 'button',
    title: item.url || item.title,
    text: String(item.title || item.uid || '未命名')
  });
  title.addEventListener('click', () => openDetail(item));
  head.appendChild(title);
  head.appendChild(
    h('div', { class: 'lib-actions' }, [
      button('打开', () => openItem(item), { small: true, title: '在浏览器打开这条视频' }),
      button(
        '复制链接',
        async () => {
          try {
            await copyText(String(item.url || ''));
            toast({ title: '链接已复制' }, 'ok', 1600);
          } catch (err) {
            toast({ title: '复制失败' }, 'warn');
          }
        },
        { small: true }
      )
    ])
  );
  row.appendChild(head);

  if (meta) row.appendChild(h('div', { class: 'lib-meta', text: meta }));
  const summary = summaryText(item);
  if (summary) row.appendChild(h('div', { class: 'lib-summary', text: summary }));

  const chips = [...collections.map((name) => '合集：' + name), ...tags];
  if (chips.length) {
    const chipBox = h('div', { class: 'lib-chips' });
    for (const name of chips.slice(0, 8)) {
      chipBox.appendChild(h('span', { class: 'lib-chip', text: name }));
    }
    row.appendChild(chipBox);
  }
  return row;
}

export function render() {
  if (!host) return;
  const st = store.get();
  const sig = signatureOf(st);
  if (sig === lastSig) return;
  lastSig = sig;

  const lib = st.desktopLibrary || { items: [], total: 0, syncedAt: 0, offline: false, error: '' };
  const link = linkStatus();
  const items = Array.isArray(lib.items) ? lib.items : [];
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? items.filter((item) =>
        [item.title, item.owner, item.uid, ...(item.tags || []), ...(item.collections || [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)
      )
    : items;

  clear(host);

  const head = h('div', { class: 'lib-head' });
  head.appendChild(h('div', { class: 'lib-head-title', text: '桌面库' }));
  head.appendChild(
    h('div', {
      class: 'lib-head-meta',
      text: lib.syncedAt
        ? `${items.length} 条 · 同步于 ${new Date(lib.syncedAt).toLocaleTimeString()}`
        : link.state === 'connected'
          ? '正在同步…'
          : '尚未同步'
    })
  );
  head.appendChild(
    button(
      syncing ? '同步中…' : '刷新',
      async () => {
        if (syncing) return;
        syncing = true;
        render();
        try {
          const out = await syncLibrary();
          if (out.ok) toast({ title: `已同步 ${out.items} 条` }, 'ok', 1800);
          else toast({ title: '同步失败', detail: out.error || '未连接桌面端' }, 'warn', 3000);
        } finally {
          syncing = false;
          render();
        }
      },
      { small: true, disabled: syncing, title: '从桌面端重新拉取库列表' }
    )
  );
  host.appendChild(head);

  const search = h('input', {
    class: 'lib-search',
    type: 'search',
    placeholder: '搜索标题 / UP / 标签 / 合集',
    value: query
  });
  search.addEventListener('input', () => {
    query = search.value;
    lastSig = '';
    render();
  });
  host.appendChild(search);

  if (lib.offline) {
    host.appendChild(
      h('div', {
        class: 'note muted',
        text: link.state === 'connected'
          ? '正在刷新桌面库…'
          : `未连接桌面端，显示上次缓存${lib.error ? `（${lib.error}）` : ''}。启动桌面端后会自动同步。`
      })
    );
  }

  if (!filtered.length) {
    host.appendChild(
      h('div', {
        class: 'empty',
        text: needle
          ? '没有匹配的条目'
          : items.length
            ? '没有匹配的条目'
            : link.state === 'connected'
              ? '桌面库还是空的。在桌面端导入视频或总结后，这里会自动出现。'
              : '还没有桌面库缓存。连接桌面端后会自动同步；插件本身仍可独立使用。'
      })
    );
    return;
  }

  const list = h('div', { class: 'lib-list' });
  for (const item of filtered) list.appendChild(renderRow(item));
  host.appendChild(list);
}

export function init(container) {
  host = container;
  store.subscribe(render);
  onLinkChange(render);
  // 首屏先画缓存，再让 desktop-link 后台刷新。
  render();
  return {
    render,
    refresh: () => syncLibrary().then(render)
  };
}
