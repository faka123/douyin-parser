import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { parseVideoUrl } from './parser';
import { extractUrl } from './utils';
import { issueDownloads, getTicket, openDownload } from './downloads';
import { pipeline } from 'stream';

const app = express();
const PORT = process.env.PORT || 3000;

// -- 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// -- GET / — 首页
app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
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

    res.json({ success: true, data: { ...info, downloads: issueDownloads(info, cleanedUrl) } });
  } catch (err: any) {
    console.error(`[api] ❌ 解析失败:`, err.message);
    res.status(400).json({ success: false, error: err.message || '解析失败，请稍后重试' });
  }
});

// -- GET /api/download — 代理下载视频 (防盗链)
app.get('/api/download', async (req: Request, res: Response) => {
  try {
    let ticket;
    try { ticket = getTicket(req.query.token); }
    catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    const filename = ticket.title || `video_${Date.now()}`;
    const response = await openDownload(ticket, req.headers.range);

    const contentType = String(response.headers['content-type'] || 'application/octet-stream');
    const contentLength = String(response.headers['content-length'] || '');
    if (!/^(video\/|application\/octet-stream)/i.test(contentType)) {
      response.data.destroy();
      res.status(502).json({ success: false, error: '播放地址未返回视频，链接可能已过期，请重新解析' });
      return;
    }
    res.status(response.status);
    if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
    if (response.headers['accept-ranges']) res.setHeader('Accept-Ranges', response.headers['accept-ranges']);

    // 清理文件名中的非法字符
    const safeName = filename
      .replace(/[\[\]\\/:*?"<>|\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200) || 'video';

    res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(safeName)}.mp4"; filename*=UTF-8''${encodeURIComponent(safeName)}.mp4`
    );
    res.setHeader('Cache-Control', 'no-store');

    res.on('close', () => response.data.destroy());
    pipeline(response.data, res, (err) => {
      if (err) console.error('[download] 下载流中断:', err.message);
    });
  } catch (err: any) {
    console.error(`[download] 失败:`, err.message);
    if (!res.headersSent) res.status(err.response?.status === 416 ? 416 : 502).json({ success: false, error: err.message || '下载失败' });
  }
});

// -- 404 (仅 API / 未知路径)
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ success: false, error: 'Not Found' });
});
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
║   抖音支持浏览器详情解析             ║
╚══════════════════════════════════════╝
`);
});
