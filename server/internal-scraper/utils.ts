export const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  window.chrome = { runtime: {} };
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) =>
    parameters.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters);
`;

export const STEALTH_BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
];

export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

export function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const INVALID_URL_PREFIXES = [
  'mailto:', 'tel:', 'javascript:', 'data:', 'file:', 'ftp:',
  'sms:', 'whatsapp:', 'skype:', 'viber:', 'callto:', 'market:',
];

const INVALID_URL_PATTERN = /^(#|mailto:|tel:|javascript:|data:|file:|void\(|about:)/i;

export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  url = url.trim();
  if (!url) return false;
  if (INVALID_URL_PATTERN.test(url)) return false;
  for (const prefix of INVALID_URL_PREFIXES) {
    if (url.toLowerCase().startsWith(prefix)) return false;
  }
  if (url.startsWith('#')) return false;
  return true;
}

export function normalizeUrl(url: string, baseUrl: string): string | null {
  if (!isValidUrl(url)) return null;
  url = url.trim();

  if (url.startsWith('//')) {
    url = 'https:' + url;
  } else if (url.startsWith('/')) {
    try {
      const parsed = new URL(baseUrl);
      url = `${parsed.protocol}//${parsed.host}${url}`;
    } catch { return null; }
  } else if (!url.startsWith('http')) {
    for (const prefix of INVALID_URL_PREFIXES) {
      if (url.toLowerCase().startsWith(prefix)) return null;
    }
    try {
      url = new URL(url, baseUrl).toString();
    } catch { return null; }
  }

  url = url.split('#')[0];

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return url;
  } catch { return null; }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch { return ''; }
}

export function isSameDomain(url: string, domain: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const d = domain.toLowerCase().replace(/^www\./, '');
    return host === d || host.endsWith('.' + d);
  } catch { return false; }
}

export function validateRegexPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, 'i');
    return true;
  } catch { return false; }
}

export function validateRegexPatterns(patterns: string[]): string[] {
  const valid: string[] = [];
  for (const pattern of patterns) {
    if (!pattern || typeof pattern !== 'string') continue;
    if (validateRegexPattern(pattern)) {
      valid.push(pattern);
    } else {
      console.warn(`Regex inválido ignorado: ${pattern}`);
    }
  }
  return valid;
}

export function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch { return null; }
}

export function compileRegexList(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const p of patterns) {
    const re = compileRegex(p);
    if (re) compiled.push(re);
  }
  return compiled;
}

const BLOCKLIST_PATTERNS: RegExp[] = [
  /\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|woff|woff2|ttf|eot|pdf|zip|rar|exe|mp3|mp4|avi|mov)(\?|$)/i,
  /(facebook|twitter|instagram|linkedin|youtube|whatsapp|tiktok|pinterest)\.com/i,
  /\/(login|logout|register|signup|signin|cart|checkout|share|print|download)(\/|$|\?)/i,
  /\/(online|planilha|auditorio|arrematante|redefinir-senha|minha-conta)(\/|$|\?)/i,
  /\/(veiculos?|carros?|motos?|caminh(?:oes|ões)|maquinas?|sucatas?|semoventes|eletros?|eletronicos|eletrônicos|diversos|agrupamento)(\/|$|\?)/i,
  /\?(utm_|ref=|share=|fbclid=|gclid=)/i,
];

export function getBuiltinBlocklist(): RegExp[] {
  return [...BLOCKLIST_PATTERNS];
}

const URL_BLOCKLIST_PATTERNS = [
  /\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|woff|woff2|ttf|eot|pdf|zip|rar)(\?|$)/i,
  /(facebook|twitter|instagram|linkedin|youtube|whatsapp)\.com/i,
  /(mailto:|tel:|javascript:|#)/,
  /\/share\?|\/login|\/register|\/cart|\/checkout/i,
  /\/(online|planilha|auditorio|arrematante|redefinir-senha|minha-conta)(\/|$|\?)/i,
  /\/(veiculos?|carros?|motos?|caminh(?:oes|ões)|maquinas?|sucatas?|semoventes|eletros?|eletronicos|eletrônicos|diversos|agrupamento)(\/|$|\?)/i,
];

export function isValidPageUrl(url: string): boolean {
  for (const pattern of URL_BLOCKLIST_PATTERNS) {
    if (pattern.test(url.toLowerCase())) return false;
  }
  return true;
}

export function generateId(length = 12): string {
  const chars = 'abcdef0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function randomDelay(min: number, max: number): Promise<void> {
  const delay = min + Math.random() * (max - min);
  return sleep(delay * 1000);
}

export class Semaphore {
  private permits: number;
  private waiting: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>(resolve => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      next();
    } else {
      this.permits++;
    }
  }
}
