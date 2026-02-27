import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

let dbPromise = null;

function getDbPath() {
  return process.env.DB_PATH || "./data/blog-auto.sqlite";
}

async function getDb() {
  if (dbPromise) return dbPromise;

  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  await mkdir(dir, { recursive: true });

  dbPromise = open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  const db = await dbPromise;
  await db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS style_profiles (
      user_id TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blog_sources (
      user_id TEXT PRIMARY KEY,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS instagram_batches (
      user_id TEXT PRIMARY KEY,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads_batches (
      user_id TEXT PRIMARY KEY,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads_auth (
      user_id TEXT PRIMARY KEY,
      auth_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drafts (
      user_id TEXT PRIMARY KEY,
      draft_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS image_analyses (
      user_id TEXT PRIMARY KEY,
      analysis_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL,
      token_balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personas (
      email TEXT PRIMARY KEY,
      persona_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      kind TEXT NOT NULL,
      prompt_json TEXT NOT NULL,
      response_json TEXT NOT NULL,
      style_guide_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS token_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function parseJsonSafe(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function toEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function clampPositiveInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

async function upsert(table, userId, jsonValue) {
  const db = await getDb();
  const now = nowIso();
  const valueColumn =
    table === "style_profiles"
      ? "profile_json"
      : table === "threads_auth"
        ? "auth_json"
      : table === "drafts"
        ? "draft_json"
      : table === "image_analyses"
        ? "analysis_json"
        : "items_json";

  await db.run(
    `
    INSERT INTO ${table} (user_id, ${valueColumn}, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id)
    DO UPDATE SET
      ${valueColumn} = excluded.${valueColumn},
      updated_at = excluded.updated_at
  `,
    userId,
    JSON.stringify(jsonValue),
    now,
    now
  );
}

export async function initStore() {
  await getDb();
}

async function getUserRow(email) {
  const db = await getDb();
  const normalized = toEmail(email);
  if (!normalized) return null;
  return db.get("SELECT email, profile_json, token_balance, created_at, updated_at FROM users WHERE email = ?", normalized);
}

export async function getUser(email) {
  const row = await getUserRow(email);
  if (!row) return null;
  return {
    email: row.email,
    tokenBalance: clampPositiveInt(row.token_balance, 0),
    profile: parseJsonSafe(row.profile_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function appendTokenLedger(email, delta, reason, meta = {}) {
  const db = await getDb();
  const normalized = toEmail(email);
  if (!normalized) return;
  await db.run(
    `
    INSERT INTO token_ledger (email, delta, reason, meta_json, created_at)
    VALUES (?, ?, ?, ?, ?)
    `,
    normalized,
    Number(delta || 0),
    String(reason || "unknown"),
    JSON.stringify(meta || {}),
    nowIso()
  );
}

export async function ensureUser(email, { initialTokens = 100 } = {}) {
  const db = await getDb();
  const normalized = toEmail(email);
  if (!normalized) throw new Error("email is required");

  const existing = await getUserRow(normalized);
  if (existing) {
    return {
      created: false,
      user: {
        email: existing.email,
        tokenBalance: clampPositiveInt(existing.token_balance, 0),
        profile: parseJsonSafe(existing.profile_json, {}),
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      },
    };
  }

  const now = nowIso();
  const startTokens = clampPositiveInt(initialTokens, 0);
  await db.run(
    `
    INSERT INTO users (email, profile_json, token_balance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    `,
    normalized,
    JSON.stringify({}),
    startTokens,
    now,
    now
  );

  if (startTokens > 0) {
    await appendTokenLedger(normalized, startTokens, "signup_bonus", { source: "google_login" });
  }

  return {
    created: true,
    user: {
      email: normalized,
      tokenBalance: startTokens,
      profile: {},
      createdAt: now,
      updatedAt: now,
    },
  };
}

export async function addUserTokens(email, amount, reason = "credit", meta = {}) {
  const db = await getDb();
  const normalized = toEmail(email);
  const delta = clampPositiveInt(amount, 0);
  if (!normalized || delta <= 0) {
    return { ok: false, message: "invalid token credit request" };
  }

  await db.run(
    `
    UPDATE users
    SET token_balance = token_balance + ?, updated_at = ?
    WHERE email = ?
    `,
    delta,
    nowIso(),
    normalized
  );
  await appendTokenLedger(normalized, delta, reason, meta);
  const user = await getUser(normalized);
  return { ok: true, tokenBalance: user?.tokenBalance ?? 0 };
}

export async function consumeUserTokens(email, amount, reason = "consume", meta = {}) {
  const db = await getDb();
  const normalized = toEmail(email);
  const cost = clampPositiveInt(amount, 0);
  if (!normalized || cost <= 0) {
    return { ok: false, message: "invalid token consume request" };
  }

  const now = nowIso();
  const result = await db.run(
    `
    UPDATE users
    SET token_balance = token_balance - ?, updated_at = ?
    WHERE email = ? AND token_balance >= ?
    `,
    cost,
    now,
    normalized,
    cost
  );

  if (!result?.changes) {
    const current = await getUser(normalized);
    return {
      ok: false,
      tokenBalance: current?.tokenBalance ?? 0,
      message: "insufficient tokens",
    };
  }

  await appendTokenLedger(normalized, -cost, reason, meta);
  const current = await getUser(normalized);
  return {
    ok: true,
    tokenBalance: current?.tokenBalance ?? 0,
  };
}

export async function getUserTokenBalance(email) {
  const user = await getUser(email);
  return clampPositiveInt(user?.tokenBalance, 0);
}

export async function createSession(email, { ttlDays = 30 } = {}) {
  const db = await getDb();
  const normalized = toEmail(email);
  if (!normalized) throw new Error("email is required");

  const sessionId = randomUUID().replace(/-/g, "");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + Math.max(1, Number(ttlDays || 30)) * 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    `
    INSERT INTO sessions (session_id, email, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    `,
    sessionId,
    normalized,
    createdAt,
    expiresAt,
    createdAt
  );
  return { sessionId, email: normalized, createdAt, expiresAt };
}

export async function getSession(sessionId) {
  const db = await getDb();
  const token = String(sessionId || "").trim();
  if (!token) return null;
  const row = await db.get(
    `
    SELECT session_id, email, created_at, expires_at, last_seen_at
    FROM sessions
    WHERE session_id = ?
    `,
    token
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.run("DELETE FROM sessions WHERE session_id = ?", token);
    return null;
  }
  return {
    sessionId: row.session_id,
    email: row.email,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

export async function touchSession(sessionId) {
  const db = await getDb();
  const token = String(sessionId || "").trim();
  if (!token) return;
  await db.run("UPDATE sessions SET last_seen_at = ? WHERE session_id = ?", nowIso(), token);
}

export async function deleteSession(sessionId) {
  const db = await getDb();
  const token = String(sessionId || "").trim();
  if (!token) return;
  await db.run("DELETE FROM sessions WHERE session_id = ?", token);
}

export async function savePersona(email, persona) {
  const db = await getDb();
  const normalized = toEmail(email);
  if (!normalized) throw new Error("email is required");
  const now = nowIso();
  await db.run(
    `
    INSERT INTO personas (email, persona_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email)
    DO UPDATE SET persona_json = excluded.persona_json, updated_at = excluded.updated_at
    `,
    normalized,
    JSON.stringify(persona || {}),
    now,
    now
  );
}

export async function getPersona(email) {
  const db = await getDb();
  const normalized = toEmail(email);
  if (!normalized) return null;
  const row = await db.get("SELECT persona_json FROM personas WHERE email = ?", normalized);
  if (!row) return null;
  return parseJsonSafe(row.persona_json, null);
}

export async function saveGenerationRecord({ email, kind, prompt, response, styleGuide = null }) {
  const db = await getDb();
  const normalized = toEmail(email);
  if (!normalized) throw new Error("email is required");
  await db.run(
    `
    INSERT INTO generation_history (email, kind, prompt_json, response_json, style_guide_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    normalized,
    String(kind || "unknown"),
    JSON.stringify(prompt || {}),
    JSON.stringify(response || {}),
    styleGuide ? JSON.stringify(styleGuide) : null,
    nowIso()
  );
}

export async function listGenerationRecords(email, { limit = 50 } = {}) {
  const db = await getDb();
  const normalized = toEmail(email);
  if (!normalized) return [];
  const size = Math.min(200, Math.max(1, Number(limit || 50)));
  const rows = await db.all(
    `
    SELECT id, email, kind, prompt_json, response_json, style_guide_json, created_at
    FROM generation_history
    WHERE email = ?
    ORDER BY id DESC
    LIMIT ?
    `,
    normalized,
    size
  );
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    kind: row.kind,
    prompt: parseJsonSafe(row.prompt_json, {}),
    response: parseJsonSafe(row.response_json, {}),
    styleGuide: row.style_guide_json ? parseJsonSafe(row.style_guide_json, null) : null,
    createdAt: row.created_at,
  }));
}

export async function saveStyleProfile(userId, profile) {
  await upsert("style_profiles", userId, profile);
}

export async function getStyleProfile(userId) {
  const db = await getDb();
  const row = await db.get("SELECT profile_json FROM style_profiles WHERE user_id = ?", userId);
  if (!row) return null;
  return parseJsonSafe(row.profile_json, null);
}

export async function saveInstagramBatch(userId, items) {
  await upsert("instagram_batches", userId, items);
}

export async function saveThreadsBatch(userId, items) {
  await upsert("threads_batches", userId, items);
}

export async function saveBlogSources(userId, items) {
  await upsert("blog_sources", userId, items);
}

export async function getInstagramBatch(userId) {
  const db = await getDb();
  const row = await db.get("SELECT items_json FROM instagram_batches WHERE user_id = ?", userId);
  if (!row) return [];
  return parseJsonSafe(row.items_json, []);
}

export async function getBlogSources(userId) {
  const db = await getDb();
  const row = await db.get("SELECT items_json FROM blog_sources WHERE user_id = ?", userId);
  if (!row) return [];
  return parseJsonSafe(row.items_json, []);
}

export async function getThreadsBatch(userId) {
  const db = await getDb();
  const row = await db.get("SELECT items_json FROM threads_batches WHERE user_id = ?", userId);
  if (!row) return [];
  return parseJsonSafe(row.items_json, []);
}

export async function saveThreadsAuth(userId, auth) {
  await upsert("threads_auth", userId, auth);
}

export async function getThreadsAuth(userId) {
  const db = await getDb();
  const row = await db.get("SELECT auth_json FROM threads_auth WHERE user_id = ?", userId);
  if (!row) return null;
  return parseJsonSafe(row.auth_json, null);
}

export async function saveDraft(userId, draft) {
  await upsert("drafts", userId, draft);
}

export async function getDraft(userId) {
  const db = await getDb();
  const row = await db.get("SELECT draft_json FROM drafts WHERE user_id = ?", userId);
  if (!row) return null;
  return parseJsonSafe(row.draft_json, null);
}

export async function saveImageAnalysis(userId, analysis) {
  await upsert("image_analyses", userId, analysis);
}

export async function getImageAnalysis(userId) {
  const db = await getDb();
  const row = await db.get("SELECT analysis_json FROM image_analyses WHERE user_id = ?", userId);
  if (!row) return null;
  return parseJsonSafe(row.analysis_json, null);
}
