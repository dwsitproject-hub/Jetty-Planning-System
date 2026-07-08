import { useState } from 'react'

function EyeIcon({ open }) {
  if (open) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export default function PasswordField({
  id,
  label,
  placeholder,
  value,
  onChange,
  autoComplete,
  disabled,
  showPasswordLabel,
  hidePasswordLabel,
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="modal__section password-field">
      <label htmlFor={id} className="modal__label">
        {label}
      </label>
      <div className="password-field__wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className="modal__input password-field__input"
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          disabled={disabled}
        />
        <button
          type="button"
          className="password-field__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? hidePasswordLabel : showPasswordLabel}
          tabIndex={-1}
          disabled={disabled}
        >
          <EyeIcon open={visible} />
        </button>
      </div>
    </div>
  )
}
