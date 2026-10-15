import type { SelectOption } from '../../../shared/database'
import { t } from '../../../shared/i18n'

export function OptionTag({
  option,
  onRemove
}: {
  option: SelectOption
  onRemove?: () => void
}): React.JSX.Element {
  return (
    <span className={`tag tag-${option.color}`}>
      {option.name || t('Sans nom')}
      {onRemove && (
        <button
          className="tag-remove"
          aria-label={t('Retirer {name}', { name: option.name })}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
        >
          ×
        </button>
      )}
    </span>
  )
}
