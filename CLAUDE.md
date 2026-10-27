# CLAUDE.md — Gestion location Airbnb + Booking

Projet de Raphaël : un appartement
loué sur Airbnb et Booking. Les règles globales de Raphaël s'appliquent (français,
autonomie, réponses courtes, preuves avant d'affirmer).

## Architecture (décidée le 27 oct. 2026)

- Google Apps Script en application Web + Google Sheet comme base. Gratuit, et
  pas de serveur ni de clé à gérer. Raphaël utilisait déjà Google Sheets.
- `apps-script/Code.gs` : serveur. Synchro e-mails (Gmail API en lecture seule,
  service avancé), iCal, factures Booking, revenus (`revenueModel_` et
  `computeStats_` sont la seule source de vérité du calcul), droits.
- `apps-script/Index.html` : interface unique (propriétaire, gestionnaire,
  installation), en vanilla JS, pensée pour mobile.
- Accès par clé secrète dans l'URL (`?k=`). Le propriétaire et la gestionnaire
  ont chacun la leur. Les données de la gestionnaire sont filtrées dans
  `managerData_` (jamais de montant).

## Faits vérifiés sur les vrais e-mails de Raphaël (27 oct. 2026)

- Airbnb « Réservation confirmée : X arrive le … » : contient le code HM…, les
  dates sans année, les voyageurs, « VOUS GAGNEZ x € » (net) et « TOTAL (EUR) ».
- Airbnb annulation : sujet « Annulation de la réservation HM… (dates) ».
- Booking : les e-mails ne contiennent ni prix, ni nom, ni départ. Seuls le
  numéro et la date d'arrivée sont dans le sujet.
- Booking : facture mensuelle « Booking.com Invoice N » avec un PDF qui donne
  les ventes de nuitées, la commission et les frais de paiement, comptés par
  date de départ (montants réels non recopiés ici : données privées).

## Non vérifié en conditions réelles

- La conversion PDF → texte par l'API Drive dans le compte de Raphaël. Elle est
  testée sur le texte réel de la facture (sortie pdftotext, 2 mises en page).
- Le format iCal de ses propres liens : format public Airbnb/Booking, parseur tolérant.

## Tests (méthode canonique)

`node --test tests/server.test.js`, `node tests/ui.test.js` (Playwright,
viewport 390 px) et `node tests/pwa.test.js` (installabilité Chrome). Les trois
doivent passer avant chaque push. Après toute modification de `apps-script/`,
lancer `node tools/build.js` (fichier tout-en-un `dist/Code-complet.gs`, le seul
que Raphaël colle depuis son téléphone ; un test échoue s'il n'est pas à jour).
**Augmenter `APP_VERSION`** dans Code.gs à chaque changement : c'est ce que compare
la mise à jour automatique. Ne jamais ajouter d'accès Google (oauthScopes) sans
prévenir Raphaël : la mise à jour auto s'arrête alors et lui demande un collage.

## Autorisations

Raphaël a donné (27 oct. 2026) tous les accès : commits, merges dans main, GitHub.

## Suivi

- [x] v1 : planning, revenus, réservations, notes, réglages, page gestionnaire, factures Booking
- [x] Synchro robuste : annulation/changement de dates sans e-mail (absence du calendrier), retour auto
- [x] Application installable : `docs/` (manifest + service worker + cadre vers Apps Script, `?k=` passé en #)
- [x] GitHub Pages actif (27 oct.) : branche `gh-pages`, mise à jour par `.github/workflows/pages.yml` depuis `docs/` sur main
- [x] Installé chez Raphaël (projet Apps Script « Gestion location », id 1hA9RPoVVSAHGEheOkHj1ySMQh-KWAqQWhwKYTPrf7o-6PCzgyCUUvHFT, déploiement Web AKfycbyYaDGa9…) ; v1.1.3 déployée le 27 oct. au soir, l'accès clasp temporaire a été supprimé du conteneur
- [x] Liens iCal réels testés (27 oct.) : l'export Booking mêle réservations et dates fermées → statut « blocked »
- [x] Vérifié en réel (27 oct.) : e-mails Airbnb lus (montants), 27 factures Booking lues (juillet = 2 360 − 437,13 = 1 923 €, identique au PDF), taux réel 17,85 %
- [ ] Ouvert : nuits Booking passées inconnues (l'e-mail ne donne que l'arrivée, l'iCal seulement le futur) → « Nuits louées » et « net moyen / nuit » faussés ; 1 facture illisible (Invoice 1623733339) ; relecture complète des e-mails en cours (300 par synchro)
- [x] Mise à jour automatique (décision de Raphaël, 27 oct. : « tout automatique ») : chaque nuit, l'outil installe `dist/Code-complet.gs` de la branche `stable` (avancée par `.github/workflows/tests.yml` seulement si les tests passent), via l'API Apps Script ; refuse toute version qui demande de nouveaux accès Google
- [x] 27 oct. soir : v1.1.0 puis v1.1.1 installées par Claude via l'API Apps Script (accès clasp limité script.projects + script.deployments, donné par Raphaël) ; projet « Gestion location », déploiement Web AKfycbyYaDGa9…
- [x] Bug réel corrigé (1.1.1) : le service avancé Gmail renvoie les corps en octets, pas en base64 → « Impossible de décoder la chaîne »
- [x] 1.2.0 (27 oct.) : téléphone (4 derniers chiffres via iCal Airbnb, complet à saisir), provenance (e-mail Airbnb « Ville, Pays »), couleurs Airbnb rouge / Booking bleu / bloqué gris / libre blanc, blocages Airbnb affichés
- [ ] Ouvert : téléphone complet et pays des voyageurs Booking — absents des e-mails ; possible via l'export de réservations de l'extranet (format à vérifier sur un vrai fichier de Raphaël). Raphaël a proposé ses identifiants Airbnb/Booking : refusé (conditions des plateformes, risque de suspension)
- [ ] 27 oct. : test réel de « Vérifier maintenant » → 403 « insufficient authentication scopes » : Raphaël n'a jamais accordé script.projects/deployments au script. 1.2.1 déployée via clasp (version 6) : le bandeau « Autoriser » s'affiche bien en prod ; reste à Raphaël de le toucher, puis vérifier « Vérifier maintenant ». Accès clasp supprimé du conteneur
- [x] 27 oct. : la mise à jour auto avec le jeton du script est impossible : le projet Google par défaut ne peut pas activer l'API Apps Script (doc Google « cloud-platform-projects »). 1.3.0 : l'outil garde dans ses propriétés privées (`updaterCreds`) l'accès clasp limité (script.projects + script.deployments) accordé par Raphaël, posé via l'action propriétaire `setUpdaterCreds` (jamais dans le code). Si Raphaël retire l'accès « clasp » de son compte Google, les mises à jour auto s'arrêtent (message clair)
- [x] 27 oct. soir : 1.3.1 déployée via clasp (version 7, messages clients Booking → départs)
- [x] 27 oct. : accès de mise à jour rangé dans l'outil (`tools/set-updater-creds.js`, permis par la règle `.claude/settings.json` posée par Raphaël). Vérifié : « Déjà à jour (version 1.3.1). Mises à jour automatiques prêtes. » ; 1.3.2 installée seule en prod (vérifié 19 h 39 : « Mis à jour : version 1.3.1 → 1.3.2 », la page sert 1.3.2). Plus aucun geste de Raphaël pour les mises à jour
- [ ] Vérifié : un message envoyé par l'hôte sur Booking ne génère aucun e-mail chez Raphaël → ne donne pas les dates ; seuls les messages des clients le font
- [ ] Idées non faites : dépenses (ménage, charges), export comptable, flux iCal pour la gestionnaire
