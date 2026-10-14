# Installer le serveur Notionix (IIS + conteneur)

Le serveur Notionix permet de travailler à plusieurs : comptes et rôles, édition simultanée en temps réel (Yjs / Hocuspocus), images partagées. Il tourne dans un conteneur ; IIS reçoit le trafic HTTPS et le transmet au conteneur, qui n’est jamais exposé directement au réseau.

```
Postes Notionix ──HTTPS / WSS──▶ IIS (certificat de l’entreprise) ──HTTP──▶ 127.0.0.1:8080 conteneur Notionix ──▶ volume /data
```

## 1. Prérequis sur le serveur Windows

- Un moteur de conteneurs Linux (Docker Desktop avec WSL 2, ou Docker Engine/Mirantis selon votre politique).
- IIS avec : **URL Rewrite**, **Application Request Routing (ARR)**, et la fonctionnalité Windows **WebSocket Protocol** (Gestionnaire de serveur > Rôles > Serveur Web > Développement d’applications).
- Dans le Gestionnaire IIS, au niveau du serveur : *Application Request Routing Cache > Server Proxy Settings* > cocher **Enable proxy**.
- Un certificat HTTPS de l’entreprise pour le nom DNS choisi (ex. `notionix.entreprise.local`). Émis par l’autorité de certification interne, il est reconnu par les postes du domaine sans alerte.

## 2. Lancer le conteneur

Depuis une copie du dépôt sur le serveur :

```
docker compose -f server/docker-compose.yml up -d --build
```

Avant le premier lancement, mettez dans `server/docker-compose.yml` l’adresse et un mot de passe (10 caractères minimum) pour le premier administrateur, puis retirez ces deux lignes une fois le compte créé.

Vérification : `curl http://127.0.0.1:8080/api/health` doit répondre `{"ok":true,...}`.

Le port n’est publié que sur `127.0.0.1` : seul IIS, sur la même machine, y accède.

## 3. Site IIS

1. Créer un site (ex. « Notionix ») avec une liaison **HTTPS 443** sur le nom DNS et le certificat de l’entreprise ; pas de liaison HTTP, ou une redirection vers HTTPS.
2. Copier `docs/deploy/web.config` à la racine physique du site (un dossier vide suffit).
3. Redémarrer le site, puis depuis un poste : `https://notionix.entreprise.local/api/health`.

Le fichier `web.config` relaie tout vers le conteneur, y compris les connexions WebSocket de l’édition en temps réel, autorise des images jusqu’à 50 Mo et active HSTS.

## 4. Comptes

Les comptes se gèrent dans l’app (administrateur) ou en ligne de commande dans le conteneur :

```
docker compose -f server/docker-compose.yml exec notionix node main.js create-user marie@entreprise.local "Marie Dupont" editor
docker compose -f server/docker-compose.yml exec notionix node main.js reset-password marie@entreprise.local
docker compose -f server/docker-compose.yml exec notionix node main.js list-users
```

Rôles : `admin` (gère les comptes), `editor` (modifie), `reader` (lecture seule, imposée par le serveur).

Sécurité : mots de passe hachés (scrypt), sessions par jeton aléatoire dont seule l’empreinte est stockée, essais de mot de passe limités, sessions fermées à chaque changement de mot de passe, de rôle ou désactivation.

## 5. Sauvegardes

Toutes les données sont dans le volume `/data` : la base `notionix-server.db` et le dossier `assets/`.

```
docker compose -f server/docker-compose.yml exec notionix node main.js backup /data/sauvegarde.db
```

produit une copie cohérente de la base sans arrêter le service ; copiez-la ensuite avec le dossier `assets/` vers votre stockage de sauvegarde (tâche planifiée Windows).

## 6. Sans conteneur (dépannage)

Le serveur est un seul fichier JavaScript : `cd server && npm ci && npm run build`, puis `node dist/main.js` avec Node.js 22.5 ou plus récent (variables `NOTIONIX_PORT`, `NOTIONIX_HOST=127.0.0.1`, `NOTIONIX_DATA_DIR`). Il peut tourner comme service Windows (par exemple avec NSSM) derrière le même site IIS.
