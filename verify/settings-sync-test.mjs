// 共享设置映射单测：插件 → 共享 → 插件，以及模板 id 映射。
import { defaultSettings } from '../shizi-extension/src/shared/settings.js';
import { exportSharedSettings, importSharedSettings } from '../shizi-extension/src/shared/settings-sync.js';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const source = defaultSettings();
source.ai.platforms[0].apiKey = 'sk-test-1234';
source.ai.activeId = source.ai.platforms[0].id;
source.search.platforms[0].apiKey = 'search-key';
source.search.maxResults = 9;
source.asr.platforms[0].apiKey = 'asr-key';
source.prompt.templates = [{ id: 'tpl', name: '模板', text: '总结提示词' }];
source.prompt.activeId = 'tpl';
source.optimize.glossary = [{ term: '拾字', note: '产品名' }];
source.exportCfg = { format: 'md', template: 'study', includeTimestamps: true, filenamePattern: '{title}', assFontSize: 30, estimateTimestamps: true };

const shared = exportSharedSettings(source, true);
check('导出包含 AI Key', shared.ai.platforms[0].apiKey === 'sk-test-1234', shared.ai.platforms[0].apiKey);
check('导出模板 id 映射为 notes', shared.export.template === 'notes', shared.export.template);
check('导出术语表', shared.glossary[0].from === '拾字');

const target = defaultSettings();
target.ai.platforms[0].apiKey = '';
target.ai.platforms[0].id = shared.ai.platforms[0].id;
const merged = importSharedSettings(target, shared);
check('导入 AI Key', merged.ai.platforms.find((p) => p.id === source.ai.platforms[0].id)?.apiKey === 'sk-test-1234');
check('导入检索结果数', merged.search.maxResults === 9, String(merged.search.maxResults));
check('导入模板', merged.prompt.templates[0].id === 'tpl' && merged.prompt.templates[0].text === '总结提示词');
check('导入术语表', merged.optimize.glossary[0].term === '拾字');
check('导入模板 id 映射回 study', merged.exportCfg.template === 'study', merged.exportCfg.template);

const noSecrets = exportSharedSettings(source, false);
check('不导出 Key 时清空', noSecrets.ai.platforms[0].apiKey === '' && noSecrets.ai.platforms[0].hasKey === true);

console.log(failures ? `\n${failures} 项失败` : '\n全部通过');
process.exit(failures ? 1 : 0);
