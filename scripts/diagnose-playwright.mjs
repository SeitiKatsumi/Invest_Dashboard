import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const targetUrl = process.env.DIAGNOSE_SCRAPING_URL
  || 'https://www.mgl.com.br/busca/#Engine=StartMGL&modelo=Im%C3%B3veis&Pagina=0&PaginaIndex=1&';

const stealthInitScript = `
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

const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  process.env.GOOGLE_CHROME_BIN,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const executablePath = executableCandidates.find(candidate => existsSync(candidate));

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
  ],
});

const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1366, height: 768 },
});

await context.addInitScript(stealthInitScript);
const page = await context.newPage();
const jsonUrls = new Set();
const domUrls = new Set();
const apiResponses = [];

page.on('response', async (response) => {
  try {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (response.status() !== 200 || !contentType.includes('json')) return;

    const text = await response.text();
    const data = JSON.parse(text);
    const stack = [data];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      if (typeof current === 'string') {
        if (/^(\/?lote\/|https?:\/\/[^/]+\/lote\/)/i.test(current)) {
          const absolute = new URL(current.replace(/^\/?/, '/'), url).toString();
          jsonUrls.add(absolute);
        }
      } else if (Array.isArray(current)) {
        stack.push(...current);
      } else if (typeof current === 'object') {
        stack.push(...Object.values(current));
      }
    }

    apiResponses.push({ url, status: response.status(), bytes: text.length });
  } catch {
    // Some responses cannot be read twice or are not JSON despite their headers.
  }
});

try {
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(3000);

  const hrefs = await page.$$eval('a[href]', anchors => anchors.map(anchor => anchor.href));
  for (const href of hrefs) {
    if (/\/lote\/[^/]+\/\d+\/?$/i.test(href)) domUrls.add(href);
  }

  const title = await page.title();
  const bodyText = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).slice(0, 500);

  console.log(JSON.stringify({
    ok: jsonUrls.size > 0 || domUrls.size > 0,
    targetUrl,
    title,
    jsonUrlsFound: jsonUrls.size,
    domUrlsFound: domUrls.size,
    apiResponses: apiResponses.slice(0, 10),
    sampleUrls: [...new Set([...jsonUrls, ...domUrls])].slice(0, 10),
    bodyPreview: bodyText,
  }, null, 2));
} finally {
  await browser.close();
}
