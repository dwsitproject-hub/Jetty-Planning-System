import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { JPS_LOCALE_STORAGE_KEY } from './constants'

import enCommon from '../locales/en/common.json'
import idCommon from '../locales/id/common.json'
import enNav from '../locales/en/nav.json'
import idNav from '../locales/id/nav.json'
import enAuth from '../locales/en/auth.json'
import idAuth from '../locales/id/auth.json'
import enTerms from '../locales/en/terms.json'
import idTerms from '../locales/id/terms.json'
import enPages from '../locales/en/pages.json'
import idPages from '../locales/id/pages.json'
import enDashboard from '../locales/en/dashboard.json'
import idDashboard from '../locales/id/dashboard.json'
import enShippingInstruction from '../locales/en/shippingInstruction.json'
import idShippingInstruction from '../locales/id/shippingInstruction.json'
import enAllocation from '../locales/en/allocation.json'
import idAllocation from '../locales/id/allocation.json'
import enAtBerth from '../locales/en/atBerth.json'
import idAtBerth from '../locales/id/atBerth.json'

export function getInitialLanguage() {
  try {
    const s = localStorage.getItem(JPS_LOCALE_STORAGE_KEY)
    if (s === 'en' || s === 'id') return s
  } catch {
    /* ignore */
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('id')) {
    return 'id'
  }
  return 'en'
}

i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      nav: enNav,
      auth: enAuth,
      terms: enTerms,
      pages: enPages,
      dashboard: enDashboard,
      shippingInstruction: enShippingInstruction,
      allocation: enAllocation,
      atBerth: enAtBerth,
    },
    id: {
      common: idCommon,
      nav: idNav,
      auth: idAuth,
      terms: idTerms,
      pages: idPages,
      dashboard: idDashboard,
      shippingInstruction: idShippingInstruction,
      allocation: idAllocation,
      atBerth: idAtBerth,
    },
  },
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'nav', 'auth', 'terms', 'pages', 'dashboard', 'shippingInstruction', 'allocation', 'atBerth'],
  interpolation: {
    escapeValue: false,
  },
})

i18n.on('languageChanged', (lng) => {
  try {
    if (lng === 'en' || lng === 'id') {
      localStorage.setItem(JPS_LOCALE_STORAGE_KEY, lng)
    }
  } catch {
    /* ignore */
  }
})

export default i18n
