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
  'notification.email_echo': {
    /** Echo rows are targeted to a single user; no recipient query. */
    approvePageKey: null,
  },
};

export function getNotificationEventConfig(eventKey) {
  return NOTIFICATION_EVENT_CONFIG[eventKey] ?? null;
}
