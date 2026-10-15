import { formatProductProgressLine } from '../utils/cargoQtyDisplay'

/**
 * Per-product moved / planned lines. Hidden unless the call has two or more products.
 */
export default function ProductCargoProgressLines({ products, className = '' }) {
  if (!Array.isArray(products) || products.length < 2) return null

  return (
    <ul className={className}>
      {products.map((product) => (
        <li key={product.commodityId ?? product.shortName}>{formatProductProgressLine(product)}</li>
      ))}
    </ul>
  )
}
