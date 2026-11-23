import { useTranslation } from 'react-i18next'

/** "Before cargo" / "After cargo" tag; stops during cargo need no tag. */
export default function StopPhasePill({ phase }) {
  const { t } = useTranslation('pages')
  if (phase !== 'before' && phase !== 'after') return null
  return <span className="no-flow__pill no-flow__pill--phase">{t(`noFlowPhase_${phase}`)}</span>
}
