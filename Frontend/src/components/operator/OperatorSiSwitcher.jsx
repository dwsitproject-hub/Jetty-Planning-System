export default function OperatorSiSwitcher({ siblings, operationId, onChange }) {
  if (!Array.isArray(siblings) || siblings.length <= 1) return null

  return (
    <div className="operator-si-switcher">
      <label htmlFor="operator-si-select">Shipping instruction</label>
      <select
        id="operator-si-select"
        value={String(operationId ?? '')}
        onChange={(e) => onChange(e.target.value)}
      >
        {siblings.map((row) => (
          <option key={row.operationId} value={String(row.operationId)}>
            {row.shippingInstruction || row.jettyOperationCode || `Operation ${row.operationId}`}
          </option>
        ))}
      </select>
    </div>
  )
}
