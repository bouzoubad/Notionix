/** English texts of the desktop app linked to a server, keyed by their French source text. */
const dictionary: Record<string, string> = {
  'Hors ligne : vos pages privées et les pages d’équipe déjà ouvertes ici restent modifiables, le reste en lecture seule. Tout se synchronise au retour du réseau.':
    'Offline: your private pages and the team pages already opened here can still be edited; everything else is read-only. Everything syncs when the network is back.',
  'Cette page n’est pas disponible hors ligne : ouvrez-la une fois connecté pour la garder sur cet ordinateur.':
    'This page is not available offline: open it once while connected to keep it on this computer.',
  'Page privée gardée sur cet ordinateur : elle n’est jamais envoyée au serveur.':
    'Private page kept on this computer: it is never sent to the server.',
  'Sur cet ordinateur': 'On this computer',
  'Privé (cet ordinateur)': 'Private (this computer)',
  'Vos pages privées, gardées sur cet ordinateur et jamais envoyées au serveur.':
    'Your private pages, kept on this computer and never sent to the server.',
  'Privé sur le serveur': 'Private on the server',
  'Se reconnecter au serveur': 'Sign in to the server again',
  'Se connecter à un serveur': 'Connect to a server',
  'Une page ne peut pas encore passer de cet ordinateur au serveur, ni du serveur à cet ordinateur.':
    'A page cannot move from this computer to the server, or from the server to this computer, yet.',
  'Cet ordinateur ne reconnaît pas le certificat du serveur : installez le certificat de son autorité (notionix-ca.crt, fourni par le serveur), puis réessayez.':
    'This computer does not recognize the server’s certificate: install its authority’s certificate (notionix-ca.crt, provided by the server), then try again.',
  'Serveur injoignable : vérifiez l’adresse et le réseau.':
    'Server unreachable: check the address and the network.',
  'Se connecter à un serveur Notionix': 'Connect to a Notionix server',
  'Les pages de l’équipe sont sur le serveur. Vos pages privées restent sur cet ordinateur et n’y sont jamais envoyées.':
    'The team’s pages are on the server. Your private pages stay on this computer and are never sent to it.',
  'Votre session a pris fin : entrez à nouveau votre mot de passe.':
    'Your session has ended: enter your password again.',
  'Adresse du serveur': 'Server address',
  // Messages of the main process, shown like the server's
  'Adresse invalide.': 'Invalid address.',
  'Serveur injoignable : vous êtes hors ligne.': 'Server unreachable: you are offline.'
}
export default dictionary
