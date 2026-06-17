import axios from 'axios';
import * as crypto from 'crypto';
import { VideoInfo } from '../utils';

/**
 * SnapAny 通用解析器（回退方案）
 *
 * 解析原理 (参考 videodl — snapany.py):
 *   - 调用第三方 API https://api.snapany.com/v1/extract/post
 *   - 需要 MD5 签名 (url + lang + timestamp + salt)
 *   - 返回 medias 列表，取 video 类型的最高画质
 */

const SNAPANY_SALT = '6HTugjCXxR';

export async function parse(url: string): Promise<VideoInfo> {
  const timestamp = String(Date.now());
  const lang = 'zh';
  const signStr = `${url}${lang}${timestamp}${SNAPANY_SALT}`;
  const gFooter = crypto.createHash('md5').update(signStr).digest('hex');

  const resp = await axios.post(
    'https://api.snapany.com/v1/extract/post',
    { link: url },
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': lang,
        'G-Timestamp': timestamp,
        'G-Footer': gFooter,
        'Content-Type': 'application/json',
        Origin: 'https://snapany.com',
        Referer: 'https://snapany.com/',
      },
      timeout: 20000,
    }
  );

  const data = resp.data;
  if (!data?.medias) throw new Error('SnapAny 未能解析该链接');

  // 取视频类型的 media
  const videos = data.medias.filter(
    (m: any) => m.media_type === 'video' && m.formats?.length
  );
  if (!videos.length) throw new Error('未找到视频资源');

  // 按 quality + video_size 排序取最高画质
  const formats: Array<{ video_url: string; quality: string; video_size: string }> =
    videos[0].formats.filter((f: any) => f.video_url);
  formats.sort((a, b) => {
    const aNum = parseInt((a.quality || '').match(/\d+/)?.[0] || '0');
    const bNum = parseInt((b.quality || '').match(/\d+/)?.[0] || '0');
    return bNum - aNum;
  });

  const best = formats[0];
  if (!best?.video_url) throw new Error('未找到可用的视频地址');

  return {
    platform: 'generic',
    aweme_id: '',
    title: data.text || '视频下载',
    author: '',
    cover_url: data.preview_url || '',
    video_url: best.video_url,
    video_url_watermark: '',
  };
}
