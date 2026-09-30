// Poster bilan solishtirish — tafsilotli (Наличные / Безналичные / Сертификат).
// DIQQAT: quyidagi taxminlar hali haqiqiy Poster hisobida tekshirilmagan
// (productionda birinchi solishtirishdan keyin moslashtirish kerak bo'lishi mumkin):
//   - Naqd to'lovlar dash.getTransactions'da payment_method_id === '0' deb qabul qilinadi.
//   - Sertifikat mijozlari: client_id '3' = Yandex eats, client_id '2' = Jiz-Biz restaurant
//     (context hujjatida shunday qayd etilgan).
//   - Karta turlari payment_types.poster_payment_method_id orqali moslashtiriladi;
//     mos kelmagan tranzaksiyalar "Карточки (aniqlanmagan)" sifatida yig'iladi.

const poster = require('./poster');
const { computeShiftDiff } = require('./cashCalc');
const { businessDateRange } = require('./businessDay');

const POSTER_CASH_METHOD_ID = '0';
const CERT_CLIENTS = { '3': 'Yandex eats', '2': 'Jiz-Biz restaurant' };

async function computePosterCompare(businessDate, entry, paymentTypes, rasxodBreakdown) {
  const { start, end } = businessDateRange(businessDate);
  const transactions = await poster.dashGetTransactions({ dateFrom: start.toISOString(), dateTo: end.toISOString() });

  let posterCashSom = 0;
  let posterCardUnmatched = 0;
  const posterByPaymentType = {}; // payment_type_id -> som
  const posterCert = { 'Yandex eats': 0, 'Jiz-Biz restaurant': 0 };

  const byPosterMethodId = new Map();
  for (const pt of paymentTypes) {
    if (pt.poster_payment_method_id) byPosterMethodId.set(String(pt.poster_payment_method_id), pt);
  }

  for (const tx of transactions) {
    const certName = CERT_CLIENTS[String(tx.client_id)];
    if (certName) {
      posterCert[certName] += tx.sum_som;
      continue;
    }
    if (String(tx.payment_method_id) === POSTER_CASH_METHOD_ID) {
      posterCashSom += tx.sum_som;
      continue;
    }
    const pt = byPosterMethodId.get(String(tx.payment_method_id));
    if (pt) {
      posterByPaymentType[pt.id] = (posterByPaymentType[pt.id] || 0) + tx.sum_som;
    } else {
      posterCardUnmatched += tx.sum_som;
    }
  }

  // Smena farqi — Poster kassa smenasidan (Yopilish - Ochilish).
  const shifts = await poster.financeGetCashShifts({ dateFrom: start.toISOString(), dateTo: end.toISOString() });
  const closedShift = shifts.find((s) => !s.is_open) || shifts[0];
  const smenaFarqi = closedShift ? computeShiftDiff(closedShift.amount_start, closedShift.amount_end) : 0;

  // FAKT tomoni (xodim kiritgan ma'lumotlar asosida).
  const inkassatsiyaFakt = paymentTypes
    .filter((p) => p.group_type === 'inkassatsiya')
    .reduce((s, p) => s + Number((entry.payment_amounts || {})[p.id] || 0), 0);
  const cardRows = paymentTypes.filter((p) => p.group_type === 'card');
  const cardFaktTotal = cardRows.reduce((s, p) => s + Number((entry.payment_amounts || {})[p.id] || 0), 0);

  const nalichnieFakt = Number(entry.toza_naqd || 0) + Number(rasxodBreakdown.total || 0) + inkassatsiyaFakt + smenaFarqi;
  const nalichniePoster = posterCashSom;

  const beznalFakt = cardFaktTotal;
  const beznalPoster = cardRows.reduce((s, p) => s + (posterByPaymentType[p.id] || 0), 0) + posterCardUnmatched;

  const certFaktTotal = posterCert['Yandex eats'] + posterCert['Jiz-Biz restaurant']; // Poster manbasidan — FAKT=POSTER
  const certPosterTotal = certFaktTotal;

  const umumiyFakt = nalichnieFakt + beznalFakt + certFaktTotal;
  const umumiyPoster = nalichniePoster + beznalPoster + certPosterTotal;

  const cards = cardRows.map((p) => ({
    id: p.id,
    name: p.name,
    fakt: Number((entry.payment_amounts || {})[p.id] || 0),
    poster: posterByPaymentType[p.id] || 0,
  }));
  cards.push({ id: null, name: 'Карточки (aniqlanmagan)', fakt: 0, poster: posterCardUnmatched });

  const farqPercent = umumiyPoster > 0 ? Math.abs(umumiyFakt - umumiyPoster) / umumiyPoster * 100 : 0;

  return {
    computed_at: new Date().toISOString(),
    smena_farqi: smenaFarqi,
    smena_open: closedShift ? Number(closedShift.amount_start) : null,
    smena_close: closedShift ? Number(closedShift.amount_end) : null,
    umumiy: { fakt: umumiyFakt, poster: umumiyPoster, farq: umumiyFakt - umumiyPoster },
    nalichnie: { fakt: nalichnieFakt, poster: nalichniePoster, farq: nalichnieFakt - nalichniePoster },
    beznal: { fakt: beznalFakt, poster: beznalPoster, farq: beznalFakt - beznalPoster, cards },
    sertifikat: {
      fakt: certFaktTotal, poster: certPosterTotal, farq: 0,
      items: [
        { name: 'Yandex eats', fakt: posterCert['Yandex eats'], poster: posterCert['Yandex eats'] },
        { name: 'Jiz-Biz restaurant', fakt: posterCert['Jiz-Biz restaurant'], poster: posterCert['Jiz-Biz restaurant'] },
      ],
    },
    farq_percent: farqPercent,
  };
}

module.exports = { computePosterCompare };
