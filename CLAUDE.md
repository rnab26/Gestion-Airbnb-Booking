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
- [x] 1.4.0 (21 nov.) : calendrier façon Airbnb, demandé par Raphaël : bandeau par séjour du milieu du jour d'arrivée au milieu du jour de départ (rouge Airbnb, bleu Booking, vert direct), nom du client dedans, jours bloqués gris avec date barrée, aujourd'hui en rond rouge ; toucher un bandeau ouvre la réservation. Tests : date figée par `FAKE_NOW` (gas-mock), sinon les tests cassent quand les dates de test passent
- [x] 1.4.1 (21 nov.) : bug réel corrigé : l'iCal Booking fusionne une réservation et les dates fermées qui suivent (29 déc. 2026 → 16 nov. 2027, 322 nuits) → prise pour un séjour estimé ≈ 41 654 €. Plage > `MAX_ICAL_STAY_NIGHTS` (45) = départ inconnu + reste bloqué ; départs aberrants déjà en base effacés à la synchro. Planning : annulations regroupées dans « Annulations du mois (N) », repliable
- [x] (réglé par l'import 1.5.0, à refaire à la main de temps en temps) Ouvert (21 nov.) : montants exacts et départs Booking passés → aucun e-mail ne les donne, l'export extranet n'est pas automatisable sans se connecter à la place de Raphaël (refusé). Proposé : gestionnaire de canaux (Beds24 ≈ 8-16 €/mois, non vérifié) ou rester gratuit — réponse de Raphaël attendue
- [ ] 21 nov. : comparatif channel managers avec API (demande de Raphaël). Vérifié sur sources officielles : **Beds24** ≈ 19-20 €/mois (14,90 base + 3 €/logement + 0,65 €/lien × 2), API v2 incluse (code d'invitation → refresh token, 100 crédits/5 min), webhooks réservation ; spec OpenAPI (api.beds24.com/v2/apiV2.yaml) : prénom/nom, email, phone, mobile, country, price, commission, status, channel, apiReference. Smoobu 29 €/mois Flex (+0,9 %) ou prépayé, API HMAC + webhooks (détails partiellement vérifiés). Hospitable Host ≈ 29 $/mois (API sur Host : sources contradictoires). Lodgify ≈ 16-26 $/mois non vérifié (site bloqué). OwnerRez ≥ 40 $/mois. Recommandé : Beds24. Intégration prévue : webhook Beds24 → doPost de l'outil (URL à clé secrète) + relecture quotidienne GET /bookings ; aucun nouvel accès Google. Décision de Raphaël attendue (dépense)
- [x] 22 nov. : **vrai relevé Booking vérifié** (extranet › Réservations › Date de « Départ » › Télécharger › « Télécharger le relevé de réservations », téléchargé une fois par Claude dans le Chrome de Raphaël à sa demande, puis supprimé) : Excel 97-2003 .xls binaire (BIFF8/OLE), 26 colonnes : Numéro de réservation (nombre), Réservé par (« Nom, Prénom »), Nom du client, « Arrivée&nbsp; », « Départ&nbsp; » (texte 2026-10-01), Réservé le, Statut (ok / cancelled_by_guest / cancelled_by_hotel), Hébergements, Personnes, Adultes, Enfants, Âges des enfants, Tarif (« 667.8 EUR »), « % comm. » (17), Montant de la commission (« 113.5260 EUR », 4 décimales, vide si annulée), Statut du paiement, Moyen de paiement, Remarques, Booker country (code ISO « fr »), Motif du voyage, Appareil, Type d'hébergement, Durée (nuits), Date d'annulation, Adresse (vide), Numéro de téléphone (VIDE). Plage > 1 mois : la liste ne s'affiche pas mais le téléchargement marche. Tarifs du relevé = ventes des factures, mois par mois. « Demander un relevé avec coordonnées clients » : erreur Booking (2 essais) → pas de téléphone Booking. Airbnb (22 nov.) : la liste des réservations avec export n'existe plus (redirige vers Aujourd'hui / À venir).
- [x] 1.5.0 (22 nov.) : import de l'export des réservations Booking (demande de Raphaël) : Réglages › « Importer l'export Booking » (relevé .xls BIFF8 lu en pur JS : `xlsRows_`/`cfbStream_`, .xlsx, CSV, page HTML) + partage Android « Partager › Gestion location » (share_target de docs/manifest, fichier gardé par docs/sw.js dans le cache gl-share, transmis par postMessage à l'appli qui n'accepte que l'origine de appUrl et demande confirmation). Rapprochement par numéro (clé booking:<n°>, nouvelles lignes origin « export »), nom, départ, pays (code ISO → nom), téléphone, annulation (annulée facturée = keepRevenue), net exact = prix − commission (export) − frais de paiement (facture du mois répartie au centime si les ventes égalent la facture, sinon taux réel). Champs verrouillés jamais écrasés ; réimport = 0 changement ; résultat « N nouvelle(s), N mise(s) à jour, N annulée(s), N inchangée(s), N erreur(s) » + contrôle par facture (Journal + lastImport). Aucun nouvel accès Google. Fixture synthétique de même structure : tests/fixtures/booking-export.js (générateur .xls/.xlsx/CSV). Aussi demandé par Raphaël : colonne `commission` (Booking : commission + frais = prix − net ; Airbnb : « Frais de service hôte » de l'e-mail, relecture des e-mails via EMAIL_RESCAN_VERSION 1.5.0), fiche réservation avec résumé (jours « Lun. Mar. … », personnes, pays, téléphone + bouton WhatsApp, brut − commission = net), cartes compactes, Revenus › Par plateforme brut/commissions, Par mois déroulant avec les paiements séjour par séjour (`computeStats_` → months[].items)
- [x] 1.5.1 (22 nov.) : bug réel vu au 1er import en prod (141 mises à jour, mais mois gonflés : octobre export 4 046,57 € / facture 2 445,56 €) : le relevé garde le tarif des annulations avec une commission vide (50 annulations sur 51) et la 1.5.0 leur appliquait le % de commission → comptées comme facturées. Annulée = facturée seulement si « Montant de la commission » > 0 ; un réimport remet keepRevenue à vide (sauf saisie à la main)
- [x] 1.5.2 (22 nov.) : retours de Raphaël sur la prod : (1) séjours Booking à venir estimés tous au même montant (284,90 €) : estimation = nuits × net moyen par nuit des séjours Booking exacts des 12 derniers mois (les prix exacts des séjours à venir viennent d'un relevé « Départ » couvrant le futur) ; (2) « 6 réservations sans montant » = séjours Airbnb de 2024 dont l'e-mail n'a pas « VOUS GAGNEZ » mais « VERSEMENT DE L'HÔTE … Frais de service -x € … TOTAL (EUR) y € » (vérifié sur un vrai e-mail) : lu, relecture via EMAIL_RESCAN_VERSION 1.5.2 ; l'alerte « sans montant » n'apparaît plus qu'en Revenus, pour l'année affichée ; (3) jours gris = fermetures Airbnb/Booking (ex. airbnb-block d'une nuit accolé à un séjour Booking), légende « Fermé (Airbnb/Booking) » ; (4) Revenus : revenus nets par mois (déroulant) en premier, plateformes, factures Booking repliées ; (5) simplification : plus de badge plateforme ni « estimé » sur les cartes (barre de couleur et « ≈ »), fiche réservation = résumé + notes, champs sous « Modifier les informations », aides redondantes et doublons (bouton synchro et version dans Réglages) retirés
- [x] 22 nov. (suite) : 2e relevé Booking (départs du 22/11/2026 au 22/11/2027, 15 réservations dont 4 séjours à venir), téléchargé à la demande de Raphaël (connexion Booking validée par lui), importé (15 mises à jour, 0 erreur) puis supprimé : séjours à venir au montant exact avec nom/pays/voyageurs. Les frais de paiement des mois pas encore facturés restent au taux réel moyen des factures
- [x] 1.5.3 (22 nov.) : fiche séjour refaite (demande de Raphaël : pas de WhatsApp ni de téléphone visibles, infos pas claires) : plateforme + n°, dates en grand avec heures et nuits, voyageurs / pays / téléphone toujours affichés (« Pas de numéro » sinon), boutons WhatsApp + Appeler si numéro complet, « Écrire sur Airbnb / Booking » (lien réservation ; Booking via le réglage bookingHotelId), « + Ajouter le numéro » qui ouvre le champ. Rappel : aucun numéro complet automatique (relevé Booking sans téléphone, Airbnb = 4 derniers chiffres)
- [ ] Idées non faites : dépenses (ménage, charges), export comptable, flux iCal pour la gestionnaire
