// Har 5 daqiqada bugungi "ish kuni" (05:00-05:00 oynasi) tranzaksiyalarini
// Poster'dan olib, daily_bonus jadvalini yangilab turadi.

const cron = require('node-cron');
const { pool } = require('../db/db');
const poster = require('./posterClient');
const { calculateDailyBonus } = require('./bonusCalculator');
const { getBusinessDayWindow, getCurrentBusinessDate } = require('./businessDay');

const TIMEZONE_OFFSET_HOURS = Number(process.env.TIMEZONE_OFFSET_HOURS || 5);

// Faol sinxronlash oynasi (Toshkent vaqti bo'yicha): 06:00 dan 03:30 gacha.
// Eng kech yopiladigan filial soat 03:00 da yopiladi, shuning uchun 03:30'dagi
// so'nggi sinxronlash barcha kunlik savdoni ushlab qoladi. 03:30-06:00 oralig'ida
// scheduler HECH QANDAY so'rov yubormaydi - shu payt baza "uxlashi" mumkin
// (Neon compute sarfini kamaytirish uchun).
const ACTIVE_START_MIN = 6 * 60;        // 06:00
const ACTIVE_END_MIN = 3 * 60 + 30;     // 03:30 (keyingi kun)

function isWithinActiveWindow() {
  const now = new Date();
  const tashkentMs = now.getTime() + TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000;
  const tashkentDate = new Date(tashkentMs);
  const minutesOfDay = tashkentDate.getUTCHours() * 60 + tashkentDate.getUTCMinutes();

  // Oyna kechayarimdan o'tadi (06:00 -> ertasi 03:30), shuning uchun "yoki" mantig'i:
  return minutesOfDay >= ACTIVE_START_MIN || minutesOfDay < ACTIVE_END_MIN;
}

async function fetchTransactionsForCalendarDate(date) {
  let allTx = [];
  let page = 1;
  while (true) {
    const result = await poster.call('transactions.getTransactions', {
      date_from: date,
      date_to: date,
      per_page: 100,
      page,
    });
    allTx = allTx.concat(result.data);
    if (result.data.length < 100) break;
    page += 1;
  }
  return allTx;
}

/**
 * Berilgan "ish kuni" (masalan '2026-08-23', 05:00-05:00 oynasi) uchun barcha
 * tegishli tranzaksiyalarni Poster'dan yig'ib, oynaga mos ravishda filtrlaydi.
 */
async function fetchTransactionsForBusinessDay(dateStr) {
  const { startStr, endStr, fetchDates } = getBusinessDayWindow(dateStr);

  let allTx = [];
  for (const calendarDate of fetchDates) {
    const tx = await fetchTransactionsForCalendarDate(calendarDate);
    allTx = allTx.concat(tx);
  }

  return allTx.filter((tx) => tx.date_close >= startStr && tx.date_close < endStr);
}

async function upsertDailyBonus(date, spotId, breakdown) {
  const existingRes = await pool.query(
    'SELECT cash_diff_ok FROM daily_bonus WHERE date = $1 AND spot_id = $2 LIMIT 1',
    [date, spotId]
  );
  const cashDiffOk = existingRes.rows[0] ? existingRes.rows[0].cash_diff_ok : 1;

  for (const item of breakdown) {
    await pool.query(
      `INSERT INTO daily_bonus (date, spot_id, category, quantity, bonus, cash_diff_ok, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (date, spot_id, category) DO UPDATE SET
         quantity = EXCLUDED.quantity,
         bonus = EXCLUDED.bonus,
         updated_at = EXCLUDED.updated_at`,
      [date, spotId, item.category, item.quantity, item.bonus, cashDiffOk]
    );
  }
}

/**
 * @param {string} date "Ish kuni" - masalan '2026-08-23' (05:00 dan keyingi kun 05:00 gacha)
 */
async function syncDate(date) {
  const allTx = await fetchTransactionsForBusinessDay(date);

  const bySpot = new Map();
  for (const tx of allTx) {
    const arr = bySpot.get(tx.spot_id) || [];
    arr.push(tx);
    bySpot.set(tx.spot_id, arr);
  }

  for (const [spotId, txs] of bySpot.entries()) {
    const { breakdown } = await calculateDailyBonus(txs, { spotId });
    await upsertDailyBonus(date, spotId, breakdown);
  }

  console.log(`[scheduler] ${date} (ish kuni) uchun ${bySpot.size} ta filial yangilandi (${allTx.length} tranzaksiya)`);
}

/**
 * Hozirgi vaqtga mos "ish kuni"ni aniqlaydi. Masalan agar hozir soat 02:00 bo'lsa
 * (ya'ni 05:00 dan oldin), bu hali "kechagi" ish kuniga tegishli hisoblanadi.
 */
let isSyncing = false;

async function runSync() {
  if (!isWithinActiveWindow()) {
    // Tinch soat (03:30-06:00) - hech qanday so'rov yubormaymiz, baza uxlashi mumkin
    return;
  }
  if (isSyncing) {
    console.log('[scheduler] Oldingi sinxronlash hali tugamagan, bu safar o\'tkazib yuborildi.');
    return;
  }
  isSyncing = true;
  const businessDate = getCurrentBusinessDate();
  try {
    await syncDate(businessDate);
  } catch (e) {
    console.error('[scheduler] Xato:', e.message);
  } finally {
    isSyncing = false;
  }
}

function startScheduler() {
  const intervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES || 1);
  runSync();
  cron.schedule(`*/${intervalMinutes} * * * *`, runSync);
  console.log(`[scheduler] Har ${intervalMinutes} daqiqada avtomatik yangilanish yoqildi (ish kuni: 05:00-05:00, faol soat: 06:00-03:30).`);
}

module.exports = { startScheduler, syncDate };
