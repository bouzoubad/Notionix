/** English texts of the desktop app linked to a server, keyed by their French source text. */
const dictionary: Record<string, string> = {
  'Hors ligne : vos pages privées et les pages déjà ouvertes ici restent modifiables (texte, titre, place, nouvelles pages) ; les bases et commentaires de l’équipe en lecture seule. Tout part sur le serveur au retour du réseau.':
    'Offline: your private pages and the pages already opened here can still be edited (text, title, place, new pages); the team’s databases and comments are read-only. Everything goes to the server when the network is back.',
  'Cette page n’est pas disponible hors ligne : ouvrez-la une fois connecté pour la garder sur cet ordinateur.':
    'This page is not available offline: open it once while connected to keep it on this computer.',
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
  'Toutes vos pages sont enregistrées sur le serveur, les privées visibles par vous seul ; l’app les garde aussi sur cet ordinateur pour travailler sans réseau.':
    'All your pages are saved on the server, private ones visible to you only; the app also keeps them on this computer to work without network.',
  'Cette page a été écrite sans réseau : elle sera envoyée sur le serveur au retour du réseau, vous pourrez la déplacer ensuite.':
    'This page was written without network: it will be sent to the server when the network is back, then you can move it.',
  // Messages of the main process, shown like the server's
  'Adresse invalide.': 'Invalid address.',
  'Lien invalide.': 'Invalid link.',
  'Réponse invalide du serveur.': 'Invalid answer from the server.',
  'Serveur injoignable : vous êtes hors ligne.': 'Server unreachable: you are offline.'
}
export default dictionary
