/**
 * Small chain-link mark on labels/headers that come from DataHub.
 */
export default function DataHubFieldCue({ children }) {
  return (
    <span className="datahub-field-cue" title="Synced with DataHub">
      <svg
        className="datahub-field-cue__icon"
        viewBox="0 0 16 16"
        width="12"
        height="12"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill="currentColor"
          d="M6.3 9.7a.75.75 0 0 1 0-1.06l2.4-2.4a.75.75 0 0 1 1.06 1.06L7.36 9.7a.75.75 0 0 1-1.06 0Zm3.4-3.4a.75.75 0 0 1 0-1.06l.7-.7a2.5 2.5 0 0 1 3.54 3.54l-.7.7a.75.75 0 0 1-1.06-1.06l.7-.7a1 1 0 1 0-1.42-1.42l-.7.7a.75.75 0 0 1-1.06 0ZM2.36 13.64a2.5 2.5 0 0 1 0-3.54l.7-.7A.75.75 0 1 1 4.12 10.46l-.7.7a1 1 0 1 0 1.42 1.42l.7-.7A.75.75 0 0 1 6.6 12.94l-.7.7a2.5 2.5 0 0 1-3.54 0Z"
        />
      </svg>
      <span className="datahub-field-cue__text">{children}</span>
      <span className="visually-hidden"> (synced with DataHub)</span>
    </span>
  )
}
