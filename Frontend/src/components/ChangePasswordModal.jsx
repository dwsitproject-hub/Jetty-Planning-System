import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { changeMyPasswordApi } from '../api/usersApi'
import PasswordField from './PasswordField'

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

export default function ChangePasswordModal({ open, onClose }) {
  const { t } = useTranslation('common')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const resetForm = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    setSuccess(false)
    setSubmitting(false)
  }

  useEffect(() => {
    if (!open) {
      resetForm()
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, submitting])

  const handleClose = () => {
    if (submitting) return
    onClose()
  }

  const validate = () => {
    if (!currentPassword.trim()) {
      return t('changePassword.errors.currentRequired')
    }
    if (!newPassword.trim()) {
      return t('changePassword.errors.newRequired')
    }
    if (newPassword.length < 6) {
      return t('changePassword.errors.newMinLength')
    }
    if (newPassword !== confirmPassword) {
      return t('changePassword.errors.confirmMismatch')
    }
    if (newPassword === currentPassword) {
      return t('changePassword.errors.sameAsCurrent')
    }
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setSubmitting(true)
    try {
      await changeMyPasswordApi({ currentPassword, newPassword })
      setSuccess(true)
      window.setTimeout(() => {
        handleClose()
      }, 1200)
    } catch (err) {
      setError(err?.message || t('changePassword.errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={handleClose} aria-hidden="true">
      <div
        className="modal modal--password"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="change-password-title"
        aria-modal="true"
      >
        <div className="modal__header">
          <h2 id="change-password-title" className="modal__title modal__title--flush">
            {t('changePassword.title')}
          </h2>
          <button
            type="button"
            className="modal__close"
            onClick={handleClose}
            aria-label={t('changePassword.cancel')}
            disabled={submitting}
          >
            <CloseIcon />
          </button>
        </div>
        <hr className="modal__divider" />

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="modal__alert modal__alert--error" role="alert">
              {error}
            </div>
          )}
          {success && (
            <div className="modal__alert modal__alert--success" role="status">
              {t('changePassword.success')}
            </div>
          )}

          <PasswordField
            id="change-password-current"
            label={t('changePassword.currentLabel')}
            placeholder={t('changePassword.currentPlaceholder')}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            disabled={submitting || success}
            showPasswordLabel={t('changePassword.showPassword')}
            hidePasswordLabel={t('changePassword.hidePassword')}
          />
          <PasswordField
            id="change-password-new"
            label={t('changePassword.newLabel')}
            placeholder={t('changePassword.newPlaceholder')}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            disabled={submitting || success}
            showPasswordLabel={t('changePassword.showPassword')}
            hidePasswordLabel={t('changePassword.hidePassword')}
          />
          <PasswordField
            id="change-password-confirm"
            label={t('changePassword.confirmLabel')}
            placeholder={t('changePassword.confirmPlaceholder')}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            disabled={submitting || success}
            showPasswordLabel={t('changePassword.showPassword')}
            hidePasswordLabel={t('changePassword.hidePassword')}
          />

          <div className="modal__footer">
            <button type="button" className="btn btn--ghost" onClick={handleClose} disabled={submitting}>
              {t('changePassword.cancel')}
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting || success}>
              {submitting ? t('changePassword.saving') : t('changePassword.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
