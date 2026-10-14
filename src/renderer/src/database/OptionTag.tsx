import type { SelectOption } from '../../../shared/database'

export function OptionTag({
  option,
  onRemove
}: {
  option: SelectOption
  onRemove?: () => void
}): React.JSX.Element {
  return (
    <span className={`tag tag-${option.color}`}>
      {option.name || 'Sans nom'}
      {onRemove && (
        <button
          className="tag-remove"
          aria-label={`Retirer ${option.name}`}
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
