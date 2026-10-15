# Installer le serveur Notionix

Le serveur Notionix permet de travailler à plusieurs depuis un navigateur : comptes et rôles, édition simultanée en temps réel (Yjs / Hocuspocus), images partagées, import Notion et export Markdown. Un seul conteneur sert l'application web, l'API et la synchronisation, sur un seul port.

Deux façons de l'exposer :

- **Phase de test** : le conteneur est joignable directement sur le réseau local, en HTTP (`http://<serveur>:8080`). Simple, mais rien n'est chiffré : à réserver à un réseau de confiance et à des données de test.
- **Production** : IIS (ou un autre proxy) reçoit le HTTPS avec le certificat de l'entreprise et relaie vers le conteneur, qui n'écoute plus que sur la machine elle-même.

```
Phase de test :  Navigateurs ──HTTP / WS──▶ <serveur>:8080 conteneur Notionix ──▶ volume /data
Production :     Navigateurs ──HTTPS / WSS──▶ IIS (certificat) ──HTTP──▶ 127.0.0.1:8080 conteneur ──▶ volume /data
```

## 1. Prérequis

- Un moteur de conteneurs **Linux** : Docker Desktop (Windows avec WSL 2, ou macOS), ou Docker Engine sur Linux. L'image est une image Linux (`node:22-alpine`) ; les conteneurs Windows natifs ne la font pas tourner.
- Une copie de ce dépôt sur la machine (pour construire l'image), ou l'image déjà construite (`docker save` / `docker load`).
- L'ordinateur serveur doit rester allumé et ne pas se mettre en veille pendant les heures de travail.

## 2. Phase de test sur le réseau local

1. Dans `server/docker-compose.yml`, remplacer l'e-mail et le mot de passe du premier administrateur (10 caractères minimum).
2. Depuis la racine du dépôt :

   ```
   docker compose -f server/docker-compose.yml up -d --build
   ```

3. Sur le serveur : `curl http://127.0.0.1:8080/api/health` répond `{"ok":true,...}`.
4. Trouver l'adresse IP du serveur (`ipconfig` sous Windows, `ipconfig getifaddr en0` sous macOS) et, depuis un autre poste, ouvrir `http://<adresse>:8080`.
5. Si la page ne s'ouvre pas depuis un autre poste : autoriser le port 8080 en entrée dans le pare-feu du serveur (Windows : _Pare-feu Windows Defender > Paramètres avancés > Règles de trafic entrant > Nouvelle règle > Port TCP 8080_, profil « Privé » ou « Domaine »). Une adresse IP fixe (réservation DHCP) ou un nom DNS interne évite de redonner l'adresse à chaque changement.
6. Se connecter avec le compte administrateur, puis retirer les deux lignes `NOTIONIX_ADMIN_*` du fichier compose (le compte reste).

**Reprendre les pages de l'app de bureau** (une seule fois, avant que l'équipe commence) : les deux bases ont le même format. App de bureau fermée, conteneur arrêté :

```
docker compose -f server/docker-compose.yml stop
docker compose -f server/docker-compose.yml cp "<dossier de l'app>/notionix.db" notionix:/data/workspace.db
docker compose -f server/docker-compose.yml cp "<dossier de l'app>/assets/." notionix:/data/assets/
docker compose -f server/docker-compose.yml start
```

Dossier de l'app : `~/Library/Application Support/Notionix` (macOS), `%APPDATA%\Notionix` (Windows) ; `notionix` en minuscules pour une version lancée en développement. Cela remplace tout l'espace partagé existant.

## 3. Comptes

En ligne de commande dans le conteneur (un écran d'administration dans l'app est prévu) :

```
docker compose -f server/docker-compose.yml exec notionix node main.mjs create-user marie@entreprise.local "Marie Dupont" editor
docker compose -f server/docker-compose.yml exec notionix node main.mjs reset-password marie@entreprise.local
docker compose -f server/docker-compose.yml exec notionix node main.mjs list-users
```

Ajouter `-it` après `exec` si le mot de passe n'est pas demandé. Rôles : `admin` (gère les comptes), `editor` (modifie), `reader` (lecture seule, imposée par le serveur).

Sécurité : mots de passe hachés (scrypt), session par jeton aléatoire dont seule l'empreinte est stockée, cookie `HttpOnly` et `SameSite=Strict` (marqué `Secure` derrière HTTPS), toute modification exige un en-tête propre au client web (une page d'un autre site ne peut pas agir à votre place), essais de mot de passe limités, sessions fermées à chaque changement de mot de passe, de rôle ou désactivation. Politique de sécurité stricte sur la page web (aucun script ou contenu d'un autre site).

## 4. Passer en HTTPS derrière IIS (production)

Prérequis IIS : **URL Rewrite**, **Application Request Routing (ARR)** et la fonctionnalité Windows **WebSocket Protocol** ; dans le Gestionnaire IIS, au niveau du serveur, _Application Request Routing Cache > Server Proxy Settings_ > cocher **Enable proxy**. Un certificat de l'entreprise pour le nom DNS choisi (ex. `notionix.entreprise.local`), reconnu par les postes du domaine.

1. Dans `server/docker-compose.yml`, remplacer la ligne de port par `- '127.0.0.1:8080:8080'`, puis `docker compose -f server/docker-compose.yml up -d`.
2. Créer un site IIS (ex. « Notionix ») avec une liaison **HTTPS 443** sur le nom DNS et le certificat ; pas de liaison HTTP, ou une redirection vers HTTPS.
3. Copier `docs/deploy/web.config` à la racine physique du site (un dossier vide suffit).
4. Depuis un poste : `https://notionix.entreprise.local`.

Le fichier `web.config` relaie tout vers le conteneur, y compris les connexions WebSocket de l'édition en temps réel, autorise des envois jusqu'à 50 Mo et active HSTS. Pour importer de gros exports Notion par IIS, augmenter `maxAllowedContentLength` dans ce fichier.

## 5. Sauvegardes

Toutes les données sont dans le volume `/data` : `workspace.db` (pages et bases), `notionix-server.db` (comptes, documents partagés) et le dossier `assets/` (images).

```
docker compose -f server/docker-compose.yml exec notionix node main.mjs backup /data/sauvegardes/2026-10-15
```

écrit une copie cohérente des deux bases sans arrêter le service ; copiez ensuite ce dossier et `assets/` vers votre stockage de sauvegarde (tâche planifiée).

## 6. Sans conteneur (dépannage)

Le serveur est un fichier JavaScript accompagné du client web : `npm ci && npm run build:server && npm run build:web` à la racine du dépôt produit `out/server/` (`main.mjs` et `web/`). Lancer `node out/server/main.mjs` avec Node.js 22.13 ou plus récent ; variables : `NOTIONIX_PORT` (8080), `NOTIONIX_HOST` (`127.0.0.1` par défaut, `0.0.0.0` pour le réseau), `NOTIONIX_DATA_DIR`, `NOTIONIX_WEB_DIR`, `NOTIONIX_SESSION_DAYS`. Il peut tourner comme service Windows (par exemple avec NSSM).
