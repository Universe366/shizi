import { buildSearchUrl, type SearchEngineId } from '../shared/searchEngines';

export type SearchEngine = SearchEngineId;

export interface SearchPreference {
  engine?: SearchEngine;
  customUrl?: string;
}

function searchUrl(raw: string, pref?: SearchPreference): string {
  return buildSearchUrl(pref?.engine || 'bing', raw, pref?.customUrl || '');
}

export function normalizeUrl(input: string, pref?: SearchPreference): string {
  const raw = (input || '').trim();
  if (!raw) return 'https://www.bilibili.com/';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^BV[0-9A-Za-z]{10}$/i.test(raw)) return `https://www.bilibili.com/video/${raw}`;
  if (/^(www\.)?bilibili\.com(\/|$)/i.test(raw)) return `https://${raw}`;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(raw)) return `https://${raw}`;
  return searchUrl(raw, pref);
}
