// Kassa formulasi (KPI Mondo'dan meros, Region'da ham o'zgarmaydi):
//
// Umumiy kassa (JAMI) = Наличные + Безналичные + Сертификат
//   Наличные  = Тоза + Rasxod + Инкассация + Smena farqi (Yopilish - Ochilish)
//   Безналичные = faqat kartalar (UZCARD, HUMO, Click, Payme, ...)
//   Сертификат  = Yandex eats + Jiz-Biz (Безналичныега KIRMAYDI, alohida)
//
// Smena farqi: Yopilish > Ochilish bo'lsa QO'SHILADI, Yopilish < Ochilish bo'lsa AYIRILADI.

const { pool } = require('../db');

async function computeRasxod(businessDate) {
  const { rows: expRows } = await pool.query(
    'SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE business_date = $1',
    [businessDate]
  );
  const { rows: bozRows } = await pool.query(
    'SELECT COALESCE(SUM(total_amount),0) AS s FROM bozorlik_entries WHERE business_date = $1',
    [businessDate]
  );
  return Number(expRows[0].s) + Number(bozRows[0].s);
}

function computeShiftDiff(openAmount, closeAmount) {
  // Yopilish > Ochilish => musbat (filialda pul qoldi); aks holda manfiy (float'dan sarflandi)
  return Number(closeAmount || 0) - Number(openAmount || 0);
}

/**
 * paymentAmounts: { [payment_type_id]: amount }
 * paymentTypes:   payment_types jadvalidan olingan qatorlar (group_type bilan)
 */
function splitPayments(paymentAmounts, paymentTypes) {
  const byId = new Map(paymentTypes.map((p) => [String(p.id), p]));
  let card = 0;
  let certificate = 0;
  for (const [id, amount] of Object.entries(paymentAmounts || {})) {
    const pt = byId.get(String(id));
    const amt = Number(amount) || 0;
    if (!pt) continue;
    if (pt.group_type === 'certificate') certificate += amt;
    else card += amt;
  }
  return { cardAmount: card, certificateAmount: certificate };
}

function computeTotals({ tozaNaqd, rasxod, inkassatsiya, smenaFarqi, cardAmount, certificateAmount }) {
  const nalichnie = Number(tozaNaqd || 0) + Number(rasxod || 0) + Number(inkassatsiya || 0) + Number(smenaFarqi || 0);
  const jami = nalichnie + Number(cardAmount || 0) + Number(certificateAmount || 0);
  return { nalichnie_amount: nalichnie, beznal_amount: cardAmount, sertifikat_amount: certificateAmount, jami };
}

module.exports = { computeRasxod, computeShiftDiff, splitPayments, computeTotals };
