// bridge.js — 微信桥接主入口
// 启动后连接微信、开始轮询、监听消息
const path = require('path');

// 读取配置
let config;
try {
  config = require('./config.json');
} catch (e) {
  console.error('[bridge] 无法读取 config.json:', e.message);
  process.exit(1);
}

// 初始化 API 客户端
const apiClient = require('./api-client');
apiClient.setServerUrl(config.coreServerUrl);

// 初始化通知器（先不传 wcf，等 WeChatFerry 连接后再注入）
const { Notifier } = require('./notifier');
const notifier = new Notifier(config, null);

// 初始化状态监控器
const { StatusMonitor } = require('./status-monitor');
const monitor = new StatusMonitor(config, null, apiClient);
monitor.notifier = notifier;

// 初始化消息处理器
const { MessageHandler } = require('./message-handler');
const handler = new MessageHandler(config, null, apiClient);
handler.notifier = notifier;

// ---- 是否启用 WeChatFerry ----
let wcf = null;
let useWeChatFerry = true;

async function main() {
  console.log('[bridge] 货物跟踪微信桥接启动');

  // 验证核心服务器可达
  try {
    await apiClient.fetchAllStatuses();
    console.log('[bridge] 核心服务器连接成功:', config.coreServerUrl);
  } catch (e) {
    console.error('[bridge] 核心服务器不可达:', e.message);
    console.error('[bridge] 请先启动核心服务器 (npm start)');
    process.exit(1);
  }

  if (useWeChatFerry) {
    try {
      const { createClient } = require('wechatferry');
      wcf = createClient({ dllPath: config.wechat.dllPath });

      wcf.on('message', (msg) => handler.handle(msg));

      await wcf.start();
      console.log('[bridge] WeChatFerry 已连接');

      // 注入 wcf 到各模块
      notifier.wcf = wcf;
      monitor.wcf = wcf;
      handler.wcf = wcf;

    } catch (e) {
      console.error('[bridge] WeChatFerry 启动失败:', e.message);
      console.log('[bridge] 将以 dry-run 模式运行（不发送微信消息，仅日志输出）');
      useWeChatFerry = false;
    }
  }

  // 启动状态监控
  if (config.polling.enabled) {
    monitor.start();
  }

  console.log('[bridge] 桥接启动完成');
  console.log('[bridge] WeChatFerry:', useWeChatFerry ? '已连接' : 'dry-run 模式');
  console.log('[bridge] 轮询间隔:', config.polling.intervalMinutes, '分钟');
}

// 优雅退出
async function shutdown() {
  console.log('[bridge] 正在关闭...');
  monitor.stop();
  if (wcf) {
    try { await wcf.stop(); } catch {}
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(e => {
  console.error('[bridge] 启动失败:', e);
  process.exit(1);
});
