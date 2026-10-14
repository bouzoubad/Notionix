# Notionix

Clone local de Notion, réimplémentation originale (ne jamais copier de code ou d'assets Notion). Voir README.md pour l'état et les TODO.

## Architecture

- `src/shared/types.ts` : contrat `NotionixApi` partagé main/preload/renderer.
- `src/main/db/` : `database.ts` (migrations via `PRAGMA user_version`), `pageRepository.ts` (toute la logique pages/arbre/corbeille/recherche), `text.ts` (texte pour FTS).
- `src/main/transfer/` : import d'export Notion (`sources.ts` zip/dossier/zips imbriqués, `notionImport.ts` plan d'arbre + insertion, `markdownToDoc.ts` markdown-it vers JSON ProseMirror, `canonicalDoc.ts` validation contre le schéma réel) et export (`docToMarkdown.ts`, `markdownExport.ts`).
- `src/shared/editorExtensions.ts` : schéma de document partagé éditeur/importeur (imports TipTap nommés : les imports par défaut cassent le build main).
- `src/main/assets.ts` : images stockées par empreinte (`userData/assets/<sha256>.<ext>`), servies par le protocole `notionix-asset://file/<nom>` (nom validé, jamais de chemin libre). Les importeurs reçoivent l'`AssetStore`.
- Blocs ajoutés en phase 2 dans `editorExtensions.ts` : Image, TableKit, Details (toggle), `callout.ts`. Vues interactives côté renderer seulement (`CalloutView.tsx`), poignée de blocs maison (`blockHandle.ts`, sans Yjs).
- `src/main/ipc.ts` + `src/preload/index.ts` : canaux `pages:*` et `transfer:*` (dialogues natifs côté main), sandbox + contextIsolation.
- `src/renderer/src/` : `store.ts` (Zustand), `components/`, `editor/` (TipTap + menu `/`).
- Persistance : `node:sqlite` (pas de module natif). Tests unitaires sous Node 24 (`.nvmrc`), e2e Electron dans `tests/e2e/smoke.mjs`.

## Branding

Logos générés par `scripts/build-logos.py` depuis `branding/notionix-brand-sheet.png` ; ne pas éditer à la main les PNG de `src/renderer/src/assets/logo-*` ni `build/icon.*`. Composant `components/Logo.tsx` (`<picture>` clair/sombre).

## Conventions

- Ajouter une migration = nouvelle entrée dans `MIGRATIONS` ; ne jamais modifier les anciennes.
- Toute écriture incrémente `version` et `updated_at` (prépare la sync).
- Vérifier avant commit : `npm run typecheck && npm run lint && npm test && npm run test:e2e` (l'e2e attrape les problèmes de bundling main que vitest ne voit pas).
- Pages importées : colonne `source` unique (`notion:<id>`, `notion-folder:<chemin>`) ; ne jamais écraser une page déjà importée.
- Commits de ce repo : auteur `bouzoubad` (config git locale), sans ligne Co-Authored-By.
