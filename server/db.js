// =========================================================================
// db.js — SQLite 持久层（better-sqlite3，WAL）
// 本步极简：单表 kv(key, value)，整个 love data blob 作为一个 JSON 字符串存一行。
// 后续 M2+ 拆 entries/collections/attachments 等表时再演进。
// =========================================================================
import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_PATH = join(DATA_DIR, 'love.db');
const SEED_PATH = join(__dirname, '..', 'data.json');
const KEY = 'love:data'; // 与 localStorage 前端 key 同名，语义一致
const KEY_PRESENCE = 'love:presence'; // 实时状态独立 kv 行（不进主 blob，避免整 blob 放大）

let db = null;

export function openDB() {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  // 首次启动空表 → 灌 data.json 种子
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(KEY);
  if (!row) {
    const seedRaw = readFileSync(SEED_PATH, 'utf8');
    // 灌种子前先 migrateEntry + computeStatus 一遍，确保落库 status 正确
    const seeded = reseed(JSON.parse(seedRaw));
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run(KEY, JSON.stringify(seeded));
    console.log(`[db] 首次启动，已灌种子（${seeded.entries?.length || 0} 条 entry）`);
  }
  return db;
}

export function readAll() {
  const db = openDB();
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(KEY);
  return row ? JSON.parse(row.value) : null;
}

export function writeAll(blob) {
  const db = openDB();
  const json = JSON.stringify(blob);
  db.prepare(`
    INSERT INTO kv (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(KEY, json);
  return blob;
}

// —— 服务端不变量重算兜底（INV-1：status 永远是派生值）——
// 本步只做这一件事，不接管 commit 编排。import 前端纯函数层。
import { migrateEntry } from '../scripts/schema.js';
import { computeStatus } from '../scripts/status-machine.js';

function ensureCollections(blob) {
  for (const k of ['timeline', 'messages', 'photos', 'anniversaries']) {
    if (!Array.isArray(blob[k])) blob[k] = [];
  }
  if (!blob.entries) blob.entries = [];
  if (!blob.meta) blob.meta = {};
  return blob;
}

export function reseed(blob) {
  blob = ensureCollections(blob);
  blob.entries = (blob.entries || []).map(e => {
    const m = migrateEntry(e);
    m.status = computeStatus(m); // 强制派生值
    return m;
  });
  return blob;
}

// —— 实时状态 presence（独立 kv 行，与主 blob 隔离）——
// 高频心跳只写 presence，不触发 reseed/不广播 data-changed/不污染主 blob，
// 避免每次心跳触发全量 entries 状态重算 + 全员 reload + UI 闪烁放大。
export function readPresence() {
  const db = openDB();
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(KEY_PRESENCE);
  return row ? JSON.parse(row.value) : { male: null, female: null };
}

// payload: { side, online, lastSeen, battery, charging, location, lat, lng, locAt }
// 只覆盖 payload.side 这一侧；保留另一侧不动。
export function writePresence(payload) {
  const db = openDB();
  const side = payload && payload.side;
  if (side !== 'male' && side !== 'female') throw new Error('side 必须是 male/female');
  const cur = readPresence();
  // 浅合并本侧字段，保留旧值（单次上报可能只含部分字段）
  cur[side] = { ...cur[side], ...payload };
  db.prepare(`
    INSERT INTO kv (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(KEY_PRESENCE, JSON.stringify(cur));
  return cur;
}
