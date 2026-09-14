import { commodityRowTitle } from './commodityShortTitle.js'

const STACK_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  alignItems: 'flex-start',
};

export function hasStackedSiEntries(row) {
  return Array.isArray(row?.planQueueSiEntries) && row.planQueueSiEntries.length > 0;
}

function wrapPreLine(text, title) {
  const v = text || '—';
  return (
    <span className="si-cargo-qty-cell" title={title}>
      {v}
    </span>
  );
}

export function resolveCommodityQtyCellText(row) {
  if (hasStackedSiEntries(row)) return null;
  return row?.totalQtyDisplay || '—';
}

export function renderStackedSiCargoQtyColumn(row) {
  const entries = row?.planQueueSiEntries || [];
  return (
    <div style={STACK_STYLE}>
      {entries.map((si) => (
        <span
          key={`${si.shippingInstructionId}-qty`}
          className="si-cargo-qty-cell"
          title={commodityRowTitle(si)}
        >
          {si.totalQtyDisplay || '—'}
        </span>
      ))}
    </div>
  );
}

export function renderCommodityQtyCell(row) {
  if (hasStackedSiEntries(row)) {
    return renderStackedSiCargoQtyColumn(row);
  }
  return wrapPreLine(resolveCommodityQtyCellText(row), commodityRowTitle(row));
}
