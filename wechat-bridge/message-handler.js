// message-handler.js — 检测群聊 @消息，提取单号并自动回复
const { statusLabel, getBriefText } = require('../shared/status-calculator');

class MessageHandler {
  constructor(config, wcf, apiClient) {
    this.cfg = config;
    this.wcf = wcf;
    this.api = apiClient;
    this.notifier = null; // set after construction
    this.rateLimitMap = {}; // { wxid: lastQueryTimestamp }
    this.botWxid = null;
  }

  async handle(rawMsg) {
    // 仅处理群聊文本消息（type=1）
    if (!rawMsg.is_group || rawMsg.type !== 1) return;

    const roomId = rawMsg.roomid;
    const senderWxid = rawMsg.sender;
    const content = rawMsg.content || '';

    // 获取机器人自己的 wxid（首次查询后缓存）
    if (!this.botWxid) {
      try { this.botWxid = this.wcf.getSelfInfo().wxid; } catch {}
    }

    // 检测是否 @了机器人
    const atList = rawMsg.at_userlist || [];
    const isAt = atList.includes(this.botWxid) ||
                 content.includes('@' + this.cfg.wechat.botName);

    if (!isAt) return;

    // 频率限制
    const now = Date.now();
    const lastQuery = this.rateLimitMap[senderWxid] || 0;
    const cooldown = (this.cfg.rateLimitSeconds || 30) * 1000;
    if (now - lastQuery < cooldown) {
      const remaining = Math.ceil((cooldown - (now - lastQuery)) / 1000);
      this._replyRateLimit(senderWxid, remaining, roomId);
      return;
    }

    // 提取单号
    const pattern = new RegExp(this.cfg.waybillPattern || '[A-Z]{2,6}\\d{6,12}', 'g');
    const matches = content.match(pattern);

    if (!matches || matches.length === 0) {
      this._replyNoResult(senderWxid, content, roomId);
      return;
    }

    this.rateLimitMap[senderWxid] = now;

    // 查询每个单号（取最多3个避免刷屏）
    const numbers = [...new Set(matches)].slice(0, 3);
    for (const no of numbers) {
      await this._lookupAndReply(no, senderWxid, roomId);
    }
  }

  async _lookupAndReply(no, senderWxid, roomId) {
    try {
      const result = await this.api.replyLookup(no);

      if (result.error) {
        this._replyNoResult(senderWxid, no, roomId);
        return;
      }

      const senderName = this._getDisplayName(senderWxid);
      const atWxids = [senderWxid];
      const time = result.updatedAt ? formatLocalTime(result.updatedAt) : '';

      this.notifier.sendMentionReply(
        senderName,
        no,
        result.status || '',
        result.statusLabel || statusLabel(result.status, 'zh'),
        result.latestEventContent || getBriefText(result, 'zh'),
        time,
        roomId,
        atWxids
      );

      console.log('[message-handler] 回复:', no, '→', senderName);
    } catch (e) {
      console.error('[message-handler] 查询失败:', no, e.message);
      this._replyNoResult(senderWxid, no, roomId);
    }
  }

  _replyNoResult(senderWxid, input, roomId) {
    const senderName = this._getDisplayName(senderWxid);
    this.notifier.sendNoResult(senderName, input, roomId, [senderWxid]);
  }

  _replyRateLimit(senderWxid, seconds, roomId) {
    const senderName = this._getDisplayName(senderWxid);
    this.notifier.sendRateLimit(senderName, seconds, roomId, [senderWxid]);
  }

  _getDisplayName(wxid) {
    if (!this.wcf) return wxid;
    try {
      const contacts = this.wcf.getContacts();
      const c = contacts.find(x => x.wxid === wxid);
      return c ? (c.remark || c.nickname || c.name || wxid) : wxid;
    } catch {
      return wxid;
    }
  }
}

function formatLocalTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

module.exports = { MessageHandler };
