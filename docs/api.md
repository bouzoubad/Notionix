# API du serveur Notionix

Le serveur Notionix expose les mêmes opérations que l'application, pour des scripts et des intégrations (import d'un tableur, création de pages depuis un autre outil, etc.).

## Authentification

Chacun crée ses jetons dans l'application : _Mon compte > Jetons d'API_. Un jeton agit avec les droits de son propriétaire (pages privées, partages, rôle) ; il est révocable à tout moment et sa dernière utilisation est affichée.

```
Authorization: Bearer nxk_…
```

Les jetons ne sont stockés que sous forme d'empreinte : copiez-le à sa création, il n'est plus affiché ensuite.

## Opérations

Toutes les opérations passent par un seul point d'entrée :

```
POST /api/rpc
Content-Type: application/json

{ "method": "pages.list", "args": [] }
```

Réponse : `{ "result": … }`, ou `{ "error": "…" }` avec un code HTTP 400 (argument invalide, page introuvable), 401 (jeton invalide) ou 403 (droits insuffisants).

| Méthode                                                                                   | Arguments                                                    | Résultat                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `pages.list`                                                                              | —                                                            | pages visibles (titre, icône, parent, droits…)                         |
| `pages.get`                                                                               | `id`                                                         | page avec son contenu (JSON ProseMirror)                               |
| `pages.create`                                                                            | `parentId \| null`, `access?` (`workspace`, `restricted`)    | nouvelle page                                                          |
| `pages.createWith`                                                                        | `parentId \| null`, `{ title?, icon?, content?, access? }`   | nouvelle page avec son contenu                                         |
| `pages.update`                                                                            | `id`, `{ title?, icon?, cover?, favorite?, options? }`       | page mise à jour                                                       |
| `pages.move`                                                                              | `id`, `parentId \| null`, `index`                            | —                                                                      |
| `pages.trash`, `pages.restore`, `pages.deleteForever`                                     | `id`                                                         | —                                                                      |
| `pages.duplicate`                                                                         | `id`                                                         | copie                                                                  |
| `pages.search`                                                                            | `texte`                                                      | résultats                                                              |
| `pages.setAccess`                                                                         | `id`, `inherit \| workspace \| restricted`                   | page                                                                   |
| `pages.shares`, `pages.setShare`                                                          | `id` (, `userId`, `read \| comment \| edit \| full \| null`) | partages                                                               |
| `pages.publish`                                                                           | `id`, `true \| false`                                        | page (avec `publicToken`)                                              |
| `pages.versions`, `pages.version`, `pages.restoreVersion`                                 | `id` / `versionId`                                           | historique                                                             |
| `pages.backlinks`                                                                         | `id`                                                         | pages qui y renvoient                                                  |
| `people.list`                                                                             | —                                                            | personnes de l'espace                                                  |
| `databases.create`                                                                        | `parentId \| null`                                           | base                                                                   |
| `databases.get`                                                                           | `id`                                                         | schéma et lignes (formules et rollups calculés)                        |
| `databases.updateSchema`                                                                  | `id`, `schema`, `base?`                                      | schéma (fusionné avec les changements des autres si `base` est fourni) |
| `databases.createRow`                                                                     | `id`, `{ title?, properties?, templateId? }`                 | ligne                                                                  |
| `databases.updateRow`                                                                     | `rowId`, `{ <propriété>: valeur, title? }`                   | ligne                                                                  |
| `databases.linkRelation`, `databases.enableNesting`                                       | `id`, `propertyId` / `subItems \| dependencies`              | schéma                                                                 |
| `comments.list`, `comments.add`, `comments.update`, `comments.remove`, `comments.resolve` | voir l'app                                                   | commentaires                                                           |
| `inbox.list`, `inbox.markRead`, `inbox.activity`                                          | — / `ids \| null`                                            | notifications, activité                                                |

Le contenu d'une page existante se modifie par l'édition en temps réel (document partagé) ; l'API le fixe seulement à la création (`pages.createWith`), où il est vérifié contre le schéma de l'éditeur.

## Exemple

```sh
TOKEN=nxk_…
curl -s https://notionix.entreprise.local/api/rpc \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"method":"databases.createRow","args":["<id de la base>",{"title":"Nouvelle demande"}]}'
```

## Autres points d'entrée

- `GET /api/transfer/export?page=<id>&format=markdown|html` : export (fichier ou archive .zip).
- `POST /api/transfer/import` (corps : le .zip d'un export Notion) : import.
- `POST /api/assets?name=<nom>&file=1` (corps : le fichier) : stocke une image ou un fichier, renvoie `{ "src" }` à placer dans une page.
- `GET /api/public/<lien>` : une page publiée, sans authentification.
