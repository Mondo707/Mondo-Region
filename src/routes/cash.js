const express = require('express');
const { pool } = require('../db');
const { requireSection, requireRole } = require('../middleware/auth');
const { businessDateFor, businessDateRange } = require('../lib/businessDay');
const { computeRasxod, computeShiftDiff, splitPayments, computeTotals } = require('../lib/cashCalc');
const poster = require('../lib/poster');
const config = require('../config');

const router = express.Router();

async function loadOrDraft(businessDate) {
  const { rows } = await pool.query('SELECT * FROM cash_entries WHERE business_date = $1', [businessDate]);
  if (rows[0]) return rows[0];
  return {
    business_date: businessDate,
    denominations: {}, toza_naqd: 0, rasxod: 0, inkassatsiya: 0, smena_farqi: 0,
    payment_amounts: {}, nalichnie_amount: 0, beznal_amount: 0, sertifikat_amount: 0, jami: 0,
    submitted_at: null, locked_until: null, poster_compare: null,
  };
}

function isLocked(entry, isAdmin) {
  if (isAdmin) return false;
  if (!entry.submitted_at) return false;
  return true; // yuborilgach faqat admin tahrirlaydi (submitted bo'lса, xodim uchun har doim qulf)
}

router.get('/', requireSection('cash'), async (req, res) => {
  const businessDate = req.query.date || businessDateFor();
  const entry = await loadOrDraft(businessDate);
  const rasxod = await computeRasxod(businessDate);
  const { rows: paymentTypes } = await pool.query('SELECT * FROM payment_types WHERE active = true ORDER BY sort_order');
  res.json({ entry: { ...entry, rasxod }, payment_types: paymentTypes, business_date: businessDate });
});

router.put('/', requireSection('cash'), async (req, res) => {
  const businessDate = req.body.business_date || businessDateFor();
  const existing = await loadOrDraft(businessDate);
  const isAdmin = req.session.user.role === 'admin';

  if (isLocked(existing, isAdmin)) {
    return res.status(409).json({ error: 'Yuborilgan kassa yozuvini faqat admin tahrirlashi mumkin' });
  }

  const { denominations, toza_naqd, inkassatsiya, payment_amounts } = req.body || {};
  const rasxod = await computeRasxod(businessDate);
  const { rows: paymentTypes } = await pool.query('SELECT * FROM payment_types WHERE active = true');
  const { cardAmount, certificateAmount } = splitPayments(payment_amounts, paymentTypes);
  const totals = computeTotals({
    tozaNaqd: toza_naqd,
    rasxod,
    inkassatsiya,
    smenaFarqi: existing.smena_farqi,
    cardAmount,
    certificateAmount,
  });

  const { rows } = await pool.query(
    `INSERT INTO cash_entries(business_date, denominations, toza_naqd, rasxod, inkassatsiya, payment_amounts,
        nalichnie_amount, beznal_amount, sertifikat_amount, jami)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (business_date) DO UPDATE SET
        denominations = EXCLUDED.denominations,
        toza_naqd = EXCLUDED.toza_naqd,
        rasxod = EXCLUDED.rasxod,
        inkassatsiya = EXCLUDED.inkassatsiya,
        payment_amounts = EXCLUDED.payment_amounts,
        nalichnie_amount = EXCLUDED.nalichnie_amount,
        beznal_amount = EXCLUDED.beznal_amount,
        sertifikat_amount = EXCLUDED.sertifikat_amount,
        jami = EXCLUDED.jami
     RETURNING *`,
    [businessDate, JSON.stringify(denominations || {}), toza_naqd || 0, rasxod, inkassatsiya || 0,
      JSON.stringify(payment_amounts || {}), totals.nalichnie_amount, totals.beznal_amount, totals.sertifikat_amount, totals.jami]
  );
  res.json({ entry: rows[0] });
});

router.post('/submit', requireSection('cash'), async (req, res) => {
  const businessDate = req.body.business_date || businessDateFor();
  const existing = await loadOrDraft(businessDate);
  const isAdmin = req.session.user.role === 'admin';
  if (isLocked(existing, isAdmin)) {
    return res.status(409).json({ error: 'Bu yozuv allaqachon yuborilgan' });
  }
  const { rows } = await pool.query(
    `UPDATE cash_entries SET submitted_by = $1, submitted_at = now(),
       locked_until = now() + ($2 || ' hours')::interval
     WHERE business_date = $3 RETURNING *`,
    [req.session.user.id, config.cashLockHours, businessDate]
  );
  if (!rows[0]) return res.status(404).json({ error: "Avval kassa ma'lumotlarini saqlang" });
  res.json({ entry: rows[0] });
});

// Poster bilan solishtirish. 6 soatlik qulf ichida faqat admin ko'ra oladi.
router.get('/:date/poster-compare', requireSection('cash'), async (req, res) => {
  const businessDate = req.params.date;
  const isAdmin = req.session.user.role === 'admin';
  const { rows } = await pool.query('SELECT * FROM cash_entries WHERE business_date = $1', [businessDate]);
  const entry = rows[0];
  if (!entry || !entry.submitted_at) {
    return res.status(404).json({ error: 'Bu kun uchun kassa hali yuborilmagan' });
  }
  const locked = entry.locked_until && new Date(entry.locked_until) > new Date();
  if (locked && !isAdmin) {
    return res.status(423).json({
      error: 'Firibgarlikning oldini olish uchun natija vaqtinchalik qulflangan',
      locked_until: entry.locked_until,
    });
  }

  const { start, end } = businessDateRange(businessDate);
  const transactions = await poster.dashGetTransactions({
    dateFrom: start.toISOString(),
    dateTo: end.toISOString(),
  });
  const posterTotalSom = transactions.reduce((s, t) => s + t.sum_som, 0);

  res.json({
    entry_jami: Number(entry.jami),
    poster_jami: posterTotalSom,
    farq: Number(entry.jami) - posterTotalSom,
    locked,
  });
});

// Bitta yozuvni qayta hisoblash (faqat admin) — Poster'da chek keyinroq o'zgargan bo'lsa.
router.post('/:date/recompute', requireRole('admin'), async (req, res) => {
  const businessDate = req.params.date;
  const rasxod = await computeRasxod(businessDate);
  const { rows } = await pool.query(
    `UPDATE cash_entries SET rasxod = $1, recomputed_at = now(), recomputed_by = $2
     WHERE business_date = $3 RETURNING *`,
    [rasxod, req.session.user.id, businessDate]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  // MUHIM: butun davr uchun ommaviy qayta hisoblash ATAYLAB qo'shilmagan —
  // Poster'ga ketma-ket ko'p so'rov yuborish sekinlashtirishi va rate-limit
  // xavfini keltirib chiqaradi. Faqat bitta-bitta yozuv qayta hisoblanadi.
  res.json({ entry: rows[0] });
});

module.exports = router;
