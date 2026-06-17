import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import axios from 'axios';
import { parseVideoUrl } from './parser';

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * 智能提取 URL：从用户粘贴的整段文案中提取可用的视频链接
 *
 * 支持的输入格式:
 *   - 纯链接: https://v.douyin.com/xxxxx/
 *   - 完整文案: "6.99 06/12 :7pm p@d.AG reB:/ ... https://v.douyin.com/xxxxx/ 复制此链接..."
 */
function extractUrl(raw: string): string {
  const trimmed = raw.trim();

  // 如果整段文字中包含常见的视频平台域名，直接提取
  const RELEVANT_DOMAINS = [
    'douyin.com', 'iesdouyin.com',
    'kuaishou.com',
    'xiaohongshu.com', 'xhslink.com',
    'bilibili.com',
  ];

  for (const domain of RELEVANT_DOMAINS) {
    // 匹配包含该域名的完整 URL
    const regex = new RegExp(
      `https?://[^\\s]*${domain.replace(/\./g, '\\.')}[^\\s]*`,
      'gi'
    );
    const match = trimmed.match(regex);
    if (match) return match[0];
  }

  // 兜底：如果本身就是纯 URL，直接返回
  if (/^https?:\/\//.test(trimmed)) return trimmed;

  throw new Error(
    '未在粘贴内容中找到视频链接。支持：douyin.com / kuaishou.com / xhslink.com / bilibili.com'
  );
}

// -- 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// -- POST /api/parse — 多平台视频解析
app.post('/api/parse', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      res.status(400).json({ success: false, error: '请提供视频分享链接' });
      return;
    }

    // 智能提取链接：用户可能粘贴整段文案（含文字 + 链接），自动提取 URL
    const cleanedUrl = extractUrl(url);
    console.log(`\n[api] 解析请求: ${cleanedUrl.substring(0, 80)}...`);
    const info = await parseVideoUrl(cleanedUrl);
    console.log(`[api] ✅ 解析成功 | 平台: ${info.platform} | 标题: ${info.title}`);

    res.json({ success: true, data: info });
  } catch (err: any) {
    console.error(`[api] ❌ 解析失败:`, err.message);
    res.status(400).json({ success: false, error: err.message || '解析失败，请稍后重试' });
  }
});

// -- GET /api/download — 代理下载视频 (防盗链)
app.get('/api/download', async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    const filename = (req.query.filename as string) || `video_${Date.now()}`;

    if (!url) {
      res.status(400).json({ success: false, error: '缺少视频地址' });
      return;
    }

    console.log(`[download] 代理下载: ${url.substring(0, 80)}...`);

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        Referer: 'https://www.douyin.com/',
      },
      responseType: 'stream',
      timeout: 60000,
    });

    const contentType = String(response.headers['content-type'] || 'video/mp4');
    const contentLength = String(response.headers['content-length'] || '');

    // 清理文件名中的非法字符
    const safeName = filename
      .replace(/[[:\\/*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);

    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(safeName)}.mp4"; filename*=UTF-8''${encodeURIComponent(safeName)}.mp4`
    );
    res.setHeader('Cache-Control', 'public, max-age=86400');

    response.data.pipe(res);
    response.data.on('error', (err: Error) => {
      console.error(`[download] 流错误:`, err.message);
      if (!res.headersSent) res.status(500).json({ success: false, error: '下载中断' });
    });
  } catch (err: any) {
    console.error(`[download] 失败:`, err.message);
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message || '下载失败' });
  }
});

// -- 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: 'Not Found' });
});

// -- 全局错误处理
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] 未捕获:', err);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║   🎬 多平台视频解析服务已启动        ║
║   地址: http://localhost:${PORT}        ║
║   支持: 抖音 | 快手 | 小红书 | B站  ║
║   回退: SnapAny 通用解析             ║
╚══════════════════════════════════════╝
`);
});
