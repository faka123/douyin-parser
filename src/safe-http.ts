import axios, { AxiosRequestConfig } from 'axios';
import http from 'http';
import https from 'https';
import dns from 'dns';
import ipaddr from 'ipaddr.js';

export function publicAddress(address: string): boolean {
  try { return ipaddr.process(address.replace(/^\[|\]$/g, '')).range() === 'unicast'; }
  catch { return false; }
}

/** Explicit compatibility for a local proxy using RFC 2544 fake DNS addresses. */
export function allowedFakeAddress(host: string, address: string): boolean {
  if (process.env.ALLOW_FAKE_IP !== '1') return false;
  const domains = ['douyin.com', 'iesdouyin.com', 'douyinvod.com', 'bilibili.com',
    'bilivideo.com', 'kuaishou.com', 'xiaohongshu.com', 'xhscdn.com', 'xhslink.com'];
  if (!domains.some(domain => host === domain || host.endsWith('.' + domain))) return false;
  try { return ipaddr.parse(address).kind() === 'ipv4'
    && ipaddr.parse(address).match(ipaddr.parseCIDR('198.18.0.0/15')); }
  catch { return false; }
}

export function validateRemoteUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('仅支持公开的 HTTP/HTTPS 视频地址');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')
    || (ipaddr.isValid(host) && !publicAddress(host))) {
    throw new Error('不允许访问本机或内网地址');
  }
  return url;
}

// Validate the addresses actually used by the socket, including after redirects.
const lookup: any = (host: string, options: any, callback: any) => {
  dns.lookup(host, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(a => !publicAddress(a.address) && !allowedFakeAddress(host, a.address))) {
      return callback(new Error('不允许访问本机或内网地址'));
    }
    const family = typeof options === 'number' ? options : options?.family;
    const eligible = family ? addresses.filter(a => a.family === family) : addresses;
    if (!eligible.length) return callback(new Error('没有可用的公开网络地址'));
    if (options?.all) callback(null, eligible);
    else callback(null, eligible[0].address, eligible[0].family);
  });
};
const httpAgent = new http.Agent({ lookup });
const httpsAgent = new https.Agent({ lookup });

export function safeGet(url: string, config: AxiosRequestConfig = {}) {
  validateRemoteUrl(url);
  return axios.get(url, {
    ...config, adapter: 'http', proxy: false, httpAgent, httpsAgent,
    maxRedirects: 5,
    beforeRedirect: options => {
      validateRemoteUrl(`${options.protocol}//${options.hostname}${options.port ? ':' + options.port : ''}/`);
    },
  });
}
