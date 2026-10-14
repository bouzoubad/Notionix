# Notionix

Réimplémentation originale, 100 % locale, d'un espace de travail de type Notion. Aucune copie de code ni d'assets Notion : le comportement visé vient de la documentation publique et du comportement connu du produit. Sync et en ligne : prévus plus tard.

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

## Identité visuelle

La planche source est `branding/notionix-brand-sheet.png`. `python3 -I scripts/build-logos.py` (Pillow, numpy, `iconutil` sur macOS) en dérive :

- bannière avec nom, transparente, en variantes claire/sombre (sidebar et écran d'accueil, selon le thème système) ;
- tuile blanche (la plus à gauche de la planche) et tuile sombre (deuxième à gauche) : favicon et icône d'application (`build/icon.*`, `resources/icon.png`, icône du Dock en dev), la tuile sombre servant d'icône d'app.

Les logos sont recadrés depuis une image de 1254 px : l'icône 1024 px est un agrandissement, un peu douce. Un export vectoriel du logo permettrait de la régénérer nette.

## TODO

- Phase 2 : blocs supplémentaires (callout, toggle, tableau, image, embeds), menu de formatage flottant, drag-and-drop de blocs, icônes et couvertures choisies par l'utilisateur.
- Phase 3 : bases de données (propriétés typées, vues table/board/liste/calendrier/galerie, filtres, tris, relations), templates.
- Phase 4 : finitions UI (raccourcis, onglets, import/export Markdown), packaging.
- Plus tard : sync et en ligne (contenu aujourd'hui stocké comme un document TipTap JSON par page ; une sync fine par bloc demandera un modèle de blocs ou un CRDT).

## Limites connues

- Le contenu d'une page est un seul document JSON : pas de bloc adressable individuellement.
- `node:sqlite` est expérimental dans Node 22 (avertissement au lancement).
