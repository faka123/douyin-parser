import { chromium, Browser } from 'playwright';

let active = 0;

/** A fresh browser context lets Douyin's own scripts sign the detail request. */
export async function fetchBrowserDetail(id: string): Promise<any> {
  if (active >= (process.env.RENDER ? 1 : 2)) throw new Error('解析请求较多，请稍后重试');
  active++;
  let browser: Browser | undefined;
  try {
    // Prefer installed Chrome locally; deployments can install Playwright Chromium.
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true });
    } catch {
      browser = await chromium.launch({ headless: true }).catch(error => {
        console.error('[douyin-browser] Chromium launch failed:', error.message);
        throw new Error('浏览器解析组件未安装，请运行 npx playwright install chromium');
      });
    }
    const page = await browser.newPage();
    // Detail extraction does not need media playback or decorative page assets.
    // Routing also disables the HTTP cache, reducing memory on small instances.
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      return ['image', 'media', 'font'].includes(type) ? route.abort() : route.continue();
    });
    const timeoutMs = process.env.RENDER ? 75000 : 30000;
    let detailStatus: number | undefined;
    let resolveDetail: (value: any) => void;
    const detail = new Promise<any>(resolve => { resolveDetail = resolve; });
    page.on('response', async response => {
      const url = new URL(response.url());
      if (url.hostname !== 'www.douyin.com' || url.pathname !== '/aweme/v1/web/aweme/detail/') return;
      detailStatus = response.status();
      try {
        const data = await response.json();
        if (String(data?.aweme_detail?.aweme_id) === id) resolveDetail(data.aweme_detail);
      } catch { /* Empty or blocked responses must not be mistaken for deleted videos. */ }
    });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('抖音未返回视频详情，可能需要验证、登录或稍后重试')), timeoutMs);
    });
    try {
      const navigation = page.goto(`https://www.douyin.com/video/${id}`, {
        waitUntil: 'domcontentloaded', timeout: timeoutMs,
      });
      // A detail response may arrive before page navigation finishes.
      try {
        return await Promise.race([detail, timeout, navigation.then(() => detail)]);
      } catch (error) {
        console.error('[douyin-browser] Detail failed:', {
          title: await page.title().catch(() => ''), detailStatus,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } finally {
      clearTimeout(timer!);
    }
  } finally {
    try { await browser?.close(); } finally { active--; }
  }
}
