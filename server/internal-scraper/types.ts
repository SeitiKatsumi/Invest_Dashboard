export interface ExplorerOptions {
  baseUrl: string;
  maxPages?: number;
  usePlaywright?: boolean; // defaults to true — Playwright is primary, fetch is fallback
}

export interface PageData {
  url: string;
  type: 'category' | 'detail' | 'pagination' | 'other';
  structure: PageStructure;
  links: LinkInfo;
  pagination: string[];
}

export interface PageStructure {
  title: string;
  mainContainers: ContainerInfo[];
  cardPatterns: CardPattern[];
}

export interface ContainerInfo {
  tag: string;
  classes: string[];
  id: string;
  childrenCount: number;
}

export interface CardPattern {
  tag: string;
  classes: string[];
  count: number;
}

export interface LinkInfo {
  totalLinks: number;
  sampleLinks: SampleLink[];
  uniquePatterns: string[];
}

export interface SampleLink {
  url: string;
  text: string;
  classes: string[];
  parentClasses: string[];
  hasImage: boolean;
}

export interface ExplorationResult {
  pagesExplored: number;
  data: PageData[];
  allLinksFound: string[];
  detailUrlsFound: string[];
  categoryUrlsFound: string[];
  paginationSamples: string[];
  stats: {
    totalLinks: number;
    detailCount: number;
    categoryCount: number;
  };
  usedPlaywright?: boolean;
  warnings?: string[];
}

export interface ScrapingConfig {
  id: string;
  domain: string;
  allowlist_patterns: string[];
  blocklist_patterns: string[];
  pagination_pattern: string | null;
  pagination_type: string | null;
  listing_page_indicators: string[];
  detail_page_indicators: string[];
  max_listing_pages: number;
  max_detail_pages: number;
  link_selectors: string[];
  category_patterns?: string[];
  created_at: string;
  updated_at: string;
  analysis_notes?: string;
  tokens_used?: number;
}

export interface AnalysisResult {
  success: boolean;
  config?: ScrapingConfig;
  tokens_used?: number;
  validation?: ConfigValidation;
  exploration_summary?: {
    pages_explored: number;
    detail_urls_found: number;
    category_urls_found: number;
    total_links_found: number;
  };
  error?: string;
  raw_response?: string;
}

export interface ConfigValidation {
  detail_urls_tested: number;
  detail_urls_matched: number;
  all_urls_tested: number;
  all_urls_matched: number;
  coverage_percent: number;
  warnings: string[];
}

export interface CrawlerOptions {
  concurrentRequests?: number;
  delayMin?: number;
  delayMax?: number;
  timeout?: number;
  maxRetries?: number;
}

export interface CrawlResult {
  success: boolean;
  urls_found: string[];
  total_urls: number;
  pages_processed: number;
  categories_found: number;
  listing_pages: number;
  detail_pages: number;
  errors: string[];
  warnings?: string[];
  config_used: {
    domain: string;
    allowlist_patterns: string[];
    blocklist_patterns: string[];
  };
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type ResultClassification = 'success' | 'empty' | 'error' | 'config_invalid' | 'config_suspect';

export interface InternalJob {
  id: string;
  status: JobStatus;
  type: 'onboard' | 'scrape';
  siteUrl: string;
  siteId?: number;
  progress: number;
  progressMessage: string;
  urlsFound: string[];
  totalUrls: number;
  pagesProcessed: number;
  error?: string;
  startedAt: string;
  completedAt?: string;
  result?: CrawlResult | AnalysisResult;
  callbackUrl?: string;
  engine: 'internal';
  resultClassification?: ResultClassification;
  confidenceScore?: number;
}

export interface OnboardRequest {
  url: string;
  openaiApiKey: string;
  model?: string;
  maxPagesToExplore?: number;
  targetDescription?: string;
  previousErrors?: {
    scraping_error?: string;
    scraping_error_analysis?: string;
    previous_config?: Record<string, unknown>;
  };
}

export interface ScrapeRequest {
  url: string;
  config: ScrapingConfig | Record<string, unknown>;  // use NormalizedConfig internally
  maxPages?: number;
  concurrentRequests?: number;
  usePlaywright?: boolean;
  useHeuristics?: boolean;
  callbackUrl?: string;
}
