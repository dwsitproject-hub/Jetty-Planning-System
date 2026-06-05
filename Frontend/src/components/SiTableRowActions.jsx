import { useTranslation } from 'react-i18next'

/** Action icons — outlined style, consistent size (18×18), use currentColor */
export function IconRequestApproval() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="si-action-icon si-action-icon--request"
      aria-hidden
      focusable="false"
    >
      <path d="M4 2h8v10H4V2z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M5 5h6M5 7h4M5 9h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <circle
        className="si-action-icon__badge"
        cx="12"
        cy="11"
        r="3.25"
        stroke="currentColor"
        strokeWidth="1.25"
        fill="var(--color-bg-white, #fff)"
      />
      <path
        className="si-action-icon__check"
        d="M11 11l1.5 1.5 2.5-2.5"
        stroke="var(--color-primary)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function IconApprove() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
      <path d="M5 4h6l2 2v2H5V4z" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinejoin="round" />
      <path d="M6 4v4M9 4v4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
      <ellipse cx="10" cy="12" rx="3" ry="2" stroke="currentColor" strokeWidth="1.25" fill="none" />
      <path d="M8.5 12l1.25 1.25 2-2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconViewDocument() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
      <path d="M4 2h7v12H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinejoin="round" />
      <path d="M5 5h5M5 7h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <circle cx="11" cy="11" r="3.5" stroke="currentColor" strokeWidth="1.25" fill="none" />
      <path d="M13.5 13.5L15 15" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function IconEdit() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
      <path d="M3 12.75V15h2.25L13.5 6.75 11.25 4.5 3 12.75z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M10.5 5.25l2.25 2.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

export function IconDelete() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden focusable="false">
      <path d="M4 5.5h10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <path
        d="M6.5 5.5V4.25A1.25 1.25 0 017.75 3h2.5A1.25 1.25 0 0111.5 4.25V5.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path d="M6 5.5l.65 9.1a1 1 0 001 0.9h3.7a1 1 0 001-.9L12 5.5" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M7.5 8.5v5M10.5 8.5v5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

export function usesShippingInstructionApprovalFlow(n) {
  const p = (n.purpose || '').toLowerCase()
  return p === 'loading' || p === 'unloading'
}

export function canViewAsDocument(n) {
  if (!n) return false
  return (n.status || '').toLowerCase() === 'approved'
}

export function siEditDisabledReason(n) {
  if (n.status === 'Draft') return null
  return 'Disabled: only Draft instructions can be edited.'
}

export function siSubmitDisabledReason(n) {
  if (usesShippingInstructionApprovalFlow(n) && n.status === 'Draft') return null
  if (!usesShippingInstructionApprovalFlow(n)) {
    return 'Disabled: submit for approval applies to Loading and Unloading instructions only.'
  }
  return 'Disabled: submit is only available while status is Draft.'
}

export function siApproveDisabledReason(n, canApproveSi) {
  if (
    usesShippingInstructionApprovalFlow(n) &&
    n.status === 'Submitted' &&
    Boolean(n.siId || n.id) &&
    canApproveSi
  ) {
    return null
  }
  if (!usesShippingInstructionApprovalFlow(n)) {
    return 'Disabled: approval applies to Loading and Unloading instructions only.'
  }
  if (!canApproveSi) return 'Disabled: your role cannot approve shipping instructions.'
  if (!(n.siId || n.id)) return 'Disabled: instruction has no reference yet.'
  if (n.status !== 'Submitted') {
    return 'Disabled: open approval only after the instruction is submitted for review (Received / Submitted).'
  }
  return 'Disabled: cannot open approval for this instruction.'
}

export function siViewDocDisabledReason(n) {
  if (canViewAsDocument(n)) return null
  return 'Disabled: open the SI document after the shipment plan is approved.'
}

export function siDeleteDisabledReason(n, canDeleteSi) {
  if (!canDeleteSi) return 'Disabled: your role cannot delete shipping instructions.'
  const s = n.status || ''
  if (s === 'Approved') return 'Disabled: approved instructions cannot be deleted.'
  if (s !== 'Draft' && s !== 'Submitted') {
    return 'Disabled: only Draft or Submitted instructions can be deleted.'
  }
  return null
}

/** Actions column: Edit | View SI | Delete — SI approval is managed at shipment plan level. */
export function SiRowActions({ row: n, canDeleteSi, onEdit, onViewDocument, onDelete }) {
  const { t } = useTranslation('shippingInstruction')
  const editReason = siEditDisabledReason(n)
  const viewReason = siViewDocDisabledReason(n)
  const deleteReason = siDeleteDisabledReason(n, canDeleteSi)

  return (
    <div className="si-table__action-slots si-table__action-slots--si-docs">
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon"
          disabled={Boolean(editReason)}
          title={editReason || t('actionEdit')}
          aria-label={editReason || t('actionEdit')}
          onClick={onEdit}
        >
          <IconEdit />
        </button>
      </div>
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon si-table__action-btn--view-si"
          disabled={Boolean(viewReason)}
          title={viewReason || t('actionViewSiDocument')}
          aria-label={viewReason || t('actionViewSiDocument')}
          onClick={onViewDocument}
        >
          <IconViewDocument />
        </button>
      </div>
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon si-table__action-btn--delete-si"
          disabled={Boolean(deleteReason)}
          title={deleteReason || t('actionDeleteInstruction')}
          aria-label={deleteReason || t('actionDeleteShippingInstruction')}
          onClick={onDelete}
        >
          <IconDelete />
        </button>
      </div>
    </div>
  )
}

function planSiCount(plan) {
  const n = plan?.shippingInstructions?.length
  if (typeof n === 'number' && n >= 0) return n
  return Number(plan?.siCount) || 0
}

export function planEditDisabledReason(plan, canEdit) {
  if (!canEdit) return 'Disabled: your role cannot edit shipment plans.'
  const s = plan?.approvalStatus || ''
  if (s !== 'Draft' && s !== 'Rejected') return 'Disabled: only Draft or Rejected plans can be edited.'
  return null
}

export function planSubmitDisabledReason(plan, canEdit) {
  if (!canEdit) return 'Disabled: your role cannot submit shipment plans.'
  const s = plan?.approvalStatus || ''
  if (s !== 'Draft' && s !== 'Rejected') return 'Disabled: submit is only available for Draft or Rejected plans.'
  if (planSiCount(plan) < 1) return 'Disabled: at least one shipping instruction is required before submit.'
  return null
}

export function planOpenApprovalDisabledReason(plan, canApprove) {
  if (!canApprove) return 'Disabled: your role cannot approve shipment plans.'
  if (plan?.approvalStatus !== 'Submitted') return 'Disabled: open approval only when the plan is submitted.'
  return null
}

export function planViewHubDisabledReason(_plan, canView) {
  if (!canView) return 'Disabled: your role cannot view shipment plans.'
  return null
}

export function planDeleteDisabledReason(plan, canDelete) {
  if (!canDelete) return 'Disabled: your role cannot delete shipment plans.'
  const s = plan?.approvalStatus || ''
  if (s !== 'Draft' && s !== 'Rejected') return 'Disabled: only Draft or Rejected plans can be deleted.'
  return null
}

/**
 * Shipment plan row: same five icon slots as SI (4th = view hub / plan).
 * @param {{ plan: object, canEdit: boolean, canApprove: boolean, canDelete: boolean, canView: boolean,
 *   onEdit: () => void, onSubmit: () => void, onOpenApproval: () => void, onViewHub: () => void, onDelete: () => void }} props
 */
export function ShipmentPlanRowActions({
  plan,
  canEdit,
  canApprove,
  canDelete,
  canView,
  onEdit,
  onSubmit,
  onOpenApproval,
  onViewHub,
  onDelete,
}) {
  const { t } = useTranslation('shippingInstruction')
  const { t: tp } = useTranslation('shipmentPlan')
  const editReason = planEditDisabledReason(plan, canEdit)
  const submitReason = planSubmitDisabledReason(plan, canEdit)
  const approveReason = planOpenApprovalDisabledReason(plan, canApprove)
  const viewReason = planViewHubDisabledReason(plan, canView)
  const deleteReason = planDeleteDisabledReason(plan, canDelete)

  return (
    <div className="si-table__action-slots">
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon"
          disabled={Boolean(editReason)}
          title={editReason || t('actionEdit')}
          aria-label={editReason || t('actionEdit')}
          onClick={onEdit}
        >
          <IconEdit />
        </button>
      </div>
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--primary btn--small si-table__action-btn si-table__action-icon"
          disabled={Boolean(submitReason)}
          title={submitReason || t('actionSubmitForApproval')}
          aria-label={submitReason || t('actionSubmitForApproval')}
          onClick={onSubmit}
        >
          <IconRequestApproval />
        </button>
      </div>
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--primary btn--small si-table__action-btn si-table__action-icon"
          disabled={Boolean(approveReason)}
          title={approveReason || t('actionOpenApproval')}
          aria-label={approveReason || t('actionOpenApproval')}
          onClick={onOpenApproval}
        >
          <IconApprove />
        </button>
      </div>
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon si-table__action-btn--view-si"
          disabled={Boolean(viewReason)}
          title={viewReason || tp('planActionViewHub')}
          aria-label={viewReason || tp('planActionViewHub')}
          onClick={onViewHub}
        >
          <IconViewDocument />
        </button>
      </div>
      <div className="si-table__action-slot">
        <button
          type="button"
          className="btn btn--secondary btn--small si-table__action-btn si-table__action-icon si-table__action-btn--delete-si"
          disabled={Boolean(deleteReason)}
          title={deleteReason || t('actionDeleteInstruction')}
          aria-label={deleteReason || tp('planActionDeletePlan')}
          onClick={onDelete}
        >
          <IconDelete />
        </button>
      </div>
    </div>
  )
}
