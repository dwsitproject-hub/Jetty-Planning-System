# OIDC callback: `ERR_CONNECTION_RESET` and `chrome-error://chromewebdata/` (comprehensive)

## What you are seeing (two related symptoms)

### 1) Main page: `This site can't be reached` / `ERR_CONNECTION_RESET`

This is **TCP-level**: the browser opened a socket to the API host (e.g. `localhost:3000`) and the connection was **reset before a complete HTTP response** was received. This is **not** an Express route bug by itself, and it is **not** the same as HTTP 4xx/5xx (those still return a response body).

### 2) Console: `Unsafe attempt to load URL http://localhost:3000/auth/oidc/callback?... from frame with URL chrome-error://chromewebdata/`

Chrome’s **internal error document** (`chrome-error://chromewebdata/`) is the active “page” after the load failed. Any follow-up navigation or script (extensions, DevTools, session restore, or a parent frame) that tries to open your callback URL **from that error context** can be blocked with this message. It is usually a **consequence** of (1), not the root cause.

**Important:** Fix (1) first. Once the callback returns a normal HTTP response (302 or HTML), the `chrome-error` noise usually disappears.

---

## Diagnosis order (do these in sequence)

### Step A — Confirm the API process accepts TCP on the host you use in the browser

From the **same machine** where the browser runs (PowerShell):

```powershell
# Prefer loopback IPv4 (see Step D if localhost misbehaves)
curl.exe -sS -D - http://127.0.0.1:3000/health -o NUL

curl.exe -sS -D - http://127.0.0.1:3000/auth/oidc/ready -o NUL
```

- **`/health`** — general API up.
- **`/auth/oidc/ready`** — OIDC router only; no DB; confirms `/auth/*` reaches Node.

**If these fail or hang:** Docker is not publishing the port, `jps-api` is down, or something on the host (firewall/VPN) is RST’ing connections. Fix that before OIDC.

```powershell
docker compose --env-file Backend/.env -f docker-compose.backend.yml ps
docker logs --tail 200 jps-api
```

### Step B — Compare `localhost` vs `127.0.0.1` (Windows + Docker common issue)

On some Windows setups, **`http://localhost:3000`** resolves to **`::1` (IPv6)** first, while Docker Desktop publishes **`127.0.0.1:3000` (IPv4)** reliably. Symptom: **intermittent `ERR_CONNECTION_RESET`** or refusal for `localhost` while **`127.0.0.1` works**.

Run:

```powershell
curl.exe -sS -D - http://localhost:3000/health -o NUL
curl.exe -sS -D - http://127.0.0.1:3000/health -o NUL
```

If **`127.0.0.1` works** and **`localhost` fails**:

1. Set **`OIDC_REDIRECT_URI`** to use **`http://127.0.0.1:3000/auth/oidc/callback`** (not `localhost`) in [Backend/.env](../../Backend/.env).
2. Register the **same** redirect URI in **Hub** for the Jetty OAuth client.
3. Open the app / callback using **`127.0.0.1`** during testing so cookies and redirects stay consistent.

### Step C — Oversized `Cookie` / header block (less common but real)

If **`curl` works** but the **browser** still resets on the **long** callback URL (Hub may append `code_verifier`), the request can carry **very large `Cookie` headers**. Node rejects oversized header blocks; behavior can look like a reset.

Mitigations:

- Retest in **Incognito** (fewer cookies).
- Jetty API uses a larger **`maxHttpHeaderSize`** (see [Backend/src/index.js](../../Backend/src/index.js)); optional env **`HTTP_MAX_HEADER_SIZE`** (bytes). Restart **`jps-api`** after changes.

### Step D — Iframe / Hub embedding

If the IdP redirect targets your callback **inside an iframe**, Chrome sends **`Sec-Fetch-Dest: iframe`**. Jetty responds with a small HTML page that runs **`window.top.location.replace(same URL)`** so the **top** window performs the real callback ([Backend/src/routes/oidc-sso.js](../../Backend/src/routes/oidc-sso.js)).

**Hub-side best practice:** open Jetty in a **new tab** / top window for OIDC, not a sandboxed embed.

### Step E — DevTools “Responsive” / device toolbar

Rare, but rule out tooling: try **without** device emulation and with DevTools closed once, to ensure nothing is injecting navigations into a synthetic frame.

---

## OAuth note (redirect URI must match exactly)

Whatever you put in **`OIDC_REDIRECT_URI`** must match **Hub’s registered redirect URI** byte-for-byte (scheme, host, port, path). If you switch `localhost` → `127.0.0.1`, update **both** Jetty env and Hub.

The token request still sends the configured `redirect_uri` (no extra query params); a long browser URL with `code` / `state` / `code_verifier` is normal.

---

## Related docs

- [REBUILD-RESTART-CONTAINERS.md](./REBUILD-RESTART-CONTAINERS.md)
- [SSO-INTEGRATION-GUIDE.md](../Security/SSO-INTEGRATION-GUIDE.md) (troubleshooting §8)
