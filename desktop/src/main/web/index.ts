export { buildSearchPlan } from './plan';
export type { SearchAngle, SearchPlanItem, SearchPlanOptions } from './plan';
export {
  capPerDomain,
  dedupeEvidence,
  normalizeUrl,
  rankEvidence,
  searchWebPlan,
  siteOf,
  sourceTypeOf
} from './service';
export type { SearchWebOptions, WebEvidence, WebSearchMeta, WebSearchResult } from './service';export { clearDocumentCache, documentCacheSize } from './documents';
export { clearSearchMetrics, recentSearches, searchStats } from './metrics';
export type { SearchMetric, SearchStats } from './metrics';export { flushMetrics, hydrateMetrics } from './metrics';
export { retrieveEvidence } from './retrieve';
export type { RetrieveOptions, RetrieveResult, SearchPurpose } from './retrieve';
