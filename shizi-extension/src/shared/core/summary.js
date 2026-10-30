/**
 * 总结提示词核心：桌面端与插件端唯一来源。
 *
 * 这个文件不能 import 任何桌面运行时（Electron/Node），否则无法编译给扩展。
 * 生成的 JS 由 scripts/build-core.mjs 输出到 shizi-extension/src/shared/core/。
 */
export const DEFAULT_SUMMARY_FORMAT_RULES = [
    '【输出风格：做成一份信息密度高的图文笔记，不要平铺直叙的流水账】',
    '',
    '飞书文档能渲染丰富结构，请**主动使用**，不要只用「标题 + 段落」：',
    '',
    '1. **先给一句话结论**，紧接一个「速览」表格（3~6 行），让读者 10 秒抓住重点。',
    '2. **该用表格就用表格** —— 对比、参数、时间线、优劣、步骤一律用管道表格，',
    '   不要写成句子。必须有表头与 `---` 分隔行。',
    '3. **引用块（行首 `> `）用来强调关键判断或原话**，例如 `> **结论**：…`。',
    '4. **代码块**（三个反引号 + 语言）用于命令、配置、代码、数据样例。',
    '5. **超链接**写成 `[文字](https://…)`。**只链接字幕里明确出现过、或你确信真实存在的 URL**，绝对不要编造。',
    '6. **公式**用 LaTeX：行内 `$…$`、块级 `$$…$$`。',
    '7. **任务列表** `- [ ]` / `- [x]` 用于待办、检查项、可执行建议。',
    '8. **分割线** `---` 用于分节。',
    '9. **emoji 做小标题前缀**提升可读性（如 `## 🎯 核心结论`），但不要每行都加。',
    '10. **图片无法通过文本携带**。某个位置适合配图时，用一行 `> 🖼️ 建议配图：<放什么图>` 占位，不要输出假的图片语法。',
    '',
    '【硬性要求】',
    '· 内容必须**全部来自字幕**（以及下方给出的简介/评论/外部补充），不要引入字幕里没有的信息。',
    '· **不要输出**内嵌 HTML、脚注、自定义容器语法、base64 图片。',
    '· 标题最多三级（`#` / `##` / `###`），不要跳级。',
    '',
    '【详细程度：宁可详细，不要简略】',
    '· 这是一份**完整的观看笔记**，不是摘要提纲，请充分展开。',
    '· 每个要点都要写清「是什么 + 为什么 + 怎么做/结论」，不要只写一句短语。',
    '· 视频里出现的**具体数字、名称、命令、步骤、参数、结论**都要保留；有流程就逐步列出，有对比就做成表格，有坑就写清现象与原因。',
    '· 按时间线自然分节（顺序见下方「顺序」要求），不要为了短而合并章节；长视频写长一些是正常的。',
    '· 唯一要避免的是**重复与灌水** —— 不要为了凑长度而复述同一件事。'
].join('\n');
/**
 * 顺序硬要求：无论用户是否自定义格式规则，都会追加到系统提示词末尾。
 * 模型默认倾向按主题/重要性重排，导致笔记顺序与字幕对不上。
 */
export const SUMMARY_ORDER_RULES = [
    '【顺序：严格按视频时间线，不要按主题重排】',
    '· 正文从视频开头写到结尾，章节顺序 = 字幕里内容出现的顺序。',
    '· 每个章节标题带上该节起始时间戳，例如 `## 03:21 主题`、`## 1:02:15 主题`；时间取字幕行首的 `[mm:ss]`，有官方分段时用官方分段的起始时间。',
    '· 不要把后面才出现的内容提到前面，也不要把分散在各处的同类内容抽出来合并成单独一章。',
    '· 同一个话题在后文再次出现时，留在后面对应的时间点，最多写「（前面 12:30 提过）」呼应，不要挪回前面。',
    '· 开头的一句话结论与「速览」表可以放在最前面，但速览表的行同样按出现顺序排列，不要按重要性排序。'
].join('\n');
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
        '【视频官方分段（必须沿用这些分段作为章节，按时间顺序排列，不要另造章节标题）】',
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
    const rules = String(options.formatRules || '').trim() || DEFAULT_SUMMARY_FORMAT_RULES;
    // 各段之间留空行：顺序规则单独成段，模型更容易把它当成硬约束。
    const system = [
        String(options.promptText || '').trim(),
        glossaryBlock(options.glossary),
        rules,
        SUMMARY_ORDER_RULES
    ]
        .filter(Boolean)
        .join('\n\n');
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
        '正文严格按字幕时间顺序（从开头到结尾）组织，章节标题带该节起始时间戳；不要按主题或重要性重排。',
        '尽量详细：每个主题至少展开 2–4 个具体要点，保留数字、时间、步骤、例子和结论，不要只写一句话概括。',
        '需要外部事实时，可以调用联网搜索/读取网页；用到外部资料时用 [n] 标注来源。'
    ].join('\n');
    return { system, user };
}
