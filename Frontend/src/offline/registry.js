/**
 * Per-endpoint offline policy.
 *
 * A rule:
 *   { match: RegExp, read?: 'cache', write?: 'outbox', entity?: string, ttlMs?: number }
 * `match` tests the API path (without the base URL), incl. any query string,
 * e.g. "/allocation/plan-overview?from=...".
 *
 * P2 registers READ policies for the field-scope screens (Allocation, At-Berth,
 * Clearance/Loading) plus the reference + app-context reads those screens need to
 * render offline. WRITE policies (queueing) are added in P3.
 *
 * Note: these rules only take effect in the native app AND only when offline for
 * reads-from-cache — the seam short-circuits on the web, so the web build is
 * unaffected. TTL is generous because offline reads fall back to stale data
 * anyway (better to show slightly old data than nothing at the jetty).
 */
const DAY = 24 * 60 * 60 * 1000
const REF_TTL = 7 * DAY // master/reference data changes rarely
const OPS_TTL = 1 * DAY // operational data
const CTX_TTL = 1 * DAY // app context (who am I, my ports, my permissions)

export const OFFLINE_POLICY = [
  // --- App context needed to render the shell offline ---
  { match: /^\/users\/me(\/|\?|$)/, read: 'cache', entity: 'user-context', ttlMs: CTX_TTL },
  { match: /^\/rbac\/me\/page-permissions(\/|\?|$)/, read: 'cache', entity: 'rbac-perms', ttlMs: CTX_TTL },

  // --- Allocation & Berthing ---
  { match: /^\/allocation\/(overview|plan-overview)(\/|\?|$)/, read: 'cache', entity: 'allocation-overview', ttlMs: OPS_TTL },

  // --- At-Berth / Clearance / Loading (all operation reads + detail subpaths) ---
  { match: /^\/operations(\/|\?|$)/, read: 'cache', entity: 'operations', ttlMs: OPS_TTL },

  // --- Reference / planning data the field screens read ---
  { match: /^\/shipment-plans(\/|\?|$)/, read: 'cache', entity: 'shipment-plans', ttlMs: OPS_TTL },
  { match: /^\/shipping-instructions(\/|\?|$)/, read: 'cache', entity: 'shipping-instructions', ttlMs: OPS_TTL },
  { match: /^\/ports(\/|\?|$)/, read: 'cache', entity: 'ports', ttlMs: REF_TTL },
  { match: /^\/jetties(\/|\?|$)/, read: 'cache', entity: 'jetties', ttlMs: REF_TTL },
  { match: /^\/jetty-layout(\/|\?|$)/, read: 'cache', entity: 'jetty-layout', ttlMs: REF_TTL },
  { match: /^\/si-lookups(\/|\?|$)/, read: 'cache', entity: 'si-lookups', ttlMs: REF_TTL },
  { match: /^\/master\/cargo-handling-methods(\/|\?|$)/, read: 'cache', entity: 'cargo-handling', ttlMs: REF_TTL },

  // --- WRITE policies (P3): field transactions queue to the outbox when offline ---
  // Allocation arrival/berthing logging (the primary field write; has an optimistic overlay).
  { match: /^\/allocation\/arrival(\?|$)/, write: 'outbox', entity: 'arrival' },
  { match: /^\/allocation\/shipment-plans\/swap-berthing-sequence(\?|$)/, write: 'outbox', entity: 'allocation-sequence' },
  // At-Berth / Clearance / Loading operation writes — every /operations/<id>/... path
  // and the top-level qc/quantity endpoints. NOTE: `/operations/<id>` requires a slash,
  // so the create endpoint (POST /operations) and the list stay online-only.
  { match: /^\/operations\//, write: 'outbox', entity: 'operation' },
  { match: /^\/quantity-checks\//, write: 'outbox', entity: 'operation' },
  { match: /^\/qc-surveys\//, write: 'outbox', entity: 'operation' },

  // Everything else (notifications, activity-logs, dashboard, admin, sla-config,
  // integration-admin, user/role/plan/SI creation) has no rule → stays online-only.
]

/**
 * @param {string} method HTTP method
 * @param {string} path API path (no base URL)
 * @param {Array} [policies]
 * @returns {{kind:'read'|'write', match:RegExp, entity?:string, ttlMs?:number}|null}
 */
export function matchOfflinePolicy(method, path, policies = OFFLINE_POLICY) {
  const m = String(method || 'GET').toUpperCase()
  const p = String(path || '')
  for (const rule of policies) {
    if (!rule || !rule.match || !rule.match.test(p)) continue
    if (m === 'GET') {
      if (rule.read) return { kind: 'read', ...rule }
    } else if (rule.write) {
      return { kind: 'write', ...rule }
    }
  }
  return null
}
