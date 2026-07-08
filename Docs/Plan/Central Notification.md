## **Central Notification**

**Role:** You are a Backend Architect specializing in scalable notification systems.

**Context:** I want to build a centralized **Notification Engine**. The system should abstract away the complexity of "who gets notified" and "how they get notified."

**The Core Flow:**

1. **Trigger:** A business action happens (e.g., shipment.plan\_submitted or clearance.requested).  
2. **Resolution:** The system looks at the event type, finds the relevant **RBAC Role** (e.g., "Approver"), and fetches all users assigned to that role.  
3. **Delivery:** The system sends a dual-channel notification:  
   * **In-App:** A record is saved to the database to be displayed in a "Bell Icon" UI.  
   * **Email:** A formatted email is sent via a SMTP (I will provide the SMTP configuration later)

**The "Vibe" Requirements:**

* **Clean Interface:** I want a single function call like notify(event\_type, payload) to handle everything.  
* **RBAC Integrated:** The system must automatically filter recipients based on roles in our RBAC system.  
* **Audit-Ready:** Every notification should have a status (e.g., sent, delivered, read).  
* **Language/Stack:** Node.js (Express), PostgreSQL, React (Vite); see **Implementation** below.

**Output:**

Give me a clean data model for the notifications table and the notification\_templates table. Then, provide the logic for a NotificationService that handles the role-to-user resolution and the multi-channel dispatch.

## ---

**How the Architecture Should Look**

To make this feel seamless, the system should be built on three pillars:

### **1\. The Data Schema**

You need a way to store the "Bell Icon" alerts and the templates to keep your code clean.

| Table | Purpose |
| :---- | :---- |
| **NotificationTemplates** | Stores the "Subject" and "Body" with placeholders (e.g., "New Plan for {{shipment\_id}}"). |
| **Notifications** | The specific instance sent to a user (stores user\_id, is\_read, payload). |
| **UserRoles (RBAC)** | Links users to the "Approver" role so the engine knows who to ping. |

### **2\. The Logic Flow**

Instead of writing an email function inside your "Shipment" code, you use an **Event-Dispatcher** pattern:

1. **Shipment Controller** → Calls NotificationService.trigger('SHIPMENT\_APPROVAL', shipment\_data)  
2. **NotificationService** → Looks up the template for SHIPMENT\_APPROVAL.  
3. **NotificationService** → Queries the DB for all users with the Approver role.  
4. **NotificationService** → Loops through those users and fires off the In-App and Email tasks.

### **3\. The "In-App" Experience**

For the vibe to feel right, the In-App notification needs to be **real-time**. This usually involves a **WebSocket** or **Server-Sent Events (SSE)**. When the NotificationService saves a record to the DB, it should also "push" that message to the user's browser so the red dot appears instantly without a page refresh.

---

## Implementation (Jetty Planning System)

**Stack:** Node.js (Express) API, PostgreSQL, React (Vite) SPA.

**Database (migration `070_central_notifications.sql`):**

- `notification_templates` — `event_key`, `channel` (`in_app` | `email`), `title_template`, `body_template`, `kind` (UI: `approval` | `clearance` | `email_sent` | `info`), optional `primary_action_label_key` for the bell dropdown CTA.
- `notifications` — per-user rows with rendered `title`/`body`, JSON `payload` (includes `primaryHref`, template vars), `read_at`, `correlation_id` with **unique (user_id, correlation_id)** for idempotency, optional `port_id` (scoped to assigned ports in the API).
- `notification_deliveries` — email queue: `status` in `queued`, `sent`, `failed`, `skipped`.

**Backend modules:**

- `Backend/src/lib/notifications.js` — `renderTemplate`, `triggerNotification`, `triggerNotificationDeferred`, `getPublicAppBaseUrl`, recipient resolution via **page `can_approve`** (same model as `userHasPageApprove` in RBAC).
- `Backend/src/lib/notification-events.js` — maps `event_key` → approve page key (`shipment-plan`, `loading`).
- `Backend/src/lib/notification-email-worker.js` — polls queued deliveries (interval `NOTIFICATION_EMAIL_POLL_MS`, default 20s), sends with **nodemailer** when `SMTP_HOST` is set; on success inserts optional in-app **email echo** using template `notification.email_echo`.
- `Backend/src/routes/notifications.js` — `GET /notifications/unread-count`, `GET /notifications`, `PATCH /notifications/read` (body `{ ids }` or `{ all: true }`). Mounted with **`requireAuth` only**; port filter uses all ports from `user_ports` so the bell works even when the SPA is on an admin route without a selected port header.

**Domain triggers:** `POST /shipment-plans/:id/submit` → `shipment_plan.submitted`; `POST /operations/:id/signoff-request` → `operation.signoff_requested`.

**SMTP env:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, optional `APP_PUBLIC_URL` / `FRONTEND_APP_URL` for links in emails.

**Frontend:** `NotificationBell` in the top bar (`Layout.jsx`), polling unread count (~45s), dropdown list, Luxon relative times, EN/ID strings in `locales/*/notifications.json`. **Phase 1 real-time:** polling only; SSE/WebSocket deferred.

**Deep links:** Plan approval → `/shipment-plans/approval/:planId`; clearance sign-off → `/verification?filter=pending` (pending filter applied on load).

