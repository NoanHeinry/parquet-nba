# Guide d'utilisation de Parquet

Ton tableau de bord et ton encyclopédie NBA personnels, en français.

- **Matchs** : l'accueil s'ouvre sur le joueur du match de chaque rencontre de la nuit, présenté en grand ; en dessous, les scores de la journée qui se mettent à jour tout seuls pendant les matchs, puis « La nuit en chiffres ». Pour chaque match : score par quart-temps, scénario du match (l'écart au score minute par minute), faits marquants (fautes techniques, expulsions, challenges), clés du match, duel des équipes, box score complet, fil des actions, carte des tirs, et un onglet **Vidéos** (résumé officiel sur YouTube, résumé NBA.com, moments décisifs en vidéo). Avant le match : les joueurs absents ou incertains. Les horaires sont à l'heure de Paris, et tu peux remonter dans le temps jour par jour.
- **Multi-matchs** : plusieurs matchs en direct côte à côte, en plein écran si tu veux, pour les grosses soirées.
- **Équipes** : les 30 franchises avec leur effectif (en photos, ou en tableau si tu préfères), leur staff, leur calendrier présenté mois par mois (un V vert ou un D rouge avec le score pour chaque match joué, l'horaire pour les prochains, exportable dans ton agenda), leur histoire, leurs titres, les maillots retirés, leurs membres du Hall of Fame et leurs victoires saison par saison.
- **Joueurs** et **Comparateur** : tous les joueurs passés par la NBA depuis 1946, avec leur fiche (biographie, palmarès, parcours, records, statistiques de carrière par match, sur 36 minutes ou en totaux, stats avancées, derniers matchs) et un outil de comparaison face-à-face (duel statistique, palmarès comparé, graphiques de trajectoire saison par saison).
- **Infos** : le rapport officiel des blessures de la NBA, traduit en français, et toutes les transactions (signatures, échanges, joueurs libérés).
- **Classement**, **leaders** et **Playoffs** : classement par conférence, leaders statistiques et l'arbre complet des playoffs NBA (séries 1er tour, demi-finales, finales de conférence, Finales NBA et détail de chaque rencontre).
- Logos et photos officiels, thème sombre ou clair, équipes favorites mises en avant.

L'application tourne sur ton ordinateur, ou directement sur ton téléphone Android (voir [Sans ordinateur](#sans-ordinateur-sur-un-téléphone-android)), et va chercher les données publiques de NBA.com et de Wikipédia. Rien n'est hébergé ailleurs, aucun compte n'est nécessaire.

## Installation

Il te faut **Python 3.9 ou plus récent** (gratuit) et une connexion Internet. Pas d'ordinateur ? Sur Android, va directement à la section [Sans ordinateur](#sans-ordinateur-sur-un-téléphone-android).

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
- Il n'y a pas de barre en haut : sur toutes les pages, le bouton rond en haut à droite ouvre le menu, avec les rubriques, la recherche et les boutons ci-dessous. Le sommaire numéroté à droite de l'écran (01. 02. 03. 04.) mène directement aux matchs, aux chiffres de la nuit ou au classement.
- En haut de l'accueil, le joueur du match de chaque rencontre de la nuit : clique sur un nom en bas de l'écran, utilise les flèches (ou celles du clavier), ou glisse le doigt sur téléphone. « Sa fiche » ouvre sa page, l'encart du match ouvre la rencontre.
- Clique sur la cloche dans le menu pour activer les alertes : coup d'envoi et résultat de tes favoris, fins de match serrées (5 dernières minutes avec 5 points d'écart ou moins). Les alertes fonctionnent **tant qu'un onglet Parquet est ouvert**, même en arrière-plan ; une alerte n'est jamais envoyée deux fois.
- Le bouton en forme d'œil, dans le menu, active le mode anti-spoiler, pour regarder un match en différé : les scores, le box score, le fil des actions, le résumé de la nuit, le champion des playoffs et le contenu des alertes restent masqués jusqu'à ce que tu cliques sur « Révéler ». Ce que tu as révélé le reste jusqu'à la fermeture de l'onglet.
- Quand des matchs sont en cours, le bouton « Mode multi-matchs » de la page d'accueil les affiche côte à côte.
- Dans l'onglet *Calendrier* d'une équipe, passe d'un mois à l'autre avec les flèches ou les mois de la saison ; clique sur un match pour l'ouvrir. Les boutons « À venir » et « Résultats » affichent la même chose sous forme de liste. « Ajouter à mon agenda » télécharge un fichier `.ics` à importer dans Google Agenda, Apple Calendrier ou Outlook. Les horaires s'affichent à l'heure de ton agenda ; les scores n'y figurent pas.
- Le bouton en forme de lune ou de soleil change le thème.
- Le bouton en forme de ballon lancé active ou coupe les animations. Par défaut, Parquet suit le réglage de ton système : si Windows a les « Effets d'animation » désactivés (Paramètres > Accessibilité > Effets visuels), les sites reçoivent la consigne de limiter les animations et Parquet n'en montre aucune. Un clic sur ce bouton les remet, et ce choix est retenu.

### Les vidéos des matchs

Dans l'onglet *Vidéos* d'un match terminé :

- **Le résumé vidéo** officiel de la NBA se lit directement dans la page. Parquet le trouve tout seul pour les matchs des dernières heures. Pour retrouver celui de n'importe quel match, il faut une clé gratuite de l'API YouTube : ouvre **État des sources** (en bas de chaque page), section *Résumés vidéo YouTube*, et suis les étapes (5 minutes avec un compte Google, sans carte bancaire). La clé reste sur ton appareil.
- **Le résumé NBA.com** s'ouvre sur le site de la NBA (il ne peut pas être intégré).
- **Les moments décisifs** : les actions qui ont fait basculer le match, en extraits de quelques secondes. Les titres sont en anglais, tels que les écrit la NBA.

La NBA publie le résumé YouTube en général une à deux heures après la fin du match. En mode anti-spoiler, l'onglet reste masqué tant que le match n'est pas révélé.

### Blessures et transactions

La page **Infos** affiche le dernier rapport officiel des blessures, publié par la NBA toutes les 15 minutes : pour chaque match à venir, les joueurs forfait, peu probables, incertains ou probables, avec leur blessure en français. Le filtre *Mes équipes favorites* ne garde que tes équipes. L'onglet *Transactions* liste les signatures, échanges et joueurs libérés des quatre derniers mois.

Ces informations apparaissent aussi sur la page d'un match avant le coup d'envoi, dans l'onglet *Infirmerie et mouvements* d'une équipe, et sur la fiche d'un joueur blessé.

### Sur ton téléphone

Par défaut, seul ton ordinateur peut ouvrir Parquet. Pour l'utiliser aussi sur ton téléphone, en gardant l'ordinateur allumé (sur Android, tu peux aussi t'en passer complètement : voir la section suivante) :

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

## Sans ordinateur, sur un téléphone Android

Parquet peut tourner entièrement sur un téléphone Android, grâce à **Termux**, une application gratuite qui permet d'y faire tourner des programmes comme sur un ordinateur. Rien n'est hébergé ailleurs : c'est ton téléphone qui va chercher les données sur NBA.com.

### Installation (une seule fois, environ 5 minutes)

1. Installe **F-Droid**, le magasin d'applications libres, depuis [f-droid.org](https://f-droid.org/). Dans F-Droid, installe **Termux** et **Termux:Widget**.
   Ne prends pas Termux sur le Play Store : cette version n'y est plus mise à jour. Termux et Termux:Widget doivent venir du même endroit.
2. Ouvre Termux. Colle cette première ligne (appui long, puis *Coller*), valide avec Entrée et attends qu'elle soit terminée (une à deux minutes) :

   ```
   apt update && apt full-upgrade -y -o Dpkg::Options::=--force-confnew
   ```

   Elle met tout Termux à jour. C'est indispensable : sur un Termux qui vient d'être installé, mettre à jour un seul outil peut casser les autres (erreur « CANNOT LINK EXECUTABLE »).
3. Colle ensuite la seconde ligne et valide :

   ```
   curl -fsSL https://raw.githubusercontent.com/NoanHeinry/parquet-nba/main/installer-android.sh | bash
   ```

   L'installation télécharge Python et Parquet, puis affiche « Parquet est installé ».
4. Ajoute le raccourci sur ton écran d'accueil : appui long sur un espace vide, *Widgets*, **Termux:Widget**, puis place-le. Il propose « Parquet » et « Arrêter Parquet ».

### Au quotidien

- **Lancer :** touche « Parquet » dans le widget, ou tape `parquet` dans Termux. Parquet démarre et s'ouvre dans Chrome. Si Parquet tourne déjà, il s'ouvre simplement.
- **Pendant l'utilisation :** une notification de Termux reste affichée, c'est normal. Elle indique que Parquet tourne et empêche Android de le mettre en veille.
- **Arrêter :** touche « Arrêter Parquet » dans le widget, tape `parquet stop`, ou touche *Exit* dans la notification de Termux. Pense à l'arrêter quand tu as fini, pour économiser la batterie.
- **Installer comme une vraie application :** une fois Parquet ouvert dans Chrome, menu ⋮, puis *Installer l'application* (ou *Ajouter à l'écran d'accueil*). Comme tout se passe sur le téléphone, l'adresse `http://localhost:8765` est considérée comme sécurisée : l'application complète et les notifications fonctionnent, sans aucun réglage de Chrome. L'icône ne s'ouvre que si Parquet tourne : lance-le d'abord avec le widget.
- **Mettre à jour :** tape `parquet maj` dans Termux.
- **Autres commandes :** `parquet demo` (mode démonstration), `parquet diagnostic` (tester l'accès à NBA.com), `parquet aide`.

### Si ça ne marche pas

- **« CANNOT LINK EXECUTABLE "curl" : cannot locate symbol… » :** Termux n'est qu'à moitié à jour. Relance la première ligne de l'installation (`apt update && apt full-upgrade -y -o Dpkg::Options::=--force-confnew`), puis la seconde. Si `apt` affiche lui aussi une erreur, tape `termux-change-repo`, choisis un autre miroir, et recommence.
- **Le widget ne fait rien :** dans les paramètres d'Android, *Applications*, *Termux*, autorise *Afficher par-dessus d'autres applications*.
- **Parquet s'arrête tout seul en arrière-plan :** dans les paramètres d'Android, *Applications*, *Termux*, *Batterie*, choisis *Non restreinte* (le nom varie selon les marques).
- **« Le port 8765 est déjà utilisé par une autre application » :** lance Parquet sur un autre port avec `PARQUET_PORT=8780 parquet`. L'application s'ouvre alors à `http://localhost:8780`, avec des favoris et des réglages séparés.
- **Hors Wi-Fi**, Parquet utilise tes données mobiles pour ce que tu consultes, comme n'importe quelle application de sport.

Ce mode n'existe pas sur **iPhone** : iOS ne laisse pas un programme de ce type tourner en arrière-plan. Sur iPhone, il faut passer par l'ordinateur, comme décrit dans la section précédente.

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
| Résumé NBA.com, moments décisifs, clés du match | Page du match sur `www.nba.com` ; les vidéos sont lues directement depuis NBA.com |
| Résumé vidéo du match, vidéos de la nuit | Chaîne YouTube officielle de la NBA, lues dans le lecteur YouTube |
| Blessures | Rapport officiel de la NBA (PDF, `official.nba.com`) |
| Transactions | Liste officielle des mouvements de joueurs de la NBA |

Ces sources ne sont pas des API officiellement documentées : NBA.com peut les modifier sans prévenir. Si une partie cesse de fonctionner un jour, c'est le plus souvent qu'un format a changé.

Le code de Parquet est libre (licence MIT), mais les logos, photos et données restent la propriété de la NBA et de leurs auteurs. L'application est faite pour un **usage personnel** sur ton ordinateur : ne l'héberge pas en ligne pour d'autres personnes et n'en fais pas d'usage commercial. Parquet n'est pas affilié à la NBA.

Pour arrêter : ferme la fenêtre noire ou appuie sur `Ctrl+C` dedans.
