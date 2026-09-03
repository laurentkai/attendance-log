# Attendance Log

Attendance Log est une application d’administration mobile-first destinée au suivi des présences d’une école de navigation.

Elle couvre actuellement :

- la gestion et l’import CSV des élèves ;
- la gestion des classes et de leurs membres ;
- la planification des séances et le suivi des présences ;
- une prise de présence rapide, manuelle ou par QR élève ;
- l’affichage, le téléchargement et l’envoi du QR élève par e-mail ;
- une configuration SMTP générique ;
- le reporting et les exports Excel ;
- le chiffrement des secrets fournisseur ;
- les sauvegardes locales, S3/S3-compatible et Azure Blob ;
- la préparation et la restauration de sauvegardes depuis un fichier ou le cloud.

## Architecture

- Node.js 22 et Express fournissent l’application HTTP.
- PostgreSQL 17 est l’unique base de données persistante.
- L’interface est rendue côté serveur et utilise du HTML, du CSS et du JavaScript sans framework frontend.
- Docker Compose exécute les services `app` et `postgres` sur le VPS AWS Lightsail.
- Le conteneur `app` écoute en HTTP sur le port interne `3000`. En production, HTTPS doit être terminé par un reverse proxy externe.
- Le volume Docker `postgres_data` conserve les données PostgreSQL.
- Le volume Docker `app_secrets` conserve la clé de chiffrement lorsque la clé est stockée dans le fichier géré par l’application.

Les deux volumes nommés survivent aux reconstructions d’image, remplacements de conteneur, `docker compose up -d` et redémarrages normaux du VPS.

> **Attention — volumes persistants**
>
> Ne pas utiliser couramment :
>
> ```bash
> docker compose down -v
> ```
>
> L’option `-v` supprime les volumes Compose. Elle peut donc détruire la base PostgreSQL et la clé de chiffrement générée dans `app_secrets`. Pour appliquer une configuration ou une nouvelle image, utiliser normalement :
>
> ```bash
> docker compose up -d
> ```

## Prérequis sur le VPS

- Git ;
- Docker Engine ;
- le plugin Docker Compose (`docker compose`) ;
- un nom de domaine et un certificat HTTPS pour un accès distant ;
- nginx ou un reverse proxy équivalent si HTTPS n’est pas déjà fourni par l’infrastructure.

Node.js, npm, PostgreSQL et les outils PostgreSQL ne doivent pas être installés directement sur le VPS : ils sont inclus dans les images Docker.

L’accès caméra depuis un téléphone nécessite un contexte sécurisé. Hors `localhost`, la page de prise de présence QR doit donc être servie en HTTPS.

## Installation

### 1. Cloner le dépôt

```bash
git clone <repository-url>
cd attendance-log
```

### 2. Configurer l’environnement

```bash
cp .env.example .env
```

Modifier ensuite `.env` avec des valeurs propres à l’installation. Ne jamais committer ce fichier.

| Variable | Usage | Exigence |
| --- | --- | --- |
| `PORT` | Port publié par Docker Compose vers le port interne `3000` | Optionnelle, `3000` par défaut |
| `NODE_ENV` | Environnement Node.js | Utiliser `production` sur le VPS |
| `POSTGRES_DB` | Nom de la base PostgreSQL Compose | Important |
| `POSTGRES_USER` | Utilisateur PostgreSQL Compose | Important |
| `POSTGRES_PASSWORD` | Mot de passe PostgreSQL Compose | Requis en pratique ; utiliser une valeur forte |
| `DATABASE_URL` | Connexion PostgreSQL lors d’une exécution directe hors Compose | Présente pour ce cas ; Compose construit sa propre URL avec les trois variables PostgreSQL |
| `DATABASE_SSL` | Active la vérification TLS PostgreSQL hors Compose | Compose utilise `false` sur son réseau interne |
| `SESSION_SECRET` | Signature des sessions administrateur | Requis, au moins 32 caractères |
| `APP_ENCRYPTION_KEY` | Clé maître Base64 de 256 bits fournie par l’environnement | Optionnelle ; prioritaire sur le fichier persistant |
| `APP_ENCRYPTION_KEY_FILE` | Emplacement du fichier de clé pour une exécution hors Compose | Optionnelle ; Compose impose `/app-secrets/encryption.key` |
| `BACKUP_TIMEZONE` | Fuseau IANA utilisé par la planification des sauvegardes | Optionnelle, `Europe/Brussels` par défaut |
| `BACKUP_RESTORE_MAX_MB` | Taille maximale d’un fichier envoyé pour restauration | Optionnelle, `512` Mo par défaut |

En production, utiliser des valeurs distinctes et fortes pour `POSTGRES_PASSWORD` et `SESSION_SECRET`. Une valeur `APP_ENCRYPTION_KEY`, lorsqu’elle est fournie, doit être une clé aléatoire de 256 bits encodée en Base64.

### 3. Construire l’image

```bash
docker compose build
```

### 4. Appliquer les migrations

```bash
docker compose run --rm app npm run migrate
```

La commande de migration applique les migrations PostgreSQL absentes. Elle est conçue pour être relancée : les migrations déjà enregistrées dans `schema_migrations` ne sont pas réappliquées.

### 5. Créer le premier administrateur

```bash
docker compose run --rm \
  -e CREATE_ADMIN_NAME="Votre nom" \
  -e CREATE_ADMIN_EMAIL="admin@example.com" \
  -e CREATE_ADMIN_PASSWORD="VotreMotDePasseLongEtSolide" \
  app npm run create-admin
```

Les options `-e` transmettent ces valeurs uniquement au conteneur ponctuel créé par `docker compose run --rm`. Elles ne doivent pas être ajoutées à `.env` et ne constituent pas une configuration d’exécution permanente. La commande refuse une adresse e-mail déjà utilisée et exige un mot de passe d’au moins 12 caractères.

`npm run create-admin` peut être réutilisé ultérieurement de manière délibérée lorsqu’un amorçage administrateur est réellement nécessaire. En fonctionnement normal, les comptes et leurs rôles se gèrent depuis **Configuration > Utilisateurs** ; cette commande ne fait pas partie de la procédure de mise à jour.

### 6. Démarrer ou recréer l’application

```bash
docker compose up -d
```

### 7. Vérifier les services

```bash
docker compose ps
docker compose logs --tail=100
curl http://localhost:3000/health
```

Une réponse saine ressemble à :

```json
{"status":"ok","database":"connected"}
```

### 8. Se connecter

Ouvrir Attendance Log, puis utiliser l’adresse e-mail et le mot de passe fournis à l’étape 5.

## HTTPS et reverse proxy

Le dépôt ne fournit pas de configuration nginx. Sur le VPS, le reverse proxy doit transmettre le trafic HTTPS vers `http://127.0.0.1:3000` et fournir au minimum les en-têtes d’origine attendus par Express.

Exemple minimal de bloc `location` nginx à intégrer dans une configuration HTTPS gérée séparément :

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Avec `NODE_ENV=production`, Attendance Log fait confiance au premier reverse proxy et utilise des cookies de session sécurisés. Le proxy doit donc transmettre correctement `X-Forwarded-Proto` et présenter un certificat HTTPS valide.

## Clé de chiffrement et récupération

Attendance Log chiffre les mots de passe et credentials fournisseur récupérables avant leur stockage dans PostgreSQL.

Le chargement de la clé suit cet ordre :

1. `APP_ENCRYPTION_KEY`, si elle est définie ;
2. le fichier persistant indiqué par `APP_ENCRYPTION_KEY_FILE` ;
3. génération sécurisée de ce fichier lors d’une première installation sans clé existante.

Avec Docker Compose, le fichier se trouve dans `app_secrets` et n’est pas stocké dans PostgreSQL. Il reste disponible après un remplacement normal du conteneur.

Après la première connexion, ouvrir **Configuration > Sécurité**, puis utiliser **Exporter la clé**. Conserver ce fichier de récupération séparément des sauvegardes de base de données, dans un emplacement sécurisé.

Une sauvegarde restaurée sans la clé correspondante restitue les élèves, classes, séances, présences, rapports et autres données ordinaires. En revanche, les credentials SMTP/S3/Azure chiffrés restent inutilisables jusqu’à l’import de la bonne clé de récupération ou leur reconfiguration.

## Mise à jour de l’application

Avant une mise à jour importante, vérifier qu’une sauvegarde récente existe dans **Configuration > Sauvegardes**. Si une destination cloud est configurée, l’action **Sauvegarder maintenant** crée une sauvegarde immédiate.

Séquence recommandée :

```bash
git pull
docker compose build
docker compose run --rm app npm run migrate
docker compose up -d
```

La migration doit être exécutée **après** `docker compose build` afin d’utiliser la nouvelle image, qui contient les nouveaux fichiers de migration.

La commande :

```bash
docker compose run --rm app npm run migrate
```

applique le schéma, mais ne remplace pas les conteneurs actifs. La commande `docker compose up -d` reste nécessaire pour démarrer ou recréer l’application avec la nouvelle image.

Contrôler ensuite :

```bash
docker compose ps
docker compose logs --tail=100
curl http://localhost:3000/health
```

## Redémarrage et reconstruction

Redémarrer les conteneurs existants sans reconstruire l’image :

```bash
docker compose restart
```

Redémarrer uniquement l’application :

```bash
docker compose restart app
```

Après un changement de code ou de dépendances :

```bash
docker compose build
docker compose run --rm app npm run migrate
docker compose up -d
```

Un simple `restart` ne reconstruit pas l’image et n’applique pas de nouvelles migrations.

## Logs et état des services

Logs de l’application :

```bash
docker compose logs -f app
```

Logs PostgreSQL :

```bash
docker compose logs -f postgres
```

Dernières lignes de tous les services :

```bash
docker compose logs --tail=100
```

État des conteneurs :

```bash
docker compose ps
```

Arrêter temporairement les services sans supprimer les volumes :

```bash
docker compose stop
```

Les relancer :

```bash
docker compose up -d
```

## Migrations PostgreSQL

La commande normale est :

```bash
docker compose run --rm app npm run migrate
```

L’utiliser :

- lors de la première installation ;
- après avoir récupéré et construit une version contenant de nouvelles migrations ;
- pour vérifier que le schéma est à jour.

Le système crée `schema_migrations`, prend un verrou PostgreSQL pendant l’exécution et enregistre chaque migration appliquée. Ne pas modifier manuellement cette table ni les migrations déjà déployées dans le cadre des opérations courantes.

## Sauvegardes

La page **Configuration > Sauvegardes** propose :

- **Télécharger une sauvegarde** : crée immédiatement une archive locale ;
- une destination S3/S3-compatible ou Azure Blob Storage ;
- **Tester la destination** ;
- **Sauvegarder maintenant** vers la destination configurée ;
- une planification quotidienne ou hebdomadaire avec heure et rétention ;
- l’historique des exécutions et leurs erreurs normalisées.

La planification est gérée par Attendance Log. Aucun cron VPS ne doit être ajouté. Régler `BACKUP_TIMEZONE` avec le fuseau IANA opérationnel du site.

Une archive contient exactement :

```text
database.dump
manifest.json
```

`database.dump` est une sauvegarde logique PostgreSQL au format personnalisé. Le manifeste contient uniquement des métadonnées non sensibles, dont l’identifiant de la clé de chiffrement. La clé brute, `.env`, les secrets du système de fichiers et les sessions administrateur ne sont pas inclus.

Les credentials fournisseur présents dans PostgreSQL restent chiffrés dans le dump. L’archive ZIP elle-même n’est pas chiffrée par Attendance Log : conserver les téléchargements locaux dans un emplacement sûr et activer la protection au repos proposée par le fournisseur cloud.

## Restauration V1

La restauration actuelle se trouve dans **Configuration > Sauvegardes > Restaurer une sauvegarde**. Elle prend en charge :

- l’envoi d’une archive ZIP locale ;
- la sélection d’une sauvegarde Attendance Log depuis la destination S3/Azure actuellement configurée ;
- l’inspection du manifeste avant toute modification ;
- l’avertissement en cas de clé de chiffrement différente ;
- une confirmation destructive explicite ;
- une sauvegarde de sécurité avant le remplacement d’une base contenant des données ;
- l’application automatique des migrations après restauration.

Pour une installation neuve avec une sauvegarde cloud :

1. installer et démarrer Attendance Log ;
2. créer puis utiliser le compte administrateur de la nouvelle installation ;
3. configurer les credentials S3/Azure actuels dans **Configuration > Sauvegardes** ;
4. utiliser **Tester la destination** ;
5. ouvrir **Restaurer une sauvegarde**, sélectionner la sauvegarde cloud et l’inspecter ;
6. vérifier les fingerprints de clé et confirmer la restauration ;
7. attendre le redémarrage automatique de l’application, puis se reconnecter.

La restauration est également possible avec une clé différente. Les données métier sont restaurées et les ciphertexts fournisseur sont conservés. Ouvrir ensuite **Configuration > Sécurité** pour importer la clé de récupération correspondante, ou reconfigurer les connexions externes.

Une sauvegarde provenant d’une migration plus récente que l’application est refusée. Mettre d’abord Attendance Log à jour, exécuter ses migrations, puis recommencer l’inspection.

La restauration V1 remplace toute la base ; elle ne fusionne pas les données et ne restaure pas des élèves ou séances individuellement. Avant un premier usage en production, tester le parcours complet avec une copie récente de la sauvegarde et de la clé de récupération dans un environnement isolé.

## Configuration SMTP et QR par e-mail

La page **Configuration > E-mail** accepte une configuration SMTP générique : STARTTLS, TLS implicite ou relais non chiffré sans authentification. Une connexion SMTP authentifiée non chiffrée est refusée.

Le mot de passe SMTP est chiffré dans PostgreSQL et n’est jamais réaffiché dans le formulaire. Utiliser **Envoyer un e-mail de test** avant l’envoi des QR élèves.

Depuis la fiche QR d’un élève, **Envoyer le QR** transmet le QR personnel existant à l’adresse enregistrée de l’élève, avec une version intégrée et une pièce jointe PNG.

## Contrôles après déploiement

Après une installation ou une mise à jour :

1. vérifier `docker compose ps` ;
2. vérifier `/health` ;
3. ouvrir la page de connexion ;
4. contrôler **Configuration > Sécurité** ;
5. vérifier la configuration SMTP si elle est utilisée ;
6. vérifier la destination et l’historique des sauvegardes ;
7. depuis un téléphone en HTTPS, tester la prise de présence manuelle et l’accès caméra QR.

## Dépannage rapide

### Le conteneur `app` redémarre en boucle

Consulter :

```bash
docker compose logs --tail=100 app
```

Vérifier en priorité les variables requises dans `.env`, notamment `SESSION_SECRET` et les paramètres PostgreSQL. Vérifier également que les migrations ont été appliquées et qu’au moins un compte administrateur actif existe dans `admin_users`.

### Une migration manque

Reconstruire d’abord l’image, puis relancer :

```bash
docker compose build
docker compose run --rm app npm run migrate
docker compose up -d
```

### La clé ne correspond pas aux secrets restaurés

Les fonctions métier restent disponibles. Ouvrir **Configuration > Sécurité** et importer la clé exportée avec la sauvegarde concernée. Sans cette clé, reconfigurer les credentials SMTP/S3/Azure.

### La caméra QR ne démarre pas sur un téléphone

Vérifier que l’application est ouverte en HTTPS, que le navigateur dispose de l’autorisation caméra et qu’aucune autre application ne monopolise la caméra. La prise de présence manuelle reste disponible.

### Une sauvegarde planifiée ne s’exécute pas

Vérifier `BACKUP_TIMEZONE`, l’état de la planification, **Tester la destination**, puis l’historique dans **Configuration > Sauvegardes** et les logs `app`.

## Règles d’exploitation essentielles

- Ne jamais committer `.env`, une clé de récupération ou des credentials réels.
- Exporter et conserver la clé de récupération séparément des sauvegardes PostgreSQL.
- Vérifier régulièrement qu’une sauvegarde cloud récente a réussi.
- Tester périodiquement une restauration dans un environnement isolé.
- Ne pas utiliser `docker compose down -v` sauf si la destruction des données et de la clé est explicitement voulue.
