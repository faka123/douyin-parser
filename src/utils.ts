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

/** 从 URL 和 patterns 判断属于哪个平台 */
export function detectPlatform(url: string): string | null {
  const rules: [string, RegExp[]][] = [
    ['douyin', [/douyin\.com/]],
    ['kuaishou', [/kuaishou\.com/]],
    ['bilibili', [/bilibili\.com/]],
    ['rednote', [/xiaohongshu\.com/, /xhslink\.com/]],
  ];
  for (const [name, patterns] of rules) {
    if (patterns.some((p) => p.test(url))) return name;
  }
  return null;
}
