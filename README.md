# TeamCal

Application web de gestion de planning d'équipe : calendriers multi-utilisateurs, événements et récurrences, permissions par calendrier, administration, thèmes clair/sombre, notifications e-mail iCalendar, en français, anglais et allemand.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Stack technique](#stack-technique)
- [Démarrage rapide (Docker)](#démarrage-rapide-docker)
- [Première connexion](#première-connexion)
- [Développement local](#développement-local)
- [Configuration](#configuration)
- [Permissions](#permissions)
- [E-mails et calendrier](#e-mails-et-calendrier)
- [Exploitation](#exploitation)
- [API](#api)
- [Tests](#tests)
- [Structure du projet](#structure-du-projet)
- [Choix et limites](#choix-et-limites)

## Fonctionnalités

- Authentification par identifiant/mot de passe, sessions serveur, cookie HttpOnly, protection CSRF et limitation des tentatives de connexion.
- Assistant de première installation : création du compte administrateur et des paramètres initiaux depuis l'interface web.
- Administration : utilisateurs (création, modification, désactivation, réinitialisation de mot de passe), catégories, paramètres généraux, champs d'événement activables, thèmes, SMTP.
- Calendriers personnels par utilisateur avec permissions déléguées (consulter / ajouter / modifier / supprimer).
- Vues jour, semaine et mois, numéros de semaine, premier jour de semaine, heures de travail, fuseau horaire et formats configurables.
- Glisser-déposer et redimensionnement des événements, avec confirmation occurrence/série pour les événements récurrents.
- Événements : titre, dates, journée entière, description (texte ou HTML assaini), lieu, URL, priorité, visibilité, catégorie, participants, récurrence.
- Récurrences quotidiennes, hebdomadaires, mensuelles et annuelles avec intervalle, jours de semaine, date de fin ou nombre d'occurrences ; exceptions et occurrences déplacées ou annulées.
- Vues personnalisées (personnelles ou partagées) sélectionnant des ressources.
- Préférences utilisateur : langue, fuseau horaire, formats, vue par défaut, thème.
- E-mails HTML de création, modification et annulation avec pièce jointe `invitation.ics` (REQUEST/CANCEL, UID stable, SEQUENCE).
- Déploiement Docker Compose, image GHCR versionnée, healthcheck, volume persistant.

## Stack technique

| Élément | Choix |
| --- | --- |
| Backend | Node.js 24, Express 4, TypeScript |
| Base de données | SQLite (`better-sqlite3`), mode WAL, migrations versionnées |
| Frontend | React 18, Vite, TypeScript, FullCalendar 6 |
| E-mails | Nodemailer + génération iCalendar interne |
| Déploiement | Dockerfile multi-étapes, `compose.yaml`, GitHub Actions, GHCR |

## Démarrage rapide (Docker)

L'image est publiée sur GitHub Container Registry :

```bash
docker pull ghcr.io/didier57/teamcal-app:latest
```

Créez un fichier `compose.yaml` (ou utilisez celui du dépôt) puis :

```bash
docker compose up -d
```

L'application est disponible sur `http://localhost:8080` (port modifiable avec `TEAMCAL_PORT`).

```yaml
services:
  teamcal:
    image: ghcr.io/didier57/teamcal-app:latest
    container_name: teamcal
    restart: unless-stopped
    ports:
      - "${TEAMCAL_PORT:-8080}:8080"
    environment:
      TZ: ${TZ:-Europe/Paris}
    volumes:
      - teamcal_data:/app/data

volumes:
  teamcal_data:
```

> Si le paquet GHCR est privé, connectez-vous d'abord : `echo $GITHUB_TOKEN | docker login ghcr.io -u <compte> --password-stdin`.

## Première connexion

Au premier démarrage, l'application affiche un assistant d'installation :

1. nom de l'application, URL publique, langue et fuseau par défaut ;
2. création du compte administrateur (identifiant, e-mail, mot de passe de 8 caractères minimum).

Une fois l'administration créée, l'assistant ne peut plus être rejoué. Les comptes suivants sont créés depuis **Administration → Utilisateurs**.

Aucune variable d'environnement ne contient de configuration métier : SMTP, langues, thèmes, catégories et permissions sont stockés en base et modifiables dans l'interface.

## Développement local

Prérequis : Node.js 24+ (ou 22+), npm 10+.

```bash
npm install
npm run dev
```

- Frontend Vite : http://localhost:5173 (proxy `/api` vers le backend)
- Backend Express : http://localhost:8080
- Base locale : `data/teamcal.sqlite`

Autres commandes :

```bash
npm run build      # build client + serveur
npm start          # démarre le serveur compilé
npm test           # tests API (Vitest + Supertest)
npm run typecheck  # vérification TypeScript des deux workspaces
```

## Configuration

Toute la configuration se fait dans **Administration** :

- **Paramètres** : nom, URL, langue/fuseau par défaut, format de date/heure, premier jour, week-end, heures de travail, vue par défaut, durée de session, champs d'événement, autorisation HTML, valeurs de priorité/visibilité.
- **Catégories** : nom et couleur utilisés dans le calendrier.
- **Permissions** : droits par calendrier pour chaque utilisateur.
- **SMTP** : serveur, port, TLS, authentification, expéditeur, test d'envoi.
- **Apparence** : couleurs des thèmes clair et sombre avec prévisualisation.

Variables d'environnement acceptées (uniquement l'infrastructure) :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `8080` | Port HTTP interne |
| `DATABASE_PATH` | `/app/data/teamcal.sqlite` | Fichier SQLite |
| `TZ` | `Europe/Paris` | Fuseau du processus |
| `NODE_ENV` | `production` | Environnement |

## Permissions

Le propriétaire d'un calendrier et les administrateurs disposent de tous les droits. Les autres utilisateurs reçoivent, calendrier par calendrier :

- **Consulter** : voir les événements ;
- **Ajouter** : créer un événement sur ce calendrier ;
- **Modifier** : modifier les événements du calendrier ;
- **Supprimer** : supprimer les événements du calendrier.

Le créateur d'un événement peut toujours le modifier et le supprimer. Un participant peut consulter l'événement auquel il est invité, même sans droit sur le calendrier. Toutes les vérifications sont effectuées côté serveur.

## E-mails et calendrier

À chaque création, modification ou suppression, un e-mail HTML est envoyé au propriétaire et aux participants (adresses dédupliquées). La pièce jointe `invitation.ics` contient :

- un UID stable par événement ;
- un numéro `SEQUENCE` incrémenté à chaque modification ;
- des dates UTC (ou dates pour les journées entières) ;
- la règle `RRULE` pour les séries ;
- `METHOD:REQUEST` ou `METHOD:CANCEL` selon l'opération.

Les échecs SMTP sont journalisés dans `email_log` sans annuler l'opération métier. Si SMTP n'est pas configuré, les envois sont marqués `skipped`.

## Exploitation

### Sauvegarde

Sauvegarde cohérente à chaud via l'API SQLite (WAL inclus) :

```bash
docker compose exec teamcal node -e "const D=require('/app/node_modules/better-sqlite3');const db=new D(process.env.DATABASE_PATH);db.backup('/app/data/teamcal-backup.sqlite').then(()=>{console.log('backup ok');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
docker compose cp teamcal:/app/data/teamcal-backup.sqlite ./teamcal-backup.sqlite
```

### Restauration

```bash
docker compose stop teamcal
docker compose cp ./teamcal-backup.sqlite teamcal:/app/data/teamcal.sqlite
docker compose start teamcal
```

### Mise à jour

```bash
docker compose pull
docker compose up -d
```

Les migrations de schéma sont appliquées automatiquement au démarrage. Les données restent dans le volume `teamcal_data`.

### Retour arrière

Déployez un tag précédent puis redémarrez :

```bash
TEAMCAL_VERSION=0.1.0 docker compose up -d
```

## API

Toutes les routes sont préfixées par `/api`. Authentification par cookie de session ; les mutations exigent l'en-tête `X-CSRF-Token` fourni par `/api/auth/me`.

| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/health` | État du service |
| GET | `/setup/status` | Indique si l'installation est requise |
| POST | `/setup` | Crée le premier administrateur |
| POST | `/auth/login` / `/auth/logout` | Connexion / déconnexion |
| GET | `/auth/me` | Session, jeton CSRF, paramètres publics |
| PUT | `/auth/me/preferences` | Préférences utilisateur |
| POST | `/auth/me/password` | Changement de mot de passe |
| GET/POST | `/users` | Liste / création d'utilisateurs |
| PATCH/DELETE | `/users/:id` | Modification / désactivation |
| POST | `/users/:id/password` | Réinitialisation par un administrateur |
| GET | `/settings/public` | Paramètres publics |
| GET/PUT | `/settings` | Paramètres d'administration |
| POST | `/settings/smtp/test` | Test SMTP |
| GET/POST | `/categories` | Catégories |
| PATCH/DELETE | `/categories/:id` | Modification / suppression |
| GET | `/calendars` | Calendriers accessibles |
| PUT | `/calendars/:id` | Nom / couleur |
| GET/PUT | `/calendars/:id/acl` | Permissions |
| GET | `/events?start=&end=&calendarIds=` | Occurrences sur une plage |
| POST | `/events` | Création |
| GET/PATCH/DELETE | `/events/:id` | Détail / modification / suppression |
| GET/POST | `/views` | Vues personnalisées |
| PATCH/DELETE | `/views/:id` | Modification / suppression |

Les événements récurrents sont étendus côté serveur. `scope=occurrence` avec `occurrenceStart` permet de modifier ou supprimer une occurrence sans toucher à la série.

## Tests

```bash
npm test
```

Les tests couvrent l'installation initiale, l'authentification, le CSRF, les ACL de calendrier, les contrôles de permissions, la validation des dates et l'expansion/modification/annulation d'occurrences récurrentes.

## Structure du projet

```text
TeamCal/
├── server/
│   └── src/
│       ├── db/            # schéma SQLite et migrations
│       ├── lib/           # auth, permissions, iCalendar, mailer, récurrence, temps
│       ├── modules/       # routes API (auth, users, settings, events, ...)
│       ├── app.ts         # application Express
│       └── index.ts       # démarrage
├── client/
│   └── src/
│       ├── components/    # calendrier, dialogues, administration
│       ├── pages/         # calendrier, connexion, installation, préférences
│       ├── i18n.tsx       # FR / EN / DE
│       └── styles.css     # thèmes clair et sombre
├── Dockerfile
├── compose.yaml
└── .github/workflows/     # CI et publication GHCR
```

## Choix et limites

- **FullCalendar gratuit** : les vues « ressources » timeline relèvent de FullCalendar Premium. TeamCal simule les ressources par des colonnes de calendriers synchronisées en vues jour et semaine ; la vue mois affiche une grille unique colorée par catégorie. Aucune licence Premium n'est requise.
- **SQLite** : adapté à une équipe (quelques dizaines d'utilisateurs). Le fichier est stocké dans un volume persistant et sauvegardable à chaud.
- **Récurrences** : expansion côté serveur avec gestion des exceptions ; les règles prennent en charge fréquence, intervalle, jours de semaine, `UNTIL` et `COUNT`.
- **Configuration** : volontairement en base plutôt qu'en variables d'environnement, pour être modifiable depuis l'interface et éviter les secrets dans les fichiers.
- **Points du cahier des charges encore ouverts** : charge cible, durée de conservation des journaux, conformité RGPD, politique de rétention des comptes/événements. Ces éléments peuvent être précisés dans une version ultérieure.
