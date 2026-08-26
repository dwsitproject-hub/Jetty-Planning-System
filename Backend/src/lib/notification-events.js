/**
 * Registry: event_key → which page permission (can_approve) selects recipients.
 */
export const NOTIFICATION_EVENT_CONFIG = {
  'shipment_plan.submitted': {
    approvePageKey: 'shipment-plan',
  },
  'operation.signoff_requested': {
    approvePageKey: 'loading',
  },
  'operation.sla_etc_d1': {
    approvePageKey: null,
    adminConfigured: true,
  },
  'operation.sla_etc_breach': {
    approvePageKey: null,
    adminConfigured: true,
  },
  'notification.email_echo': {
    /** Echo rows are targeted to a single user; no recipient query. */
    approvePageKey: null,
  },
};

export const EVENT_LABELS = {
  'shipment_plan.submitted': 'Shipment Plan Approval',
  'operation.signoff_requested': 'Sign-off Requested',
  'operation.sla_etc_d1': 'SLA D-1 Reminder',
  'operation.sla_etc_breach': 'SLA Breach Alert',
  'notification.email_echo': 'Email Sent',
};

export function getNotificationEventConfig(eventKey) {
  return NOTIFICATION_EVENT_CONFIG[eventKey] ?? null;
}

export function getEventLabel(eventKey) {
  return EVENT_LABELS[eventKey] || eventKey;
}
