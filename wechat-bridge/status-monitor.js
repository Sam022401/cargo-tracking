// status-monitor.js — 定时轮询核心服务器，检测状态变化并推送通知
const fs = require('fs');
const path = require('path');
const { calcStatus, statusLabel, getBriefText } = require('../shared/status-calculator');

class StatusMonitor {
  constructor(config, wcf, apiClient) {
    this.cfg = config;
    this.wcf = wcf;
    this.api = apiClient;
    this.timer = null;
    this.stateFile = config.stateFile || './bridge-state.json';
    this.state = null; // { lastPoll, waybills: { no: { status, latestEventId, lastNotifiedAt } } }
    this.notifier = null; // set after construction
  }

  // 加载本地状态缓存
  _loadState() {
    try {
      this.state = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
    } catch {
      this.state = { lastPoll: null, waybills: {} };
    }
  }

  // 保存本地状态
  _saveState() {
    fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  // 启动轮询
  start() {
    this._loadState();
    const isFirstRun = !this.state.lastPoll;

    console.log('[status-monitor] 启动轮询，间隔:', this.cfg.polling.intervalMinutes, '分钟');
    console.log('[status-monitor] 首次运行:', isFirstRun, '| 已有单号:', Object.keys(this.state.waybills).length);

    const tick = async () => {
      try {
        await this._poll(isFirstRun && this.cfg.polling.suppressInitialNotifications);
        this._saveState();
      } catch (e) {
        console.error('[status-monitor] 轮询出错:', e.message);
      }
    };

    // 首次立即执行
    tick();
    // 定时执行
    this.timer = setInterval(tick, this.cfg.polling.intervalMinutes * 60 * 1000);
  }

  // 停止轮询
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // 强制立即检查
  async forceCheck() {
    await this._poll(false);
    this._saveState();
  }

  // 单次轮询
  async _poll(suppressNotifications) {
    const statuses = await this.api.fetchAllStatuses();
    const now = new Date().toISOString();

    for (const [no, info] of Object.entries(statuses)) {
      const prev = this.state.waybills[no];

      if (!prev) {
        // 新单号
        if (!suppressNotifications && this.cfg.polling.notifyOnNewWaybill) {
          this._notifyNewWaybill(no, info);
        }
        this.state.waybills[no] = {
          status: info.status,
          latestEventId: info.latestEventId,
          lastNotifiedAt: suppressNotifications ? now : null
        };
        continue;
      }

      // 对比状态
      if (prev.status !== info.status) {
        // 状态变化！
        if (!suppressNotifications) {
          const oldLabel = statusLabel(prev.status, 'zh');
          const newLabel = info.statusLabel || statusLabel(info.status, 'zh');
          this._notifyStatusChange(no, prev.status, oldLabel, info.status, newLabel, info);
        }
        prev.status = info.status;
        prev.latestEventId = info.latestEventId;
        prev.lastNotifiedAt = suppressNotifications ? null : now;
      } else if (this.cfg.polling.notifyOnEventGrowth && info.latestEventId !== prev.latestEventId) {
        // 状态未变但轨迹有更新
        prev.latestEventId = info.latestEventId;
      }
    }

    // 清理已删除的单号
    for (const no of Object.keys(this.state.waybills)) {
      if (!statuses[no]) {
        delete this.state.waybills[no];
      }
    }

    this.state.lastPoll = now;
    if (!suppressNotifications) {
      console.log('[status-monitor] 轮询完成，单号数:', Object.keys(statuses).length);
    }
  }

  _notifyStatusChange(no, oldStatus, oldLabel, newStatus, newLabel, info) {
    const groups = this._getTargetGroups();
    for (const groupId of groups) {
      const sent = this.notifier.sendStatusChange(
        no, oldStatus, oldLabel, newStatus, newLabel,
        info.latestEventContent || '',
        info.updatedAt ? formatLocalTime(info.updatedAt) : '',
        groupId
      );
      if (sent) console.log('[status-monitor] 推送:', no, oldStatus, '→', newStatus);
    }
  }

  _notifyNewWaybill(no, info) {
    const groups = this._getTargetGroups();
    for (const groupId of groups) {
      this.notifier.sendNewWaybill(
        no,
        info.statusLabel || '',
        info.latestEventContent || '',
        info.updatedAt ? formatLocalTime(info.updatedAt) : '',
        groupId
      );
    }
  }

  _getTargetGroups() {
    if (!this.wcf) return ['dry-run-group'];
    try {
      const contacts = this.wcf.getContacts();
      const groups = contacts.filter(c => c.type === 'group' || c.wxid?.includes('@chatroom'));
      if (this.cfg.wechat.targetGroups.includes('*')) {
        return groups.map(g => g.wxid);
      }
      return groups.filter(g => this.cfg.wechat.targetGroups.includes(g.name)).map(g => g.wxid);
    } catch {
      return [];
    }
  }
}

function formatLocalTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

module.exports = { StatusMonitor };
