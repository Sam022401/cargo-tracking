// 货物跟踪看板 — 共享状态计算模块
// UMD 格式：同时支持 Node.js (require) 和浏览器 (<script> 标签)
;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.StatusCalculator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  // 获取最新轨迹事件（list 按 id 升序，id=1 是最新）
  function getLatestEvent(item) {
    if (!item || !item.dataDict || !item.dataDict.list || item.dataDict.list.length === 0) return null;
    return item.dataDict.list[0];
  }

  // 从轨迹内容中提取预计到达日期
  function extractEstimatedDate(content) {
    if (!content) return null;
    // 匹配完整日期: 2026-06-01 或 2026/06/01
    var m = content.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
    if (m) {
      var d = new Date(m[1].replace(/\//g, '-'));
      if (!isNaN(d.getTime())) return d;
    }
    // 匹配 MM-DD 格式（无年份，如 "预计 5月17 日"）
    var m2 = content.match(/预计.*?(\d{1,2})[月/-](\d{1,2})/);
    if (m2) {
      var d2 = new Date();
      d2.setMonth(parseInt(m2[1]) - 1, parseInt(m2[2]));
      d2.setHours(0, 0, 0, 0);
      return d2;
    }
    return null;
  }

  // 计算货物状态
  // 返回: 'fail' | 'pending' | 'completed' | 'arriving' | 'in_transit'
  function calcStatus(item) {
    if (!item || item.result === false) return 'fail';
    var ev = getLatestEvent(item);
    if (!ev) return 'pending';

    var content = (ev.content || ev.content_loc || '');
    var contentEn = (ev.content_en || '');

    // 已签收 / 已到港 / 已到目的地 / 已到仓库 → 已完成
    if (/已签收|已到港|已到目的地|已到仓库/.test(content)) return 'completed';
    if (/delivered|signed for|arrived at (destination|warehouse)/i.test(contentEn)) return 'completed';

    // 尝试从内容中提取预计到港日期
    var dateText = content || contentEn;
    var eta = extractEstimatedDate(dateText);

    if (eta) {
      var now = new Date();
      now.setHours(0, 0, 0, 0);
      var diffDays = Math.ceil((eta.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= 3) return 'arriving';  // 快到港
      return 'in_transit';  // 运输中
    }

    // 没有日期，根据关键词判断
    if (/预计|中转|安排|运输途中/.test(content)) return 'in_transit';
    if (/estimated|in transit|scheduled|on the way/i.test(contentEn)) return 'in_transit';
    return 'in_transit';
  }

  // 状态标签（中英文）
  function statusLabel(s, lang) {
    if (lang === 'en') {
      if (s === 'arriving') return 'Arriving';
      if (s === 'in_transit') return 'In Transit';
      if (s === 'completed') return 'Completed';
      if (s === 'fail') return 'Failed';
      return 'Pending';
    }
    // 中文默认
    if (s === 'arriving') return '快到港';
    if (s === 'in_transit') return '运输中';
    if (s === 'completed') return '已完成';
    if (s === 'fail') return '查询失败';
    return '待更新';
  }

  // 获取最新轨迹摘要文本
  function getBriefText(item, lang) {
    var ev = getLatestEvent(item);
    if (!ev) return '';
    if (lang === 'en') return ev.content_en || ev.content_loc || ev.content || '';
    return ev.content || ev.content_loc || '';
  }

  // 状态排序优先级（数值越小越靠前）
  var STATUS_PRIORITY = {
    completed: 0,
    in_transit: 1,
    arriving: 2,
    fail: 3,
    pending: 4
  };

  return {
    getLatestEvent: getLatestEvent,
    extractEstimatedDate: extractEstimatedDate,
    calcStatus: calcStatus,
    statusLabel: statusLabel,
    getBriefText: getBriefText,
    STATUS_PRIORITY: STATUS_PRIORITY
  };
}));
