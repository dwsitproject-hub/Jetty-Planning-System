# DataHub inbound webhook — staging test checklist

**Full deploy steps (3-server, GitHub branch `staging`):** [DATAHUB-WEBHOOK-STAGING-DEPLOY.md](./DATAHUB-WEBHOOK-STAGING-DEPLOY.md)

After deploying to **`172.28.92.57`**:

1. Run migration: `cd Backend && npm run migrate` (includes `120_datahub_webhook.sql`).
2. Set on the API host:
   - `DHM_WEBHOOK_ENABLED=true`
   - `DHM_WEBHOOK_SECRET=whsec_demo_secret` (match DHM portal)
   - `PORT=3000`
3. Restart the Node API.
4. Smoke test (on `.57`): `node scripts/simulate-dhm-webhook.mjs`
5. In DHM portal: edit a vessel → **Deliveries** should show **2xx**.
6. In JPS: **Master → Vessel** → **Resume review** on staged webhook run → approve → **Apply**.
7. Replay the same delivery in DHM → response **duplicate**, no second run.

Callback URL registered in DHM:

`http://172.28.92.57:3000/api/v1/datahub/webhook`
