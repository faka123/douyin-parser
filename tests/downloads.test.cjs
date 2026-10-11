const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { publicAddress, validateRemoteUrl, safeGet } = require('../dist/safe-http');
const { getTicket, issueDownloads, openDownload } = require('../dist/downloads');

const info = { platform: 'douyin', title: 'test', aweme_id: '123', video_url: 'https://cdn.example/a.mp4', video_url_watermark: '', video_candidates: ['https://cdn.example/a.mp4','https://cdn.example/b.mp4'] };
const response = (type = 'video/mp4') => ({ status: 200, headers: { 'content-type': type }, data: Readable.from(['data']) });
const ticket = () => ({ source: 'https://www.douyin.com/video/123', platform: 'douyin', title: 'test', quality: '', watermark: false, urls: info.video_candidates, expires: Date.now()+1000 });

test('reject local, private, metadata, IPv6 and mapped IPs and unsupported protocols', () => {
  for (const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','::1','fe80::1','fc00::1','::ffff:127.0.0.1','0.0.0.0']) assert.equal(publicAddress(address), false, address);
  for (const address of ['8.8.8.8','2606:4700:4700::1111']) assert.equal(publicAddress(address), true);
  for (const url of ['http://127.0.0.1/','http://2130706433/','http://[::1]/','http://localhost/','http://user:pass@example.com/','file:///etc/passwd','data:text/plain,hello']) assert.throws(() => validateRemoteUrl(url));
});

test('download requires a server-issued token, not a supplied arbitrary URL', () => {
  assert.throws(() => getTicket('https://cdn.example/a.mp4'));
  const downloads = issueDownloads(info, ticket().source);
  const token = new URL(downloads.default, 'http://localhost').searchParams.get('token');
  assert.deepEqual(getTicket(token).urls, info.video_candidates);
  assert.throws(() => issueDownloads({...info, video_candidates:['http://127.0.0.1/']},ticket().source));
});

test('mirror failure switches to the next URL without reparsing', async () => {
  const calls = [];
  const result = await openDownload(ticket(), 'bytes=0-1023', async (url, config) => {
    calls.push(url);
    assert.equal(config.headers.Range, 'bytes=0-1023');
    if (calls.length === 1) throw new Error('expired');
    return response();
  }, async () => { throw new Error('unexpected refresh'); });
  assert.equal(result.status, 200);
  assert.deepEqual(calls, info.video_candidates);
  result.data.destroy();
});

test('all expired mirrors cause one refresh; HTML streams are closed', async () => {
  let refreshes = 0;
  const html = response('text/html');
  const calls = [];
  const result = await openDownload(ticket(), undefined, async url => {
    calls.push(url);
    if (url.endsWith('/fresh.mp4')) return response();
    return html;
  }, async source => {
    refreshes++;
    assert.equal(source, ticket().source);
    return {...info, video_candidates:['https://cdn.example/fresh.mp4']};
  });
  assert.equal(refreshes, 1);
  assert.equal(html.data.destroyed, true);
  assert.deepEqual(calls, [...info.video_candidates,'https://cdn.example/fresh.mp4']);
  result.data.destroy();
});

test('range errors do not reparse and unavailable quality does not silently downgrade', async () => {
  await assert.rejects(openDownload(ticket(),'bytes=999999-', async()=>{throw {response:{status:416}}},async()=>{throw new Error('unexpected refresh')}), e=>e.response.status===416);
  await assert.rejects(openDownload({...ticket(),quality:'1080p'},undefined,async()=>{throw new Error('expired')},async()=>({...info,quality:{nowm:{'720p':info.video_url},wm:{}}})), /清晰度已不可用/);
});

test('DNS resolving a hostname to loopback cannot bypass URL validation', async () => {
  // localhost.localdomain is not rejected just by its name; the socket lookup rejects its address.
  try { await safeGet('http://localhost.localdomain/', {timeout:2000}); assert.fail('local DNS address allowed'); }
  catch (e) { assert.match(e.message, /内网地址|ENOTFOUND|EAI_AGAIN/); }
});

test('fake DNS compatibility is opt-in and restricted to platform domains and its specific subnet', () => {
  const { allowedFakeAddress } = require('../dist/safe-http');
  const previous = process.env.ALLOW_FAKE_IP;
  try {
    delete process.env.ALLOW_FAKE_IP;
    assert.equal(allowedFakeAddress('v.douyin.com','198.18.0.159'),false);
    process.env.ALLOW_FAKE_IP='1';
    assert.equal(allowedFakeAddress('v.douyin.com','198.18.0.159'),true);
    assert.equal(allowedFakeAddress('douyin.com.example.org','198.18.0.159'),false);
    assert.equal(allowedFakeAddress('v.douyin.com','127.0.0.1'),false);
    assert.equal(allowedFakeAddress('v.douyin.com','192.168.1.1'),false);
    assert.equal(allowedFakeAddress('v.douyin.com','198.20.0.1'),false);
  } finally {
    if(previous === undefined) delete process.env.ALLOW_FAKE_IP;
    else process.env.ALLOW_FAKE_IP=previous;
  }
});

test('redirects to private IPs are rejected before connecting', async () => {
  const axios = require('axios');
  const original = axios.get;
  let config;
  axios.get = async (_url, options) => {config=options;return response()};
  try {
    const r=await safeGet('https://cdn.example/file');
    r.data.destroy();
    assert.equal(config.proxy,false);
    assert.equal(config.adapter,'http');
    for(const hostname of ['127.0.0.1','169.254.169.254','192.168.1.1']) assert.throws(()=>config.beforeRedirect({protocol:'http:',hostname}));
    assert.doesNotThrow(()=>config.beforeRedirect({protocol:'https:',hostname:'cdn.example'}));
  } finally {axios.get=original;}
});
