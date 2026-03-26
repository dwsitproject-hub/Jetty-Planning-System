import { formatSiCalendarDateOnly, formatSiDateTime } from '../utils/siFormPlaceDate'

/**
 * Labels system vs business dates on the printable SI (approval + view).
 */
export default function SiFormReferenceDates({ documentDate, createdAt, updatedAt, approvedAt }) {
  return (
    <dl className="si-form__reference-dates">
      <dt>Document date</dt>
      <dd>{formatSiCalendarDateOnly(documentDate)}</dd>
      <dt>Created in system</dt>
      <dd>{formatSiDateTime(createdAt)}</dd>
      <dt>Last updated</dt>
      <dd>{formatSiDateTime(updatedAt)}</dd>
      <dt>Approved</dt>
      <dd>{approvedAt ? formatSiDateTime(approvedAt) : '—'}</dd>
    </dl>
  )
}
