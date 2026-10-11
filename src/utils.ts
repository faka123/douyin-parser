/**
 * 通用工具函数
 */

export interface VideoQuality {
  nowm: Record<string, string>;  // { '4K': url, '1080p': url, '720p': url, '540p': url }
  wm: Record<string, string>;
}

export interface VideoInfo {
  platform: string;
  aweme_id: string;
  title: string;
  author: string;
  cover_url: string;
  video_url: string;           // 默认（最高）无水印地址
  video_url_watermark: string; // 默认（最高）带水印地址
  video_candidates?: string[];
  watermark_candidates?: string[];
  quality_candidates?: Record<string, string[]>;
  quality?: VideoQuality;      // 多档清晰度（抖音）
}

export interface ParseResult {
  success: boolean;
  data?: VideoInfo;
  error?: string;
}

/** 通用请求头 — 模拟移动端 */
export function getMobileHeaders(extra?: Record<string, string>) {
  return {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...extra,
  };
}

/** Match platform hosts rather than keywords embedded in paths. */
export function detectPlatform(url: string): string | null {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  const rules: [string, string[]][] = [
    ['douyin', ['douyin.com', 'iesdouyin.com']],
    ['kuaishou', ['kuaishou.com']],
    ['bilibili', ['bilibili.com']],
    ['rednote', ['xiaohongshu.com', 'xhslink.com']],
  ];
  return rules.find(([, domains]) => domains.some(domain => host === domain || host.endsWith('.' + domain)))?.[0] || null;
}

export function extractUrl(raw: string): string {
  const urls = raw.match(/https?:\/\/[^\s<>"'，。！？、）】]+/gi) || [];
  const match = urls.find(url => detectPlatform(url));
  if (match) return match;
  throw new Error('未找到支持的视频链接，请粘贴抖音、快手、小红书或 B站分享链接');
}

export function downloadHeaders(platform: string) {
  const referers: Record<string, string> = {
    douyin: 'https://www.douyin.com/', bilibili: 'https://www.bilibili.com/',
    kuaishou: 'https://www.kuaishou.com/', rednote: 'https://www.xiaohongshu.com/',
  };
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Referer: referers[platform] || referers.douyin,
  };
}
