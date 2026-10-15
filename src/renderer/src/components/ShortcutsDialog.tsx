import { t } from '../../../shared/i18n'

const mac = /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = mac ? '⌘' : 'Ctrl'
const ALT = mac ? '⌥' : 'Alt'
const SHIFT = mac ? '⇧' : t('Maj')
const OR = t('ou')
const ENTER = t('Entrée')

const GROUPS: [string, [string, string][]][] = [
  [
    t('Navigation'),
    [
      [t('Rechercher'), `${MOD} P  ${OR}  ${MOD} K`],
      [t('Nouvelle page'), `${MOD} N  ${t('(web : {keys})', { keys: `${MOD} ${ALT} N` })}`],
      [t('Page précédente / suivante'), `${MOD} [  /  ${MOD} ]`],
      [t('Page parente'), `${MOD} ${SHIFT} U`],
      [t('Afficher ou masquer la barre latérale'), `${MOD} \\`],
      [t('Thème clair / sombre'), `${MOD} ${SHIFT} L`],
      [t('Ces raccourcis'), `${MOD} /`],
      [t('Ouvrir dans un nouvel onglet'), `${MOD} ${t('clic')}  ${OR}  ${t('clic du milieu')}`],
      [t('Nouvel onglet / fermer l’onglet (app)'), `${MOD} T  /  ${MOD} W`],
      [t('Onglet suivant / précédent (app)'), `Ctrl Tab  /  Ctrl ${SHIFT} Tab`]
    ]
  ],
  [
    t('Texte'),
    [
      [t('Gras, italique, souligné'), `${MOD} B, ${MOD} I, ${MOD} U`],
      [t('Barré'), `${MOD} ${SHIFT} S`],
      [t('Code en ligne'), `${MOD} E`],
      [t('Lien (sur une sélection)'), `${MOD} K`],
      [t('Dernière couleur de fond'), `${MOD} ${SHIFT} H`],
      [t('Commenter la sélection'), `${MOD} ${SHIFT} M`],
      [t('Annuler / rétablir'), `${MOD} Z  /  ${MOD} ${SHIFT} Z`]
    ]
  ],
  [
    t('Blocs'),
    [
      [t('Texte, titres 1 à 3'), `${MOD} ${ALT} 0…3`],
      [t('Tâche, puces, numéros'), `${MOD} ${ALT} 4, 5, 6`],
      [t('Toggle, code, sous-page'), `${MOD} ${ALT} 7, 8, 9`],
      [t('Dupliquer le bloc'), `${MOD} D`],
      [t('Déplacer le bloc'), `${MOD} ${SHIFT} ↑ / ↓`],
      [t('Cocher la tâche, ouvrir le toggle'), `${MOD} ${ENTER}`],
      [t('Ouvrir ou fermer tous les toggles'), `${MOD} ${ALT} T`],
      [t('Sélectionner le bloc'), t('Échap')],
      [t('Indenter / désindenter'), `Tab  /  ${SHIFT} Tab`]
    ]
  ],
  [
    t('En tapant'),
    [
      [t('Menu des blocs'), '/'],
      [t('Mention, date, rappel'), '@'],
      [t('Lien vers une page'), '[['],
      [t('Titres'), t('#, ##, ###  + espace')],
      [t('Puces, numéros, tâche'), t('- ou *,  1.,  [] + espace')],
      [t('Toggle, citation'), t('>,  "  + espace')],
      [t('Code, séparateur'), '```,  ---']
    ]
  ]
]

/** Every keyboard shortcut (Cmd+/). */
export function ShortcutsDialog({
  onClose,
  onTour
}: {
  onClose: () => void
  onTour?: () => void
}): React.JSX.Element {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t('Raccourcis clavier')}</h3>
        <div className="results">
          <div className="shortcuts-grid">
            {GROUPS.map(([title, rows]) => [
              <h4 key={title}>{title}</h4>,
              ...rows.flatMap(([label, keys]) => [
                <span key={label}>{label}</span>,
                <kbd key={`${label}-k`}>{keys}</kbd>
              ])
            ])}
          </div>
        </div>
        {onTour && (
          <div className="shortcuts-footer">
            <button onClick={onTour}>🧭 {t('Revoir la visite guidée')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
