import "./utils/loadEnv.js";
import googleTrends from "google-trends-api";
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { createHash, randomUUID, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Busboy from "busboy";
import { decodeHtmlEntities } from "./utils/html.js";
import {
  addUserTokens,
  consumeUserTokens,
  createSession,
  deleteSession,
  getBlogSources,
  getDraft,
  getImageAnalysis,
  getInstagramBatch,
  getPersona,
  getSession,
  getThreadsAuth,
  getThreadsBatch,
  getStyleProfile,
  getUser,
  getUserTokenBalance,
  initStore,
  listGenerationRecords,
  saveGenerationRecord,
  saveBlogSources,
  saveDraft,
  saveImageAnalysis,
  savePersona,
  saveThreadsAuth,
  saveInstagramBatch,
  saveThreadsBatch,
  saveStyleProfile,
  ensureUser,
  touchSession,
} from "./store/sqliteStore.js";
import { fetchMany } from "./services/contentFetcher.js";
import { fetchThreadsPosts } from "./services/threadsFetcher.js";
import {
  buildThreadsLoginUrl,
  exchangeThreadsCodeForToken,
  getThreadsMe,
} from "./services/threadsAuth.js";
import { buildStyleProfile } from "./services/styleProfiler.js";
import { enhanceStyleProfileWithLLM } from "./services/styleProfileEnhancer.js";
import { generateDraft } from "./services/draftGenerator.js";
import {
  rewriteDraftWithLLM,
  generateStep1Outline,
  generateStep2SEO,
  generateStep3Style,
  generateOutlineMVP,
  generateFinalMVP,
} from "./services/styleAwareWriter.js";
import { evaluateDraftQuality } from "./services/draftEvaluator.js";
import { analyzeImageFile } from "./services/imageAnalyzer.js";

const PORT = Number(process.env.PORT) || 4321;
const HOST = String(process.env.HOST || "0.0.0.0").trim() || "0.0.0.0";
const threadsAuthStates = new Map();
const googleAuthStates = new Map();
const DEFAULT_LLM_PROVIDER = String(process.env.LLM_PROVIDER || "openai").trim().toLowerCase();
const UPLOAD_DIR = path.resolve(process.cwd(), String(process.env.UPLOAD_DIR || "data/uploads"));
const SESSION_COOKIE_NAME = "ba_session";
const INITIAL_SIGNUP_TOKENS = Math.max(0, Number.parseInt(String(process.env.INITIAL_SIGNUP_TOKENS || "100"), 10) || 100);
const TOKEN_COSTS = {
  style_profile: 15,
  final_generate: 10,
  image_analyze: 5,
  step1_outline: 5,
  step2_seo: 5,
  step3_style: 10,
  draft_llm: 10,
  outline_mvp: 5,
};
const DEFAULT_PERSONA = {
  identity: "",
  blog_focus: "",
  target_reader: "",
  goal: "",
  tone_note: "",
};

function inferExtFromMime(mimeType) {
  const map = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  return map[String(mimeType || "").toLowerCase()] || ".jpg";
}

async function parseMultipartForm(req) {
  await mkdir(UPLOAD_DIR, { recursive: true });

  return new Promise((resolve, reject) => {
    const fields = {};
    const uploads = [];
    const pendingWrites = [];
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024, files: 50 } });

    busboy.on("field", (name, value) => {
      if (Object.prototype.hasOwnProperty.call(fields, name)) {
        fields[name] = Array.isArray(fields[name]) ? [...fields[name], value] : [fields[name], value];
      } else {
        fields[name] = value;
      }
    });

    busboy.on("file", (name, file, info) => {
      const chunks = [];

      file.on("data", (chunk) => chunks.push(chunk));
      file.on("limit", () => reject(new Error("File too large (max 10MB)")));
      file.on("end", () => {
        if (!chunks.length) return;
        pendingWrites.push(
          (async () => {
            const ext = inferExtFromMime(info.mimeType);
            const filename = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
            const absPath = path.join(UPLOAD_DIR, filename);
            await writeFile(absPath, Buffer.concat(chunks));
            uploads.push({
              fieldName: name,
              mimeType: info.mimeType,
              originalFilename: info.filename,
              filename,
              absPath,
              publicPath: `/uploads/${filename}`,
            });
          })()
        );
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", async () => {
      try {
        await Promise.all(pendingWrites);
        resolve({ fields, uploads });
      } catch (error) {
        reject(error);
      }
    });
    req.pipe(busboy);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 3_000_000) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function parseMaybeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseFormUrlEncoded(raw) {
  const params = new URLSearchParams(raw);
  const output = {};

  for (const [key, value] of params.entries()) {
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      output[key] = Array.isArray(output[key]) ? [...output[key], value] : [output[key], value];
    } else {
      output[key] = value;
    }
  }

  return output;
}

function toUrlList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/\n|,/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function toIdList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(/\n|,/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function toBoolean(value, defaultValue = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on", "y"].includes(normalized);
  }
  return defaultValue;
}

function toInt(value, defaultValue = 10) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isNaN(n) ? defaultValue : n;
}

function badRequest(res, message) {
  return sendJson(res, 400, { ok: false, message });
}

function redirect(res, location) {
  res.writeHead(303, { location });
  res.end();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseCookies(req) {
  const cookieHeader = String(req.headers.cookie || "");
  if (!cookieHeader) return {};
  const out = {};
  for (const pair of cookieHeader.split(";")) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function buildCookieHeader(name, value, { maxAge = 0, httpOnly = true, sameSite = "Lax", secure = false, path = "/" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (Number.isFinite(maxAge) && maxAge >= 0) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (httpOnly) parts.push("HttpOnly");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  if (forwardedProto === "https") return true;
  const host = String(req.headers.host || "").toLowerCase();
  return !(host.startsWith("localhost") || host.startsWith("127.0.0.1"));
}

function setSessionCookie(res, sessionId, req) {
  const secure = isSecureRequest(req);
  const maxAge = 60 * 60 * 24 * 30;
  res.setHeader("Set-Cookie", buildCookieHeader(SESSION_COOKIE_NAME, sessionId, { maxAge, secure, sameSite: "Lax" }));
}

function clearSessionCookie(res, req) {
  const secure = isSecureRequest(req);
  res.setHeader("Set-Cookie", buildCookieHeader(SESSION_COOKIE_NAME, "", { maxAge: 0, secure, sameSite: "Lax" }));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getGoogleRedirectUri(req) {
  const configured = String(process.env.GOOGLE_REDIRECT_URI || "").trim();
  if (configured && configured.toUpperCase() !== "AUTO") return configured;
  return `${getPublicOrigin(req)}/auth/google/callback`;
}

function createGoogleState(nextPath = "/") {
  const state = randomUUID();
  googleAuthStates.set(state, { createdAt: Date.now(), nextPath: String(nextPath || "/") });
  return state;
}

function consumeGoogleState(state) {
  const token = String(state || "").trim();
  if (!token) return null;
  const record = googleAuthStates.get(token);
  if (!record) return null;
  googleAuthStates.delete(token);
  const ttlMs = 10 * 60 * 1000;
  if (Date.now() - record.createdAt > ttlMs) return null;
  return record;
}

function buildGoogleLoginUrl({ req, state }) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set");
  const redirectUri = getGoogleRedirectUri(req);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeGoogleCode({ req, code }) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) throw new Error("Google OAuth env is missing");
  const redirectUri = getGoogleRedirectUri(req);

  const form = new URLSearchParams();
  form.set("code", code);
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("redirect_uri", redirectUri);
  form.set("grant_type", "authorization_code");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson?.access_token) {
    const message = tokenJson?.error_description || tokenJson?.error || "Failed to exchange Google code";
    throw new Error(message);
  }
  return tokenJson;
}

async function getGoogleUserInfo(accessToken) {
  const token = String(accessToken || "").trim();
  if (!token) throw new Error("Google access token is missing");
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error_description || json?.error || "Failed to fetch Google user info");
  }
  const email = normalizeEmail(json?.email);
  if (!email) throw new Error("Google account email is missing");
  return {
    email,
    name: String(json?.name || ""),
    picture: String(json?.picture || ""),
    verifiedEmail: Boolean(json?.email_verified),
  };
}

async function getAuthContext(req) {
  const cookies = parseCookies(req);
  const sessionToken = String(cookies?.[SESSION_COOKIE_NAME] || "").trim();
  if (!sessionToken) return { loggedIn: false, session: null, user: null };

  const session = await getSession(sessionToken);
  if (!session?.email) return { loggedIn: false, session: null, user: null };

  await touchSession(sessionToken);
  const user = await getUser(session.email);
  if (!user) return { loggedIn: false, session: null, user: null };
  return { loggedIn: true, sessionToken, session, user };
}

function resolveUserId(auth, providedUserId = "") {
  if (auth?.loggedIn && auth?.user?.email) return auth.user.email;
  return String(providedUserId || "demo-user");
}

async function requireLoggedIn(res, auth) {
  if (auth?.loggedIn && auth?.user?.email) return true;
  sendJson(res, 401, { ok: false, message: "Google 로그인이 필요합니다." });
  return false;
}

function tokenCostForAction(action) {
  return Math.max(0, Number(TOKEN_COSTS[action] || 0));
}

async function chargeTokenOrReject(res, auth, action, meta = {}) {
  const cost = tokenCostForAction(action);
  if (cost <= 0) return { ok: true, cost: 0, balance: auth?.user?.tokenBalance ?? 0 };
  const email = auth?.user?.email;
  if (!email) {
    sendJson(res, 401, { ok: false, message: "Google 로그인이 필요합니다." });
    return { ok: false };
  }
  const consumed = await consumeUserTokens(email, cost, action, meta);
  if (!consumed.ok) {
    sendJson(res, 402, {
      ok: false,
      message: `토큰이 부족합니다. 필요: ${cost}, 현재: ${consumed.tokenBalance ?? 0}`,
      token_balance: consumed.tokenBalance ?? 0,
      required_tokens: cost,
    });
    return { ok: false };
  }
  return { ok: true, cost, balance: consumed.tokenBalance ?? 0 };
}

async function refundTokenIfNeeded(auth, charged, reason, meta = {}) {
  if (!charged?.ok || !charged?.cost) return;
  if (!auth?.user?.email) return;
  await addUserTokens(auth.user.email, charged.cost, reason || "refund", meta);
}

function mergePersona(base, incoming) {
  const source = incoming && typeof incoming === "object" ? incoming : {};
  const fallback = base && typeof base === "object" ? base : DEFAULT_PERSONA;
  return {
    identity: String(source.identity ?? fallback.identity ?? "").trim(),
    blog_focus: String(source.blog_focus ?? fallback.blog_focus ?? "").trim(),
    target_reader: String(source.target_reader ?? fallback.target_reader ?? "").trim(),
    goal: String(source.goal ?? fallback.goal ?? "").trim(),
    tone_note: String(source.tone_note ?? fallback.tone_note ?? "").trim(),
  };
}

function renderResultsPageHtml({ email, records }) {
  const safeEmail = escapeHtml(email || "");
  const recordList = Array.isArray(records) ? records : [];
  const kinds = [...new Set(recordList.map((record) => String(record?.kind || "unknown").trim() || "unknown"))];
  const kindOptions = kinds
    .map((kind) => `<option value="${escapeHtml(encodeURIComponent(kind))}">${escapeHtml(kind)}</option>`)
    .join("");

  let markdownCount = 0;
  const rows = recordList
    .map((record) => {
      const kindRaw = String(record?.kind || "unknown").trim() || "unknown";
      const kindValue = encodeURIComponent(kindRaw);
      const safeKind = escapeHtml(kindRaw);
      const safeCreatedAt = escapeHtml(String(record?.createdAt || ""));
      const promptText = escapeHtml(JSON.stringify(record?.prompt || {}, null, 2));
      const responseText = escapeHtml(JSON.stringify(record?.response || {}, null, 2));
      const styleGuideText = record?.styleGuide
        ? `<details><summary>style_guide snapshot</summary><pre>${escapeHtml(
            JSON.stringify(record.styleGuide, null, 2)
          )}</pre></details>`
        : "";

      const markdownRaw = typeof record?.response?.markdown === "string" ? record.response.markdown : "";
      const safeMarkdown = escapeHtml(markdownRaw);
      const hasMarkdown = markdownRaw.trim().length > 0;
      if (hasMarkdown) markdownCount += 1;

      const titleSuggestions = Array.isArray(record?.response?.title_suggestions)
        ? record.response.title_suggestions.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5)
        : [];
      const hashtags = Array.isArray(record?.response?.hashtags)
        ? record.response.hashtags.map((item) => String(item || "").trim()).filter(Boolean)
        : [];

      const titleSuggestionHtml = titleSuggestions.length
        ? `<div class="reader-meta">
            <strong>제목 추천</strong>
            <div>${titleSuggestions.map((title, idx) => `${idx + 1}. ${escapeHtml(title)}`).join("<br />")}</div>
          </div>`
        : "";

      const hashtagHtml = hashtags.length
        ? `<div class="tag-wrap">${hashtags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
        : "";

      const readerHtml = hasMarkdown
        ? `<div class="reader-pane">
            ${titleSuggestionHtml}
            <pre class="md-text">${safeMarkdown}</pre>
            ${hashtagHtml}
            <div class="reader-actions">
              <button type="button" class="ghost copy-md-btn">마크다운 복사</button>
            </div>
            <textarea class="md-raw" hidden>${safeMarkdown}</textarea>
          </div>`
        : `<div class="reader-pane empty-md">이 기록에는 markdown 결과가 없습니다.</div>`;

      return `
        <article class="card result-record" data-kind="${escapeHtml(kindValue)}" data-has-markdown="${hasMarkdown ? "1" : "0"}">
          <div class="card-head">
            <span class="kind-chip">${safeKind}</span>
            <span class="meta">${safeCreatedAt}</span>
          </div>
          ${readerHtml}
          <div class="dev-pane">
            <details open>
              <summary>Prompt</summary>
              <pre>${promptText}</pre>
            </details>
            <details>
              <summary>Response</summary>
              <pre>${responseText}</pre>
            </details>
            ${styleGuideText}
          </div>
        </article>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>생성 결과 이력</title>
  <style>
    body { font-family: "Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif; background:#f8fafc; margin:0; color:#0f172a; }
    main { max-width: 980px; margin: 32px auto; padding: 0 16px 48px; }
    .top { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
    .meta { color:#64748b; font-size:12px; margin:4px 0 10px; }
    .card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:14px; margin-bottom:12px; }
    .card-head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; }
    .kind-chip { display:inline-flex; align-items:center; border:1px solid #bfdbfe; color:#1d4ed8; background:#eff6ff; border-radius:999px; padding:4px 10px; font-size:12px; font-weight:700; }
    .toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:10px 12px; margin-bottom:14px; }
    .seg { display:inline-flex; border:1px solid #d1d5db; border-radius:10px; overflow:hidden; }
    .seg button { border:none; background:#fff; color:#334155; font-size:13px; padding:7px 12px; cursor:pointer; }
    .seg button.active { background:#0f172a; color:#fff; }
    .filter { display:inline-flex; align-items:center; gap:6px; color:#334155; font-size:13px; }
    .filter select { padding:6px 8px; border-radius:8px; border:1px solid #cbd5e1; background:#fff; font-size:13px; color:#0f172a; }
    .count { margin-left:auto; font-size:12px; color:#64748b; }
    .reader-meta { margin-bottom:10px; padding:10px; border-radius:8px; background:#f8fafc; border:1px solid #e2e8f0; font-size:13px; line-height:1.6; color:#334155; }
    .md-text { white-space:pre-wrap; word-break:break-word; background:#ffffff; color:#0f172a; border:1px solid #e2e8f0; padding:14px; border-radius:10px; font-size:14px; line-height:1.7; overflow:auto; margin:0; }
    .tag-wrap { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
    .tag { display:inline-flex; padding:4px 8px; border-radius:999px; font-size:12px; font-weight:600; background:#eef2ff; color:#3730a3; border:1px solid #c7d2fe; }
    .reader-actions { margin-top:10px; }
    .ghost { border:1px solid #cbd5e1; background:#fff; color:#334155; border-radius:8px; font-size:12px; padding:6px 10px; cursor:pointer; }
    .ghost:hover { background:#f8fafc; }
    .empty-md { padding:12px; border:1px dashed #cbd5e1; border-radius:8px; font-size:13px; color:#64748b; background:#f8fafc; }
    .dev-pane { margin-top:12px; }
    body.mode-reader .dev-pane { display:none; }
    body.mode-dev .reader-pane { display:none; }
    pre { white-space:pre-wrap; word-break:break-word; background:#0f172a; color:#e2e8f0; padding:12px; border-radius:8px; font-size:12px; overflow:auto; }
    a.btn { display:inline-block; padding:8px 12px; border-radius:8px; background:#2563eb; color:#fff; text-decoration:none; }
    @media (max-width: 720px) {
      .count { width:100%; margin-left:0; }
    }
  </style>
</head>
<body class="mode-reader">
  <main>
    <div class="top">
      <div>
        <h1 style="margin:0;">최종 결과물 이력</h1>
        <p class="meta">${safeEmail}</p>
      </div>
      <div style="display:flex; gap:8px;">
        <a class="btn" href="/">메인으로</a>
        <a class="btn" href="/auth/logout">로그아웃</a>
      </div>
    </div>
    <div class="toolbar">
      <div class="seg" role="tablist" aria-label="보기 모드">
        <button type="button" class="active" data-view-mode="reader">결과물 마크다운 보기</button>
        <button type="button" data-view-mode="dev">개발자 보기</button>
      </div>
      <label class="filter">
        <input type="checkbox" id="filterMarkdownOnly" checked />
        마크다운 있는 결과만
      </label>
      <label class="filter">
        유형
        <select id="filterKind">
          <option value="all">전체</option>
          ${kindOptions}
        </select>
      </label>
      <span class="count" id="resultCount">표시 0 / 전체 ${recordList.length} (마크다운 ${markdownCount})</span>
    </div>
    ${rows || '<p class="meta">저장된 생성 이력이 없습니다.</p>'}
  </main>
  <script>
    (function () {
      const body = document.body;
      const viewButtons = Array.from(document.querySelectorAll("[data-view-mode]"));
      const markdownOnly = document.getElementById("filterMarkdownOnly");
      const kindFilter = document.getElementById("filterKind");
      const countEl = document.getElementById("resultCount");
      const records = Array.from(document.querySelectorAll(".result-record"));

      function setViewMode(mode) {
        const resolved = mode === "dev" ? "dev" : "reader";
        body.classList.toggle("mode-dev", resolved === "dev");
        body.classList.toggle("mode-reader", resolved === "reader");
        viewButtons.forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.viewMode === resolved);
        });
      }

      function applyFilters() {
        const onlyMarkdown = Boolean(markdownOnly && markdownOnly.checked);
        const kind = kindFilter ? kindFilter.value : "all";
        let visible = 0;
        for (const card of records) {
          const hasMarkdown = card.dataset.hasMarkdown === "1";
          const cardKind = card.dataset.kind || "unknown";
          const kindOk = kind === "all" || cardKind === kind;
          const markdownOk = !onlyMarkdown || hasMarkdown;
          const show = kindOk && markdownOk;
          card.style.display = show ? "" : "none";
          if (show) visible += 1;
        }
        if (countEl) {
          countEl.textContent = "표시 " + visible + " / 전체 " + records.length;
        }
      }

      document.addEventListener("click", async (event) => {
        const modeBtn = event.target.closest("[data-view-mode]");
        if (modeBtn) {
          setViewMode(modeBtn.dataset.viewMode || "reader");
          return;
        }

        const copyBtn = event.target.closest(".copy-md-btn");
        if (!copyBtn) return;
        const card = copyBtn.closest(".result-record");
        const textarea = card ? card.querySelector(".md-raw") : null;
        if (!textarea) return;
        try {
          await navigator.clipboard.writeText(textarea.value || "");
          const original = copyBtn.textContent;
          copyBtn.textContent = "복사 완료";
          setTimeout(() => { copyBtn.textContent = original; }, 1000);
        } catch {
          copyBtn.textContent = "복사 실패";
          setTimeout(() => { copyBtn.textContent = "마크다운 복사"; }, 1200);
        }
      });

      if (markdownOnly) markdownOnly.addEventListener("change", applyFilters);
      if (kindFilter) kindFilter.addEventListener("change", applyFilters);

      setViewMode("reader");
      applyFilters();
    })();
  </script>
</body>
</html>`;
}

function createThreadsState(userId, redirectUri = "") {
  const nonce = randomUUID();
  const state = `${userId}:${nonce}`;
  threadsAuthStates.set(state, { userId, createdAt: Date.now(), redirectUri });
  return state;
}

function consumeThreadsState(state) {
  const record = threadsAuthStates.get(state);
  if (!record) return null;
  threadsAuthStates.delete(state);

  const ttlMs = 10 * 60 * 1000;
  if (Date.now() - record.createdAt > ttlMs) return null;
  return record;
}

function getPublicOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").trim();
  const proto = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`);
  return `${proto}://${host}`;
}

function resolveThreadsRedirectUri(req) {
  const configured = String(process.env.THREADS_REDIRECT_URI || "").trim();
  if (configured && configured.toUpperCase() !== "AUTO") {
    return configured;
  }
  return `${getPublicOrigin(req)}/auth/threads/callback`;
}

function makePostId(item, platform, index) {
  const raw = [platform, item.id || "", item.url || "", item.title || "", String(index)].join("|");
  const digest = createHash("sha1").update(raw).digest("hex").slice(0, 12);
  return `${platform}:${digest}`;
}

function normalizeSocialItems(instaItems, threadsItems) {
  const normalizedInsta = instaItems.map((item, index) => ({
    ...item,
    platform: "instagram",
    _postId: makePostId(item, "instagram", index),
  }));

  const normalizedThreads = threadsItems.map((item, index) => ({
    ...item,
    platform: "threads",
    _postId: makePostId(item, "threads", index),
  }));

  return [...normalizedInsta, ...normalizedThreads];
}

function renderMediaPreview(mediaItems) {
  if (!Array.isArray(mediaItems) || !mediaItems.length) {
    return "";
  }

  const limited = mediaItems.slice(0, 4);
  const cells = limited
    .map((media) => {
      const mediaUrl = escapeHtml(media.url || "");
      const type = String(media.type || "").toLowerCase();

      if (type === "video") {
        return `<video class="media" controls preload="metadata" playsinline muted src="${mediaUrl}"></video>`;
      }

      return `<img class="media" loading="lazy" alt="media" src="${mediaUrl}" />`;
    })
    .join("\n");

  return `<div class="media-grid">${cells}</div>`;
}

function renderSocialPostCards(items, formId, selectedSet) {
  if (!items.length) {
    return `<p class="empty">아직 수집된 소셜 포스트가 없습니다.</p>`;
  }

  const cards = items
    .map((item) => {
      const postId = escapeHtml(item._postId);
      const platform = escapeHtml(item.platform || "social");
      const title = escapeHtml(decodeHtmlEntities(item.title || "제목 없음"));
      const desc = escapeHtml(decodeHtmlEntities(item.description || item.excerpt || "")).slice(0, 420);
      const url = escapeHtml(item.url || "");
      const checked = selectedSet.has(item._postId) ? "checked" : "";
      const media = renderMediaPreview(item.mediaItems || []);

      return `<article class="post-card">
  <header class="post-head">
    <span class="badge">${platform}</span>
    <label class="pick">
      <input form="${formId}" type="checkbox" name="selectedPostIds" value="${postId}" ${checked} />
      선택
    </label>
  </header>
  <h3>${title}</h3>
  <p class="desc">${desc}</p>
  ${media}
  <p class="link-row"><a href="${url}" target="_blank" rel="noreferrer">원문 보기</a></p>
</article>`;
    })
    .join("\n");

  return `<div class="post-grid">${cards}</div>`;
}

function renderComparisonSourceCards(items) {
  if (!items.length) {
    return `<p class="empty">비교할 원본 포스트가 없습니다.</p>`;
  }

  const cards = items
    .map((item) => {
      const platform = escapeHtml(item.platform || "social");
      const title = escapeHtml(decodeHtmlEntities(item.title || "제목 없음"));
      const desc = escapeHtml(decodeHtmlEntities(item.description || item.excerpt || "")).slice(0, 220);
      const url = escapeHtml(item.url || "");
      const media = renderMediaPreview(item.mediaItems || []);

      return `<article class="source-card">
  <header class="post-head">
    <span class="badge">${platform}</span>
  </header>
  <h3>${title}</h3>
  <p class="desc">${desc}</p>
  ${media}
  <p class="link-row"><a href="${url}" target="_blank" rel="noreferrer">원문 보기</a></p>
</article>`;
    })
    .join("\n");

  return `<div class="source-grid">${cards}</div>`;
}

function renderBlogSourceList(items) {
  if (!items.length) return `<p class="empty">아직 수집된 블로그 포스트가 없습니다.</p>`;

  const rows = items
    .map((item) => {
      const title = escapeHtml(decodeHtmlEntities(item.title || "제목 없음"));
      const desc = escapeHtml(decodeHtmlEntities(item.description || item.excerpt || "")).slice(0, 180);
      const url = escapeHtml(item.url || "");
      return `<li><strong>${title}</strong><br /><a href="${url}" target="_blank" rel="noreferrer">${url}</a><p>${desc}</p></li>`;
    })
    .join("\n");

  return `<ul class="blog-list">${rows}</ul>`;
}

function renderStyleProfileCard(profile) {
  if (!profile) return `<p class="empty">아직 생성된 스타일 프로필이 없습니다.</p>`;

  const llmStyle = profile.llmStyle || null;
  const styleRules = Array.isArray(llmStyle?.styleRules) ? llmStyle.styleRules : [];
  const doNotImitateTopics = Array.isArray(llmStyle?.doNotImitateTopics)
    ? llmStyle.doNotImitateTopics
    : [];
  const writingSamples = Array.isArray(profile.writingSamples) ? profile.writingSamples.slice(0, 4) : [];
  const keywords = Array.isArray(profile.contentKeywords) ? profile.contentKeywords.slice(0, 10) : [];

  return `<div class="profile-card">
  <p><strong>분석 소스:</strong> ${Number(profile.sourceCount || 0)}개 글</p>
  <p><strong>기본 톤:</strong> ${escapeHtml(profile.tone || "unknown")}</p>
  <p><strong>평균 글 길이:</strong> ${Number(profile.avgPostWordCount || 0)} 단어</p>
  <p><strong>평균 문장 길이:</strong> ${Number(profile.avgSentenceLength || 0)} 단어</p>
  <p><strong>문단 패턴:</strong> 도입 ${Number(profile.paragraphPattern?.introParagraphs || 1)} / 전개 ${Number(profile.paragraphPattern?.bodyParagraphs || 3)} / 요약 ${Number(profile.paragraphPattern?.summaryParagraphs || 1)}</p>
  <p><strong>소제목 평균:</strong> ${Number(profile.paragraphPattern?.avgHeadingCount || 0)}개</p>
  ${llmStyle
      ? `<details open>
    <summary>LLM 스타일 분석</summary>
    <p><strong>문체 요약:</strong> ${escapeHtml(llmStyle.voiceSummary || "없음")}</p>
    <p><strong>작성자 추정:</strong> ${escapeHtml(llmStyle.personaSummary || "없음")}</p>
    <p><strong>생성용 스타일 프롬프트:</strong></p>
    <pre>${escapeHtml(llmStyle.stylePrompt || "")}</pre>
    ${styleRules.length
        ? `<p><strong>문체 룰</strong></p><ul>${styleRules.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
        : ""
      }
    ${doNotImitateTopics.length
        ? `<p><strong>문체로 오인 금지 토픽:</strong> ${doNotImitateTopics
          .map((x) => escapeHtml(x))
          .join(", ")}</p>`
        : ""
      }
  </details>`
      : `<p class="hint">LLM 스타일 분석 결과가 없습니다. (${escapeHtml(profile.llmStyleError || "not available")})</p>`
    }
  ${keywords.length
      ? `<details><summary>참고 키워드(콘텐츠 토픽)</summary><p>${keywords.map((x) => escapeHtml(x)).join(", ")}</p></details>`
      : ""
    }
  ${writingSamples.length
      ? `<details><summary>문체 샘플</summary><ol>${writingSamples
        .map((s) => `<li>${escapeHtml(s)}</li>`)
        .join("")}</ol></details>`
      : ""
    }
</div>`;
}

function pageTemplate() {
  const filepath = path.join(process.cwd(), 'src', 'views', 'index.html');
  try {
    return readFileSync(filepath, 'utf8');
  } catch (err) {
    return '<h1>MVP UI file not found</h1>';
  }
}

async function createStyleProfile(userId, blogUrls, llmProvider = DEFAULT_LLM_PROVIDER, openaiModel = "") {
  const fetched = await fetchMany(blogUrls);
  const pages = fetched.filter((x) => x.ok).map((x) => x.data);

  if (!pages.length) {
    return {
      ok: false,
      message: "유효하게 수집된 블로그 본문이 없습니다.",
      fetched,
    };
  }

  const profile = buildStyleProfile(pages);
  const enhancement = await enhanceStyleProfileWithLLM({
    pages,
    llmProvider,
    openaiModel,
    userId,
  });

  if (enhancement.ok) {
    profile.llmStyle = {
      ...enhancement.enhancement,
      rawJson: enhancement.enhancement.rawJson, // Ensure rawJson is firmly attached
      provider: enhancement.provider,
      model: enhancement.model,
      llm_response: enhancement.llm_response || "",
      llm_responses: Array.isArray(enhancement.llm_responses) ? enhancement.llm_responses : [],
      analyzedAt: new Date().toISOString(),
    };
    profile.llmStylePrompt = enhancement.prompt;
  } else {
    profile.llmStyle = null;
    profile.llmStyleError = enhancement.reason || "LLM style analysis unavailable";
    profile.llmStyleDebug = {
      provider: enhancement.provider || "",
      llm_response: enhancement.llm_response || "",
      llm_responses: Array.isArray(enhancement.llm_responses) ? enhancement.llm_responses : [],
      analyzedAt: new Date().toISOString(),
    };
  }

  await saveStyleProfile(userId, profile);
  await saveBlogSources(userId, pages);

  return {
    ok: true,
    userId,
    profile,
    fetched,
    llmStyle: profile.llmStyle,
    llmStyleError: profile.llmStyleError || "",
    llm_response: enhancement.llm_response || "",
    llm_responses: Array.isArray(enhancement.llm_responses) ? enhancement.llm_responses : [],
  };
}

async function ingestInstagram(userId, instagramUrls) {
  const fetched = await fetchMany(instagramUrls);
  const items = fetched.filter((x) => x.ok).map((x) => x.data);
  await saveInstagramBatch(userId, items);

  return {
    ok: true,
    userId,
    count: items.length,
    fetched,
  };
}

async function ingestThreads(userId, threadsAccessToken, limit) {
  const savedAuth = await getThreadsAuth(userId);
  const token = String(
    threadsAccessToken || savedAuth?.accessToken || process.env.THREADS_ACCESS_TOKEN || ""
  ).trim();

  if (!token) {
    return {
      ok: false,
      message:
        "threadsAccessToken is required (or login first via /auth/threads/login, or set THREADS_ACCESS_TOKEN)",
    };
  }

  const items = await fetchThreadsPosts({
    accessToken: token,
    limit: toInt(limit, 10),
  });
  await saveThreadsBatch(userId, items);

  return {
    ok: true,
    userId,
    count: items.length,
    usedAuthSource: threadsAccessToken
      ? "request"
      : savedAuth?.accessToken
        ? "saved_login"
        : "env",
    items,
  };
}

async function analyzeImageForUser({ userId, imageUpload, llmProvider }) {
  if (!imageUpload?.absPath) {
    return {
      ok: false,
      message: "imageFile is required",
    };
  }

  const analyzed = await analyzeImageFile({
    imagePath: imageUpload.absPath,
    mimeType: imageUpload.mimeType,
    llmProvider: llmProvider || DEFAULT_LLM_PROVIDER,
  });

  if (!analyzed.ok) {
    return {
      ok: false,
      message: analyzed.reason || "Image analysis failed",
      statusCode: analyzed.statusCode || 0,
      provider: analyzed.provider || llmProvider || DEFAULT_LLM_PROVIDER,
      model: analyzed.model || "",
    };
  }

  const payload = {
    userId,
    provider: analyzed.provider,
    model: analyzed.model,
    originalFilename: imageUpload.originalFilename || "",
    publicPath: imageUpload.publicPath,
    analysisText: analyzed.analysisText,
    createdAt: new Date().toISOString(),
  };
  await saveImageAnalysis(userId, payload);

  return {
    ok: true,
    imageAnalysis: payload,
  };
}

async function createDraftForUser(
  userId,
  useLLM,
  selectedPostIds = [],
  llmProvider = DEFAULT_LLM_PROVIDER
) {
  const styleProfile = await getStyleProfile(userId);
  const instagramItems = await getInstagramBatch(userId);
  const threadsItems = await getThreadsBatch(userId);

  const allSocialItems = normalizeSocialItems(instagramItems, threadsItems);
  const selected = new Set(toIdList(selectedPostIds));
  const selectedItems = selected.size
    ? allSocialItems.filter((item) => selected.has(item._postId))
    : allSocialItems;

  if (selected.size && !selectedItems.length) {
    return {
      ok: false,
      message: "선택한 포스트를 찾을 수 없습니다. 다시 선택해주세요.",
    };
  }

  const baseDraft = generateDraft({
    userId,
    styleProfile,
    instagramItems: selectedItems,
  });

  const { draft, llmMeta } = useLLM
    ? await rewriteDraftWithLLM({
      userId,
      baseDraft,
      styleProfile,
      instagramItems: selectedItems,
      llmProvider,
    })
    : {
      draft: {
        ...baseDraft,
        llmApplied: false,
        llmReason: "LLM disabled by request",
        llmProvider,
      },
      llmMeta: { enabled: false, reason: "disabled by request" },
    };

  const finalizedDraft = {
    ...draft,
    sourcePostIds: selectedItems.map((x) => x._postId),
    sourcePostCount: selectedItems.length,
    llmPrompt: llmMeta?.prompt || draft?.llmPrompt || null,
    evaluation: evaluateDraftQuality({
      draft,
      styleProfile,
      sourceItems: selectedItems,
    }),
  };

  await saveDraft(userId, finalizedDraft);

  return {
    ok: true,
    userId,
    hasStyleProfile: Boolean(styleProfile),
    instagramCount: instagramItems.length,
    threadsCount: threadsItems.length,
    socialItemCount: allSocialItems.length,
    selectedCount: selectedItems.length,
    llm: llmMeta,
    draft: finalizedDraft,
  };
}

const requestHandler = async (req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = requestUrl.pathname;
    const auth = await getAuthContext(req);

    if (req.method === "GET" && pathname.startsWith("/uploads/")) {
      const filename = path.basename(pathname);
      const absPath = path.join(UPLOAD_DIR, filename);
      try {
        const buf = await readFile(absPath);
        const ext = path.extname(filename).toLowerCase();
        const mime =
          ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : ext === ".gif"
                ? "image/gif"
                : "image/jpeg";
        res.writeHead(200, { "content-type": mime });
        res.end(buf);
        return;
      } catch {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }
    }

    if (req.method === "GET" && pathname === "/") {
      const userId = auth?.loggedIn ? auth.user.email : requestUrl.searchParams.get("userId") || "demo-user";
      return sendHtml(
        res,
        200,
        pageTemplate({
          userId,
          profile: await getStyleProfile(userId),
          blogItems: await getBlogSources(userId),
          instaItems: await getInstagramBatch(userId),
          threadsAuth: await getThreadsAuth(userId),
          threadsItems: await getThreadsBatch(userId),
          imageAnalysis: await getImageAnalysis(userId),
          draft: await getDraft(userId),
        })
      );
    }

    if (req.method === "GET" && pathname === "/results") {
      if (!(await requireLoggedIn(res, auth))) return;
      const records = await listGenerationRecords(auth.user.email, { limit: 200 });
      return sendHtml(res, 200, renderResultsPageHtml({ email: auth.user.email, records }));
    }

    if (req.method === "GET" && pathname === "/auth/google/login") {
      const nextPath = requestUrl.searchParams.get("next") || "/";
      const state = createGoogleState(nextPath);
      const loginUrl = buildGoogleLoginUrl({ req, state });
      return redirect(res, loginUrl);
    }

    if (req.method === "GET" && pathname === "/auth/google/callback") {
      const error = requestUrl.searchParams.get("error");
      if (error) {
        return sendHtml(
          res,
          400,
          `<html><body><h1>Google 로그인 실패</h1><p>${escapeHtml(
            requestUrl.searchParams.get("error_description") || error
          )}</p></body></html>`
        );
      }

      const state = requestUrl.searchParams.get("state") || "";
      const code = requestUrl.searchParams.get("code") || "";
      const stateRecord = consumeGoogleState(state);
      if (!stateRecord) {
        return sendHtml(
          res,
          400,
          "<html><body><h1>잘못된 state</h1><p>다시 로그인해주세요.</p></body></html>"
        );
      }
      if (!code) {
        return sendHtml(
          res,
          400,
          "<html><body><h1>code 누락</h1><p>Google 인증 코드가 없습니다.</p></body></html>"
        );
      }

      const token = await exchangeGoogleCode({ req, code });
      const googleUser = await getGoogleUserInfo(token.access_token);
      await ensureUser(googleUser.email, { initialTokens: INITIAL_SIGNUP_TOKENS });
      const session = await createSession(googleUser.email, { ttlDays: 30 });
      setSessionCookie(res, session.sessionId, req);
      return redirect(res, stateRecord.nextPath || "/");
    }

    if (req.method === "GET" && pathname === "/auth/logout") {
      const cookies = parseCookies(req);
      const token = String(cookies?.[SESSION_COOKIE_NAME] || "");
      if (token) await deleteSession(token);
      clearSessionCookie(res, req);
      return redirect(res, "/");
    }

    if (req.method === "GET" && pathname === "/auth/threads/login") {
      const userId = resolveUserId(auth, requestUrl.searchParams.get("userId"));
      const redirectUri = resolveThreadsRedirectUri(req);
      const state = createThreadsState(userId, redirectUri);
      const loginUrl = buildThreadsLoginUrl(state, redirectUri);
      return redirect(res, loginUrl);
    }

    if (req.method === "GET" && pathname === "/api/debug/threads-auth") {
      const userId = requestUrl.searchParams.get("userId") || "demo-user";
      const redirectUri = resolveThreadsRedirectUri(req);
      const state = createThreadsState(userId, redirectUri);
      const loginUrl = buildThreadsLoginUrl(state, redirectUri);
      return sendJson(res, 200, {
        ok: true,
        userId,
        hasThreadsAppId: Boolean(process.env.THREADS_APP_ID),
        hasThreadsAppSecret: Boolean(process.env.THREADS_APP_SECRET),
        threadsRedirectUri: redirectUri,
        loginUrl,
      });
    }

    if (req.method === "GET" && pathname === "/auth/threads/callback") {
      const error = requestUrl.searchParams.get("error");
      if (error) {
        const errorReason = requestUrl.searchParams.get("error_description") || error;
        return sendHtml(
          res,
          400,
          `<html><body><h1>Threads 로그인 실패</h1><p>${escapeHtml(errorReason)}</p></body></html>`
        );
      }

      const state = requestUrl.searchParams.get("state") || "";
      const code = requestUrl.searchParams.get("code") || "";
      const stateRecord = consumeThreadsState(state);
      if (!stateRecord) {
        return sendHtml(
          res,
          400,
          "<html><body><h1>잘못된 state</h1><p>다시 로그인해주세요.</p></body></html>"
        );
      }

      if (!code) {
        return sendHtml(
          res,
          400,
          "<html><body><h1>code 누락</h1><p>Threads에서 code를 받지 못했습니다.</p></body></html>"
        );
      }

      const token = await exchangeThreadsCodeForToken(code, stateRecord.redirectUri);
      let me = null;
      try {
        me = await getThreadsMe(token.accessToken);
      } catch {
        me = null;
      }

      await saveThreadsAuth(stateRecord.userId, {
        ...token,
        username: me?.username || "",
        name: me?.name || "",
      });

      return redirect(res, `/?userId=${encodeURIComponent(stateRecord.userId)}`);
    }

    if (req.method === "GET" && pathname === "/api/state") {
      if (!(await requireLoggedIn(res, auth))) return;
      const userId = auth.user.email;

      return sendJson(res, 200, {
        ok: true,
        userId,
        styleProfile: await getStyleProfile(userId),
        blogSources: await getBlogSources(userId),
        instagramItems: await getInstagramBatch(userId),
        threadsAuth: await getThreadsAuth(userId),
        threadsItems: await getThreadsBatch(userId),
        imageAnalysis: await getImageAnalysis(userId),
        draft: await getDraft(userId),
      });
    }

    if (req.method === "GET" && pathname === "/api/me") {
      if (!auth.loggedIn) {
        return sendJson(res, 200, {
          ok: true,
          loggedIn: false,
          user: null,
          persona: null,
        });
      }
      const persona = (await getPersona(auth.user.email)) || { ...DEFAULT_PERSONA };
      return sendJson(res, 200, {
        ok: true,
        loggedIn: true,
        user: {
          email: auth.user.email,
          token_balance: auth.user.tokenBalance,
        },
        persona,
      });
    }

    if (req.method === "GET" && pathname === "/api/results") {
      if (!(await requireLoggedIn(res, auth))) return;
      const records = await listGenerationRecords(auth.user.email, { limit: 200 });
      return sendJson(res, 200, { ok: true, records });
    }

    if (req.method === "GET" && pathname === "/api/google-trends") {
      const keyword = requestUrl.searchParams.get("keyword");
      if (!keyword) return badRequest(res, "keyword is required");

      try {
        const startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
        const resultString = await googleTrends.interestOverTime({ keyword, startTime, geo: 'KR' });
        const result = JSON.parse(resultString);
        const dataList = result.default.timelineData.map(item => ({
          time: Number(item.time),
          formattedTime: item.formattedTime,
          value: Array.isArray(item.value) ? item.value[0] : item.value
        }));
        return sendJson(res, 200, { ok: true, data: dataList });
      } catch (err) {
        console.error("Google Trends Error:", err);
        return sendJson(res, 500, { ok: false, message: "failed to fetch trends from Google API" });
      }
    }


    if (req.method === "GET" && pathname === "/api/naver-golden-keyword") {
      const keyword = requestUrl.searchParams.get("keyword");
      const page = parseInt(requestUrl.searchParams.get("page") || "1", 10);
      const limit = 15;
      if (!keyword) return badRequest(res, "keyword is required");

      const CUSTOMER_ID = process.env.NAVER_SEARCHAD_CUSTOMER_ID;
      const ACCESS_LICENSE = process.env.NAVER_SEARCHAD_ACCESS_LICENSE;
      const SECRET_KEY = process.env.NAVER_SEARCHAD_SECRET_KEY;

      const SEARCH_CLIENT_ID = process.env.NAVER_BUSINESS_API_ID;
      const SEARCH_CLIENT_SECRET = process.env.NAVER_BUSINESS_API_SECRET;

      if (!CUSTOMER_ID || !ACCESS_LICENSE || !SECRET_KEY) {
        return sendJson(res, 400, { ok: false, message: "Naver Search Ad keys missing." });
      }

      try {
        // 1. Get related keywords from Search Ad Tool
        const method = "GET";
        const route = "/keywordstool";
        const timestamp = Date.now().toString();
        const signature = createHmac("sha256", SECRET_KEY).update(`${timestamp}.${method}.${route}`).digest("base64");

        const noSpaceKeyword = keyword.replace(/\s+/g, '');
        const adRes = await fetch(`https://api.naver.com${route}?hintKeywords=${encodeURIComponent(noSpaceKeyword)}&showDetail=1`, {
          method,
          headers: {
            "X-Timestamp": timestamp,
            "X-API-KEY": ACCESS_LICENSE,
            "X-Customer": CUSTOMER_ID,
            "X-Signature": signature
          }
        });
        const adText = await adRes.text();
        const adJson = adText ? JSON.parse(adText) : {};
        if (!adRes.ok) throw new Error(adJson.message || "Failed to fetch related keywords");

        const rawKeywords = adJson.keywordList || [];

        // Find Exact match
        let exactData = null;
        if (rawKeywords.length > 0) {
          const exactRaw = rawKeywords.find(k => k.relKeyword.replace(/\s+/g, '') === noSpaceKeyword) || rawKeywords[0];
          exactData = {
            keyword: exactRaw.relKeyword,
            pc: exactRaw.monthlyPcQcCnt === "< 10" ? 10 : Number(exactRaw.monthlyPcQcCnt),
            mobile: exactRaw.monthlyMobileQcCnt === "< 10" ? 10 : Number(exactRaw.monthlyMobileQcCnt),
            comp: exactRaw.compIdx
          };
          exactData.volume = exactData.pc + exactData.mobile;
        }

        // Filter and sort by highest traffic
        const sortedKeywords = rawKeywords
          .map(k => {
            const pc = k.monthlyPcQcCnt === "< 10" ? 10 : Number(k.monthlyPcQcCnt);
            const mobile = k.monthlyMobileQcCnt === "< 10" ? 10 : Number(k.monthlyMobileQcCnt);
            return { keyword: k.relKeyword, volume: pc + mobile, pc, mobile };
          })
          .sort((a, b) => b.volume - a.volume);

        const totalItems = sortedKeywords.length;
        const totalPage = Math.ceil(totalItems / limit);
        const topKeywords = sortedKeywords.slice((page - 1) * limit, page * limit);

        // 2. Fetch Document Count for each via Naver Search API
        // This requires the Search API scope enabled for NAVER_BUSINESS_API_ID
        const fetchDocCount = async (kwItem) => {
          if (!SEARCH_CLIENT_ID || !SEARCH_CLIENT_SECRET) {
            return { ...kwItem, docCount: 0, ratio: 999 };
          }
          const searchRes = await fetch(`https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(kwItem.keyword)}&display=1`, {
            headers: {
              "X-Naver-Client-Id": SEARCH_CLIENT_ID,
              "X-Naver-Client-Secret": SEARCH_CLIENT_SECRET
            }
          });
          const searchJson = await searchRes.json();
          if (!searchRes.ok) {
            if (searchJson.errorCode) throw searchJson; // throw to be caught below
            return { ...kwItem, docCount: 0, ratio: 999 };
          }
          const total = searchJson.total || 0;
          return {
            ...kwItem,
            docCount: total,
            ratio: kwItem.volume > 0 ? (total / kwItem.volume) : 999
          };
        };

        const processedList = [];
        for (const kwItem of topKeywords) {
          const resItem = await fetchDocCount(kwItem);
          processedList.push(resItem);
          // Small delay to prevent Naver API Rate Limit (10 req/s)
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Sort by Lowest Ratio (Golden Keywords first)
        processedList.sort((a, b) => a.ratio - b.ratio);

        return sendJson(res, 200, { ok: true, exactData, dataList: processedList, page, totalPage });

      } catch (err) {
        if (err.errorCode === '024') {
          return sendJson(res, 403, { ok: false, errorCode: '024', message: err.errorMessage });
        }
        if (err.errorCode === '012') {
          return sendJson(res, 429, { ok: false, message: "Naver API Rate Limit Exceeded (너무 많은 요청). 잠시 후 다시 시도해주세요." });
        }
        console.error("Golden Keyword Analysis Error:", err);
        return sendJson(res, 500, { ok: false, message: "failed to generate golden keyword report" });
      }
    }

    if (req.method === "POST" && pathname.startsWith("/api/")) {
      if (pathname === "/api/image-analyze") {
        if (!(await requireLoggedIn(res, auth))) return;
        const { fields, uploads } = await parseMultipartForm(req);
        const userId = auth.user.email;
        const llmProvider = fields.llmProvider ? String(fields.llmProvider) : DEFAULT_LLM_PROVIDER;
        const imageUpload = uploads.find((u) => u.fieldName === "imageFile") || uploads[0];
        const charged = await chargeTokenOrReject(res, auth, "image_analyze", { route: pathname });
        if (!charged.ok) return;
        try {
          const result = await analyzeImageForUser({ userId, imageUpload, llmProvider });
          const statusCode = result.ok ? 200 : Number(result.statusCode || 422);
          if (!result.ok) {
            await refundTokenIfNeeded(auth, charged, "refund:image_analyze", { route: pathname });
          }
          return sendJson(res, statusCode, {
            ...result,
            token_balance: await getUserTokenBalance(userId),
          });
        } catch (err) {
          await refundTokenIfNeeded(auth, charged, "refund:image_analyze_error", { route: pathname });
          throw err;
        }
      }

      if (pathname === "/api/analyze-image-mvp") {
        if (!(await requireLoggedIn(res, auth))) return;
        const { fields, uploads } = await parseMultipartForm(req);
        const userId = auth.user.email;
        const llmProvider = fields.llmProvider ? String(fields.llmProvider) : "gemini";
        const targetKeywords = fields.targetKeywords ? String(fields.targetKeywords) : "";
        const memo = fields.memo ? String(fields.memo) : "";
        const colabAddress = fields.colabAddress ? String(fields.colabAddress) : "";
        const geminiModel = fields.geminiModel ? String(fields.geminiModel) : "";
        const openaiModel = fields.openaiModel ? String(fields.openaiModel) : "";
        const imageUpload = uploads.find((u) => u.fieldName === "imageFile") || uploads[0];

        if (!imageUpload) return sendJson(res, 400, { ok: false, message: "No image file provided" });

        const { analyzeImageFile } = await import("./services/imageAnalyzer.js");
        const charged = await chargeTokenOrReject(res, auth, "image_analyze", { route: pathname });
        if (!charged.ok) return;
        try {
          const analysis = await analyzeImageFile({
            imagePath: imageUpload.absPath,
            mimeType: imageUpload.mimeType,
            llmProvider,
            geminiModel,
            openaiModel,
            colabAddress,
            targetKeywords,
            memo
          });

          if (!analysis.ok) {
            await refundTokenIfNeeded(auth, charged, "refund:image_analyze_mvp", { route: pathname });
            return sendJson(res, 422, { ok: false, message: analysis.reason, token_balance: await getUserTokenBalance(userId) });
          }

          return sendJson(res, 200, {
            ok: true,
            text: analysis.analysisText,
            prompt: analysis.promptText,
            token_balance: await getUserTokenBalance(userId),
          });
        } catch (err) {
          await refundTokenIfNeeded(auth, charged, "refund:image_analyze_mvp_error", { route: pathname });
          throw err;
        }
      }

      const raw = await readBody(req);
      const jsonBody = parseMaybeJson(raw);
      const body = jsonBody || parseFormUrlEncoded(raw);

      if (pathname === "/api/persona") {
        if (!(await requireLoggedIn(res, auth))) return;
        const personaInput = body?.persona && typeof body.persona === "object" ? body.persona : body;
        const persona = mergePersona(DEFAULT_PERSONA, personaInput);
        await savePersona(auth.user.email, persona);
        return sendJson(res, 200, { ok: true, persona });
      }

      if (pathname === "/api/style-profile") {
        if (!(await requireLoggedIn(res, auth))) return;
        const userId = auth.user.email;
        const blogUrls = toUrlList(body.blogUrls);
        const llmProvider = body.llmProvider ? String(body.llmProvider) : DEFAULT_LLM_PROVIDER;
        const openaiModel = body.openaiModel ? String(body.openaiModel) : "";
        if (!blogUrls.length) return badRequest(res, "blogUrls is required");
        const charged = await chargeTokenOrReject(res, auth, "style_profile", { route: pathname, llmProvider });
        if (!charged.ok) return;

        try {
          const result = await createStyleProfile(userId, blogUrls, llmProvider, openaiModel);
          if (!result.ok) {
            await refundTokenIfNeeded(auth, charged, "refund:style_profile_failed", { route: pathname });
          } else {
            await saveGenerationRecord({
              email: userId,
              kind: "style_profile",
              prompt: { blogUrls, llmProvider, openaiModel },
              response: {
                llmStyle: result.profile?.llmStyle || null,
                llmStyleError: result.llmStyleError || "",
                llm_response: result.llm_response || "",
                llm_responses: Array.isArray(result.llm_responses) ? result.llm_responses : [],
              },
              styleGuide: result.profile?.llmStyle?.rawJson?.style_guide || null,
            });
          }
          return sendJson(res, result.ok ? 200 : 422, {
            ...result,
            token_balance: await getUserTokenBalance(userId),
          });
        } catch (err) {
          await refundTokenIfNeeded(auth, charged, "refund:style_profile_error", { route: pathname });
          throw err;
        }
      }

      if (pathname === "/api/save-style-prompt") {
        if (!(await requireLoggedIn(res, auth))) return;
        const userId = auth.user.email;
        const styleJsonStr = body.styleJson ? String(body.styleJson) : "";
        if (!styleJsonStr) return badRequest(res, "styleJson is required");

        let parsedJson;
        try {
          parsedJson = JSON.parse(styleJsonStr);
        } catch (e) {
          return badRequest(res, "Invalid JSON format");
        }

        const profile = await getStyleProfile(userId) || {};
        if (!profile.llmStyle) profile.llmStyle = {};

        profile.llmStyle.rawJson = parsedJson;

        // Re-generate the markdown string representation from the newly edited JSON, 
        // so that the backend LLM can use the updated markdown style rules.
        // Needs a quick rebuild function inline or import. For simplicity we generate a basic version here or use the existing logic if exported.
        // Actually, we can directly update it using a basic formatter, but we should import normalizeEnhancement logic if possible.
        // Since normalizeEnhancement is in styleProfileEnhancer.js and we don't want to duplicate logic, 
        // we'll just format it inline here.

        const sg = parsedJson.style_guide || {};
        const wr = sg.writing_rules || {};
        const lex = sg.lexicon || {};
        const promptLines = [`## 문체 및 페르소나 (작성자 고유 스타일)`];

        if (wr.structure?.typical_flow) promptLines.push(`- 전체 흐름/구조: ${wr.structure.typical_flow}`);
        if (wr.sentence_style) {
          const s = wr.sentence_style;
          promptLines.push(`- 문장 호흡: ${s.avg_sentence_length || '보통'} (한 문단당 ${s.paragraph_length_sentences || '2~4'}문장 위주)`);
          promptLines.push(`- 대화체 사용: ${s.conversational_tone || 'medium'}`);
          promptLines.push(`- 이모지 강도: ${s.emoji_usage_level || 'low'}`);
          promptLines.push(`- 특수기호 강도: ${s.special_char_usage_level || 'low'}`);
        }
        if (lex.favorite_phrases?.length) promptLines.push(`- 자주 쓰는 표현: ${lex.favorite_phrases.join(', ')}`);
        if (lex.tone_keywords?.length) promptLines.push(`- 글의 톤(분위기): ${lex.tone_keywords.join(', ')}`);
        const avoid = [...(lex.avoid_phrases || []), ...(sg.banned_phrases || [])];
        if (avoid.length) promptLines.push(`- 🚫 절대 사용 금지어/표현: ${avoid.join(', ')}`);
        if (sg.style_examples?.user_samples?.length) {
          promptLines.push(`\n## 작성자 문체 샘플 (참고용)`);
          sg.style_examples.user_samples.forEach(samp => promptLines.push(`- "${samp.excerpt}" (${samp.why_it_matters})`));
        }

        // Apply Custom Overrides if user added them
        if (parsedJson.user_manual_overrides) {
          promptLines.push(`\n## 💡 사용자 특별 추가 지시사항`);
          promptLines.push(`- ${parsedJson.user_manual_overrides}`);
        }

        promptLines.push(`\n위의 스타일 가이드와 문체 특성, 금지어, 말투를 종합하여 100% 동일한 사람(페르소나)이 쓴 것처럼 일관되게 본문을 작성해라.`);

        profile.llmStyle.stylePrompt = promptLines.join('\n');

        await saveStyleProfile(userId, profile);
        return sendJson(res, 200, { ok: true, profile });
      }

      if (pathname === "/api/instagram-ingest") {
        if (!(await requireLoggedIn(res, auth))) return;
        const userId = auth.user.email;
        const instagramUrls = toUrlList(body.instagramUrls);
        if (!instagramUrls.length) return badRequest(res, "instagramUrls is required");

        const result = await ingestInstagram(userId, instagramUrls);
        return sendJson(res, 200, result);
      }

      if (pathname === "/api/threads-ingest") {
        if (!(await requireLoggedIn(res, auth))) return;
        const userId = auth.user.email;
        const threadsAccessToken = body.threadsAccessToken ? String(body.threadsAccessToken) : "";
        const result = await ingestThreads(userId, threadsAccessToken, body.limit);
        return sendJson(res, result.ok ? 200 : 422, result);
      }

      if (pathname === "/api/generate-draft") {
        if (!(await requireLoggedIn(res, auth))) return;
        const userId = auth.user.email;
        const useLLM = toBoolean(body.useLLM, false);
        const selectedPostIds = toIdList(body.selectedPostIds);
        const llmProvider = body.llmProvider ? String(body.llmProvider) : DEFAULT_LLM_PROVIDER;
        let charged = { ok: true, cost: 0 };
        if (useLLM) {
          charged = await chargeTokenOrReject(res, auth, "draft_llm", { route: pathname, llmProvider });
          if (!charged.ok) return;
        }
        try {
          const result = await createDraftForUser(userId, useLLM, selectedPostIds, llmProvider);
          if (!result.ok && useLLM) {
            await refundTokenIfNeeded(auth, charged, "refund:draft_llm_failed", { route: pathname });
          }
          return sendJson(res, result.ok ? 200 : 422, {
            ...result,
            token_balance: await getUserTokenBalance(userId),
          });
        } catch (err) {
          if (useLLM) {
            await refundTokenIfNeeded(auth, charged, "refund:draft_llm_error", { route: pathname });
          }
          throw err;
        }
      }

      if (pathname === "/api/generate-step1-outline") {
        if (!(await requireLoggedIn(res, auth))) return;
        const userId = auth.user.email;
        const selectedPostIds = toIdList(body.selectedPostIds);
        const llmProvider = body.llmProvider ? String(body.llmProvider) : DEFAULT_LLM_PROVIDER;
        const charged = await chargeTokenOrReject(res, auth, "step1_outline", { route: pathname, llmProvider });
        if (!charged.ok) return;

        const instagramItems = await getInstagramBatch(userId);
        const threadsItems = await getThreadsBatch(userId);
        const allSocialItems = normalizeSocialItems(instagramItems, threadsItems);
        const selected = new Set(selectedPostIds);
        const selectedItems = selected.size ? allSocialItems.filter((item) => selected.has(item._postId)) : allSocialItems;

        if (selected.size && !selectedItems.length) {
          await refundTokenIfNeeded(auth, charged, "refund:step1_outline_invalid_selection", { route: pathname });
          return sendJson(res, 400, {
            ok: false,
            message: "선택한 포스트가 없습니다.",
            token_balance: await getUserTokenBalance(userId),
          });
        }

        try {
          const result = await generateStep1Outline({ instagramItems: selectedItems, llmProvider });
          return sendJson(res, 200, {
            ok: true,
            outline: result.outline,
            prompt: result.prompt,
            token_balance: await getUserTokenBalance(userId),
          });
        } catch (err) {
          await refundTokenIfNeeded(auth, charged, "refund:step1_outline_error", { route: pathname });
          return sendJson(res, 500, {
            ok: false,
            message: err.message,
            token_balance: await getUserTokenBalance(userId),
          });
        }
      }

      if (pathname === "/api/generate-step2-seo") {
        if (!(await requireLoggedIn(res, auth))) return;
        const userId = auth.user.email;
        const outline = body.outline ? String(body.outline) : "";
        const llmProvider = body.llmProvider ? String(body.llmProvider) : DEFAULT_LLM_PROVIDER;
        const charged = await chargeTokenOrReject(res, auth, "step2_seo", { route: pathname, llmProvider });
        if (!charged.ok) return;
        try {
          const result = await generateStep2SEO({ outline, llmProvider });
          return sendJson(res, 200, {
            ok: true,
            seoDraft: result,
            prompt: result.prompt,
            token_balance: await getUserTokenBalance(userId),
          });
        } catch (err) {
          await refundTokenIfNeeded(auth, charged, "refund:step2_seo_error", { route: pathname });
          return sendJson(res, 500, {
            ok: false,
            message: err.message,
            token_balance: await getUserTokenBalance(userId),
          });
        }
      }

      if (pathname === "/api/generate-step3-style") {
        if (!(await requireLoggedIn(res, auth))) return;
        const userId = auth.user.email;
        const llmProvider = body.llmProvider ? String(body.llmProvider) : DEFAULT_LLM_PROVIDER;
        const seoDraft = body.seoDraft; // expected object
        const charged = await chargeTokenOrReject(res, auth, "step3_style", { route: pathname, llmProvider });
        if (!charged.ok) return;
        try {
          const styleProfile = await getStyleProfile(userId);
          const finalDraft = await generateStep3Style({ userId, seoDraft, styleProfile, llmProvider });
          // Save the final draft!
          const instagramItems = await getInstagramBatch(userId);
          const threadsItems = await getThreadsBatch(userId);
          const allSocialItems = normalizeSocialItems(instagramItems, threadsItems);
          const selectedItems = allSocialItems; // in MVP step flow, we omit exact source selection here for simplicity, or we could pass it from frontend.

          const saveable = {
            ...finalDraft,
            sourcePostIds: [],
            sourcePostCount: 0,
            llmApplied: true,
            llmProvider: llmProvider,
            llmPrompt: finalDraft.meta?.llmPrompt || null,
            evaluation: evaluateDraftQuality({
              draft: finalDraft,
              styleProfile,
              sourceItems: selectedItems,
            })
          };
          await saveDraft(userId, saveable);
          await saveGenerationRecord({
            email: userId,
            kind: "step3_style",
            prompt: finalDraft?.meta?.llmPrompt || {},
            response: { draft: saveable },
            styleGuide: styleProfile?.llmStyle?.rawJson?.style_guide || null,
          });
          return sendJson(res, 200, {
            ok: true,
            draft: saveable,
            token_balance: await getUserTokenBalance(userId),
          });
        } catch (err) {
          await refundTokenIfNeeded(auth, charged, "refund:step3_style_error", { route: pathname });
          return sendJson(res, 500, {
            ok: false,
            message: err.message,
            token_balance: await getUserTokenBalance(userId),
          });
        }
      }

      if (pathname === "/api/generate-outline-mvp") {
        if (!(await requireLoggedIn(res, auth))) return;
        const userId = auth.user.email;
        const isPreview = toBoolean(body?.isPreview, false);
        const llmProvider = body?.llmProvider ? String(body.llmProvider) : DEFAULT_LLM_PROVIDER;
        let charged = { ok: true, cost: 0 };
        if (!isPreview) {
          charged = await chargeTokenOrReject(res, auth, "outline_mvp", { route: pathname, llmProvider });
          if (!charged.ok) return;
        }
        try {
          const { blogType, keywords, memo, imageCount, imagesData, geminiModel, openaiModel, colabAddress } = body;
          let result = await generateOutlineMVP({ blogType, keywords, memo, imageCount, imagesData, llmProvider, geminiModel, openaiModel, colabAddress, isPreview });
          if (isPreview) {
            return sendJson(res, 200, { ok: true, prompt: result.prompt, token_balance: await getUserTokenBalance(userId) });
          }
          return sendJson(res, 200, { ok: true, ...result, token_balance: await getUserTokenBalance(userId) });
        } catch (err) {
          if (!isPreview) {
            await refundTokenIfNeeded(auth, charged, "refund:outline_mvp_error", { route: pathname });
          }
          return sendJson(res, 500, {
            ok: false,
            message: err.message,
            token_balance: await getUserTokenBalance(auth?.user?.email || ""),
          });
        }
      }

      if (pathname === "/api/generate-final-mvp") {
        if (!(await requireLoggedIn(res, auth))) return;
        const userId = auth.user.email;
        const isPreview = toBoolean(body?.isPreview, false);
        const llmProvider = body?.llmProvider ? String(body.llmProvider) : DEFAULT_LLM_PROVIDER;
        let charged = { ok: true, cost: 0 };
        if (!isPreview) {
          charged = await chargeTokenOrReject(res, auth, "final_generate", { route: pathname, llmProvider });
          if (!charged.ok) return;
        }
        try {
          const {
            blogType,
            keywords,
            title,
            structuredInfo,
            imagesMeta,
            mediaMeta,
            // legacy fields
            outline,
            imagesData,
            options,
            geminiModel,
            openaiModel,
            colabAddress,
          } = body;
          let styleProfile = null;
          if (options?.optStyle) {
            styleProfile = await getStyleProfile(userId);
            const hasStyleGuide = Boolean(styleProfile?.llmStyle?.rawJson?.style_guide);
            if (!hasStyleGuide) {
              if (!isPreview) {
                await refundTokenIfNeeded(auth, charged, "refund:final_generate_missing_style", { route: pathname });
              }
              return sendJson(res, 422, {
                ok: false,
                message: "스타일 설정이 필요합니다. 설정 탭에서 스타일 추출을 먼저 완료해주세요.",
                token_balance: await getUserTokenBalance(userId),
              });
            }
          }
          const persistedPersona = await getPersona(userId);
          const persona = mergePersona(mergePersona(DEFAULT_PERSONA, persistedPersona), body?.persona);
          const resolvedImagesMeta = Array.isArray(imagesMeta)
            ? imagesMeta
            : Array.isArray(mediaMeta)
              ? mediaMeta
              : undefined;

          const result = await generateFinalMVP({
            blogType,
            keywords,
            title,
            structuredInfo,
            imagesMeta: resolvedImagesMeta,
            outline,
            imagesData,
            options,
            styleProfile,
            persona,
            llmProvider,
            geminiModel,
            openaiModel,
            colabAddress,
            isPreview,
          });

          if (isPreview) {
            return sendJson(res, 200, {
              ok: true,
              prompt: result.prompt,
              token_balance: await getUserTokenBalance(userId),
            });
          }

          await saveGenerationRecord({
            email: userId,
            kind: "final_post",
            prompt: {
              request: {
                blogType,
                keywords,
                title,
                structuredInfo,
                imagesMeta: resolvedImagesMeta || [],
                options,
                llmProvider,
                geminiModel,
                openaiModel,
              },
              prompt: result.prompt || {},
              persona,
            },
            response: {
              title_suggestions: Array.isArray(result.title_suggestions) ? result.title_suggestions : [],
              markdown: String(result.markdown || ""),
              hashtags: Array.isArray(result.hashtags) ? result.hashtags : [],
              image_plan: Array.isArray(result.image_plan) ? result.image_plan : [],
              quality_checks: result.quality_checks || {},
              llm_response: result.llm_response || "",
              llm_responses: Array.isArray(result.llm_responses) ? result.llm_responses : [],
            },
            styleGuide: styleProfile?.llmStyle?.rawJson?.style_guide || null,
          });

          const fakeHtml = result.markdown.replace(/\n/g, "<br>");
          return sendJson(res, 200, {
            ok: true,
            title_suggestions: Array.isArray(result.title_suggestions) ? result.title_suggestions : [],
            markdown: result.markdown,
            html: fakeHtml,
            hashtags: result.hashtags,
            image_plan: result.image_plan || [],
            quality_checks: result.quality_checks || {},
            llm_response: result.llm_response || "",
            llm_responses: Array.isArray(result.llm_responses) ? result.llm_responses : [],
            prompt: result.prompt,
            token_balance: await getUserTokenBalance(userId),
          });
        } catch (err) {
          if (!isPreview) {
            await refundTokenIfNeeded(auth, charged, "refund:final_generate_error", { route: pathname });
          }
          const llmResponsesRaw = Array.isArray(err?.llmResponses) ? err.llmResponses : [];
          const llmResponses = llmResponsesRaw.map((item, idx) => ({
            attempt: Number(item?.attempt || idx + 1),
            provider: String(item?.provider || ""),
            model: String(item?.model || ""),
            raw_text: String(item?.rawText || item?.raw_text || ""),
          }));
          const llmResponse = llmResponses.length
            ? llmResponses[llmResponses.length - 1].raw_text
            : "";

          return sendJson(res, 500, {
            ok: false,
            message: err.message,
            llm_response: llmResponse,
            llm_responses: llmResponses,
            token_balance: await getUserTokenBalance(userId),
          });
        }
      }
    }

    if (req.method === "POST" && pathname.startsWith("/actions/")) {
      if (pathname === "/actions/image-analyze") {
        if (!(await requireLoggedIn(res, auth))) return;
        const { fields, uploads } = await parseMultipartForm(req);
        const userId = auth.user.email;
        const llmProvider = fields.llmProvider ? String(fields.llmProvider) : DEFAULT_LLM_PROVIDER;
        const imageUpload = uploads.find((u) => u.fieldName === "imageFile") || uploads[0];

        await analyzeImageForUser({ userId, imageUpload, llmProvider });
        return redirect(res, "/");
      }

      if (!(await requireLoggedIn(res, auth))) return;
      const raw = await readBody(req);
      const body = parseFormUrlEncoded(raw);
      const userId = auth.user.email;

      if (pathname === "/actions/style-profile") {
        const blogUrls = toUrlList(body.blogUrls);
        const llmProvider = body.llmProvider ? String(body.llmProvider) : DEFAULT_LLM_PROVIDER;
        const openaiModel = body.openaiModel ? String(body.openaiModel) : "";
        if (blogUrls.length) {
          await createStyleProfile(userId, blogUrls, llmProvider, openaiModel);
        }
        return redirect(res, "/");
      }

      if (pathname === "/actions/instagram-ingest") {
        const instagramUrls = toUrlList(body.instagramUrls);
        if (instagramUrls.length) {
          await ingestInstagram(userId, instagramUrls);
        }
        return redirect(res, "/");
      }

      if (pathname === "/actions/threads-ingest") {
        const threadsAccessToken = body.threadsAccessToken ? String(body.threadsAccessToken) : "";
        await ingestThreads(userId, threadsAccessToken, body.limit);
        return redirect(res, "/");
      }

      if (pathname === "/actions/generate-draft") {
        const useLLM = toBoolean(body.useLLM, false);
        const selectedPostIds = toIdList(body.selectedPostIds);
        const llmProvider = body.llmProvider ? String(body.llmProvider) : DEFAULT_LLM_PROVIDER;
        await createDraftForUser(userId, useLLM, selectedPostIds, llmProvider);
        return redirect(res, "/");
      }
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    sendJson(res, 500, { ok: false, message });
  }
};

await initStore();

const sslKeyPath = String(process.env.SSL_KEY_PATH || "").trim();
const sslCertPath = String(process.env.SSL_CERT_PATH || "").trim();

if (sslKeyPath && sslCertPath) {
  const key = readFileSync(sslKeyPath, "utf8");
  const cert = readFileSync(sslCertPath, "utf8");
  const httpsServer = https.createServer({ key, cert }, requestHandler);
  httpsServer.listen(PORT, HOST, () => {
    console.log(`Blog Auto MVP listening on https://${HOST}:${PORT}`);
  });
} else {
  const httpServer = http.createServer(requestHandler);
  httpServer.listen(PORT, HOST, () => {
    console.log(`Blog Auto MVP listening on http://${HOST}:${PORT}`);
  });
}
