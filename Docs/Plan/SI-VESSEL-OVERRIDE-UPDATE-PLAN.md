# Shipping Instruction - Vessel Override Update Plan

## 1) Objective

Provide a controlled Admin-only override feature to update selected Shipping Instruction and linked Operation fields for exceptional cases, including when operation status is SAILED, while preserving auditability and data integrity.

---

## 2) Background and Problem

In rare situations, SI vessel data may be wrong (example: incorrect ETA entered by operator), but the vessel lifecycle has progressed and the operation is already SAILED.
Normal SI edit flows are too broad for this case and can risk silent historical corruption if unrestricted updates are allowed.

---

## 3) Scope

### In Scope

- New Admin menu entry: Shipping Instruction - Vessel Override Update
- Strict RBAC-gated access for admin/special users only
- Override fields approved for this feature:
  - SI preferred jetty (`shipping_instructions.preferred_jetty_id`)
  - ETA From (`shipping_instructions.eta_from`)
  - ETA To (`shipping_instructions.eta_to`)
  - Term (`shipping_instructions.trade_term_id`)
  - Voyage (`shipping_instructions.voyage_no`)
  - Destination (`shipping_instructions.destination_text`)
  - Freight terms (`shipping_instructions.freight_terms`)
  - Document date (`shipping_instructions.document_date`)
  - B/L clause (`shipping_instructions.bill_of_lading_clause`)
  - B/L split (`shipping_instructions.bl_split_text`)
  - Consignee (`shipping_instructions.consignee_text`)
  - Notify party (`shipping_instructions.notify_party_text`)
  - BL indicated (`shipping_instructions.bl_indicated`)
  - Shipper (`shipping_instructions.shipper_id`)
  - Loading port (`shipping_instructions.loading_port_id`)
  - Surveyor (`shipping_instructions.surveyor_id`)
  - Agent (`shipping_instructions.agent_id`)
  - Operation jetty (`operations.jetty_id`)
  - ETB (`operations.etb`)
  - TB (`operations.tb`)
  - Estimation of Completion (`operations.estimated_completion_time`)
- Mandatory override reason and audit trail
- Display override history in SI detail context

### Out of Scope (Phase 1)

- Mass update/bulk override
- Auto recalculation of unrelated operational milestones
- Editing SI breakdown cargo lines via override menu

---

## 4) Key Integrity Principles

1. Least privilege: only users with explicit override permission can access/update.
2. Field whitelisting: only approved fields can be changed.
3. Mandatory justification: reason code plus free text required.
4. Full traceability: before/after values, actor, timestamp, context are logged.
5. No silent overwrite: preserve historical value trail.
6. Mandatory 4-eyes approval: requester must be different from approver.

---

## 5) Functional Requirements

### 5.1 Access Control

- Feature appears under Admin menu only if user has canView on override page key.
- Request submit action requires canEdit on override page key.
- Approval action requires canApprove on override page key.
- Mandatory segregation of duty: requester cannot approve own request.

### 5.2 Search and Select

- User can search SI by:
  - SI reference number
  - vessel name
  - operation status
  - date range

### 5.3 Override Form

- Show current values (read-only).
- Allow input only for whitelisted override fields.
- Require:
  - reason code (dropdown)
  - reason detail text (minimum length)
  - optional reference ticket/document
- Jetty must be split into two explicit fields in UI:
  - Preferred Jetty (SI)
  - Operation Jetty (Execution)

### 5.4 Validation Rules

- `eta_from` and `eta_to` must be valid dates.
- `eta_to >= eta_from`.
- `etb` and `tb` must be valid datetimes when provided.
- If both `etb` and `tb` are provided, `tb >= etb`.
- If cast-off exists and `tb` is updated, enforce `tb <= cast_off_at` unless override policy explicitly allows exception with dedicated reason code.
- `estimated_completion_time` must be valid datetime when provided.
- Reject non-whitelisted fields.
- Reject override when SI not found/deleted/out of port scope.

### 5.5 Status Behavior

- For SAILED operations: normal edit flow remains blocked; override flow is allowed for authorized users.
- ETB, TB, and Estimation of Completion remain editable via override flow even when status is SAILED.

### 5.6 Audit and History

Each override request stores:

- SI id plus SI reference
- before values
- after values
- reason code/text
- actor user id/name
- timestamp
- operation status snapshot (for example SAILED)
- request id (for traceability)
- requester and approver identity/timestamps

History appears in:

- Activity log
- SI detail "Override History" section (phase 2 if needed)

---

## 6) Technical Design (Proposed)

### 6.1 RBAC

Add new page permission key:

- `admin-si-override-update`

Permission matrix example:

- Admin role: View + Edit + Approve
- Special role (requester): View + Edit
- Special role (approver): View + Approve
- Others: no access

### 6.2 API (Proposed)

- `GET /api/v1/admin/si-overrides?query=...` - list/search candidates and requests
- `POST /api/v1/admin/si-overrides/:siId/requests` - create override request (pending approval)
- `POST /api/v1/admin/si-overrides/requests/:requestId/approve` - approve and apply (mandatory 4-eyes)
- `POST /api/v1/admin/si-overrides/requests/:requestId/reject` - reject request
- `GET /api/v1/admin/si-overrides/:siId/history` - fetch applied override history

### 6.3 Chosen Data Model (Approved)

Use `shipping_instructions` and `operations` as latest source of truth, and store previous values in append-only history tables for each applied override.

Write behavior:

1. Requester submits override request (pending state).
2. Approver reviews before/after diff and approves/rejects.
3. On approval: read current SI/operation values (for tracked fields).
4. Insert history row(s) with before/after data plus reason/request/actor/approver.
5. Update `shipping_instructions` and/or `operations` with approved values.
6. Commit as one transaction.

This ensures schedule/UI reads remain simple while retaining a full correction trail.

### 6.4 New History Table (Proposed)

Proposed table (`shipping_instruction_override_history`):

- `id`
- `shipping_instruction_id`
- `override_fields_json` (changed keys only)
- `before_json` (snapshot of values before update)
- `after_json` (snapshot of values after update)
- `reason_code`
- `reason_text`
- `reference_no`
- `actor_user_id`
- `actor_username_snapshot`
- `operation_status_snapshot`
- `request_id`
- `requested_by_user_id`
- `approved_by_user_id`
- `approved_at`
- `created_at`

Additional table (`operation_override_history`):

- `id`
- `operation_id`
- `shipping_instruction_id`
- `override_fields_json` (changed keys only: `jetty_id`, `etb`, `tb`, `estimated_completion_time`)
- `before_json`
- `after_json`
- `reason_code`
- `reason_text`
- `reference_no`
- `request_id`
- `requested_by_user_id`
- `approved_by_user_id`
- `operation_status_snapshot`
- `approved_at`
- `created_at`

Recommended constraints:

- append-only semantics (application-level: no update/delete routes)
- `reason_code`, `reason_text`, `actor_user_id` required
- foreign key to `shipping_instructions(id)` and `users(id)`
- index on `(shipping_instruction_id, created_at DESC)`

### 6.5 Transaction and Safeguards (Mandatory)

- One dedicated override request/approval flow handles this feature (no generic SI update for exception cases).
- DB transaction is mandatory at apply time: history insert(s) plus main table updates must succeed/fail together.
- Only whitelisted fields are accepted (full approved field list in section 3).
- Unknown payload fields are rejected.
- Activity log entry is written for each request creation/approval/rejection (in addition to history table).
- Enforce mandatory 4-eyes: requester and approver must differ.
- Optional hardening: DB trigger on sensitive SI fields to prevent non-audited direct updates.

---

## 7) UX Notes

- Place under Admin hub card list.
- Prominent warning banner: Exceptional override action. This is fully audited.
- Confirmation modal before submit summarizing old vs new values.
- Success toast includes override reference id.
- History list should be easy to scan for compliance checks.

---

## 8) Security and Compliance Controls

- Enforce backend permission checks (never frontend-only).
- Capture `actor_user_id` from JWT server-side.
- Include request metadata in logs (`ip`, `user-agent`) if available.
- Prevent update if payload includes unknown fields.
- Add throttling/rate limit for override endpoint.

---

## 9) Rollout Plan

### Phase 1 (MVP)

1. Add RBAC permission key plus role assignment support (requester and approver patterns).
2. Add Admin menu card plus page shell.
3. Create override request table/migration and indexes.
4. Create `shipping_instruction_override_history` and `operation_override_history` migrations and indexes.
5. Implement request API with strict whitelist and validation.
6. Implement approval/reject API (mandatory 4-eyes).
7. Implement transactional apply: insert history row(s) then update `shipping_instructions` and/or `operations`.
8. Implement audit logging (request created, approved, rejected, applied).
9. Basic request queue and history endpoint/list.

### Phase 2 (Hardening)

1. Add richer SI detail history visualization.
2. Add reporting export for override events.
3. Add DB trigger guard for sensitive SI and operation fields.
4. Add notifier integration for pending approvals and completed approvals.

---

## 10) Test Plan

### Functional

- Authorized user can access page and submit valid override.
- Unauthorized user receives 403.
- SAILED case can be corrected only through override flow.
- ETB/TB/Estimated Completion can be corrected via override flow, including SAILED.
- Invalid date ordering (`eta_to < eta_from`) is rejected.
- Non-whitelisted fields are rejected.
- Requester cannot approve own request.

### Integrity

- Before/after values correctly logged.
- History row(s) are created on every successful approved override update.
- If history insert fails, SI/operation main rows are not updated (transaction rollback).
- Activity log contains actor plus timestamp plus reason.
- Override history is retrievable and matches SI current state.

### Regression

- Existing SI create/edit/approval flows still work unchanged.
- Allocation/At-Berth/Clearance views remain stable after approved overrides.

---

## 11) Open Questions

1. Do we require evidence attachment for timeline-field overrides (ETB/TB/Estimated Completion) as mandatory?
2. Should strict temporal rules (`tb <= cast_off_at`) allow an emergency bypass reason code?
3. Should requester and approver role pools be fully separate, or can one role have both permissions with runtime segregation?
4. Should notifications be email, in-app, or both for pending approvals?
5. Do we need SLA/latency KPI on approval turnaround?

---

## 12) Acceptance Criteria

- Admin/special users can submit override requests for the approved SI and operation field list through dedicated Admin page.
- Every applied override has mandatory reason, mandatory 4-eyes approval, and full before/after audit log.
- Access is denied for users without explicit permission, and requester cannot self-approve.
- SI and operation data integrity are preserved with clear historical trace of corrections.
