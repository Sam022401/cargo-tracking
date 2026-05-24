const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

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
        // 查询成功才保存历史（填错单号不存记录）
        if (result.result !== false) {
          const history = loadHistory();
          history[no] = { ...history[no], no, result, updatedAt: new Date().toISOString() };
          saveHistory(history);
        }
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

  // 静态文件
  if (serveStatic(req, res)) return;

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 跟踪看板已启动: http://localhost:${PORT}`);
});
