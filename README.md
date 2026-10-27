# Gestion location Airbnb + Booking

Tableau de bord gratuit pour un logement loué sur Airbnb et Booking :
planning, revenus, notes, et une page planning à partager avec la personne qui
gère l'appartement (sans aucun montant).

Fonctionne entièrement dans ton compte Google (Apps Script + Google Sheet) :
aucun serveur, aucun abonnement, aucune clé à gérer.

## Ce que ça fait

- **Réservations automatiques**
  - Airbnb : lues dans tes e-mails de confirmation (voyageur, dates, nombre de
    voyageurs, montant net « Vous gagnez »). Les annulations sont prises en compte.
  - Booking : lues dans les e-mails « Nouvelle réservation » et « Réservation annulée ».
  - Dates mises à jour par les calendriers iCal Airbnb et Booking. Synchro
    automatique toutes les heures, réglable.
- **Revenus** : net par mois et par an, nuits louées, taux d'occupation, net
  moyen par nuit, total par plateforme. Le montant d'un séjour est réparti nuit
  par nuit sur les mois concernés.
- **Booking sans saisie** : Booking ne met pas le prix dans ses e-mails. L'outil
  lit donc la **facture mensuelle Booking** (le PDF joint à l'e-mail « Booking.com
  Invoice »), qui donne les ventes, la commission et les frais réels du mois :
  - le net réel du mois est réparti entre les séjours Booking partis ce mois-là ;
  - les mois pas encore facturés sont estimés au net moyen par nuit de tes factures ;
  - le taux de commission réel (commission + frais de paiement) est calculé sur tes factures.

  Un montant saisi à la main remplace toujours le calcul.
- **Planning** : calendrier mensuel (arrivées, départs, jours d'enchaînement),
  détail par jour, notes sur une date ou une période.
- **Page gestionnaire** : planning, prochains ménages, notes que tu rends visibles.
  Elle peut ajouter ses propres notes (option). Aucun montant, aucun code de
  réservation, aucune note privée : tout est filtré sur le serveur, pas seulement
  masqué à l'écran.
- **Tout est modifiable** : créer une réservation directe, modifier, masquer ou
  supprimer (avec confirmation). Tu peux aussi revenir aux valeurs synchronisées,
  et changer le lien de la gestionnaire.
- **Alertes** : double réservation (dates qui se chevauchent), réservation sans
  montant, erreur de synchronisation (avec journal).
- **Calendrier fiable même si un e-mail manque** : une réservation future qui
  disparaît du calendrier de la plateforme est marquée annulée, et revient si
  ses dates réapparaissent. Un changement de dates Booking sans e-mail déplace
  la réservation. Un calendrier vide suspect ne modifie rien.
- **Application installable** (Chrome, Android, ordinateur) : les liens
  partagés passent par la page `docs/` (GitHub Pages). On l'installe avec
  menu ⋮ › « Installer l'application ». Elle se souvient du lien et fonctionne
  ensuite comme une appli.

## Installation (une fois, environ 10 minutes, plus simple depuis un ordinateur)

1. Ouvre https://script.google.com/home/projects/create (connecté au compte
   Gmail qui reçoit les e-mails Airbnb et Booking).
2. Renomme le projet « Gestion location » (clic sur « Projet sans titre »).
3. Fichier `Code.gs` : efface tout, colle le contenu de
   [`apps-script/Code.gs`](apps-script/Code.gs).
4. Bouton **+** › **HTML**, nomme-le `Index` (sans .html), colle le contenu de
   [`apps-script/Index.html`](apps-script/Index.html).
5. ⚙️ **Paramètres du projet** › coche « Afficher le fichier manifeste
   appsscript.json ». Reviens à l'éditeur, ouvre `appsscript.json`, colle le
   contenu de [`apps-script/appsscript.json`](apps-script/appsscript.json).
   Ce fichier active Gmail en lecture seule.
6. **Déployer** › **Nouveau déploiement** › type **Application Web** ›
   « Exécuter en tant que : moi », « Qui a accès : Tout le monde » › **Déployer**.
7. Autorise l'accès. Google affiche « Google n'a pas validé cette application »
   (normal, c'est ton propre script) : **Paramètres avancés** › **Accéder à
   Gestion location**.
8. Ouvre l'URL de l'application Web affichée, puis clique sur **Installer**.
   L'outil crée le Google Sheet de données, lit tes e-mails et t'envoie ton lien
   propriétaire par e-mail.
9. Dans **Réglages**, colle tes deux liens calendrier (où les trouver : expliqué
   sur la page), puis **Enregistrer**.
10. Toujours dans **Réglages** › « Page de la gestionnaire » › **Envoyer par
    WhatsApp**.

11. L'application installable est en ligne sur
    https://rnab26.github.io/Gestion-Airbnb-Booking/ (branche `gh-pages`, publiée
    automatiquement depuis `docs/` à chaque modification sur `main`).

Sur téléphone : ouvre ton lien propriétaire dans Chrome, menu ⋮ › « Installer
l'application ».

### Calendriers iCal : à quoi ils servent

- **Dans l'outil (Réglages)**, colle les deux liens *d'export*. Ils donnent les
  dates de départ Booking, les changements de dates, et les annulations même
  quand l'e-mail manque.
- **Entre les plateformes (indépendant de l'outil)** : pour éviter les doubles
  réservations, Airbnb doit importer le lien d'export Booking, et Booking celui
  d'Airbnb. L'outil ne bloque pas de dates sur les plateformes : il signale
  seulement un chevauchement.

### Mettre à jour plus tard (faisable depuis un téléphone)

Un seul fichier à coller, sans rien sélectionner dans l'éditeur Google :

1. Ouvre [`dist/Code-complet.gs` en version brute](https://raw.githubusercontent.com/rnab26/Gestion-Airbnb-Booking/main/dist/Code-complet.gs),
   appuie longuement sur le texte › **Tout sélectionner** › **Copier**.
2. Dans ton projet Apps Script : **+** (à côté de « Fichiers ») › **Script** ›
   nom `Code2`. Dans ce nouveau fichier, appui long › **Coller** (laisse les
   2 lignes déjà présentes, elles ne gênent pas).
3. Sur l'ancien fichier `Code.gs` : **⋮** › **Supprimer**. Le fichier
   `Index.html` peut rester, il n'est plus utilisé.
4. **Déployer** › **Gérer les déploiements** › ✏️ › Version : **Nouvelle
   version** › **Déployer**. L'URL et les liens ne changent pas.

Le fichier `dist/Code-complet.gs` est fabriqué par `node tools/build.js`
(Code.gs + Index.html intégrée). Un test vérifie qu'il est à jour.

### Lien propriétaire perdu

Il est dans ton e-mail « Ton lien propriétaire ». Sinon, dans l'éditeur Apps
Script, lance la fonction `afficherMonLien` : le lien s'affiche dans le journal
d'exécution.

## Accès demandés et pourquoi

| Accès | Pourquoi |
|---|---|
| Gmail en lecture seule | lire les e-mails Airbnb/Booking (aucun envoi, aucune suppression) |
| Google Sheets | stocker les données dans ton Sheet |
| Fichiers créés par l'app (Drive) | convertir le PDF de facture Booking en texte (fichier temporaire supprimé aussitôt) |
| Envoyer un e-mail | t'envoyer ton lien propriétaire à l'installation |
| Services externes | lire les calendriers iCal Airbnb et Booking |
| Déclencheurs | synchronisation automatique |

## Limites connues

- Booking : le montant par réservation est une **répartition** du net réel du
  mois (facture), pas le montant exact de chaque séjour. Pour l'exact, saisis le
  prix client (extranet › Réservations) dans la réservation.
- La conversion du PDF de facture par Google Drive a été testée sur le texte
  réel de ta facture, mais pas encore dans ton compte. Si elle échoue, un
  avertissement s'affiche dans le journal et l'outil réessaie à chaque synchro.
  Les montants Booking restent alors estimés avec le taux par défaut.
- Une réservation Airbnb vue seulement dans le calendrier (sans e-mail) n'a pas
  de montant : à saisir.
- Les réservations Booking anciennes, plus vieilles que ce que couvre le
  calendrier iCal, peuvent avoir un « départ inconnu » : il se corrige à la main.
- Pas de gestion des dépenses (ménage, charges) pour l'instant.

## Développement et tests

```
node --test tests/server.test.js   # 29 tests : lecture des e-mails et factures, synchro, revenus, droits
node tests/ui.test.js              # parcours complet dans Chromium, écran de téléphone
node tests/pwa.test.js             # page installable : critères Chrome, cadre, lien mémorisé
```

Les tests utilisent des e-mails et une facture réels (structure exacte),
anonymisés, et une simulation des services Google (`tests/gas-mock.js`).
