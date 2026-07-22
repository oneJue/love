// =========================================================================
// util.js — 共享工具函数（单源 export）
// =========================================================================

// HTML 转义：& < > " '
// 兼容各模块既有实现：null/undefined 归一为空串，其余强制 String 化。
// 抽离自原 comm-book/editor/app/days-together/memory-editor/messages/photo-wall/timeline
// 八处重复定义，消除复制漂移风险。统一命名为 escapeHtml。
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// id 比较：归一化为字符串后严格相等。兼容 id 为数字/字符串混用的历史数据。
// 抽离自 store.js 私有 sameId，统一 store/comm-book/editor/memory-editor/httpBackend 复用。
export function sameId(left, right) {
  return String(left) === String(right);
}
