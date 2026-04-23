# English + Bahasa Indonesia UI language (i18n)

## User-facing summary

Users can choose **English (`en`)** or **Bahasa Indonesia (`id`)** for in-app labels, navigation, and messages defined in the SPA. The choice is stored in the browser as **`localStorage` key `jps_locale`** (values `en` or `id`) so it persists across sessions without requiring backend changes in the MVP.

### Where the control appears

- **Authenticated:** top bar in the main layout (segmented **EN | ID**), near port and account actions.
- **Guest (before login):** same control on **Login** and **Select port**, inside the branded guest shell header row.

Changing language updates the React tree immediately (no full page reload); the current route and scroll position stay as they are.

### Lo-fi placement

**Authenticated header**

```text
+------------------------------------------------------------------------+
| [Logo] Jetty Planning System          [Port: …]  [ EN | ID ]  Hi, …  [Logout] |
+------------------------------------------------------------------------+
| Sidebar |                        main content                             |
```

**Guest (Login / Select port)**

```text
+--- Guest shell --------------------------------------------------------+
|  [logo] Jetty Planning System                    optional: [ EN | ID ]   |
|  -------- card --------------------------------------------------------  |
|  |  Sign in / Choose port                                               |  |
+------------------------------------------------------------------------+
```

---

## Where to manage text (sources of truth)

| What | Where |
|------|--------|
| Translatable UI strings | `Frontend/src/locales/en/*.json` and `Frontend/src/locales/id/*.json` (same keys per namespace). |
| English-only domain labels (same English in both locale files where locked) | `Frontend/src/locales/en/terms.json` and `Frontend/src/locales/id/terms.json`. |
| Runtime config (languages, fallback) | `Frontend/src/i18n/index.js`. |
| Persistence + switching | `LanguageSwitch` + `jps_locale`; i18n listens to `languageChanged` to sync storage. |
| Glossary helper in code | `Frontend/src/i18n/term.js` — `term('laytime')` reads the `terms` namespace. |

---

## Technical stack

- **i18next** + **react-i18next** (Vite-compatible).
- **Default locale:** `en`, unless `jps_locale` is set, or (on first visit) `navigator.language` starts with `id` → `id`.
- **Date/time display:** `formatDateTimeDisplay` uses the active app locale (`en` → `en-GB`, `id` → `id-ID`) via `Intl` where centralized.

Namespaces in use include at least: `common`, `nav`, `auth`, `terms`, `pages`.

---

## Glossary (`terms` namespace)

Keys under **`terms`** are **industry labels** that stay **English in the Indonesian UI** when required. In PR review, `en/terms.json` and `id/terms.json` should match for those keys.

| Key | English display | Notes |
|-----|-----------------|--------|
| `demurrage` | Demurrage | Locked English in ID. |
| `laytime` | Laytime | Locked English in ID. |
| `shiftingOut` | Shifting Out | Locked English in ID. |
| `undoShiftingOut` | Undo Shift Out | Locked English in ID. |
| `nor` | NOR | Locked English in ID. |

For sentences that mix Bahasa and a locked term, use **interpolation** with `t('terms:…')` or `term('…')` for the insert.

---

## Phased rollout (checklist)

1. **Foundation:** i18n init, `jps_locale`, language switch, shell + auth + guest pages, `terms` namespace, `term()` helper.
2. **High-traffic pages:** Dashboard, Allocation, At-Berth, Loading/Unloading hub, Clearance, Demurrage calculator — migrate strings incrementally.
3. **Master + Admin + Reporting:** longer forms and tables.
4. **Polish:** API error mapping to translated strings, empty states, optional Playwright smoke per locale.

---

## QA checklist

- Toggle **EN / ID** on Dashboard and a deep-linked page; UI updates without navigation reset.
- Reload; selected language **persists** (`localStorage` `jps_locale`).
- Indonesian strings do not break narrow layouts (wrapping, sidebars).
- Locked **terms** keys show the same English in ID where specified.
- Date/time columns still look correct in both locales where `formatDateTimeDisplay` is used.

---

## Optional later work

- Send **`Accept-Language`** from the API client if the backend ever returns localized messages.
- Store preference **per user** in profile/API when available.
