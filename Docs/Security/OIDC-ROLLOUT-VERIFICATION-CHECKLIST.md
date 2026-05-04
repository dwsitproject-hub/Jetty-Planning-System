# OIDC Rollout Verification Checklist

Use this checklist for phased rollout while preserving local login.

## Automated verification

- Backend dependency update installed (`jose`) and migration added: `057_users_auth_source_oidc_sub.sql`.
- Frontend production build passes (`cd Frontend && npm run build`).
- Backend migration command requires valid DB credentials; if it fails locally, run again in backend environment with correct `DATABASE_URL`.

## Manual staging checklist

1. Deploy with `SSO_OIDC_ENABLED=false` and `SSO_LEGACY_BRIDGE_ENABLED=true`.
2. Confirm local login still works (`/api/v1/auth/login`) and users can access normal app pages.
3. Register OIDC app in Hub with exact `OIDC_REDIRECT_URI` and correct `OIDC_CLIENT_ID`.
4. Enable `SSO_OIDC_ENABLED=true` while keeping legacy bridge enabled.
5. Validate SSO launch (`/auth/oidc/start`) and callback (`/auth/oidc/callback`) success path.
6. Verify negative cases:
   - invalid `state` is rejected;
   - invalid signature / `iss` / `aud` / expired token is rejected;
   - local account email collision without link is blocked.
7. Confirm cookies/session behavior and logout are unchanged after SSO sign-in.
8. Disable bridge (`SSO_LEGACY_BRIDGE_ENABLED=false`) and verify `/auth/hub` returns 410.
9. Monitor auth event logs for `oidc.start.*`, `oidc.callback.*`, `local.login.*`, `legacy-hub.callback.*`.
