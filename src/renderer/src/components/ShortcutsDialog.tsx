const mac = /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = mac ? '⌘' : 'Ctrl'
const ALT = mac ? '⌥' : 'Alt'
const SHIFT = mac ? '⇧' : 'Maj'

const GROUPS: [string, [string, string][]][] = [
  [
    'Navigation',
    [
      ['Rechercher', `${MOD} P  ou  ${MOD} K`],
      ['Nouvelle page', `${MOD} N  (web : ${MOD} ${ALT} N)`],
      ['Page précédente / suivante', `${MOD} [  /  ${MOD} ]`],
      ['Page parente', `${MOD} ${SHIFT} U`],
      ['Afficher ou masquer la barre latérale', `${MOD} \\`],
      ['Thème clair / sombre', `${MOD} ${SHIFT} L`],
      ['Ces raccourcis', `${MOD} /`]
    ]
  ],
  [
    'Texte',
    [
      ['Gras, italique, souligné', `${MOD} B, ${MOD} I, ${MOD} U`],
      ['Barré', `${MOD} ${SHIFT} S`],
      ['Code en ligne', `${MOD} E`],
      ['Lien (sur une sélection)', `${MOD} K`],
      ['Dernière couleur de fond', `${MOD} ${SHIFT} H`],
      ['Commenter la sélection', `${MOD} ${SHIFT} M`],
      ['Annuler / rétablir', `${MOD} Z  /  ${MOD} ${SHIFT} Z`]
    ]
  ],
  [
    'Blocs',
    [
      ['Texte, titres 1 à 3', `${MOD} ${ALT} 0…3`],
      ['Tâche, puces, numéros', `${MOD} ${ALT} 4, 5, 6`],
      ['Toggle, code, sous-page', `${MOD} ${ALT} 7, 8, 9`],
      ['Dupliquer le bloc', `${MOD} D`],
      ['Déplacer le bloc', `${MOD} ${SHIFT} ↑ / ↓`],
      ['Cocher la tâche, ouvrir le toggle', `${MOD} Entrée`],
      ['Ouvrir ou fermer tous les toggles', `${MOD} ${ALT} T`],
      ['Sélectionner le bloc', 'Échap'],
      ['Indenter / désindenter', `Tab  /  ${SHIFT} Tab`]
    ]
  ],
  [
    'En tapant',
    [
      ['Menu des blocs', '/'],
      ['Mention, date, rappel', '@'],
      ['Lien vers une page', '[['],
      ['Titres', '#, ##, ###  + espace'],
      ['Puces, numéros, tâche', '- ou *,  1.,  [] + espace'],
      ['Toggle, citation', '>,  "  + espace'],
      ['Code, séparateur', '```,  ---']
    ]
  ]
]

/** Every keyboard shortcut (Cmd+/). */
export function ShortcutsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Raccourcis clavier</h3>
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
      </div>
    </div>
  )
}
