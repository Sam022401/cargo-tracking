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

  // 每日日报
  async sendDailyReport(apiClient) {
    const statuses = await apiClient.fetchAllStatuses();
    const allHistory = await apiClient.fetchAllHistory();

    // 按群名分组
    const groups = {};
    for (const [no, item] of Object.entries(allHistory)) {
      const gn = item.groupName || '未分组';
      if (!groups[gn]) groups[gn] = [];
      const info = statuses[no] || {};
      groups[gn].push({ no, item, status: info.statusLabel || '未知', content: info.latestEventContent || '' });
    }

    const today = new Date();
    const dateStr = `${today.getMonth()+1}/${today.getDate()}`;

    for (const [groupName, shipments] of Object.entries(groups)) {
      const arriving = shipments.filter(s => s.status === '快到港');
      const inTransit = shipments.filter(s => s.status === '运输中');
      const completed = shipments.filter(s => s.status === '已完成');

      let msg = `📦 货物日报 ${dateStr}\n━━━━━━━━━━━━\n`;
      if (arriving.length) msg += `🔴 快到港：\n${arriving.map(s => '  ' + s.no).join('\n')}\n`;
      if (inTransit.length) msg += `🟡 运输中：\n${inTransit.map(s => '  ' + s.no).join('\n')}\n`;
      if (completed.length) msg += `✅ 已签收：\n${completed.map(s => '  ' + s.no).join('\n')}\n`;
      msg += `━━━━━━━━━━━━`;

      // 找到对应微信群
      let targetGroupId = groupName; // 默认用群名当ID
      if (this.wcf) {
        try {
          const contacts = this.wcf.getContacts();
          const found = contacts.find(c => c.name === groupName && c.wxid?.includes('@chatroom'));
          if (found) targetGroupId = found.wxid;
        } catch {}
      }

      console.log(`[daily-report] 发送到 \"${groupName}\": ${shipments.length} 票`);
      this._send(msg, targetGroupId);
    }
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
