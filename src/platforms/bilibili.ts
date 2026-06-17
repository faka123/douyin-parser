import axios from 'axios';
import { VideoInfo } from '../utils';

/**
 * Bilibili (B站) 视频解析器
 *
 * 解析原理 (参考 videodl — bilibili.py):
 *   1. 从 URL 提取 BV 号 (或 AV 号)
 *   2. 调 B站官方 API — x/web-interface/view 获取视频信息
 *   3. 调 x/player/playurl 获取播放地址 (优先最高清晰度 qn=80)
 *
 * 注意: B站无水印概念，但需要 Referer 防盗链。
 */

const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
};

/** 提取 BV/AV 号 */
function extractVideoId(url: string): { type: 'BV' | 'AV'; id: string } | null {
  let m: RegExpMatchArray | null;

  // BV 号
  m = url.match(/BV([A-Za-z0-9]+)/);
  if (m) return { type: 'BV', id: m[0] };

  // av 号（数字）
  m = url.match(/av(\d+)/i);
  if (m) return { type: 'AV', id: String(parseInt(m[1])) };

  return null;
}

export async function parse(url: string): Promise<VideoInfo> {
  const vid = extractVideoId(url);
  if (!vid) throw new Error('未能提取 BV 号，请检查链接');

  // 1. 获取视频基本信息
  const infoUrl =
    vid.type === 'BV'
      ? `https://api.bilibili.com/x/web-interface/view?bvid=${vid.id}`
      : `https://api.bilibili.com/x/web-interface/view?aid=${vid.id}`;

  const infoResp = await axios.get(infoUrl, { headers: API_HEADERS, timeout: 10000 });
  const infoData = infoResp.data?.data;
  if (!infoData) throw new Error('视频不存在或被删除');

  const bvid = infoData.bvid;
  const cid = infoData.cid || infoData.pages?.[0]?.cid;
  if (!cid) throw new Error('未找到视频分P信息');

  // 2. 获取播放地址 — qn=80 表示最高清晰度
  const playUrl = `https://api.bilibili.com/x/player/playurl?otype=json&fnver=0&fnval=0&qn=80&bvid=${bvid}&cid=${cid}&platform=html5`;
  const playResp = await axios.get(playUrl, { headers: API_HEADERS, timeout: 10000 });

  const durl: Array<{ url: string; size: number }> = playResp.data?.data?.durl || [];
  if (!durl.length) throw new Error('未找到可用的播放地址');

  // 取最大文件（最高画质）
  const best = durl.reduce((a, b) => (a.size > b.size ? a : b));

  return {
    platform: 'bilibili',
    aweme_id: bvid,
    title: infoData.title || 'B站视频',
    author: infoData.owner?.name || '',
    cover_url: infoData.pic || '',
    video_url: best.url,
    video_url_watermark: '',
  };
}
