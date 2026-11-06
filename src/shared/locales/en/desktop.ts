/** English texts of the desktop app linked to a server, keyed by their French source text. */
const dictionary: Record<string, string> = {
  'Hors ligne : vos pages privées et les pages déjà ouvertes ici restent modifiables (texte, titre, place, nouvelles pages) ; les bases et commentaires de l’équipe en lecture seule. Tout part sur le serveur au retour du réseau.':
    'Offline: your private pages and the pages already opened here can still be edited (text, title, place, new pages); the team’s databases and comments are read-only. Everything goes to the server when the network is back.',
  'Cette page n’est pas gardée sur cet ordinateur : elle s’ouvrira au retour du réseau. Pour l’avoir hors ligne, choisissez « Garder sur cet ordinateur » dans son menu ⋯.':
    'This page is not kept on this computer: it will open when the network is back. To have it offline, choose « Keep on this computer » in its ⋯ menu.',
  'Se reconnecter au serveur': 'Sign in to the server again',
  'Se connecter à un serveur': 'Connect to a server',
  'Cet ordinateur ne reconnaît pas le certificat du serveur. Si c’est bien le serveur de votre équipe, demandez une version de l’app qui le connaît, ou installez le certificat de son autorité (notionix-ca.crt).':
    'This computer does not recognize the server’s certificate. If it is your team’s server, ask for a version of the app that knows it, or install its authority’s certificate (notionix-ca.crt).',
  'Nouveau compte : collez ici le lien d’activation reçu dans Keeper.':
    'New account: paste here the activation link received in Keeper.',
  'Serveur injoignable : vérifiez l’adresse et le réseau.':
    'Server unreachable: check the address and the network.',
  'Se connecter à un serveur Notionix': 'Connect to a Notionix server',
  'Votre session a pris fin : entrez à nouveau votre mot de passe.':
    'Your session has ended: enter your password again.',
  'Adresse du serveur': 'Server address',
  'Écrite sans réseau : elle sera envoyée sur le serveur, en page privée, au retour du réseau.':
    'Written without network: it will be sent to the server, as a private page, when the network is back.',
  'À envoyer': 'To send',
  'Nouvelle version de l’app de bureau : {version}.': 'New version of the desktop app: {version}.',
  'Nouvelle version de l’app ({version}) prête : redémarrez pour l’installer.':
    'New version of the app ({version}) ready: restart to install it.',
  Redémarrer: 'Restart',
  'Téléchargement de la version {version} de l’app… {percent} %':
    'Downloading version {version} of the app… {percent}%',
  'Toutes vos pages sont enregistrées sur le serveur, les privées visibles par vous seul ; l’app les garde aussi sur cet ordinateur pour travailler sans réseau.':
    'All your pages are saved on the server, private ones visible to you only; the app also keeps them on this computer to work without network.',
  'Cette page a été écrite sans réseau : elle sera envoyée sur le serveur au retour du réseau, vous pourrez la déplacer ensuite.':
    'This page was written without network: it will be sent to the server when the network is back, then you can move it.',
  // Messages of the main process, shown like the server's
  'Adresse invalide.': 'Invalid address.',
  'Lien invalide.': 'Invalid link.',
  'Réponse invalide du serveur.': 'Invalid answer from the server.',
  'Serveur injoignable : vous êtes hors ligne.': 'Server unreachable: you are offline.',
  'Hors ligne : les pages gardées sur cet ordinateur restent modifiables (texte, titre, place, nouvelles pages) ; les bases et commentaires de l’équipe en lecture seule. Tout part sur le serveur au retour du réseau.':
    'Offline: the pages kept on this computer can still be edited (text, title, place, new pages); the team’s databases and comments are read-only. Everything goes to the server when the network is back.',
  'le {date}': 'on {date}',
  'Hors ligne · synchronisé {since}': 'Offline · synced {since}',
  'Hors ligne · pas encore synchronisé': 'Offline · not synced yet',
  'Synchronisation… {done} / {total} pages': 'Syncing… {done} / {total} pages',
  'Synchronisé {since}': 'Synced {since}',
  'Synchronisation en attente': 'Sync pending',
  octets: 'bytes',
  Ko: 'KB',
  Mo: 'MB',
  Go: 'GB',
  'Pages gardées sur cet ordinateur pour travailler sans réseau':
    'Pages kept on this computer to work without network',
  'Choisi pour cette page et ses sous-pages': 'Chosen for this page and its sub-pages',
  'Comme la page parente': 'Like the parent page',
  'Comme son espace': 'Like its workspace',
  'Toujours gardée : page privée, favorite ou ouverte récemment':
    'Always kept: private, favorite or recently opened page',
  'Hors ligne': 'Offline',
  'Garder sur cet ordinateur': 'Keep on this computer',
  'En ligne uniquement': 'Online only',
  'Les pages gardées sur cet ordinateur s’ouvrent sans réseau : leur texte, leur titre et leur place s’y modifient ; les bases et commentaires de l’équipe s’y lisent. Tout part sur le serveur au retour du réseau.':
    'The pages kept on this computer open without network: their text, title and place can be edited; the team’s databases and comments can be read. Everything goes to the server when the network is back.',
  'Hors ligne : {name}': 'Offline: {name}',
  '{n} pages gardées · {size}': '{n} pages kept · {size}',
  '{n} pages réglées à part': '{n} pages set apart',
  'Vos pages privées, vos favoris et les pages ouvertes récemment sont toujours gardés. Les copies sont dans le dossier de l’app (Bibliothèque > Application Support > Notionix) et sont effacées à la déconnexion ; FileVault les protège si l’ordinateur est perdu.':
    'Your private pages, your favorites and the pages opened lately are always kept. The copies are in the app’s folder (Library > Application Support > Notionix) and are deleted when you sign out; FileVault protects them if the computer is lost.',
  'Synchroniser maintenant': 'Sync now',
  'Copie gardée sur cet ordinateur, synchronisée le {date}':
    'Copy kept on this computer, synced on {date}',
  'Copie du {date}': 'Copy of {date}'
}
export default dictionary
