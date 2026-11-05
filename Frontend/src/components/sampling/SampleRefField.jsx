import SearchableSingleSelect from '../SearchableSingleSelect.jsx'
import { tankCodeOf, tankOptions } from '../../utils/samplingSampleRef.js'

export default function SampleRefField({
  kind = 'palka',
  tanks = [],
  tankId = '',
  noPalka = '',
  onChange,
  inputClass,
  placeholder,
  searchPlaceholder,
  id,
  disabled = false,
  maxLength,
  inputRef,
  onEnter,
  autoCapitalize,
  enterKeyHint,
}) {
  if (kind === 'tank') {
    return (
      <SearchableSingleSelect
        id={id}
        options={tankOptions(tanks, { tankId, noPalka })}
        value={tankId ? String(tankId) : ''}
        onChange={(value) => onChange?.({ tankId: value, noPalka: tankCodeOf(tanks, value) || noPalka })}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        disabled={disabled}
        className="sample-ref-select"
      />
    )
  }
  return (
    <input
      id={id}
      ref={inputRef}
      className={inputClass}
      value={noPalka}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      autoCapitalize={autoCapitalize}
      enterKeyHint={enterKeyHint}
      onChange={(e) => onChange?.({ tankId: '', noPalka: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onEnter?.()
        }
      }}
    />
  )
}
