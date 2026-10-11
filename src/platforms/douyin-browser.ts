import { chromium, Browser } from 'playwright';

let active = 0;

/** A fresh browser context lets Douyin's own scripts sign the detail request. */
export async function fetchBrowserDetail(id: string): Promise<any> {
  if (active >= 2) throw new Error('解析请求较多，请稍后重试');
  active++;
  let browser: Browser | undefined;
  try {
    // Prefer installed Chrome locally; deployments can install Playwright Chromium.
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true });
    } catch {
      browser = await chromium.launch({ headless: true }).catch(() => {
        throw new Error('浏览器解析组件未安装，请运行 npx playwright install chromium');
      });
    }
    const page = await browser.newPage();
    let resolveDetail: (value: any) => void;
    const detail = new Promise<any>(resolve => { resolveDetail = resolve; });
    page.on('response', async response => {
      const url = new URL(response.url());
      if (url.hostname !== 'www.douyin.com' || url.pathname !== '/aweme/v1/web/aweme/detail/') return;
      try {
        const data = await response.json();
        if (String(data?.aweme_detail?.aweme_id) === id) resolveDetail(data.aweme_detail);
      } catch { /* Empty or blocked responses must not be mistaken for deleted videos. */ }
    });
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('抖音未返回视频详情，可能需要验证、登录或稍后重试')), 30000);
    });
    try {
      const navigation = page.goto(`https://www.douyin.com/video/${id}`, {
        waitUntil: 'domcontentloaded', timeout: 30000,
      });
      // A detail response may arrive before page navigation finishes.
      return await Promise.race([detail, timeout, navigation.then(() => detail)]);
    } finally {
      clearTimeout(timer!);
    }
  } finally {
    try { await browser?.close(); } finally { active--; }
  }
}
