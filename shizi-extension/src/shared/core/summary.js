/**
 * 总结提示词核心：桌面端与插件端唯一来源。
 *
 * 这个文件不能 import 任何桌面运行时（Electron/Node），否则无法编译给扩展。
 * 生成的 JS 由 scripts/build-core.mjs 输出到 shizi-extension/src/shared/core/。
 */
/** 默认不追加任何格式规则：系统提示词只有用户模板（以及配置了才有的术语表）。 */
export const DEFAULT_SUMMARY_FORMAT_RULES = '';
export function clock(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
}
/** 官方分段转成提示词块；少于两段就不强制。 */
export function officialSegmentsBlock(info) {
    const points = Array.isArray(info.viewPoints) ? info.viewPoints : [];
    if (points.length < 2)
        return '';
    return [
        '【视频官方分段（必须沿用这些分段作为章节，不要另造章节标题）】',
        ...points.map((point) => {
            const start = Number(point.start != null ? point.start : point.from) || 0;
            const end = Number(point.end != null ? point.end : point.to) || 0;
            const title = String(point.title || point.content || '').trim();
            return `- ${clock(start)} ~ ${clock(end)} ${title}`;
        })
    ].join('\n');
}
function glossaryBlock(glossary) {
    if (!Array.isArray(glossary) || !glossary.length)
        return '';
    const rows = glossary
        .slice(0, 80)
        .map((item) => {
        const from = String(item.from || '').trim();
        if (!from)
            return '';
        const to = String(item.to || '').trim();
        const note = String(item.note || '').trim();
        const arrow = to && to !== from ? ` → ${to}` : '';
        return `- ${from}${arrow}${note ? `（${note}）` : ''}`;
    })
        .filter(Boolean);
    return rows.length ? `术语表（输出时统一使用以下写法）：\n${rows.join('\n')}` : '';
}
/** 组装总结的 system/user；字幕正文由调用方追加到 user。 */
export function buildSummaryPrompt(options) {
    const info = options.info || {};
    const rules = String(options.formatRules || '').trim();
    const system = [
        String(options.promptText || '').trim(),
        glossaryBlock(options.glossary),
        '',
        rules
    ]
        .filter(Boolean)
        .join('\n');
    const official = officialSegmentsBlock(info);
    const meta = [
        `视频标题：${info.title || '未知'}`,
        `UP 主：${info.owner || '未知'}`,
        `视频时长：${clock(Number(info.duration) || 0)}`,
        `链接：${info.url || ''}`,
        options.useVideoMeta !== false && info.desc
            ? `视频简介：${String(info.desc).slice(0, 2000)}`
            : '',
        options.commentsBlock || '',
        official
    ]
        .filter(Boolean)
        .join('\n');
    const user = [
        meta,
        '',
        '请基于上面的字幕写一份完整总结，严格按系统提示里的格式规则输出；不要写开场白或“根据字幕”这类过程说明。',
        '尽量详细：每个主题至少展开 2–4 个具体要点，保留数字、时间、步骤、例子和结论，不要只写一句话概括。',
        '需要外部事实时，可以调用联网搜索/读取网页；用到外部资料时用 [n] 标注来源。'
    ].join('\n');
    return { system, user };
}
