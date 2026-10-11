import { randomBytes } from 'crypto';
import { AxiosResponse } from 'axios';
import { VideoInfo, downloadHeaders } from './utils';
import { safeGet, validateRemoteUrl } from './safe-http';
import { parseVideoUrl } from './parser';

export interface DownloadTicket {
  source: string;
  platform: string;
  title: string;
  quality: string;
  watermark: boolean;
  urls: string[];
  expires: number;
}
const tickets = new Map<string, DownloadTicket>();
const lifetime = 30 * 60 * 1000;

function urlsFor(info: VideoInfo, quality: string, watermark: boolean): string[] {
  if (watermark) return info.watermark_candidates || [info.video_url_watermark].filter(Boolean);
  if (quality) return info.quality_candidates?.[quality] || [info.quality?.nowm?.[quality]].filter(Boolean) as string[];
  return info.video_candidates || [info.video_url];
}

export function issueDownloads(info: VideoInfo, source: string) {
  const add = (quality: string, watermark: boolean) => {
    const urls = urlsFor(info, quality, watermark);
    urls.forEach(validateRemoteUrl);
    if (!urls.length) return '';
    const token = randomBytes(24).toString('hex');
    tickets.set(token, { source, platform: info.platform, title: info.title, quality, watermark, urls, expires: Date.now() + lifetime });
    return `/api/download?token=${token}`;
  };
  for (const [token, ticket] of tickets) if (ticket.expires < Date.now()) tickets.delete(token);
  const qualities: Record<string, string> = {};
  for (const quality of Object.keys(info.quality?.nowm || {})) qualities[quality] = add(quality, false);
  const result = { default: add('', false), watermark: info.video_url_watermark ? add('', true) : '', qualities };
  // Bounded memory even if many links are parsed.
  while (tickets.size > 2000) tickets.delete(tickets.keys().next().value!);
  return result;
}

export function getTicket(token: unknown): DownloadTicket {
  const ticket = typeof token === 'string' ? tickets.get(token) : undefined;
  if (!ticket || ticket.expires <= Date.now()) throw new Error('下载凭证无效或已过期，请重新解析');
  return ticket;
}

/** Try mirrors, then refresh the same source and quality once before streaming. */
export async function openDownload(
  ticket: DownloadTicket, range?: string,
  fetcher = safeGet, refresher = parseVideoUrl,
): Promise<AxiosResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of [...new Set(ticket.urls)]) {
      try {
        const response = await fetcher(url, {
          headers: { ...downloadHeaders(ticket.platform), ...(range ? { Range: range } : {}) },
          responseType: 'stream', timeout: 15000,
        });
        const type = String(response.headers['content-type'] || '');
        if (!/^(video\/|application\/octet-stream)/i.test(type)) {
          response.data.destroy();
          throw new Error('地址未返回视频');
        }
        return response;
      } catch (error: any) {
        if (error.response?.data?.destroy) error.response.data.destroy();
        // A requested range outside the file must not trigger reparsing.
        if (error.response?.status === 416) throw error;
        lastError = error;
      }
    }
    if (attempt === 0) {
      const updated = await refresher(ticket.source);
      ticket.urls = urlsFor(updated, ticket.quality, ticket.watermark);
      if (!ticket.urls.length) throw new Error('该清晰度已不可用，请重新解析');
    }
  }
  console.error('[download] 备用地址及刷新均失败:', (lastError as Error)?.message);
  throw new Error('视频下载失败，请稍后重新解析');
}
