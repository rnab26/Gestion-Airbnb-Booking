// Calendriers iCal au format publié par Airbnb et Booking (format public, non relevé sur ton compte).
'use strict';
const AIRBNB_URL = 'https://www.airbnb.fr/calendar/ical/1000000000000000001.ics?s=test';
const BOOKING_URL = 'https://ical.booking.com/v1/export?t=test';

function airbnbIcs(extra) {
  return [
    'BEGIN:VCALENDAR', 'PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 1.0//EN', 'CALSCALE:GREGORIAN', 'VERSION:2.0',
    'BEGIN:VEVENT', 'DTEND;VALUE=DATE:20261029', 'DTSTART;VALUE=DATE:20261025', 'UID:1418fb94e984-aaa@airbnb.com',
    'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMTEST0001\\nPhone Numbe', ' r (Last 4 Digits): 1234',
    'SUMMARY:Reserved', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTEND;VALUE=DATE:20261205', 'DTSTART;VALUE=DATE:20261201', 'UID:1418fb94e984-bbb@airbnb.com',
    'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMTEST0004\\nPhone Number (Last 4 Digits): 9876',
    'SUMMARY:Reserved', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTEND;VALUE=DATE:20261127', 'DTSTART;VALUE=DATE:20261125', 'UID:1418fb94e984-ccc@airbnb.com',
    'SUMMARY:Airbnb (Not available)', 'END:VEVENT'
  ].concat(extra || []).concat(['END:VCALENDAR']).join('\r\n');
}

function bookingIcs(opts) {
  opts = opts || {};
  const ev = (s, e, uid) => ['BEGIN:VEVENT', 'DTSTAMP:20261027T080000Z', 'DTSTART;VALUE=DATE:' + s, 'DTEND;VALUE=DATE:' + e, 'UID:' + uid, 'SUMMARY:CLOSED - Not available', 'END:VEVENT'];
  let lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//admin.booking.com//EN', 'CALSCALE:GREGORIAN'];
  lines = lines.concat(ev('20261104', '20261107', 'b1@booking.com'));
  lines = lines.concat(ev('20261115', '20261118', 'b2@booking.com'));
  if (!opts.withoutPlaceholder) lines = lines.concat(ev('20261220', '20261223', 'b3@booking.com'));
  lines = lines.concat(ev('20261025', '20261029', 'b4@booking.com')); // dates Airbnb réimportées
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { AIRBNB_URL, BOOKING_URL, airbnbIcs, bookingIcs };
