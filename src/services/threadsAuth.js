function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function getConfig() {
  return {
    clientId: requiredEnv("THREADS_APP_ID"),
    clientSecret: requiredEnv("THREADS_APP_SECRET"),
    scope: String(process.env.THREADS_SCOPE || "threads_basic").trim(),
    authBase: String(process.env.THREADS_AUTH_BASE || "https://www.threads.net/oauth/authorize").trim(),
    apiBase: String(process.env.THREADS_API_BASE || "https://graph.threads.net/v1.0")
      .trim()
      .replace(/\/$/, ""),
  };
}

function getRedirectUri(override) {
  if (override) return override;
  const envValue = String(process.env.THREADS_REDIRECT_URI || "").trim();
  if (!envValue || envValue.toUpperCase() === "AUTO") {
    throw new Error("THREADS_REDIRECT_URI is not set and no runtime redirect URI was provided");
  }
  return envValue;
}

export function buildThreadsLoginUrl(state, redirectUriOverride = "") {
  const cfg = getConfig();
  const redirectUri = getRedirectUri(redirectUriOverride);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: cfg.scope,
    response_type: "code",
    state,
  });

  return `${cfg.authBase}?${params.toString()}`;
}

export async function exchangeThreadsCodeForToken(code, redirectUriOverride = "") {
  const cfg = getConfig();
  const redirectUri = getRedirectUri(redirectUriOverride);

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(`${cfg.apiBase}/oauth/access_token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.error) {
    const message = data?.error?.message || data?.error_description || `Threads token exchange failed (${res.status})`;
    throw new Error(message);
  }

  return {
    accessToken: data.access_token || "",
    userId: data.user_id || "",
    tokenType: data.token_type || "",
    expiresIn: data.expires_in || 0,
    receivedAt: new Date().toISOString(),
  };
}

export async function getThreadsMe(accessToken) {
  const cfg = getConfig();
  const params = new URLSearchParams({
    fields: "id,username,name,threads_profile_picture_url",
    access_token: accessToken,
  });

  const res = await fetch(`${cfg.apiBase}/me?${params.toString()}`, {
    headers: { accept: "application/json" },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    const message = data?.error?.message || `Threads /me failed (${res.status})`;
    throw new Error(message);
  }

  return data;
}
