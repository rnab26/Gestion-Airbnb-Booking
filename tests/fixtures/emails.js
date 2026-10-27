// E-mails réels (structure exacte des messages reçus en 2026), noms et codes anonymisés.
'use strict';

function airbnbConfirmation({ first, last, code, arrLine, datesLine, guests, earn, total }) {
  return `%opentrack%

https://www.airbnb.fr/?c=.pi80.pkYm9va2luZy9ob3N0&euid=x

NOUVELLE RÉSERVATION CONFIRMÉE ! ${first.toUpperCase()} ARRIVERA LE ${arrLine}

Envoyez un message pour confirmer les détails de l'entrée
dans les lieux ou pour souhaiter la bienvenue à ${first}.

https://www.airbnb.fr/hosting/reservations/details/${code}?isPending=true&c=.pi80 ${first} ${last}

                                                                                                    [https://www.airbnb.fr/hosting/reservations/details/${code}?isPending=true]

                                                                                                    Identité vérifiée · 2 commentaires

Bonjour
Bonjour, à bientôt.
Cordialement

APPARTEMENT TEST

Logement entier

Arrivée Départ

${datesLine}

15:00 10:00

VOYAGEURS

${guests}

PLUS D'INFORMATIONS CONCERNANT LES VOYAGEURS

CODE DE CONFIRMATION
${code}

LE VOYAGEUR A PAYÉ

100,00 € x 4 nuits 400,00 €

Frais de ménage 60,00 €

Taxes de séjour 30,00 €

TOTAL (EUR) ${total} €

VERSEMENT DE L'HÔTE

Frais de chambre pour 4 nuits 480,00 €

Frais de ménage 60,00 €

Ajustement du tarif par nuit -10,00 €

Frais de service hôte (15.5 % + TVA) -77,70 €

VOUS GAGNEZ ${earn} €

CONDITIONS D'ANNULATION
Vos conditions d'annulation pour les voyageurs sont Non
remboursable [https://www.airbnb.com/help/article/149].
`;
}

const BOOKING_NEW_BODY = `   Pour des raisons de sécurité, veuillez vous assurer que votre URL est
   https://admin.booking.com avant de vous connecter.

Booking confirmation — 7100000001

   Un client de Booking.com vient d’effectuer une réservation dans votre
   établissement.`;

const GUEST_MSG = `   Booking.com
   Numéro de réservation: 7100000001

   Vous avez reçu un nouveau message d'un client

   ANA LOPEZ a écrit :
   J'aimerais m'enregistrer à 11:00 - 12:00. C'est possible ?

   Détails de la réservation
   Nom du client : ANA LOPEZ
   Arrivée : mercredi 4 novembre 2026
   Départ : samedi 7 novembre 2026
   Nom de l'établissement: Appartement Test
   Numéro de réservation: 7100000001
`;

const messages = [
  { id: 'a1', from: 'Airbnb <automated@airbnb.com>', date: '2026-09-09T17:01:11Z',
    subject: 'Réservation confirmée : Jean Dupont arrive le 25 oct.',
    body: airbnbConfirmation({ first: 'Jean', last: 'Dupont', code: 'HMTEST0001', arrLine: '25 OCT.', datesLine: 'dim. 25 oct. jeu. 29 oct.', guests: '3 adultes', earn: '412,30', total: '590,00' }) },
  { id: 'a2', from: 'Airbnb <automated@airbnb.com>', date: '2026-05-11T05:59:38Z',
    subject: 'Réservation confirmée : Marie Martin arrive le 31 mai',
    body: airbnbConfirmation({ first: 'Marie', last: 'Martin', code: 'HMTEST0002', arrLine: '31 MAI', datesLine: 'dim. 31 mai mar. 2 juin', guests: '2 adultes, 1 enfant', earn: '181,50', total: '250,00' }) },
  { id: 'a3', from: 'Airbnb <automated@airbnb.com>', date: '2026-05-20T10:00:00Z',
    subject: 'Réservation confirmée : Paul Durand arrive le 12 juin',
    body: airbnbConfirmation({ first: 'Paul', last: 'Durand', code: 'HMTEST0003', arrLine: '12 JUIN', datesLine: 'ven. 12 juin dim. 14 juin', guests: '4 adultes', earn: '1 204,50', total: '1 500,00' }) },
  { id: 'a4', from: 'Airbnb <automated@airbnb.com>', date: '2026-06-02T15:01:08Z',
    subject: 'Annulation de la réservation HMTEST0003 (12–14 juin 2026)', body: 'RÉSERVATION ANNULÉE' },
  { id: 'a5', from: 'Airbnb <automated@airbnb.com>', date: '2026-05-28T10:16:14Z',
    subject: 'Confirmation : voici votre reçu Airbnb pour votre voyage du 28 mai – 1 juin', body: 'Tout est prêt pour votre voyage' },
  { id: 'a6', from: 'Airbnb <automated@airbnb.com>', date: '2026-04-26T11:11:17Z', subject: 'Réservation mise à jour', body: 'VOTRE RÉSERVATION AVEC ALEX A ÉTÉ MISE À JOUR' },
  { id: 'b1', from: 'Booking.com <noreply@booking.com>', date: '2026-10-21T20:04:19Z',
    subject: 'Booking.com - Nouvelle réservation ! (7100000001, mercredi 4 novembre 2026)', body: BOOKING_NEW_BODY },
  { id: 'b2', from: 'Booking.com <noreply@booking.com>', date: '2026-10-01T08:00:00Z',
    subject: 'Booking.com - Nouvelle réservation ! (7100000002, samedi 21 novembre 2026)', body: BOOKING_NEW_BODY },
  { id: 'b3', from: 'Booking.com <noreply@booking.com>', date: '2026-10-27T07:14:24Z',
    subject: 'Booking.com - Réservation annulée ! (7100000002, samedi 21 novembre 2026)', body: 'Cancellation — 7100000002' },
  { id: 'b4', from: 'Booking.com <noreply@booking.com>', date: '2026-09-30T16:34:29Z',
    subject: 'Booking.com - Nouvelle réservation ! (7100000003, dimanche 15 novembre 2026)', body: BOOKING_NEW_BODY },
  { id: 'b5', from: 'customer.relations@booking.com', date: '2026-10-25T07:22:31Z',
    subject: 'Booking.com - Votre attention est requise : Martin Lucas (7100000004)', body: '...' },
  { id: 'b6', from: 'no-reply@properties.booking.com', date: '2026-10-19T08:47:32Z',
    subject: 'Vérifiez votre type d’activité URSSAF pour les cotisations sociales', body: '...' },
  { id: 'x1', from: 'r.owner@gmail.com', date: '2026-10-23T13:46:43Z', subject: 'Re: réservation n° 7100000004', body: 'réponse' }
];

module.exports = { messages, airbnbConfirmation, GUEST_MSG };
