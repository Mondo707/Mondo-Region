// Kassa formulasi — KPI Mondo'dagi haqiqiy ilova skrinshotlariga asoslanadi.
//
// KIRITISH SAHIFASIDA (xodim ko'radigan/to'ldiradigan):
//   Umumiy kassa = Тоза + Umumiy rasxod + To'lov turlari yig'indisi
//     Тоза              = kupyuralar yig'indisi
//     Umumiy rasxod     = Avans + Ofitsant + Texnichka + Prochiy + Bozorlik
//                         (Xarajatlar va Bozorlik bo'limlaridan avtomatik, TAHRIRLANMAYDI)
//     To'lov turlari    = barcha payment_types (card + inkassatsiya guruhi) yig'indisi
//                         — Инкассация ham shu yerda, alohida maydon emas
//   (Sertifikat — Yandex eats / Jiz-Biz — bu sahifada YO'Q: naqd/kartaga
//    tegmaydi, Poster orqali avtomatik kuzatiladi, faqat solishtirishda ko'rinadi.)
//
// POSTER BILAN SOLISHTIRISHDA (tafsilotli, faqat tahlil uchun):
//   Наличные (FAKT) = Тоза + Rasxod + Инкассация + Smena farqi
//     Smena farqi: Poster smenasi Yopilish − Ochilish (Yopilish>Ochilish => qo'shiladi)
//   Безналичные (FAKT) = faqat kartalar (Инкассация KIRMAYDI)
//   Сертификат = Poster'dan avtomatik (Yandex eats + Jiz-Biz client_id bo'yicha),
//     FAKT va POSTER odatda bir xil bo'ladi (ikkalasi ham Poster manbasidan)

const { pool } = require('../db');

async function computeRasxodBreakdown(businessDate) {
  const { rows } = await pool.query(
    `SELECT et.fot_bucket, COALESCE(SUM(ex.amount),0) AS s
     FROM expenses ex JOIN expense_types et ON et.id = ex.expense_type_id
     WHERE ex.business_date = $1
     GROUP BY et.fot_bucket`,
    [businessDate]
  );
  const byBucket = { avans: 0, ofitsant: 0, texnichka: 0, prochiy: 0 };
  for (const r of rows) {
    const amt = Number(r.s);
    if (r.fot_bucket === 'avans') byBucket.avans += amt;
    else if (r.fot_bucket === 'ofitsant') byBucket.ofitsant += amt;
    else if (r.fot_bucket === 'texnichka') byBucket.texnichka += amt;
    else byBucket.prochiy += amt; // fot_bucket=null yoki noma'lum -> Prochiy
  }

  const { rows: bozRows } = await pool.query(
    'SELECT COALESCE(SUM(total_amount),0) AS s FROM bozorlik_entries WHERE business_date = $1',
    [businessDate]
  );
  const bozorlik = Number(bozRows[0].s);

  const total = byBucket.avans + byBucket.ofitsant + byBucket.texnichka + byBucket.prochiy + bozorlik;
  return { ...byBucket, bozorlik, total };
}

function computeShiftDiff(openAmount, closeAmount) {
  return Number(closeAmount || 0) - Number(openAmount || 0);
}

/** paymentAmounts: {[payment_type_id]: amount}, paymentTypes: payment_types jadvalidan */
function splitPayments(paymentAmounts, paymentTypes) {
  const byId = new Map(paymentTypes.map((p) => [String(p.id), p]));
  let card = 0;
  let inkassatsiya = 0;
  for (const [id, amount] of Object.entries(paymentAmounts || {})) {
    const pt = byId.get(String(id));
    const amt = Number(amount) || 0;
    if (!pt) continue;
    if (pt.group_type === 'inkassatsiya') inkassatsiya += amt;
    else card += amt;
  }
  return { cardTotal: card, inkassatsiyaTotal: inkassatsiya, tolovTurlariYigindisi: card + inkassatsiya };
}

/** Kiritish sahifasidagi asosiy JAMI: Тоза + Rasxod + To'lov turlari (sertifikat kirmaydi). */
function computeEntryJami({ tozaNaqd, rasxodTotal, tolovTurlariYigindisi }) {
  return Number(tozaNaqd || 0) + Number(rasxodTotal || 0) + Number(tolovTurlariYigindisi || 0);
}

module.exports = { computeRasxodBreakdown, computeShiftDiff, splitPayments, computeEntryJami };
