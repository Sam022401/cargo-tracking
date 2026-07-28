const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { getLatestEvent, calcStatus, statusLabel, getBriefText } = require('./shared/status-calculator');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ---- 数据持久化 ----
function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch { return {}; }
}
function saveHistory(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ---- 代理 zddexp 查询 ----
function trackQuery(no) {
  return new Promise((resolve, reject) => {
    const postData = `code=GZSQ&no=${encodeURIComponent(no)}`;
    const options = {
      hostname: 'www.zddexp.com',
      path: '/apiservice/DoTrackQuery',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('解析响应失败')); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ---- 静态文件服务 ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
};

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/tracking.html' : req.url;
  filePath = path.join(__dirname, filePath);
  const ext = path.extname(filePath);
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(content);
  return true;
}

// ---- HTTP 服务 ----
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // API: 查询单号
  if (pathname === '/api/track' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const params = new URLSearchParams(body);
      const no = params.get('no') || '';
      if (!no) { res.writeHead(400); res.end(JSON.stringify({ error: '请提供单号' })); return; }
      try {
        const result = await trackQuery(no);
        // 更新历史
        const history = loadHistory();
        history[no] = { ...history[no], no, result, updatedAt: new Date().toISOString() };
        saveHistory(history);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API: 获取历史
  if (pathname === '/api/history' && req.method === 'GET') {
    const history = loadHistory();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
    return;
  }

  // API: 删除单号
  if (pathname.startsWith('/api/history/') && req.method === 'DELETE') {
    const no = decodeURIComponent(pathname.slice('/api/history/'.length));
    const history = loadHistory();
    delete history[no];
    saveHistory(history);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // API: 保存/获取单号备注
  if (pathname.startsWith('/api/note/') && req.method === 'PUT') {
    const no = decodeURIComponent(pathname.slice('/api/note/'.length));
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { note, salesperson, supplier, supplierNo, warehouse, groupName } = JSON.parse(body);
        const history = loadHistory();
        if (history[no]) {
          if (note !== undefined) history[no].note = note || '';
          if (salesperson !== undefined) history[no].salesperson = salesperson || '';
          if (supplier !== undefined) history[no].supplier = supplier || '';
          if (supplierNo !== undefined) history[no].supplierNo = supplierNo || '';
          if (warehouse !== undefined) history[no].warehouse = warehouse || '';
          if (groupName !== undefined) history[no].groupName = groupName || '';
          saveHistory(history);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch { res.writeHead(400); res.end(JSON.stringify({ error: '解析失败' })); }
    });
    return;
  }

  // API: 偏远查询代理
  if (pathname === '/api/remote-check' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      const postData = `country=${encodeURIComponent(params.get('country') || '')}&country_zw=${encodeURIComponent(params.get('country_zw') || '')}&post_city=${encodeURIComponent(params.get('post_city') || '')}&express_company=${encodeURIComponent(params.get('express_company') || '')}&type=single`;
      const options = {
        hostname: 'www.51tracking.com',
        path: '/remote_area_ajax.php',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'Referer': 'https://www.51tracking.com/remote_area-cn',
        },
      };
      const proxyReq = https.request(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });
      proxyReq.on('error', () => { res.writeHead(500); res.end(JSON.stringify({ error: '查询失败' })); });
      proxyReq.write(postData);
      proxyReq.end();
    });
    return;
  }

  // API: 刷新所有活跃单号
  if (pathname === '/api/refresh-all' && req.method === 'POST') {
    const history = loadHistory();
    const nos = Object.keys(history);
    const results = {};
    for (const no of nos) {
      try {
        const result = await trackQuery(no);
        history[no] = { ...history[no], no, result, updatedAt: new Date().toISOString() };
        results[no] = 'ok';
      } catch { results[no] = 'fail'; }
    }
    saveHistory(history);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, results }));
    return;
  }

  // API: 获取所有单号状态（供微信机器人轮询用，不重复查询 zddexp）
  if (pathname === '/api/statuses' && req.method === 'GET') {
    const history = loadHistory();
    const statuses = {};
    for (const [no, item] of Object.entries(history)) {
      const status = calcStatus(item.result);
      const latest = getLatestEvent(item.result);
      statuses[no] = {
        status,
        statusLabel: statusLabel(status, 'zh'),
        latestEventId: latest ? latest.id : null,
        latestEventContent: getBriefText(item.result, 'zh'),
        updatedAt: item.updatedAt
      };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statuses));
    return;
  }

  // API: 获取单个单号状态
  if (pathname.startsWith('/api/status/') && req.method === 'GET') {
    const no = decodeURIComponent(pathname.slice('/api/status/'.length));
    const history = loadHistory();
    if (!history[no]) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '单号不存在' }));
      return;
    }
    const item = history[no];
    const status = calcStatus(item.result);
    const latest = getLatestEvent(item.result);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      no,
      status,
      statusLabel: statusLabel(status, 'zh'),
      latestEventId: latest ? latest.id : null,
      latestEventContent: getBriefText(item.result, 'zh'),
      updatedAt: item.updatedAt
    }));
    return;
  }

  // API: @查询专用 — 有缓存直接用，无缓存则查询 zddexp
  if (pathname === '/api/reply-lookup' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const params = new URLSearchParams(body);
      const no = params.get('no') || '';
      if (!no) { res.writeHead(400); res.end(JSON.stringify({ error: '请提供单号' })); return; }
      const history = loadHistory();
      // 有缓存且未超过30分钟，直接用
      const cached = history[no];
      const cacheAge = cached ? (Date.now() - new Date(cached.updatedAt).getTime()) : Infinity;
      if (cached && cacheAge < 30 * 60 * 1000) {
        const status = calcStatus(cached.result);
        const latest = getLatestEvent(cached.result);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          no,
          cached: true,
          status,
          statusLabel: statusLabel(status, 'zh'),
          latestEventId: latest ? latest.id : null,
          latestEventContent: getBriefText(cached.result, 'zh'),
          updatedAt: cached.updatedAt,
          events: (cached.result && cached.result.dataDict && cached.result.dataDict.list) || []
        }));
        return;
      }
      // 缓存过期或不存在，重新查询
      try {
        const result = await trackQuery(no);
        history[no] = { ...history[no], no, result, updatedAt: new Date().toISOString() };
        saveHistory(history);
        const status = calcStatus(result);
        const latest = getLatestEvent(result);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          no,
          cached: false,
          status,
          statusLabel: statusLabel(status, 'zh'),
          latestEventId: latest ? latest.id : null,
          latestEventContent: getBriefText(result, 'zh'),
          updatedAt: history[no].updatedAt,
          events: (result && result.dataDict && result.dataDict.list) || []
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 静态文件
  if (serveStatic(req, res)) return;

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 跟踪看板已启动: http://localhost:${PORT}`);
});
