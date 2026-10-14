# Notionix

Clone local de Notion, réimplémentation originale (ne jamais copier de code ou d'assets Notion). Voir README.md pour l'état et les TODO.

## Architecture

- `src/shared/types.ts` : contrat `NotionixApi` partagé main/preload/renderer.
- `src/main/db/` : `database.ts` (migrations via `PRAGMA user_version`), `pageRepository.ts` (toute la logique pages/arbre/corbeille/recherche), `text.ts` (texte pour FTS).
- `src/main/ipc.ts` + `src/preload/index.ts` : canaux `pages:*`, sandbox + contextIsolation.
- `src/renderer/src/` : `store.ts` (Zustand), `components/`, `editor/` (TipTap + menu `/`).
- Persistance : `node:sqlite` (pas de module natif). Tests unitaires sous Node 24 (`.nvmrc`), e2e Electron dans `tests/e2e/smoke.mjs`.

## Conventions

- Ajouter une migration = nouvelle entrée dans `MIGRATIONS` ; ne jamais modifier les anciennes.
- Toute écriture incrémente `version` et `updated_at` (prépare la sync).
- Vérifier avant commit : `npm run typecheck && npm run lint && npm test && npm run test:e2e`.
