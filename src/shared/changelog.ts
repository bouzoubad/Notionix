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
    id: '2026-11-06-favoris-prive-hors-ligne',
    date: '2026-11-06',
    title:
      'Favoris personnels, pages privées toujours visibles, barre latérale réglable, toutes les pages hors ligne',
    summary:
      'Vos favoris et pages privées restent dans la barre latérale quel que soit l’espace ouvert ; une étoile ajoute un favori ; la barre latérale s’élargit ou se masque ; l’app de bureau garde toutes les pages sur le Mac et s’ouvre tout de suite sans VPN.',
    desktop: '1.5.0',
    body: `**Pour qui :** tout le monde (merci Solenne pour vos retours).

## Vos pages privées ne disparaissent plus

La section **Privé** ne montrait que les pages privées de l'espace ouvert : en passant sur **Innovation** ou **PrediSurge Wiki**, vos pages privées de l'Espace principal semblaient avoir disparu. Elles étaient toujours là. Désormais, **Privé** montre vos pages privées de **tous les espaces**, où que vous soyez ; un clic ouvre la page dans son espace.

## Favoris

- Une **étoile ☆** en haut à droite de chaque page l'ajoute à vos **Favoris** (★ : cliquez à nouveau pour la retirer). Le menu **⋯** d'une page le permet aussi.
- Vos favoris sont **à vous seul** : les autres ne les voient pas. Les personnes en lecture seule peuvent aussi en avoir.
- Comme les pages privées, les favoris de tous les espaces sont dans la section **Favoris**, en haut de la barre latérale.

## Barre latérale plus large, plus étroite ou masquée

- **Glissez son bord droit** pour l'élargir (et lire les titres en entier) ou la rétrécir ; un double-clic sur le bord lui rend sa largeur d'origine.
- Le bouton **«** en haut de la barre latérale la masque (ou **Cmd** + **\\\\**) ; le bouton **»** en haut à gauche la fait revenir.
- La largeur et l'état masqué sont gardés sur votre appareil.

## App de bureau : toutes les pages, même sans réseau

Sans le VPN, l'app restait sur un écran noir ou vide pendant de longues minutes : chaque demande au serveur attendait qu'il réponde. Maintenant :

- l'app s'ouvre **tout de suite**, avec ce qu'elle a gardé, dans chaque espace (y compris en changeant d'espace hors ligne) ;
- elle garde sur le Mac **toutes les pages de tous vos espaces**, avec leurs images et fichiers (PDF, zip, vidéos…), et les tient à jour en arrière-plan : seules les pages modifiées sont téléchargées à nouveau. La première fois, comptez une dizaine de minutes et environ 700 Mo ;
- hors ligne, le texte des pages se modifie comme d'habitude (tout est fusionné au retour du réseau) ; les bases et les commentaires de l'équipe se lisent mais ne se modifient qu'en ligne ;
- en bas de la barre latérale, **« Synchronisé il y a … »** dit quand l'app a tout récupéré pour la dernière fois (ou combien de pages il reste) ; hors ligne, chaque page indique la date de sa copie.

**Comme OneDrive**, vous choisissez ce que le Mac garde : un clic sur « Synchronisé… » ouvre la fenêtre **Hors ligne**, où chaque espace est **gardé sur cet ordinateur** ou **en ligne uniquement** (avec la place utilisée) ; le menu **⋯** d'une page propose la même chose pour elle et ses sous-pages. « En ligne uniquement » libère la place sur le Mac. Vos pages privées, favoris et pages récentes restent toujours gardés.

Les copies sont dans le dossier de l'app sur le Mac (\`~/Library/Application Support/notionix\`) ; activez **FileVault** pour qu'elles soient chiffrées. Se déconnecter les efface.

**App de bureau :** ces changements arrivent avec la version 1.5.0, téléchargée toute seule ; cliquez **Redémarrer** quand le bouton apparaît en bas à droite.`
  },
  {
    id: '2026-11-04-onglets-icones',
    date: '2026-11-04',
    title: 'Onglets plus faciles à ouvrir, icônes à la bonne taille',
    summary:
      'Cmd-clic sur n’importe quel lien de page l’ouvre dans un nouvel onglet ; les icônes image et les émojis de l’équipe ne débordent plus dans les pages.',
    desktop: '1.4.1',
    body: `**Pour qui :** tout le monde (merci pour vos retours).

## Ouvrir une page dans un nouvel onglet

L'app de bureau a des **onglets**, comme Notion. La barre d'onglets apparaît dès que deux pages sont ouvertes. Pour ouvrir une page dans un nouvel onglet :

- **Cmd-clic** (ou clic du milieu) sur un lien de page dans le texte, une mention **@page**, un rétrolien ou une page de la barre latérale ;
- **Ouvrir dans un nouvel onglet**, dans le menu **⋯** d'une page de la barre latérale ;
- **Cmd T** ouvre un onglet vide, **Cmd W** le ferme, **Ctrl Tab** passe au suivant.

Dans le navigateur, les mêmes gestes ouvrent un onglet du navigateur.

## Icônes et émojis à la bonne taille

Une page dont l'icône est une image haute ou large (par exemple « Stents ») l'affichait en grand dans les liens vers elle. Les icônes image et les émojis de l'équipe gardent maintenant la taille d'une lettre, en entier.

**App de bureau :** ces changements arrivent avec la version 1.4.1, téléchargée toute seule ; cliquez **Redémarrer** quand le bouton apparaît en bas à droite.`
  },
  {
    id: '2026-11-04-app-1-4-0',
    date: '2026-11-04',
    title: 'App de bureau 1.4.0 : les espaces dans la barre latérale',
    summary:
      'L’app de bureau montre elle aussi chaque espace (PrediSurge Wiki, Innovation…) comme une section de la barre latérale.',
    desktop: '1.4.0',
    body: `**Pour qui :** les personnes qui utilisent l'app de bureau.

La version 1.4.0 de l'app reprend la présentation du navigateur : chaque espace est une **section de la barre latérale**, comme les espaces d'équipe de Notion. La flèche **▸** déplie un espace ; un clic sur une page ou sur le nom de l'espace l'ouvre.

**Mise à jour :** l'app la télécharge toute seule ; quand le bouton **Redémarrer** apparaît en bas à droite, cliquez-le. Rien à réinstaller.`
  },
  {
    id: '2026-11-04-notion-espaces',
    date: '2026-11-04',
    title: 'Vos pages Notion sont arrivées : PrediSurge Wiki et Innovation',
    summary:
      'Les espaces d’équipe PrediSurge Wiki et Innovation de Notion sont dans Notionix, avec leurs icônes, logos, bases et fichiers. Chaque espace est une section de la barre latérale.',
    body: `**Pour qui :** tout le monde.

## Deux espaces d'équipe venus de Notion

**PrediSurge Wiki** et **Innovation** ont été repris de Notion, tels qu'ils étaient le 4 novembre :

- toutes leurs pages et sous-pages, avec leurs **icônes et logos** (les pictogrammes de Notion sont remplacés par des pictogrammes équivalents, dans la même couleur) et leurs **couvertures** ;
- les **bases de données** avec leurs vues (tableau, liste, galerie, board), filtres, tris, statuts, personnes et relations ;
- les **images et fichiers** joints (un fichier d'un type que Notionix ne garde pas tel quel est rangé dans un .zip) ;
- les **liens et mentions** entre pages, les **équations**, tableaux, colonnes et blocs de code ;
- les **émojis personnalisés** de Notion, devenus des émojis de l'équipe (**:nom**) ;
- les auteurs et les dates de chaque page.

Les autres espaces de Notion (Général, SMSI, Application, Solution) n'ont pas encore été repris. Un lien vers une de leurs pages s'ouvrira quand ils le seront. Les blocs Google Drive, les blocs IA et les boutons de Notion ne sont pas lisibles par l'API de Notion : ils manquent.

## Les espaces dans la barre latérale

Comme les espaces d'équipe de Notion, chaque espace est maintenant une **section de la barre latérale** :

- la flèche **▸** déplie un espace et montre ses pages ;
- un clic sur une page, ou sur le nom de l'espace, l'ouvre ;
- l'espace ouvert est en gras, avec ses pages comme avant ; la section **Privé** reste en dessous.

Dans l'app de bureau, cette présentation arrive avec la version 1.4.0 (mise à jour automatique) ; d'ici là, le menu en haut de la barre latérale reste disponible.

## Comptes

Les personnes de PrediSurge citées dans Notion qui n'avaient pas encore de compte en ont un, **désactivé** : leur nom reste sur les pages qu'elles ont écrites. Un administrateur peut les activer (lien d'activation transmis par Keeper).`
  },
  {
    id: '2026-11-03-emojis-equipe-icones',
    date: '2026-11-03',
    title: 'Émojis de l’équipe, couleurs de peau et icônes',
    summary:
      'Ajoutez les émojis de l’équipe, choisissez la couleur de peau des émojis, et donnez à une page une icône (pictogramme) en couleur.',
    desktop: '1.3.0',
    body: `**Pour qui :** tout le monde.

## Émojis de l'équipe

Dans le sélecteur d'émojis (**/emoji**, ou l'icône d'une page), la section **Équipe** rassemble les émojis ajoutés par l'équipe : un logo, une mascotte, un « bravo » maison…

- **+** pour en ajouter un : un nom (lettres minuscules, chiffres, « _ » ou « - ») et une image.
- Ils s'utilisent comme les autres : **:nom** dans le texte, ou comme icône de page.
- Leur auteur ou un administrateur peut en supprimer un (la croix au survol).

## Couleur de peau

Le bouton **✋** à côté de la recherche choisit la couleur de peau des émojis qui en ont une (mains, personnes). Le choix est gardé sur l'appareil et vaut aussi pour **:nom**.

## Icônes de page

Le sélecteur d'icône d'une page a un onglet **Icônes** : plus de 1 600 pictogrammes sobres, dans la couleur de votre choix (les plus utiles d'abord, la recherche se fait en anglais : *calendar*, *rocket*…).

## Corrigé

- **Feedback** : « Tous les retours (N) » ne compte plus les retours terminés ou refusés.
- Le sélecteur d'icône ne se ferme plus quand la souris en sort : il se ferme d'un clic à côté ou avec Échap.`
  },
  {
    id: '2026-11-03-emojis-transformer-plan',
    date: '2026-11-03',
    title: 'Émojis, « Transformer en » et plan de la page',
    summary:
      'Émojis avec « : » et /emoji, « Transformer en » depuis une sélection, plan de la page sur le côté (comme Notion), et la touche Entrée corrigée.',
    desktop: '1.3.0',
    body: `**Pour qui :** tout le monde (merci Yohan et Solenne pour vos retours).

## Émojis

- Tapez **« : » suivi d'un nom** : \\:coeur, :fusée, :rire, ou en anglais :heart, :rocket, :thumbsup. Choisissez avec les flèches et **Entrée**.
- Ou **/emoji** : un sélecteur avec une recherche (en français ou en anglais), vos émojis récents et toutes les catégories.
- L'icône d'une page se choisit avec le même sélecteur (cliquez sur l'icône).
- Les deux-points d'une phrase ou d'une heure (« Note : », « 10:30 ») restent du texte.

## « Transformer en » depuis une sélection

Sélectionnez un mot (un double-clic suffit) : le premier bouton de la barre qui apparaît indique le type de la ligne (**Texte ▾**) et la transforme en titre, liste, tâche, toggle, citation, callout, code ou **équation**. **Équation dans le texte** fait de la sélection une formule.

## Plan de la page

Sur une page qui a au moins deux titres, de petits traits apparaissent sur le bord droit, un par titre, celui de la section lue en plus foncé. Au survol, ils s'ouvrent en plan cliquable, comme dans Notion.

## Corrigé

- **Entrée ne faisait rien** sur une ligne contenant « [[ » suivi d'un espace (c'est le cas de la page « Bien démarrer ») : la ligne se coupe maintenant normalement.
- **Retour sans titre** : « Envoyer » explique qu'il faut un titre au lieu de rester grisé.

## Pour les administrateurs

Dans **Comptes de l'équipe**, l'étiquette de l'app de bureau indique où en est sa mise à jour : *téléchargement*, *prête, attend un redémarrage* ou *échec*. L'app vérifie maintenant les mises à jour toutes les heures et quand on revient sur sa fenêtre.`
  },
  {
    id: '2026-11-03-activite-et-versions',
    date: '2026-11-03',
    title: 'Administration : dernière activité et version utilisée par chacun',
    summary:
      'Le tableau de bord montre la dernière activité de chacun (et plus seulement sa connexion) ; Comptes de l’équipe montre la version de l’app ou le navigateur utilisé.',
    body: `**Pour qui :** les administrateurs.

## Dernière activité

Le tableau de bord affichait l'heure à laquelle chaque session avait été **ouverte**. Or l'app de bureau reste connectée pendant des semaines avec la même session : quelqu'un qui travaillait le matin même apparaissait encore à « hier ». La colonne s'appelle maintenant **Dernière activité** et suit l'utilisation réelle (à la minute près).

## Version utilisée

- **Tableau de bord** et **Comptes de l'équipe** montrent d'où chaque personne utilise Notionix : **App 1.1.5**, **Navigateur (Safari)**…
- Une app plus ancienne que celle proposée par le serveur est signalée **à mettre à jour** (en orange).
- Survolez une étiquette pour voir quand elle a servi pour la dernière fois.

L'activité est suivie à partir de cette mise à jour du serveur : avant, seules les heures de connexion étaient connues.`
  },
  {
    id: '2026-11-03-reponse-retours-accueil',
    date: '2026-11-03',
    title: 'Correctifs : répondre à un retour, écran d’accueil',
    summary:
      'Répondre à un retour (Feedback) confirme l’envoi et montre la réponse ; l’écran d’accueil retrouve des liens discrets.',
    desktop: '1.2.0',
    body: `**Pour qui :** les administrateurs (retours) et tout le monde (écran d'accueil).

## Répondre à un retour

Dans **Feedback des utilisateurs**, le bouton **Répondre** enregistrait bien la réponse et prévenait l'auteur, mais rien ne le montrait à l'écran. Maintenant :

- un message confirme l'envoi (« Réponse envoyée : … est prévenu·e dans sa boîte de réception ») ;
- la réponse envoyée s'affiche au-dessus du champ (« Votre réponse : … ») ;
- le bouton devient **Modifier la réponse** pour la corriger.

## Écran d'accueil

Les liens de la carte **Bien démarrer** (visite guidée, raccourcis…) s'affichaient comme de gros boutons bleus ; seul **Créer une page** garde ce style.`
  },
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
