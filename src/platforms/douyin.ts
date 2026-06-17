import axios from 'axios';
import { getMobileHeaders, VideoInfo } from '../utils';

/**
 * 抖音(Douyin/TikTok CN) 视频解析器
 *
 * 解析原理:
 *   1. 跟随短链重定向，获取 aweme_id
 *   2. GET 分享页 HTML，提取 SSR 内嵌的 window._ROUTER_DATA
 *   3. 从 play_addr.uri 构造多档清晰度地址
 *
 * 画质:
 *   - 4k (2160p)、1080p、720p — 抖音会根据原始视频规格返回可用檔位
 *   - 使用 play (非 playwm) 去水印
 *
 * 参考: CharlesPikachu/videodl — douyin.py 第 42 行
 */

/** 清晰度档位定义 */
const RESOLUTIONS = [
  { label: '4K', ratio: '1080p', desc: '最高可用' },   // douyin max ratio param is 1080p; server may serve higher
  { label: '1080p', ratio: '1080p', desc: '全高清' },
  { label: '720p', ratio: '720p', desc: '高清' },
  { label: '540p', ratio: '540p', desc: '标清' },
];

/** 短链重定向 → 提取 Location */
async function resolveShortLink(url: string): Promise<string> {
  try {
    const resp = await axios.get(url, {
      headers: getMobileHeaders(),
      maxRedirects: 0,
      timeout: 10000,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return resp.headers['location'] || url;
  } catch (err: any) {
    if (err.response?.headers?.['location']) return err.response.headers['location'];
    throw err;
  }
}

/** 从 _ROUTER_DATA 提取视频 item */
async function fetchVideoFromSharePage(awemeId: string): Promise<any> {
  const pageUrl = `https://www.iesdouyin.com/share/video/${awemeId}/?region=CN&mid=&from=web_code_link`;
  const resp = await axios.get(pageUrl, {
    headers: getMobileHeaders(),
    timeout: 15000,
    maxRedirects: 5,
  });
  const html: string = resp.data;
  const prefix = 'window._ROUTER_DATA = ';
  const idx = html.indexOf(prefix);
  if (idx === -1) throw new Error('页面未包含视频数据');

  const jsonText = html.slice(idx + prefix.length);
  let depth = 0, endIdx = 0;
  for (let i = 0; i < jsonText.length; i++) {
    if (jsonText[i] === '{') depth++;
    else if (jsonText[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
  }
  if (!endIdx) throw new Error('JSON 解析失败');

  const data = JSON.parse(jsonText.slice(0, endIdx));
  const items = data?.loaderData?.['video_(id)/page']?.videoInfoRes?.item_list;
  if (!items?.length) throw new Error('视频不存在或已删除');
  return items[0];
}

/** 构造多档清晰度地址 */
function buildQualityUrls(uri: string): { wm: Record<string, string>; nowm: Record<string, string> } {
  const wm: Record<string, string> = {};
  const nowm: Record<string, string> = {};

  for (const res of RESOLUTIONS) {
    wm[res.label] = `https://aweme.snssdk.com/aweme/v1/playwm/?video_id=${uri}&ratio=${res.ratio}&line=0`;
    nowm[res.label] = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${uri}&ratio=${res.ratio}&line=0`;
  }

  return { wm, nowm };
}

/** 提取封面 */
function extractCover(item: any): string {
  const v = item?.video;
  return v?.cover?.url_list?.[0] || v?.origin_cover?.url_list?.[0] || '';
}

/** 主入口 */
export async function parse(url: string): Promise<VideoInfo> {
  let realUrl = url;
  if (url.includes('v.douyin.com')) {
    realUrl = await resolveShortLink(url);
  }

  const m = realUrl.match(/\/video\/(\d+)/) || url.match(/(\d{15,20})/);
  if (!m) throw new Error('未能提取视频 ID');
  const awemeId = m[1];

  const item = await fetchVideoFromSharePage(awemeId);
  const uri: string = item?.video?.play_addr?.uri;
  if (!uri) throw new Error('未找到播放地址');

  const { nowm, wm } = buildQualityUrls(uri);

  return {
    platform: 'douyin',
    aweme_id: awemeId,
    title: item?.desc || '无标题',
    author: item?.author?.nickname || item?.author?.unique_id || '未知作者',
    cover_url: extractCover(item),
    video_url: nowm['1080p'],         // 默认 1080p 无水印
    video_url_watermark: wm['1080p'],
    quality: {
      nowm,
      wm,
    } as any,
  };
}
