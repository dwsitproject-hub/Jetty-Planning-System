/**
 * Row action that pulls one linked DataHub master record into the review modal.
 */
export default function DataHubRecordSyncButton({ hubCode, canEdit, busy, syncing, onClick }) {
  const unlinked = !String(hubCode ?? '').trim()
  let title = 'Pull this record from DataHub and review the change.'
  if (unlinked) title = 'This row is not linked to DataHub. Use Sync from DataHub to match it.'
  else if (!canEdit) title = 'Edit permission required.'

  return (
    <button
      type="button"
      className="btn btn--small btn--secondary"
      onClick={onClick}
      disabled={!canEdit || unlinked || busy || syncing}
      title={title}
    >
      {syncing ? 'Syncing…' : 'Sync'}
    </button>
  )
}
