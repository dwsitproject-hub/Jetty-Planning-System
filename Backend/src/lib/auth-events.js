function scrub(value) {
  if (value == null) return value;
  const raw = String(value);
  if (!raw) return '';
  if (raw.length <= 8) return '[redacted]';
  return `${raw.slice(0, 3)}...[redacted]...${raw.slice(-3)}`;
}

export function logAuthEvent(event, details = {}) {
  const safe = {
    ...details,
    code: details.code ? scrub(details.code) : undefined,
    idToken: details.idToken ? scrub(details.idToken) : undefined,
    verifier: details.verifier ? scrub(details.verifier) : undefined,
  };
  const payload = Object.fromEntries(Object.entries(safe).filter(([, v]) => v !== undefined));
  console.info(`[auth-event] ${event}`, payload);
}
