/** 设置页推荐的 Ollama embedding 模型；也允许手动输入其它模型名。 */
export const OLLAMA_EMBEDDING_CATALOG = [
  { model: 'nomic-embed-text', label: 'nomic-embed-text · 约 274MB，中英文通用' },
  { model: 'bge-m3', label: 'bge-m3 · 约 1.2GB，中文/多语言，质量更高' },
  { model: 'qwen3-embedding:0.6b', label: 'qwen3-embedding:0.6b · 约 640MB，中文/多语言' }
] as const;
