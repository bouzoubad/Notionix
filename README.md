<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/notionix-dark.png">
    <img src="docs/brand/notionix-light.png" alt="Notionix" height="72">
  </picture>
</p>

<p align="center"><strong>Un espace de travail à la Notion, 100 % local.<br>Vos pages restent sur votre ordinateur, et vous pouvez y migrer votre Notion en quelques clics.</strong></p>

Notionix est une réimplémentation originale (aucun code ni asset Notion) : pages imbriquées, éditeur de blocs, recherche instantanée, et surtout **un import direct de vos exports Notion** et un export Markdown pour repartir quand vous voulez. Sync et mode en ligne : prévus plus tard.

## Points forts

- **Importez votre Notion** : un export « Markdown & CSV » (`.zip` ou dossier) devient des pages Notionix, hiérarchie et liens entre pages compris. Réimport sans doublon, sans jamais écraser vos modifications.
- **Bases de données** : propriétés typées (texte, nombre, sélection, multi-sélection, date, case à cocher, URL, e-mail, téléphone, relation, **formule**, **rollup**, dates de création/modification), vues tableau, board, liste, galerie et calendrier, filtres, tris, **groupes**, ordre manuel des lignes par glisser-déposer, modèles de lignes.
- **Exportez quand vous voulez** : tout (ou une page et ses sous-pages) en Markdown, dans l'organisation d'un export Notion.
- **Local d'abord** : aucun compte, aucun jeton, aucune connexion ; tout est dans une base SQLite sur votre machine.
- **Éditeur de blocs** : titres, listes, tâches, citations, code coloré, tableaux, images (stockées en local), callouts, toggles, équations LaTeX (KaTeX) ; menu `/`, menu de mise en forme sur la sélection, blocs déplaçables à la poignée ⋮⋮, icônes et couvertures de pages.
- **Retrouvez tout** : recherche plein texte instantanée (`Cmd/Ctrl+K`), favoris, corbeille.
- **Thème clair et sombre** selon le système.

## Migrer depuis Notion

1. Dans Notion : _Paramètres > Exporter tout le contenu de l'espace de travail_, format **Markdown & CSV**, en cochant « Inclure les sous-pages » et « Créer des dossiers pour les sous-pages ».
2. Dans Notionix : _Importer / Exporter > Choisir un export Notion…_, puis le `.zip` reçu (ou le dossier extrait ; les exports découpés en plusieurs archives sont gérés).
3. Ouvrez « Importé de Notion » : vos pages sont là, avec leurs sous-pages et leurs liens.

| L'import                                                                          | Le résultat                                                                                              |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ![Import d'un export Notion avec son rapport](docs/screenshots/import-notion.png) | ![Pages importées : hiérarchie, tâches, callout, lien entre pages](docs/screenshots/imported-notion.png) |

**Ce qui est repris**

- Hiérarchie reconstruite depuis les dossiers (`Page <id>.md` + dossier `Page <id>/`), sous une page « Importé de Notion (date) ».
- Titres, paragraphes, gras/italique/barré/souligné/code, listes imbriquées, tâches, citations, blocs de code, séparateurs, **tableaux** (y compris ceux que Notion casse sur plusieurs lignes), **images** (copiées dans Notionix), **callouts** avec leur icône, **toggles**, **équations** en ligne et en bloc.
- Liens entre pages, cliquables dans l'éditeur (liens `notion.so` vers une page de l'export inclus). Les schémas non sûrs (`javascript:`…) sont retirés.
- **Bases de données** : chaque CSV devient une vraie base ; le type de chaque colonne est déduit de toutes ses valeurs (case à cocher, nombre, date et plage, URL, e-mail, sélection, multi-sélection, sinon texte) ; chaque ligne retrouve sa page et son contenu, dans l'ordre de la vue Notion ; les **modèles** de base (pages sans ligne dans le CSV) redeviennent des modèles ; les **relations** entre bases sont reconstruites (liens « Titre (page) » ou titres) ; une base affichée dans une page reste **affichée dans la page** (bloc base de données inline).
- **Réimport sans doublon** : l'identifiant Notion est mémorisé ; une page déjà importée n'est jamais écrasée, seules les nouvelles pages sont ajoutées à leur parent.
- Un **rapport d'import** détaille à l'écran ce qui n'a pas pu être repris.

**Ce qui ne l'est pas encore** : pièces jointes autres que des images (PDF…), images distantes (gardées en lien, rien n'est téléchargé), ce que l'export Notion ne contient pas : vues (filtres, tris, regroupements ; un board est proposé s'il y a une sélection), couleurs des options, formules et rollups (leur valeur arrive figée), personnes (en texte), icônes et couvertures (absentes de l'export Markdown de Notion).

> Validé sur de vrais exports Notion (espace de 85 pages et 10 bases, dates en français, multi-sélections, bases dans les pages, images, tâches, callouts, équations). Pas encore confronté à un vrai export avec relations entre bases, colonnes nombre ou case à cocher, ni toggles : la lecture de ces cas suit le format connu de Notion. `npm run build && node scripts/import-check.mjs export.zip` importe un export dans un profil jetable et affiche le rapport, l'arborescence et les schémas déduits.

**Dans l'autre sens.** « Exporter toutes les pages… » (archive `.zip`) ou « ⋯ > Exporter en Markdown » sur une page (sous-pages incluses) : un fichier `.md` par page, un dossier par page ayant des sous-pages, liens entre pages relatifs. Les bases sont exportées en CSV au format Notion, leurs lignes en pages. Notion sait réimporter ce format (_Importer > Texte & Markdown_, _CSV_). L'import par l'API Notion (jeton d'intégration) pourra venir avec la phase en ligne.

## Aperçu

| Thème clair                                                           | Thème sombre                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| ![Éditeur, thème clair](docs/screenshots/editor-light.png)            | ![Éditeur, thème sombre](docs/screenshots/editor-dark.png)         |
| ![Menu « / » pour insérer des blocs](docs/screenshots/slash-menu.png) | ![Recherche plein texte (Cmd+K)](docs/screenshots/search.png)      |
| ![Base de données, vue tableau](docs/screenshots/database-table.png)  | ![Base de données, vue board](docs/screenshots/database-board.png) |

Captures régénérées par `npm run build && node scripts/screenshots.mjs` (profils temporaires et export Notion de démonstration : rien n'est lu dans vos données).

## Stack

Electron 39, React 19, TypeScript, TipTap 3 (ProseMirror), Zustand, SQLite via `node:sqlite` (FTS5, aucune dépendance native à recompiler), Vitest, Playwright (smoke e2e).

## Lancer

```
nvm use          # Node 24.18.0 (Electron 39 embarque Node 22)
npm install
npm run dev      # développement
npm test         # tests unitaires (repository SQLite)
npm run test:e2e # build + smoke test Electron
npm run typecheck && npm run lint
```

## État actuel (phases 1, 2 et 3 et import/export Notion terminés)

- Pages imbriquées, arbre en sidebar, glisser-déposer pour réordonner ou imbriquer, favoris, duplication (sous-pages incluses), fil d'Ariane.
- Corbeille : sous-arbre mis à la corbeille ensemble, restauration, suppression définitive.
- Éditeur de blocs (TipTap) : titres, listes à puces/numérotées/tâches, citation, code avec coloration, séparateur, liens, tableaux (lignes/colonnes, en-tête, redimensionnement), images (fichier, coller, glisser ; stockage local par empreinte SHA-256 servi par le protocole `notionix-asset://`), callouts à icône, toggles, équations LaTeX en ligne et en bloc (KaTeX, édition avec aperçu) ; menu `/`, menu flottant de mise en forme et de tableau, poignée de déplacement des blocs.
- Recherche plein texte (titre + corps) via `Cmd/Ctrl+K`.
- Sauvegarde automatique (debounce 400 ms), thème clair/sombre selon le système.
- Icônes de pages (emoji) et couvertures (dégradés ou image locale), affichées aussi dans la barre latérale et le fil d'Ariane.
- Bases de données (page de type base) : schéma de propriétés typées, valeurs validées à chaque écriture, vues tableau/board/liste/galerie/calendrier en onglets, filtres (et/ou) et tris par vue, changement de type avec conversion des valeurs, options colorées, relations vers une autre base, modèles de lignes, recherche dans les valeurs. Les lignes s'ouvrent comme des pages avec leurs propriétés sous le titre.
- Formules (langage proche de Notion : `prop("Prix") * 1.2`, `if`, texte, nombres, dates ; aide et validation dans l'éditeur) et rollups (somme, moyenne, médiane, min/max, comptes, pourcentages, dates extrêmes, valeurs) calculés à la lecture, jamais stockés, références circulaires signalées. Groupes par sélection ou case à cocher dans les vues tableau, liste et board ; ordre manuel des lignes par glisser-déposer quand la vue n'est pas triée (changer de groupe change la valeur).
- Import d'un export Notion (Markdown & CSV) et export Markdown, voir « Migrer depuis Notion ».
- Données : `pages(id, parent_id, position, version, updated_at…)`, `version` incrémentée à chaque écriture pour préparer la sync.

## Identité visuelle

La planche source est `branding/notionix-brand-sheet.png`. `python3 -I scripts/build-logos.py` (Pillow, numpy, `iconutil` sur macOS) en dérive :

- bannière avec nom, transparente, en variantes claire/sombre (sidebar et écran d'accueil, selon le thème système) ;
- tuile blanche (la plus à gauche de la planche) et tuile sombre (deuxième à gauche) : favicon et icône d'application (`build/icon.*`, `resources/icon.png`, icône du Dock en dev), la tuile sombre servant d'icône d'app.

Les logos sont recadrés depuis une image de 1254 px : l'icône 1024 px est un agrandissement, un peu douce. Un export vectoriel du logo permettrait de la régénérer nette.

## TODO

- Valider sur un vrai export les cas encore non rencontrés : relations entre bases, colonnes nombre et case à cocher, toggles.
- Embeds (YouTube…) : reportés, ils supposent du réseau ; à reprendre avec la phase en ligne.
- Phase 4 : finitions UI (raccourcis, onglets), packaging, import par l'API Notion.
- Plus tard : sync et en ligne (contenu aujourd'hui stocké comme un document TipTap JSON par page ; une sync fine par bloc demandera un modèle de blocs ou un CRDT).

## Limites connues

- Le contenu d'une page est un seul document JSON : pas de bloc adressable individuellement.
- `node:sqlite` est expérimental dans Node 22 (avertissement au lancement).
