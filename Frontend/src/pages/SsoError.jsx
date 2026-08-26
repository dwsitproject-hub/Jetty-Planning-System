import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import GuestBrandedShell from '../components/GuestBrandedShell'

const KNOWN_CODES = new Set([
  'oidc_disabled',
  'legacy_bridge_disabled',
  'sso_not_configured',
  'missing_token',
  'invalid_token',
  'missing_email_claim',
  'inactive_user',
  'no_account_jit_disabled',
  'server_config_error',
  'server_config_error_role',
  'sign_on_failed',
  'invalid_state',
  'missing_code',
  'missing_id_token',
  'connect_sso_email_not_verified',
  'domain_not_allowed',
  'connect_sso_requires_session',
  'connect_sso_user_not_found',
  'connect_sso_email_mismatch',
  'connect_sso_sub_collision',
  'admin_prelink_email_not_verified',
  'admin_prelink_state_invalid',
  'admin_prelink_email_mismatch',
  'admin_prelink_target_missing',
  'admin_prelink_target_email_changed',
  'admin_prelink_sub_collision',
  'ambiguous_email_match',
  'email_not_verified',
  'oidc_sub_collision',
  'email_collision_local_account',
  'jit_missing_email',
  'jit_email_not_verified',
  'no_linked_sso_user',
  'oidc_sign_in_failed',
])

export default function SsoError() {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [errorCode] = useState(() => (searchParams.get('code') || '').trim())

  const message = useMemo(() => {
    if (errorCode && KNOWN_CODES.has(errorCode)) {
      return t(`ssoError.${errorCode}`)
    }
    return t('ssoError.fallback')
  }, [errorCode, t])

  useEffect(() => {
    if (!searchParams.get('code')) return
    const next = new URLSearchParams(searchParams)
    next.delete('code')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  return (
    <GuestBrandedShell cardTitle={t('ssoError.title')}>
      <p className="guest-branded__error" role="alert">
        {message}
      </p>
      <div className="guest-branded__actions">
        <button
          type="button"
          className="btn btn--primary guest-branded__submit"
          onClick={() => navigate('/login', { replace: true })}
        >
          {t('backToSignIn')}
        </button>
      </div>
    </GuestBrandedShell>
  )
}
