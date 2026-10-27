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

## Suivi

- [x] v1 : planning, revenus, réservations, notes, réglages, page gestionnaire, factures Booking
- [x] Synchro robuste : annulation/changement de dates sans e-mail (absence du calendrier), retour auto
- [x] Application installable : `docs/` (manifest + service worker + cadre vers Apps Script, `?k=` passé en #)
- [ ] Activer GitHub Pages (Settings › Pages › /docs) — à faire par Raphaël, pas d'API disponible ici
- [ ] Installation dans le compte Google de Raphaël (copier-coller, voir README ; connecteur Drive en panne le 27 oct.)
- [x] Liens iCal réels testés (27 oct.) : l'export Booking mêle réservations et dates fermées → statut « blocked »
- [ ] À valider sur ses vraies données : lecture des factures
- [ ] Idée proposée à Raphaël : bouton « Mettre à jour » auto depuis GitHub (API Apps Script) — compromis sécurité, à trancher par lui
- [ ] Idées non faites : dépenses (ménage, charges), export comptable, flux iCal pour la gestionnaire
