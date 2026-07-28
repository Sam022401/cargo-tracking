// api-client.js — 封装对核心服务器的 HTTP 请求
const http = require('http');
const url = require('url');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(coreServerUrl + path);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: method,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('解析核心服务器响应失败')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    if (body) req.write(body);
    req.end();
  });
}

let coreServerUrl = 'http://127.0.0.1:3000';

function setServerUrl(u) { coreServerUrl = u; }

// 获取所有单号的计算状态
function fetchAllStatuses() {
  return request('GET', '/api/statuses');
}

// 获取单个单号状态
function fetchWaybillStatus(no) {
  return request('GET', '/api/status/' + encodeURIComponent(no));
}

// @查询专用：一站式查询+状态返回
function replyLookup(no) {
  return request('POST', '/api/reply-lookup', 'no=' + encodeURIComponent(no));
}

// 查询单号（标准 track 端点）
function trackWaybill(no) {
  return request('POST', '/api/track', 'no=' + encodeURIComponent(no));
}

module.exports = { setServerUrl, fetchAllStatuses, fetchWaybillStatus, replyLookup, trackWaybill };
