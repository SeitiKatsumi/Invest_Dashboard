import type { ScrapingConfig } from './types.js';

export interface ConfigScore {
  score: number;
  maxScore: number;
  confidence: number;
  flags: string[];
  details: {
    hasAllowlist: boolean;
    hasDetailIndicators: boolean;
    hasListingIndicators: boolean;
    hasPagination: boolean;
    hasSpecificSelectors: boolean;
    allowlistSpecificity: number;
    selectorSpecificity: number;
  };
}

const GENERIC_SELECTORS = ['a', 'a[href]', 'div', 'div a', '*', 'body a', 'li a', 'ul a', 'span a'];
const GENERIC_LISTING_SELECTORS = ['*', 'a', 'div', 'body', 'li', 'ul', 'span', 'p', 'section', 'main', 'article'];
const GENERIC_PATTERNS = ['^/', '.*', '.+', '^https?://', '/.*', '/.+'];

function patternSpecificity(pattern: string): number {
  let score = 0;
  if (pattern.includes('/')) score += 1;
  if (/\\d\+/.test(pattern)) score += 2;
  if (/\[^\/\]\+/.test(pattern) || /\[a-z/.test(pattern)) score += 1;
  if (pattern.includes('lote') || pattern.includes('imovel') || pattern.includes('item') || pattern.includes('evento') || pattern.includes('leilao') || pattern.includes('produto')) score += 3;
  if (pattern.length > 15) score += 1;
  if (GENERIC_PATTERNS.includes(pattern)) return 0;
  return score;
}

export function scoreConfig(config: ScrapingConfig | Record<string, unknown>): ConfigScore {
  const cfg = config as Record<string, unknown>;
  const flags: string[] = [];
  let score = 0;
  const maxScore = 100;

  const allowlist: string[] = Array.isArray(cfg.allowlist_patterns) ? cfg.allowlist_patterns as string[] : [];
  const blocklist: string[] = Array.isArray(cfg.blocklist_patterns) ? cfg.blocklist_patterns as string[] : [];
  const detailIndicators: string[] = Array.isArray(cfg.detail_page_indicators) ? cfg.detail_page_indicators as string[] : [];
  const listingIndicators: string[] = Array.isArray(cfg.listing_page_indicators) ? cfg.listing_page_indicators as string[] : [];
  const linkSelectors: string[] = Array.isArray(cfg.link_selectors) ? cfg.link_selectors as string[] : [];
  const paginationPattern = typeof cfg.pagination_pattern === 'string' ? cfg.pagination_pattern : null;
  const categoryPatterns: string[] = Array.isArray(cfg.category_patterns) ? cfg.category_patterns as string[] : [];

  const hasAllowlist = allowlist.length > 0;
  if (hasAllowlist) {
    score += 15;
  } else {
    flags.push('Sem patterns de allowlist - config muito genérica');
  }

  let allowlistSpec = 0;
  if (allowlist.length > 0) {
    const specs = allowlist.map(patternSpecificity);
    allowlistSpec = specs.reduce((a, b) => a + b, 0) / specs.length;
    if (allowlistSpec >= 3) {
      score += 15;
    } else if (allowlistSpec >= 1) {
      score += 8;
      flags.push('Allowlist patterns pouco específicos');
    } else {
      flags.push('Allowlist patterns genéricos demais');
    }
  }

  const hasDetailIndicators = detailIndicators.length > 0;
  if (hasDetailIndicators) {
    score += 15;
    const detailSpecs = detailIndicators.map(patternSpecificity);
    const avgDetailSpec = detailSpecs.reduce((a, b) => a + b, 0) / detailSpecs.length;
    if (avgDetailSpec >= 2) score += 5;
  } else {
    flags.push('Sem indicadores de página de detalhe');
  }

  const hasListingIndicators = listingIndicators.length > 0;
  if (hasListingIndicators) {
    score += 10;
  }

  const hasPagination = !!paginationPattern;
  if (hasPagination) {
    score += 10;
  }

  if (categoryPatterns.length > 0) {
    score += 5;
  }

  let selectorSpec = 0;
  const hasSpecificSelectors = linkSelectors.length > 0 && !linkSelectors.every(s => GENERIC_SELECTORS.includes(s.trim()));
  if (hasSpecificSelectors) {
    score += 10;
    selectorSpec = 1;
    const hasAttributeSelector = linkSelectors.some(s => s.includes('[href*=') || s.includes('[href^=') || s.includes('[class'));
    if (hasAttributeSelector) {
      score += 5;
      selectorSpec = 2;
    }
  } else if (linkSelectors.length > 0) {
    score += 3;
    flags.push('Usando apenas seletores genéricos (a[href])');
  } else {
    flags.push('Sem seletores de link definidos');
  }

  const listingSelector = typeof cfg.listing_selector === 'string' ? cfg.listing_selector.trim() : '';
  if (listingSelector) {
    if (GENERIC_LISTING_SELECTORS.includes(listingSelector.toLowerCase())) {
      flags.push(`listing_selector genérico demais ("${listingSelector}")`);
      score -= 10;
    } else if (listingSelector.includes('[') || listingSelector.includes('.') || listingSelector.includes('#')) {
      score += 5;
    }
  }

  const linkSelector = typeof cfg.link_selector === 'string' ? cfg.link_selector.trim() : '';
  if (linkSelector) {
    if (GENERIC_LISTING_SELECTORS.includes(linkSelector.toLowerCase()) || linkSelector === 'a[href]') {
      flags.push(`link_selector genérico demais ("${linkSelector}")`);
      score -= 5;
    }
  }

  if (blocklist.length > 4) {
    score += 5;
  }

  const configDomain = typeof cfg.domain === 'string' ? cfg.domain : '';
  if (configDomain && configDomain.length > 3) {
    score += 5;
  }

  score = Math.max(0, score);
  const confidence = Math.min(100, Math.round((score / maxScore) * 100));

  return {
    score,
    maxScore,
    confidence,
    flags,
    details: {
      hasAllowlist,
      hasDetailIndicators,
      hasListingIndicators,
      hasPagination,
      hasSpecificSelectors,
      allowlistSpecificity: Math.round(allowlistSpec * 10) / 10,
      selectorSpecificity: selectorSpec,
    },
  };
}
