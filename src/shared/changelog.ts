/**
 * What changed for the people using Notionix, newest first. At start, the
 * server publishes each entry it has not published yet as a page under
 * « Nouveautés de Notionix » and notifies every account (inbox, and a banner
 * in the app). Add an entry for each deployment that changes what people see
 * or do; never change the `id` of an entry already deployed.
 */
export interface ReleaseNote {
  /** Stable and unique: 'AAAA-MM-JJ-sujet' */
  id: string
  /** AAAA-MM-JJ */
  date: string
  title: string
  /** One line, shown in the notification */
  summary: string
  /** The page (Markdown) */
  body: string
  /** Version of the desktop app these changes need, when it must be updated */
  desktop?: string
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    id: '2026-11-02-pages-privees-hors-ligne',
    date: '2026-11-02',
    title: 'Pages privées sur le serveur et travail hors ligne',
    summary:
      'Vos pages privées sont sauvegardées sur le serveur et restent utilisables sans réseau dans l’app de bureau 1.1.',
    desktop: '1.1.1',
    body: `**Pour qui :** tout le monde. Dans l'app de bureau, il faut passer à la **version 1.1** (voir plus bas).

## Ce qui change

- **Vos pages privées sont enregistrées sur le serveur**, visibles par vous seul. Elles sont sauvegardées avec le serveur et s'ouvrent aussi bien depuis le navigateur que depuis l'app de bureau, sur n'importe quel Mac.
- **L'app de bureau les garde aussi sur votre Mac**, avec vos favoris et vos pages récentes, pour travailler sans réseau. Elles sont remises à jour dès qu'elles changent.
- **Sans réseau, dans l'app de bureau :**
  - le texte des pages gardées sur le Mac se modifie normalement ;
  - renommer, changer l'icône, déplacer ou mettre à la corbeille une page s'affiche tout de suite et part sur le serveur au retour du réseau ;
  - une nouvelle page est écrite sur le Mac (badge « À envoyer »), puis envoyée automatiquement au retour du réseau avec ses sous-pages, ses images et ses bases, en page privée ou sous la page où vous l'avez créée.
- Les bases de données et les commentaires de l'équipe restent en lecture seule sans réseau.
- Les pages privées que vous aviez seulement sur votre Mac (version 1.0) partent sur le serveur au premier lancement de la version 1.1.

## Mettre à jour l'app de bureau

1. Téléchargez la version 1.1 : bandeau « Nouvelle version de l'app » dans l'app, lien « App de bureau (Mac) » de votre fiche Keeper, ou **Mon compte > Télécharger l'app** dans le navigateur.
2. Ouvrez le fichier téléchargé et glissez Notionix dans **Applications** (remplacez l'ancienne).
3. À la première ouverture, si macOS bloque l'app : **Réglages Système > Confidentialité et sécurité > Ouvrir quand même**.

Vos pages et votre connexion sont conservées.`
  }
]

/** Whether version `a` (x.y.z) is older than `b`. */
export function olderVersion(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0)
  }
  return false
}
