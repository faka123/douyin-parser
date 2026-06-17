import axios from 'axios';
import { getMobileHeaders, VideoInfo } from '../utils';

/**
 * 小红书(Rednote/Xiaohongshu) 视频解析器
 *
 * 解析原理 (参考 videodl — rednote.py):
 *   1. 短链 xhslink.com → 跟随重定向拿真实 URL
 *   2. GET 真实页 → 提取 window.__INITIAL_STATE__ JSON
 *   3. 从 JSON 中查找 masterUrl（无水印视频流）
 *
 * fallback: backupUrls → 取第一个
 */

function extractInitialState(html: string): any {
  // 找 </script></body></html> 前的 __INITIAL_STATE__
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>\s*<\/body>\s*<\/html>/);
  if (!m) throw new Error('页面数据未找到');
  // 去掉末尾可能的多余分号
  let json = m[1].replace(/;+\s*$/, '');
  return JSON.parse(json);
}

/** 递归搜索 key */
function searchByKey(obj: any, targetKey: string): any | null {
  if (!obj || typeof obj !== 'object') return null;
  if (targetKey in obj) return obj[targetKey];
  for (const v of Object.values(obj)) {
    const r = searchByKey(v, targetKey);
    if (r !== null && r !== undefined) return r;
  }
  return null;
}

export async function parse(url: string): Promise<VideoInfo> {
  const headers = {
    ...getMobileHeaders(),
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  };

  // 短链重定向
  let resolvedUrl = url;
  if (url.includes('xhslink.com')) {
    const r = await axios.get(url, { headers, maxRedirects: 5, timeout: 10000 });
    resolvedUrl = r.request?.res?.responseUrl || r.request?.href || url;
  }

  const vid = resolvedUrl.split('/').filter(Boolean).pop() || '';

  const resp = await axios.get(resolvedUrl, { headers, timeout: 15000 }).catch((err: any) => {
    const status = err?.response?.status;
    if (status === 401 || status === 403) throw new Error('小红书拒绝了该请求，请确认链接有效或稍后再试');
    throw new Error(`请求小红书页面失败: ${err.message}`);
  });
  const raw = extractInitialState(resp.data);

  // 找视频地址: masterUrl 优先，否则 backupUrls
  let videoUrl: string | null = searchByKey(raw, 'masterUrl');
  if (!videoUrl) {
    const backups = searchByKey(raw, 'backupUrls');
    if (Array.isArray(backups) && backups.length) videoUrl = backups[0];
  }
  if (!videoUrl) throw new Error('未找到视频地址');

  // 标题
  const title: string =
    searchByKey(raw, 'title') || searchByKey(raw, 'desc') || vid;

  // 封面
  let coverUrl = '';
  try {
    const imageList = searchByKey(raw, 'imageList');
    if (imageList?.[0]?.[0]?.urlDefault) coverUrl = imageList[0][0].urlDefault;
  } catch {}

  return {
    platform: 'rednote',
    aweme_id: vid,
    title,
    author: '',
    cover_url: coverUrl,
    video_url: videoUrl,
    video_url_watermark: '',
  };
}
