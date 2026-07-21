// =========================================================================
// date-math.js — 日期工具（参考 anniversary-countdown 的思想重写，零依赖）
// =========================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

/** 把 'YYYY-MM-DD' 解析为本地日期对象（避免 UTC 偏移导致跨日） */
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** 今天（本地，去时分） */
export function today() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** 日期对象 → 'YYYY-MM-DD' */
export function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 在一起多少天。按"在一起那天算第 1 天"的约定：
 * daysSince = today - startDate + 1
 */
export function daysSince(startDateStr) {
  const start = parseDate(startDateStr);
  if (!start) return null;
  const diff = Math.floor((today() - start) / DAY_MS);
  return diff + 1; // 含起算当天
}

/** 距离某日期还有几天（未来为正，过去为负）。recurring=每年则取今年/明年最近一次 */
export function daysUntil(dateStr, recurring = false) {
  let target = parseDate(dateStr);
  if (!target) return null;
  if (recurring) {
    const now = today();
    const thisYear = new Date(now.getFullYear(), target.getMonth(), target.getDate());
    let next = thisYear < now
      ? new Date(now.getFullYear() + 1, target.getMonth(), target.getDate())
      : thisYear;
    target = next;
  }
  return Math.floor((target - today()) / DAY_MS);
}

/** 人性化时长：还有 N 天 / 今天 / 已过 N 天 */
export function humanizeDays(n) {
  if (n === null || n === undefined) return '';
  if (n === 0) return '就在今天';
  if (n > 0) return `还有 ${n} 天`;
  return `已过 ${-n} 天`;
}

/** 格式化日期显示：2026-07-21 → 7月21日 */
export function prettyDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return dateStr || '';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 目前的 ISO 时间戳（带时分），静态版用 new Date()，Phase 2 后端会传服务端时间 */
export function nowISO() {
  return new Date().toISOString();
}
