/**
 * Server env switches for features that roll out dark (off in production until approved).
 * A flag is on only when its env var is the exact word true. Recreate jps-api after a change.
 */

export const FEATURE_ENV = {
  netRate: 'FEATURE_NET_RATE',
  noFlowReport: 'FEATURE_NOFLOW_REPORT',
  ganttStops: 'FEATURE_GANTT_STOPS',
};

/** @param {keyof typeof FEATURE_ENV} key */
export function isFeatureOn(key, env = process.env) {
  const name = FEATURE_ENV[key];
  return Boolean(name) && env[name] === 'true';
}

/** @returns {Record<keyof typeof FEATURE_ENV, boolean>} */
export function featureFlags(env = process.env) {
  return Object.fromEntries(Object.keys(FEATURE_ENV).map((k) => [k, isFeatureOn(k, env)]));
}

/** Express guard: 404 while the feature is off, so the endpoint looks absent. */
export function requireFeature(key) {
  return (_req, res, next) => {
    if (!isFeatureOn(key)) return res.status(404).json({ error: 'Not found' });
    return next();
  };
}
