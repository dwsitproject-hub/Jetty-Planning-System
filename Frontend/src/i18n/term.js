import i18n from './index'

/**
 * Glossary labels that stay English in all locales (`terms` namespace).
 * Prefer this over scattering raw strings for domain terms (Demurrage, Laytime, …).
 */
export function term(key) {
  return i18n.t(key, { ns: 'terms' })
}
