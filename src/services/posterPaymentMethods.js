// Poster tranzaksiyalarida uchraydigan "payment_method_id" maydonini bizning
// to'lov kanallarimizga (UZCARD, HUMO, Uz Qr Kod, Click, ...) bog'lab beradi.
//
// DIQQAT: bu maydon faqat "dash.getTransactions" metodida keladi (oddiy
// "transactions.getTransactions" metodida yo'q - buni diagnostika orqali
// tasdiqladik). Shuning uchun aniqlash (discover) shu metoddan foydalanadi.

const { pool } = require('../db/db');
const poster = require('./posterClient');

const KNOWN_CHANNELS = ['uzcard', 'humo', 'uz_qr', 'click', 'payme', 'uzum', 'alif', 'paynet'];

async function getMapping() {
  const result = await pool.query('SELECT payment_method_id, channel_key, label FROM poster_payment_methods');
  const map = {};
  result.rows.forEach((r) => { map[r.payment_method_id] = r.channel_key; });
  return map;
}

async function getMappingDetailed() {
  const result = await pool.query('SELECT payment_method_id, channel_key, label, updated_at FROM poster_payment_methods ORDER BY payment_method_id');
  return result.rows;
}

async function setMapping(paymentMethodId, channelKey, label) {
  await pool.query(
    `INSERT INTO poster_payment_methods (payment_method_id, channel_key, label, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (payment_method_id) DO UPDATE SET channel_key = EXCLUDED.channel_key, label = EXCLUDED.label, updated_at = EXCLUDED.updated_at`,
    [String(paymentMethodId), channelKey, label || null]
  );
}

/**
 * Oxirgi N kun ichidagi tranzaksiyalarni skanerlab, qanday payment_method_id
 * uchrayotganini, har birida nechta tranzaksiya va qancha summa borligini
 * topib beradi - admin shu ro'yxatdan kanal tanlaydi.
 */
async function discoverPaymentMethods(spotId, days = 7) {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const allDates = [];
  let cur = new Date(from + 'T00:00:00');
  const end = new Date(today + 'T00:00:00');
  while (cur <= end) {
    allDates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  let allTx = [];
  for (const date of allDates) {
    const result = await poster.call('dash.getTransactions', { date_from: date, date_to: date });
    const list = Array.isArray(result) ? result : (result.data || []);
    const filtered = spotId ? list.filter((t) => Number(t.spot_id) === Number(spotId)) : list;
    allTx = allTx.concat(filtered);
  }

  const found = new Map();
  for (const tx of allTx) {
    const id = tx.payment_method_id;
    if (id === undefined || id === null || Number(tx.payed_card) === 0) continue;
    const key = String(id);
    if (!found.has(key)) found.set(key, { payment_method_id: key, count: 0, total: 0 });
    const entry = found.get(key);
    entry.count += 1;
    entry.total += Number(tx.payed_card) || 0;
  }

  return Array.from(found.values()).sort((a, b) => b.total - a.total);
}

module.exports = { getMapping, getMappingDetailed, setMapping, discoverPaymentMethods, KNOWN_CHANNELS };
