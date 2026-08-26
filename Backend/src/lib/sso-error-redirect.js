const PUBLIC_ORIGIN = (process.env.JPS_PUBLIC_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');

/** Redirect browser to SPA SSO error page with a stable reason code. */
export function redirectToSsoError(res, code) {
  const safeCode = encodeURIComponent(String(code || 'unknown'));
  return res.redirect(302, `${PUBLIC_ORIGIN}/sso-error?code=${safeCode}`);
}
