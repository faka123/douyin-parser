/**
 * 多平台视频解析器 — 统一入口
 *
 * 架构:
 *   parse(url) → detectPlatform → 专用解析器
 * 抖音分享页缺失详情时，使用浏览器获取详情。
 *
 * 已支持平台: 抖音 / 快手 / 小红书 / B站
 */

import { detectPlatform, VideoInfo } from './utils';
import * as douyin from './platforms/douyin';
import * as kuaishou from './platforms/kuaishou';
import * as rednote from './platforms/rednote';
import * as bilibili from './platforms/bilibili';

const PARSERS: Record<string, { parse: (url: string) => Promise<VideoInfo> }> = {
  douyin,
  kuaishou,
  rednote,
  bilibili,
};

export { VideoInfo };

export async function parseVideoUrl(url: string): Promise<VideoInfo> {
  const platform = detectPlatform(url);

  // 1. 无匹配平台 → 提示用户
  if (!platform) {
    throw new Error(
      '未能识别该链接的平台。目前支持：抖音(v.douyin.com)、快手(kuaishou.com)、小红书(xhslink.com)、B站(bilibili.com)'
    );
  }

  // 2. 尝试专用解析器
  if (PARSERS[platform]) {
    try {
      console.log(`[parser] 尝试 ${platform} 专用解析器...`);
      return await PARSERS[platform].parse(url);
    } catch (err: any) {
      console.log(`[parser] ${platform} 专用解析失败: ${err.message}`);
      throw err; // 直接抛出，不隐藏真实错误
    }
  }

  throw new Error(`平台 "${platform}" 暂未实现解析逻辑`);
}
