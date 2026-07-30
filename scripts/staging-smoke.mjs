const apiOrigin = requiredUrl("STAGING_API_URL");
const webOrigin = requiredUrl("STAGING_WEB_URL");

const results = [];

await check("API liveness", async () => {
  const response = await requestWithRetry(new URL("/health", apiOrigin));
  assert(response.status === 200, `expected 200, received ${response.status}`);
  const body = await response.json();
  assert(body.status === "ok", `expected status=ok, received ${JSON.stringify(body)}`);
  assert(body.supabaseConfigured === true, "Supabase is not configured");
  assertSecurityHeaders(response);
});

await check("API readiness", async () => {
  const response = await requestWithRetry(new URL("/ready", apiOrigin));
  assert(response.status === 200, `expected 200, received ${response.status}`);
  const body = await response.json();
  assert(body.status === "ready", `expected status=ready, received ${JSON.stringify(body)}`);
});

await check("Web login route", async () => {
  const response = await requestWithRetry(new URL("/login", webOrigin));
  assert(response.status === 200, `expected 200, received ${response.status}`);
  const html = await response.text();
  assert(html.includes('<div id="root">'), "response is not the TeamZeit application shell");
});

await check("Unauthenticated API access", async () => {
  const response = await requestWithRetry(new URL("/api/v1/me", apiOrigin));
  assert(response.status === 401, `expected 401, received ${response.status}`);
  assert(response.headers.has("x-request-id"), "X-Request-Id response header is missing");
  const body = await response.json();
  assert(body.error?.code === "UNAUTHENTICATED", `unexpected error response: ${JSON.stringify(body)}`);
});

await check("Unauthenticated absence access", async () => {
  const response = await requestWithRetry(new URL("/api/v1/absences", apiOrigin));
  assert(response.status === 401, `expected 401, received ${response.status}`);
  assert(response.headers.has("x-request-id"), "X-Request-Id response header is missing");
  const body = await response.json();
  assert(body.error?.code === "UNAUTHENTICATED", `unexpected error response: ${JSON.stringify(body)}`);
});

await check("CORS allow-list", async () => {
  const allowed = await requestWithRetry(new URL("/health", apiOrigin), {
    headers: { Origin: webOrigin.origin },
  });
  assert(
    allowed.headers.get("access-control-allow-origin") === webOrigin.origin,
    "configured web origin is not allowed by CORS",
  );

  const denied = await requestWithRetry(new URL("/health", apiOrigin), {
    headers: { Origin: "https://invalid.example" },
  });
  assert(
    denied.headers.get("access-control-allow-origin") !== "https://invalid.example",
    "unexpected origin is allowed by CORS",
  );
});

for (const result of results) console.log(`PASS ${result}`);
console.log(`Staging smoke test passed (${results.length}/${results.length}).`);

async function check(name, action) {
  try {
    await action();
    results.push(name);
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    process.exit();
  }
}

async function requestWithRetry(url, init) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

function requiredUrl(name) {
  const value = process.env[name];
  assert(value, `${name} is required`);
  const url = new URL(value);
  assert(url.protocol === "https:", `${name} must use HTTPS`);
  assert(url.pathname === "/" || url.pathname === "", `${name} must be an origin without a path`);
  return url;
}

function assertSecurityHeaders(response) {
  assert(response.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options is missing");
  assert(response.headers.get("x-frame-options") === "DENY", "X-Frame-Options is missing");
  assert(response.headers.has("strict-transport-security"), "Strict-Transport-Security is missing");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
