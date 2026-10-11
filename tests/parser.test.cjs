const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractVideoId, extractShareItem, videoInfoFromDetail } = require('../dist/platforms/douyin');
const { extractUrl, detectPlatform, downloadHeaders } = require('../dist/utils');

test('extract a URL from share text and support desktop modal links', () => {
  assert.equal(extractUrl('5.84 李修贤 https://v.douyin.com/a8dF_Hgbs1Y/ 复制此链接'), 'https://v.douyin.com/a8dF_Hgbs1Y/');
  assert.equal(extractVideoId('https://www.douyin.com/jingxuan?modal_id=7694687184145842152'), '7694687184145842152');
  assert.equal(detectPlatform('https://www.iesdouyin.com/share/video/7694687184145842152'), 'douyin');
  assert.equal(detectPlatform('https://douyin.com.example.org/video/123'), null);
  assert.equal(detectPlatform('https://example.org/douyin.com'), null);
});

test('missing sharing data falls back; braces in titles do not truncate JSON', () => {
  const id = '7694687184145842152';
  assert.equal(extractShareItem('<script>window._ROUTER_DATA={"loaderData":{"video_(id)/page":{"itemId":"'+id+'"}}};</script>', id), null);
  const item = { aweme_id: id, desc: 'a } brace', video: { play_addr: { url_list: ['https://cdn.example/video.mp4'] } } };
  const raw = { loaderData: { 'video_(id)/page': { videoInfoRes: { item_list: [item] } } } };
  assert.deepEqual(extractShareItem(`<script>window._ROUTER_DATA = ${JSON.stringify(raw)};</script>`, id), item);
});

test('use real resolutions and bitrate streams without fabricated 4K or DASH-only media', () => {
  const addr = (width, height, url) => ({ width, height, url_list: [url] });
  const info = videoInfoFromDetail({ aweme_id: '1', video: {
    width: 1280, height: 720, play_addr: addr(1280,720,'https://cdn.example/default.mp4'),
    bit_rate: [
      { bit_rate: 100, play_addr: addr(1280,720,'https://cdn.example/low.mp4') },
      { bit_rate: 200, play_addr: addr(1280,720,'https://cdn.example/high.mp4') },
      { bit_rate: 300, play_addr: addr(3840,2160,'https://www.douyin.com/aweme/v1/play/dash/?video_id=1') },
      { bit_rate: 50, play_addr: addr(1024,576,'https://cdn.example/small.mp4') },
    ],
  } });
  assert.deepEqual(Object.keys(info.quality.nowm), ['720p','576p']);
  assert.equal(info.video_url, 'https://cdn.example/high.mp4');
  assert.equal(info.video_url_watermark, '');
  assert.equal(downloadHeaders('bilibili').Referer, 'https://www.bilibili.com/');
});
