# Guide d'utilisation de Parquet

Ton tableau de bord et ton encyclopédie NBA personnels, en français.

- **Matchs** : les scores de la journée qui se mettent à jour tout seuls pendant les matchs, et au réveil le résumé « Cette nuit en NBA ». Pour chaque match : score par quart-temps, scénario du match (l'écart au score minute par minute), duel des équipes, box score complet, fil des actions et carte des tirs. Les horaires sont à l'heure de Paris, et tu peux remonter dans le temps jour par jour.
- **Multi-matchs** : plusieurs matchs en direct côte à côte, en plein écran si tu veux, pour les grosses soirées.
- **Équipes** : les 30 franchises avec leur effectif, leur staff, leur calendrier (exportable dans ton agenda), leur histoire, leurs titres, les maillots retirés, leurs membres du Hall of Fame et leurs victoires saison par saison.
- **Joueurs** et **Comparateur** : tous les joueurs passés par la NBA depuis 1946, avec leur fiche (biographie, palmarès, parcours, records, statistiques de carrière par match, sur 36 minutes ou en totaux, stats avancées, derniers matchs) et un outil de comparaison face-à-face (duel statistique, palmarès comparé, graphiques de trajectoire saison par saison).
- **Classement**, **leaders** et **Playoffs** : classement par conférence, leaders statistiques et l'arbre complet des playoffs NBA (séries 1er tour, demi-finales, finales de conférence, Finales NBA et détail de chaque rencontre).
- Logos et photos officiels, thème sombre ou clair, équipes favorites mises en avant.

L'application tourne sur ton ordinateur et va chercher les données publiques de NBA.com et de Wikipédia. Rien n'est hébergé ailleurs, aucun compte n'est nécessaire.

## Installation

Il te faut **Python 3.9 ou plus récent** (gratuit) et une connexion Internet.

### Windows

1. Si Python n'est pas installé, télécharge-le sur [python.org/downloads](https://www.python.org/downloads/). Pendant l'installation, **coche la case « Add python.exe to PATH »**.
2. Décompresse le dossier `Parquet` où tu veux (par exemple dans *Documents*).
3. Double-clique sur **`lancer.bat`**.

### Mac

1. Si Python n'est pas installé, télécharge-le sur [python.org/downloads](https://www.python.org/downloads/) et installe-le.
2. Décompresse le dossier `Parquet` où tu veux.
3. Double-clique sur **`lancer.command`**. La première fois, macOS peut bloquer le fichier car il vient d'Internet : fais un clic droit dessus, choisis *Ouvrir*, puis confirme.

### Linux

Dans un terminal, depuis le dossier `Parquet` : `bash lancer.command` (le paquet `python3-venv` doit être installé).

Le premier lancement prépare un environnement Python dans le dossier (une minute environ). Ensuite, l'application s'ouvre dans ton navigateur à l'adresse `http://localhost:8765/`.

**Laisse la fenêtre noire ouverte** pendant que tu utilises Parquet ; la fermer arrête l'application.

Pour découvrir l'application sans connexion, ou si NBA.com ne répond pas chez toi, lance-la en **mode démo** : `.\lancer.bat --demo` (Windows) ou `bash lancer.command --demo` (Mac, Linux). Les équipes sont les vraies, mais les joueurs, les scores et les statistiques sont fictifs.

## Astuces

- Appuie sur `/` n'importe où pour chercher un joueur ou une équipe.
- Depuis la fiche d'un joueur, clique sur « Comparer ce joueur » pour lancer un face-à-face immédiat avec un rival.
- Ajoute tes équipes favorites (bouton en haut de leur page) : leurs matchs passent en premier.
- Clique sur la cloche dans la barre du haut pour activer les alertes : coup d'envoi et résultat de tes favoris, fins de match serrées (5 dernières minutes avec 5 points d'écart ou moins). Les alertes fonctionnent **tant qu'un onglet Parquet est ouvert**, même en arrière-plan ; une alerte n'est jamais envoyée deux fois.
- Le bouton en forme d'œil active le mode anti-spoiler, pour regarder un match en différé : les scores, le box score, le fil des actions, le résumé de la nuit, le champion des playoffs et le contenu des alertes restent masqués jusqu'à ce que tu cliques sur « Révéler ». Ce que tu as révélé le reste jusqu'à la fermeture de l'onglet.
- Quand des matchs sont en cours, le bouton « Mode multi-matchs » de la page d'accueil les affiche côte à côte.
- Dans l'onglet *Calendrier* d'une équipe, « Ajouter à mon agenda » télécharge un fichier `.ics` à importer dans Google Agenda, Apple Calendrier ou Outlook. Les horaires s'affichent à l'heure de ton agenda ; les scores n'y figurent pas.
- Le bouton en forme de lune ou de soleil change le thème.

### Sur ton téléphone

Par défaut, seul ton ordinateur peut ouvrir Parquet. Pour l'utiliser aussi sur ton téléphone :

1. **Sur l'ordinateur**, double-clique sur **`lancer-telephone.bat`** (Windows) ou **`lancer-telephone.command`** (Mac). La fenêtre noire affiche l'adresse à ouvrir sur le téléphone, du type `http://192.168.1.20:8765/`. Si Windows demande une autorisation du pare-feu, accepte pour les **réseaux privés** uniquement.
2. **Sur le téléphone**, connecté au même Wi-Fi que l'ordinateur, ouvre cette adresse dans Chrome (Android) ou Safari (iPhone).

N'utilise ce mode que sur le Wi-Fi de la maison : sur un réseau public, n'importe quel appareil connecté pourrait ouvrir ton Parquet.

#### Installer Parquet comme une application

- **Sur ordinateur (Chrome, Edge)** : clique sur l'icône d'installation dans la barre d'adresse. Parquet s'ouvre alors dans sa propre fenêtre.
- **Sur téléphone**, une limite des navigateurs s'applique : l'installation complète et les notifications ne sont autorisées que sur une connexion sécurisée (HTTPS), ce que n'est pas une adresse en `http://192.168.…`. Sans réglage, tu peux toujours ajouter un raccourci sur l'écran d'accueil (menu de Chrome, *Ajouter à l'écran d'accueil* ; sur iPhone, bouton Partager, *Sur l'écran d'accueil*), et les alertes s'affichent dans la page.

Pour avoir la vraie application et les notifications sur un téléphone Android, autorise l'adresse de ton ordinateur dans Chrome :

1. Ouvre `chrome://flags/#unsafely-treat-insecure-origin-as-secure` dans Chrome sur le téléphone.
2. Dans le champ, saisis l'adresse affichée par la fenêtre noire (par exemple `http://192.168.1.20:8765`), puis passe l'option sur *Enabled*.
3. Touche *Relaunch* pour relancer Chrome, rouvre Parquet, puis menu de Chrome, *Installer l'application*.

Le panneau des alertes (la cloche) rappelle ces étapes quand la connexion n'est pas sécurisée. Sur iPhone, ce réglage n'existe pas : il faudrait servir Parquet en HTTPS, par exemple avec [Tailscale](https://tailscale.com/kb/1153/enabling-https), ce qui sort du cadre de ce guide.

## Si quelque chose ne s'affiche pas

Ouvre **État des sources** (lien en bas de chaque page). Le test indique si NBA.com et Wikipédia répondent.

- NBA.com bloque certains réseaux : désactive un éventuel VPN ou proxy et réessaie.
- NBA.com limite parfois les requêtes trop rapprochées : attends quelques minutes.
- Quand NBA.com ne répond pas, Parquet affiche les dernières données gardées en mémoire et le signale par un bandeau.
- Pour repartir de zéro, supprime le dossier `data` (ou lance `.\lancer.bat --vider-cache`).
- Après une mise à jour de Parquet, l'application installée récupère les nouveaux fichiers dès le lancement suivant. Si l'affichage semble ancien, recharge la page une fois.

Tu peux aussi tester les sources sans ouvrir l'application, depuis un terminal ouvert dans le dossier : `.\lancer.bat --diagnostic` (Windows) ou `bash lancer.command --diagnostic` (Mac/Linux).

## D'où viennent les données

| Contenu | Source |
| --- | --- |
| Scores en direct, box scores, actions, calendrier | Fichiers publics du CDN de NBA.com (`cdn.nba.com`) |
| Effectifs, fiches joueurs, carrières, palmarès, classements, histoire des franchises | API de statistiques de NBA.com (`stats.nba.com`) |
| Logos et photos | CDN de NBA.com, chargés directement par ton navigateur |
| Biographies et histoires des franchises | Wikipédia en français (texte sous licence CC BY-SA), article retrouvé via Wikidata |

Ces sources ne sont pas des API officiellement documentées : NBA.com peut les modifier sans prévenir. Si une partie cesse de fonctionner un jour, c'est le plus souvent qu'un format a changé.

Le code de Parquet est libre (licence MIT), mais les logos, photos et données restent la propriété de la NBA et de leurs auteurs. L'application est faite pour un **usage personnel** sur ton ordinateur : ne l'héberge pas en ligne pour d'autres personnes et n'en fais pas d'usage commercial. Parquet n'est pas affilié à la NBA.

Pour arrêter : ferme la fenêtre noire ou appuie sur `Ctrl+C` dedans.
