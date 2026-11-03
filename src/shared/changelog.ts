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
    id: '2026-11-03-apparence-code-rouge',
    date: '2026-11-03',
    title: 'Code en rouge et apparence personnalisable',
    summary:
      'Le code dans le texte s’affiche en rouge, comme dans Notion ; dans Paramètres > Apparence, choisissez un thème et la couleur de chaque élément.',
    desktop: '1.2.0',
    body: `**Pour qui :** tout le monde (merci Solenne pour l'idée).

## Le code en rouge

Ce qui est écrit comme du code dans une phrase (écrit entre deux accents graves) s'affiche maintenant **en rouge**, en mode clair comme en mode sombre, comme dans Notion : il se repère d'un coup d'œil.

## Paramètres > Apparence

- **Mode** : Système, Clair ou Sombre (le raccourci ⌘⇧L bascule toujours de l'un à l'autre).
- **Thème** : un jeu de couleurs complet pour les deux modes, comme dans les éditeurs de code : *Notionix* (par défaut), *Classique* (le code sans couleur, comme avant), *Contraste élevé*, *Sépia*, *Nord*, *Solarized*.
- **Couleurs** : la couleur de chaque élément (fond, texte, titres, liens, accent, code, blocs de code, citations), réglable pour le mode affiché, avec un aperçu. **Par défaut** rend la couleur du thème ; **Tout réinitialiser** revient à Notionix.
- Vos choix sont **enregistrés dans votre compte** : ils vous suivent dans le navigateur et dans l'app de bureau, sur tous vos appareils.

Dans l'app de bureau, il faut la **version 1.2** (elle s'installe toute seule). Sans compte (app non reliée), **Apparence** est en bas de la barre latérale.`
  },
  {
    id: '2026-11-03-captures-feedback-app',
    date: '2026-11-03',
    title: 'Correctif : captures d’écran des retours dans l’app de bureau',
    summary:
      'Dans l’app de bureau, les captures jointes aux retours (Feedback) s’affichent ; un clic les montre en grand.',
    desktop: '1.1.5',
    body: `**Pour qui :** les personnes qui utilisent l'app de bureau.

## Ce qui est corrigé

Dans la fenêtre **Feedback** de l'app de bureau, les captures d'écran jointes aux retours n'apparaissaient pas (image cassée). Elles s'affichent maintenant ; **un clic** sur une capture l'affiche en entier, un second la réduit.

## App de bureau

La version **1.1.5** s'installe toute seule (encart « Redémarrer »).`
  },
  {
    id: '2026-11-02-fenetres-app-de-bureau',
    date: '2026-11-02',
    title: 'Correctifs de l’app de bureau : page blanche et fenêtres',
    summary:
      'L’app de bureau ne devient plus blanche en ouvrant une page, et ses fenêtres Feedback, Mon compte et Administration retrouvent leur mise en page.',
    desktop: '1.1.4',
    body: `**Pour qui :** les personnes qui utilisent l'app de bureau.

## Ce qui est corrigé

- **Fenêtre blanche** : en ouvrant une page au moment où l'app la mettait de côté pour le hors ligne (ou une page qui venait d'être envoyée sur le serveur), toute la fenêtre pouvait devenir blanche jusqu'au redémarrage. C'est corrigé ; et si une page n'arrive pas à s'afficher, seule cette page affiche un message avec **Réessayer**, le reste de l'app reste utilisable.
- **Fenêtres Feedback, Mon compte et Administration** : dans l'app reliée au serveur, elles s'affichaient sans mise en page (champs et boutons bruts). Elles ont maintenant la même présentation que dans le navigateur.
- Les formules mathématiques s'affichent avec leurs vraies polices.

## App de bureau

La version **1.1.4** s'installe toute seule depuis la 1.1.2 (encart « Redémarrer »).`
  },
  {
    id: '2026-11-02-correctif-texte-en-double',
    date: '2026-11-02',
    title: 'Correctif : texte en double, et la liste des nouveautés',
    summary:
      'Une page jamais modifiée pouvait afficher son texte deux fois après passage par l’app de bureau ; c’est corrigé.',
    desktop: '1.1.3',
    body: `**Pour qui :** tout le monde.

## Ce qui est corrigé

- Une page **jamais modifiée** depuis sa création, ouverte dans l'app de bureau, pouvait ensuite afficher **son texte en double**, chez tout le monde. La cause est corrigée sur le serveur, et l'app de bureau oublie les copies faites par ses versions précédentes (elle les reprend aussitôt, propres).
- Si vous voyez encore un texte en double dans une page, supprimez simplement la partie répétée : elle ne reviendra plus.

## La page « Nouveautés de Notionix »

Elle liste maintenant toutes les nouveautés, de la plus récente à la plus ancienne : cliquez sur l'une d'elles pour l'ouvrir.

## App de bureau

La version **1.1.3** s'installe toute seule si vous avez déjà la 1.1.2 (encart « Redémarrer »). Sinon, installez-la comme d'habitude depuis **Mon compte > Télécharger l'app** ou le lien de votre fiche Keeper.`
  },
  {
    id: '2026-11-02-mise-a-jour-automatique',
    date: '2026-11-02',
    title: 'L’app de bureau se met à jour toute seule',
    summary:
      'À partir de la version 1.1.2, l’app de bureau télécharge ses mises à jour et vous propose de redémarrer pour les installer.',
    desktop: '1.1.2',
    body: `**Pour qui :** les personnes qui utilisent l'app de bureau sur Mac.

## Ce qui change

- L'app **vérifie toute seule** s'il existe une nouvelle version sur le serveur (au démarrage, puis toutes les 4 heures) et la **télécharge en arrière-plan**.
- Quand elle est prête, un encart propose **« Redémarrer »** pour l'installer. Si vous ne redémarrez pas, elle s'installe quand vous quittez l'app.
- Plus besoin de retélécharger l'app ni de repasser par **Confidentialité et sécurité** : macOS vérifie que la mise à jour est bien signée comme l'app installée.

## Une dernière installation à la main

La mise à jour automatique arrive avec la **version 1.1.2** : il faut l'installer une fois comme d'habitude (bandeau « Nouvelle version de l'app », lien « App de bureau (Mac) » de votre fiche Keeper, ou **Mon compte > Télécharger l'app** dans le navigateur), puis **Ouvrir quand même** dans **Réglages Système > Confidentialité et sécurité** si macOS le demande. Les versions suivantes s'installeront seules.`
  },
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
