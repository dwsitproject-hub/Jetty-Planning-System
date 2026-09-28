#!/usr/bin/env node
/**
 * POST a signed DHM-style webhook to the local JPS API (staging smoke test).
 *
 * Usage (from Backend/):
 *   node scripts/simulate-dhm-webhook.mjs
 *   WEBHOOK_URL=http://127.0.0.1:3000/api/v1/datahub/webhook node scripts/simulate-dhm-webhook.mjs
 */
import 'dotenv/config';
import crypto from 'crypto';

const secret = process.env.DHM_WEBHOOK_SECRET || 'whsec_demo_secret';
const url =
  process.env.WEBHOOK_URL || 'http://127.0.0.1:3000/api/v1/datahub/webhook';
const deliveryId = process.env.DELIVERY_ID || `sim-${Date.now()}`;

const body = JSON.stringify({
  event: 'record.updated',
  deliveryId,
  entityType: 'vessel',
  recordId: '00000000-0000-4000-8000-000000000001',
  version: 2,
  occurredAt: new Date().toISOString(),
  data: {
    code: 'VSL-SIM-001',
    Vessel_Name: `SIMULATED VESSEL ${deliveryId}`,
    Vessel_Type: 'tanker',
    Vessel_IMO: '9999999',
  },
});

const signature =
  'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-DHM-Signature': signature,
    'X-DHM-Delivery-Id': deliveryId,
    'X-DHM-Event': 'record.updated',
  },
  body,
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = { raw: text };
}

console.log('POST', url);
console.log('Status', res.status);
console.log(JSON.stringify(json, null, 2));

if (res.status >= 400) process.exit(1);
