import { safeGet } from '../safe-http';
import { getMobileHeaders, VideoInfo } from '../utils';
import { fetchBrowserDetail } from './douyin-browser';

export function extractVideoId(url: string): string | null {
  const parsed = new URL(url);
  return parsed.pathname.match(/\/(?:video|note)\/(\d{15,20})/)?.[1]
    || parsed.searchParams.get('modal_id')?.match(/^\d{15,20}$/)?.[0]
    || parsed.searchParams.get('aweme_id')?.match(/^\d{15,20}$/)?.[0] || null;
}

export function extractShareItem(html: string, id: string): any | null {
  const match = html.match(/window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1].trim().replace(/;\s*$/, ''));
    for (const loader of Object.values(raw.loaderData || {}) as any[]) {
      const item = loader?.videoInfoRes?.item_list?.find((v: any) => String(v.aweme_id) === id);
      if (item?.video?.play_addr?.url_list?.length) return item;
    }
  } catch { /* Fall back to the browser if the page schema changes. */ }
  return null;
}

function usableUrls(address: any): string[] {
  return (address?.url_list || []).filter((url: unknown) => typeof url === 'string'
    && /^https?:\/\//.test(url) && !/\/playwm\/|\/play\/dash\//.test(url));
}

/** Only report actual streams. Never invent 4K or construct unsigned play URLs. */
export function videoInfoFromDetail(item: any): VideoInfo {
  const video = item?.video;
  if (!video || !usableUrls(video.play_addr).length) {
    throw new Error(item?.images?.length ? '该链接为图集，暂不支持图集下载' : '视频详情没有可用播放地址');
  }
  const candidates = [
    { address: video.play_addr, bitrate: Number(video.bit_rate?.[0]?.bit_rate || 0) },
    ...(video.bit_rate || []).filter((b: any) => !b.format || b.format === 'mp4')
      .map((b: any) => ({ address: b.play_addr, bitrate: Number(b.bit_rate || 0) })),
  ].filter(c => usableUrls(c.address).length);
  const resolution = (addr: any) => {
    const width = Number(addr.width || video.width || 0);
    const height = Number(addr.height || video.height || 0);
    return width && height ? Math.min(width, height) : 0;
  };
  candidates.sort((a, b) => resolution(b.address) - resolution(a.address) || b.bitrate - a.bitrate);
  const nowm: Record<string, string> = {};
  const quality_candidates: Record<string, string[]> = {};
  for (const candidate of candidates) {
    const pixels = resolution(candidate.address);
    const label = pixels ? `${pixels}p` : '原画';
    if (!nowm[label]) {
      nowm[label] = usableUrls(candidate.address)[0];
      quality_candidates[label] = usableUrls(candidate.address);
    }
  }
  return {
    platform: 'douyin', aweme_id: String(item.aweme_id),
    title: item.desc || '无标题', author: item.author?.nickname || '未知作者',
    cover_url: video.cover?.url_list?.[0] || video.origin_cover?.url_list?.[0] || '',
    video_url: Object.values(nowm)[0],
    video_url_watermark: usableUrls(video.download_addr)[0] || '',
    quality: { nowm, wm: {} }, quality_candidates,
    video_candidates: quality_candidates[Object.keys(nowm)[0]],
    watermark_candidates: usableUrls(video.download_addr),
  };
}

export async function parse(url: string): Promise<VideoInfo> {
  let realUrl = url;
  if (new URL(url).hostname === 'v.douyin.com') {
    const response = await safeGet(url, {
      headers: getMobileHeaders(), maxRedirects: 5, timeout: 15000,
    });
    realUrl = response.request?.res?.responseUrl || url;
  }
  const id = extractVideoId(realUrl);
  if (!id) throw new Error('未能提取视频 ID，请提供视频分享链接');
  let item: any;
  try {
    const response = await safeGet(`https://www.iesdouyin.com/share/video/${id}/`, {
      headers: getMobileHeaders(), timeout: 10000,
    });
    item = extractShareItem(String(response.data), id);
  } catch { /* Sharing pages may be unavailable while the web detail still works. */ }
  if (!item) item = await fetchBrowserDetail(id);
  return videoInfoFromDetail(item);
}
