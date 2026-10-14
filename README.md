# Notionix

Réimplémentation originale, 100 % locale, d'un espace de travail de type Notion. Aucune copie de code ni d'assets Notion : le comportement visé vient de la documentation publique et du comportement connu du produit. Sync et en ligne : prévus plus tard.

## Aperçu

| Thème clair                                                           | Thème sombre                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| ![Éditeur, thème clair](docs/screenshots/editor-light.png)            | ![Éditeur, thème sombre](docs/screenshots/editor-dark.png)    |
| ![Menu « / » pour insérer des blocs](docs/screenshots/slash-menu.png) | ![Recherche plein texte (Cmd+K)](docs/screenshots/search.png) |

Captures régénérées par `npm run build && node scripts/screenshots.mjs` (pages d'exemple créées dans un profil temporaire, rien n'est lu dans tes données).

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

## État actuel (phase 1 terminée)

- Pages imbriquées, arbre en sidebar, glisser-déposer pour réordonner ou imbriquer, favoris, duplication (sous-pages incluses), fil d'Ariane.
- Corbeille : sous-arbre mis à la corbeille ensemble, restauration, suppression définitive.
- Éditeur de blocs (TipTap) : titres, listes à puces/numérotées/tâches, citation, code avec coloration, séparateur, liens ; menu `/`.
- Recherche plein texte (titre + corps) via `Cmd/Ctrl+K`.
- Sauvegarde automatique (debounce 400 ms), thème clair/sombre selon le système.
- Données : `pages(id, parent_id, position, version, updated_at…)`, `version` incrémentée à chaque écriture pour préparer la sync.

## Transferts avec Notion

Tout se passe en local : aucun compte, aucun jeton, aucune connexion.

**Notion vers Notionix.** Dans Notion : _Paramètres > Exporter tout le contenu de l'espace de travail_, format **Markdown & CSV**, avec « Inclure les sous-pages » et « Créer des dossiers pour les sous-pages ». Dans Notionix : _Importer / Exporter > Choisir un export Notion…_, puis le `.zip` reçu (ou le dossier extrait ; les exports découpés en plusieurs archives sont gérés).

- Hiérarchie reconstruite depuis les dossiers (`Page <id>.md` + dossier `Page <id>/`), les pages arrivent sous une page « Importé de Notion (date) ».
- Blocs repris : titres, paragraphes, gras/italique/barré/souligné/code, listes imbriquées, tâches, citations, code, séparateurs, callouts (en citation), toggles (titre en gras suivi du contenu).
- Liens entre pages conservés (`notionix://page/<id>`, cliquables dans l'éditeur) ; liens `notion.so` vers une page de l'export aussi. Schémas non sûrs (`javascript:`…) retirés.
- Réimport sans doublon : l'identifiant Notion est mémorisé ; une page déjà importée n'est jamais écrasée (vos modifications sont gardées), seules les nouvelles pages sont ajoutées à leur parent.
- Lignes de base de données : importées comme sous-pages, propriétés en tête de page (`**Statut :** …`).
- Rapport d'import détaillé à l'écran (ce qui n'a pas pu être repris).

**Notionix vers Markdown.** « Exporter toutes les pages… » (archive `.zip`) ou « ⋯ > Exporter en Markdown » sur une page (ses sous-pages incluses). Même organisation que l'export Notion, liens entre pages relatifs ; un fichier `.md` seul pour une page sans sous-page. Notion sait réimporter ce format (_Importer > Texte & Markdown_).

Limites actuelles : pas de bloc image, tableau ni base de données dans Notionix (images non importées, tableaux convertis en lignes de texte, bases réduites à des pages simples sans propriétés typées ni vues) ; pas d'icônes ni de couvertures (absentes de l'export Markdown de Notion). Le format d'export Notion est implémenté d'après sa structure documentée et testé sur des archives de test ; il n'a pas encore été confronté à un vrai export volumineux, d'où le rapport d'import. Importer par l'API Notion (jeton d'intégration) pourra venir avec la phase en ligne.

## Identité visuelle

La planche source est `branding/notionix-brand-sheet.png`. `python3 -I scripts/build-logos.py` (Pillow, numpy, `iconutil` sur macOS) en dérive :

- bannière avec nom, transparente, en variantes claire/sombre (sidebar et écran d'accueil, selon le thème système) ;
- tuile blanche (la plus à gauche de la planche) et tuile sombre (deuxième à gauche) : favicon et icône d'application (`build/icon.*`, `resources/icon.png`, icône du Dock en dev), la tuile sombre servant d'icône d'app.

Les logos sont recadrés depuis une image de 1254 px : l'icône 1024 px est un agrandissement, un peu douce. Un export vectoriel du logo permettrait de la régénérer nette.

## TODO

- Phase 2 : blocs supplémentaires (callout, toggle, tableau, image, embeds ; permettra aussi d'importer images et tableaux de Notion), menu de formatage flottant, drag-and-drop de blocs, icônes et couvertures choisies par l'utilisateur.
- Phase 3 : bases de données (propriétés typées, vues table/board/liste/calendrier/galerie, filtres, tris, relations), templates.
- Phase 4 : finitions UI (raccourcis, onglets, import/export Markdown), packaging.
- Plus tard : sync et en ligne (contenu aujourd'hui stocké comme un document TipTap JSON par page ; une sync fine par bloc demandera un modèle de blocs ou un CRDT).

## Limites connues

- Le contenu d'une page est un seul document JSON : pas de bloc adressable individuellement.
- `node:sqlite` est expérimental dans Node 22 (avertissement au lancement).
