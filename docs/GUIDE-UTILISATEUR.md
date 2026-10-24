# Guide d'utilisation de Parquet

Ton tableau de bord et ton encyclopédie NBA personnels, en français.

- **Matchs** : les scores de la journée qui se mettent à jour tout seuls pendant les matchs, puis pour chaque match le score par quart-temps, le duel des équipes, le box score complet, le fil des actions et la carte des tirs. Les horaires sont à l'heure de Paris, et tu peux remonter dans le temps jour par jour.
- **Équipes** : les 30 franchises avec leur effectif, leur staff, leur calendrier, leur histoire, leurs titres, les maillots retirés, leurs membres du Hall of Fame et leurs victoires saison par saison.
- **Joueurs** et **Comparateur** : tous les joueurs passés par la NBA depuis 1946, avec leur fiche (biographie, palmarès, parcours, records, statistiques de carrière, derniers matchs) et un outil de comparaison face-à-face (duel statistique, palmarès comparé, graphiques de trajectoire saison par saison).
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

## Astuces

- Appuie sur `/` n'importe où pour chercher un joueur ou une équipe.
- Depuis la fiche d'un joueur, clique sur « ⚖️ Comparer ce joueur » pour lancer un face-à-face immédiat avec un rival.
- Ajoute tes équipes favorites (bouton en haut de leur page) : leurs matchs passent en premier.
- Le bouton en forme de lune ou de soleil change le thème.

### Sur ton téléphone

Ton ordinateur doit être allumé avec Parquet lancé, et le téléphone connecté au même Wi-Fi. Lance Parquet avec l'option `--lan` :

- Windows : dans le dossier, ouvre un terminal (clic droit dans le dossier, *Ouvrir dans le terminal*) et tape `.\lancer.bat --lan`
- Mac : dans le Terminal, tape `bash ` puis glisse le fichier `lancer.command` dans la fenêtre, ajoute ` --lan` et valide

La fenêtre affiche alors l'adresse à ouvrir sur le téléphone (du type `http://192.168.1.20:8765/`). Windows te demandera d'autoriser l'accès au réseau privé : accepte.

## Si quelque chose ne s'affiche pas

Ouvre **État des sources** (lien en bas de chaque page). Le test indique si NBA.com et Wikipédia répondent.

- NBA.com bloque certains réseaux : désactive un éventuel VPN ou proxy et réessaie.
- NBA.com limite parfois les requêtes trop rapprochées : attends quelques minutes.
- Quand NBA.com ne répond pas, Parquet affiche les dernières données gardées en mémoire et le signale par un bandeau.
- Pour repartir de zéro, supprime le dossier `data` (ou lance `.\lancer.bat --vider-cache`).

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
