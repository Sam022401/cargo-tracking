// notifier.js — 消息格式化与发送
function format(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp('\\{' + key + '\\}', 'g'), value || '');
  }
  return result;
}

class Notifier {
  constructor(config, wcf) {
    this.cfg = config;
    this.wcf = wcf;
    this.notifyCooldowns = {}; // { waybillNo: lastNotifiedTimestamp }
  }

  // 状态变化通知
  sendStatusChange(no, oldStatus, oldLabel, newStatus, newLabel, latestEvent, time, groupId) {
    // 冷却检查：同一单号 1 小时内最多通知 1 次
    const now = Date.now();
    const last = this.notifyCooldowns[no] || 0;
    if (now - last < 3600000) return false;

    const msg = format(this.cfg.notifications.statusChangeTemplate, {
      no,
      oldStatus,
      oldStatusLabel: oldLabel,
      newStatus,
      newStatusLabel: newLabel,
      latestEvent: latestEvent || '',
      time: time || ''
    });

    this._send(msg, groupId);
    this.notifyCooldowns[no] = now;
    return true;
  }

  // @查询回复
  sendMentionReply(senderName, no, status, statusLabelText, latestEvent, time, groupId, atWxids) {
    const msg = format(this.cfg.notifications.mentionReplyTemplate, {
      senderName,
      no,
      status,
      statusLabel: statusLabelText,
      latestEvent: latestEvent || '',
      time: time || ''
    });
    this._send(msg, groupId, atWxids);
  }

  // 查询失败回复
  sendNoResult(senderName, input, groupId, atWxids) {
    const msg = format(this.cfg.notifications.mentionNoResultTemplate, {
      senderName,
      input,
      botName: this.cfg.wechat.botName
    });
    this._send(msg, groupId, atWxids);
  }

  // 频率限制提示
  sendRateLimit(senderName, seconds, groupId, atWxids) {
    const msg = format(this.cfg.notifications.mentionRateLimitTemplate, {
      senderName,
      seconds: String(seconds)
    });
    this._send(msg, groupId, atWxids);
  }

  // 新单号通知
  sendNewWaybill(no, status, latestEvent, time, groupId) {
    const msg = '📦 新单号: ' + no + '\n状态: ' + status + '\n' + (latestEvent || '') + '\n添加时间: ' + (time || '');
    this._send(msg, groupId);
  }

  _send(msg, groupId, atWxids) {
    if (!this.wcf) {
      console.log('[notifier] (dry-run) to:', groupId, '| msg:', msg.substring(0, 80));
      return;
    }
    try {
      if (atWxids && atWxids.length > 0) {
        this.wcf.sendText(msg, groupId, atWxids);
      } else {
        this.wcf.sendText(msg, groupId);
      }
      console.log('[notifier] sent to:', groupId);
    } catch (e) {
      console.error('[notifier] send error:', e.message);
    }
  }
}

module.exports = { Notifier, format };
