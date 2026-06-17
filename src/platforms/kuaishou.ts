import axios from 'axios';
import { getMobileHeaders, VideoInfo } from '../utils';

/**
 * 快手(Kuaishou) 视频解析器
 *
 * 解析原理 (参考 videodl — kuaishou.py):
 *   1. 从 URL 提取 video id
 *   2. GET 分享页 → 提取 window.__APOLLO_STATE__ JSON
 *   3. 遍历 VisionVideoDetailPhoto → 优选 H265 + 高码率的视频地址
 *
 * 快手没有水印问题 — 直接拿到的即为无水印地址。
 */

async function fetchFromApolloState(url: string): Promise<VideoInfo> {
  const vid = url.split('/').filter(Boolean).pop() || '';
  const headers = {
    ...getMobileHeaders({ Referer: 'https://v.kuaishou.com/' }),
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  };

  const resp = await axios.get(url, { headers, timeout: 15000, maxRedirects: 5 }).catch((err: any) => {
    const status = err?.response?.status;
    if (status === 401 || status === 403) throw new Error('快手拒绝了该请求，请确认链接有效或稍后再试');
    throw new Error(`请求快手页面失败: ${err.message}`);
  });
  const html: string = resp.data;

  // 提取 window.__APOLLO_STATE__ = {...};
  const match = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!match) throw new Error('页面数据未找到');

  const raw = JSON.parse(match[1]);
  const client: Record<string, any> = raw.defaultClient || {};

  // 找到 VisionVideoDetailPhoto 类型的条目
  const photoKey = Object.keys(client).find(
    (k) => client[k]?.__typename === 'VisionVideoDetailPhoto'
  );
  if (!photoKey) throw new Error('未找到视频详情');
  const photo = client[photoKey];

  // 收集视频候选: 优先 H265 (hevc), 再按码率 + 分辨率排序
  interface Candidate { url: string; priority: number }
  const candidates: Candidate[] = [];

  const pushCand = (url: string, codec: string) => {
    if (url) candidates.push({ url, priority: codec.startsWith('hevc') ? 2 : 1 });
  };

  pushCand(photo.photoH265Url, 'hevc_single');
  pushCand(photo.photoUrl, 'h264_single');

  const vr = photo.videoResource?.json;
  if (vr) {
    for (const codec of ['hevc', 'h264']) {
      for (const adapt of vr[codec]?.adaptationSet || []) {
        for (const rep of adapt.representation || []) {
          pushCand(rep.url, codec);
        }
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  if (!candidates.length) throw new Error('未找到可用视频流');

  const title = photo.caption || vid;
  const coverUrl = photo.coverUrl || photo.poster || '';

  return {
    platform: 'kuaishou',
    aweme_id: vid,
    title,
    author: photo.userName || photo.authorName || '',
    cover_url: coverUrl,
    video_url: candidates[0].url,
    video_url_watermark: '',
  };
}

export async function parse(url: string): Promise<VideoInfo> {
  return fetchFromApolloState(url);
}
