const express = require('express');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { requireSection, requireRole } = require('../middleware/auth');
const { businessDateFor } = require('../lib/businessDay');
const { computeRasxodBreakdown, splitPayments, computeEntryJami } = require('../lib/cashCalc');
const { computePosterCompare } = require('../lib/posterCompare');
const config = require('../config');

const router = express.Router();

function resolveViewDate(req) {
  // Ko'rish — hammaga ochiq: istalgan sanani ko'rish mumkin.
  return req.query.date || businessDateFor();
}

async function resolveWriteDate(req) {
  // Yozish (PUT/submit) — eski sanaga faqat admin/curator kirita oladi.
  const isAdmin = req.session.user.role === 'admin';
  const isCurator = req.session.user.role === 'curator';
  const requested = req.query.date || req.body.business_date;
  if (requested && (isAdmin || isCurator)) return requested;
  if (requested && !(isAdmin || isCurator) && requested !== businessDateFor()) {
    throw Object.assign(new Error("Faqat admin yoki curator eski sanaga kirita oladi"), { status: 403 });
  }
  return businessDateFor();
}

async function loadOrDraft(businessDate) {
  const { rows } = await pool.query('SELECT * FROM cash_entries WHERE business_date = $1', [businessDate]);
  if (rows[0]) return rows[0];
  return {
    business_date: businessDate, denominations: {}, toza_naqd: 0,
    payment_amounts: {}, jami: 0, submitted_at: null, locked_until: null, poster_compare: null,
  };
}

function isLocked(entry, isAdmin) {
  if (isAdmin) return false;
  return !!entry.submitted_at;
}

router.get('/', requireSection('cash'), async (req, res) => {
  const businessDate = resolveViewDate(req);
  const entry = await loadOrDraft(businessDate);
  const rasxod = await computeRasxodBreakdown(businessDate);
  const { rows: paymentTypes } = await pool.query('SELECT * FROM payment_types WHERE active = true ORDER BY sort_order');
  res.json({ entry: { ...entry, rasxod }, payment_types: paymentTypes, business_date: businessDate });
});

router.put('/', requireSection('cash'), async (req, res) => {
  let businessDate;
  try { businessDate = await resolveWriteDate(req); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

  const existing = await loadOrDraft(businessDate);
  const isAdmin = req.session.user.role === 'admin';
  if (isLocked(existing, isAdmin)) {
    return res.status(409).json({ error: 'Yuborilgan kassa yozuvini faqat admin tahrirlashi mumkin' });
  }

  const { denominations, toza_naqd, payment_amounts } = req.body || {};
  const rasxod = await computeRasxodBreakdown(businessDate);
  const { rows: paymentTypes } = await pool.query('SELECT * FROM payment_types WHERE active = true');
  const { tolovTurlariYigindisi } = splitPayments(payment_amounts, paymentTypes);
  const jami = computeEntryJami({ tozaNaqd: toza_naqd, rasxodTotal: rasxod.total, tolovTurlariYigindisi });

  const { rows } = await pool.query(
    `INSERT INTO cash_entries(business_date, denominations, toza_naqd, rasxod, payment_amounts, beznal_amount, jami)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (business_date) DO UPDATE SET
        denominations = EXCLUDED.denominations, toza_naqd = EXCLUDED.toza_naqd,
        rasxod = EXCLUDED.rasxod, payment_amounts = EXCLUDED.payment_amounts,
        beznal_amount = EXCLUDED.beznal_amount, jami = EXCLUDED.jami
     RETURNING *`,
    [businessDate, JSON.stringify(denominations || {}), toza_naqd || 0, rasxod.total,
      JSON.stringify(payment_amounts || {}), tolovTurlariYigindisi, jami]
  );
  res.json({ entry: { ...rows[0], rasxod } });
});

router.post('/submit', requireSection('cash'), async (req, res) => {
  let businessDate;
  try { businessDate = await resolveWriteDate(req); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

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
    return res.status(423).json({ error: 'Firibgarlikning oldini olish uchun natija vaqtinchalik qulflangan', locked_until: entry.locked_until });
  }

  let compare = entry.poster_compare;
  if (!compare) {
    const rasxod = await computeRasxodBreakdown(businessDate);
    const { rows: paymentTypes } = await pool.query('SELECT * FROM payment_types WHERE active = true');
    compare = await computePosterCompare(businessDate, entry, paymentTypes, rasxod);
    await pool.query('UPDATE cash_entries SET poster_compare = $1 WHERE business_date = $2', [JSON.stringify(compare), businessDate]);
  }
  res.json({ compare, locked });
});

// Bitta yozuvni qayta hisoblash (faqat admin) — Poster'da chek keyinroq o'zgargan bo'lsa.
// MUHIM: butun davr uchun ommaviy qayta hisoblash ATAYLAB qo'shilmagan — Poster'ga
// ketma-ket ko'p so'rov yuborish sekinlashtirishi va rate-limit xavfini keltirib chiqaradi.
router.post('/:date/recompute', requireRole('admin'), async (req, res) => {
  const businessDate = req.params.date;
  const { rows: entryRows } = await pool.query('SELECT * FROM cash_entries WHERE business_date = $1', [businessDate]);
  const entry = entryRows[0];
  if (!entry) return res.status(404).json({ error: 'Topilmadi' });

  const rasxod = await computeRasxodBreakdown(businessDate);
  const { rows: paymentTypes } = await pool.query('SELECT * FROM payment_types WHERE active = true');
  const compare = await computePosterCompare(businessDate, entry, paymentTypes, rasxod);

  const { rows } = await pool.query(
    `UPDATE cash_entries SET rasxod = $1, poster_compare = $2, recomputed_at = now(), recomputed_by = $3
     WHERE business_date = $4 RETURNING *`,
    [rasxod.total, JSON.stringify(compare), req.session.user.id, businessDate]
  );
  res.json({ entry: rows[0], compare });
});

async function journalRows(from, to) {
  const { rows } = await pool.query(
    `SELECT business_date::text AS business_date, toza_naqd, rasxod, beznal_amount, jami, poster_compare
     FROM cash_entries WHERE business_date BETWEEN $1 AND $2 ORDER BY business_date DESC`,
    [from, to]
  );
  return rows;
}

router.get('/journal', requireSection('cash'), async (req, res) => {
  const to = req.query.to || businessDateFor();
  const from = req.query.from || to;
  const rows = await journalRows(from, to);
  res.json({ rows });
});

router.get('/journal/export.xlsx', requireSection('cash'), async (req, res) => {
  const to = req.query.to || businessDateFor();
  const from = req.query.from || to;
  const rows = await journalRows(from, to);
  const aoa = [['Sana', 'Тоза', 'Rasxod', "To'lov turlari", 'Umumiy kassa']];
  for (const r of rows) aoa.push([r.business_date, Number(r.toza_naqd), Number(r.rasxod), Number(r.beznal_amount), Number(r.jami)]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kassa jurnali');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Kassa_jurnali_${from}_${to}.xlsx"`);
  res.send(buf);
});

router.get('/farq-journal', requireRole('admin'), async (req, res) => {
  const to = req.query.to || businessDateFor();
  const from = req.query.from || to;
  const rows = await journalRows(from, to);
  const result = rows.filter((r) => r.poster_compare).map((r) => ({
    business_date: r.business_date,
    fakt: r.poster_compare.umumiy.fakt,
    poster: r.poster_compare.umumiy.poster,
    farq: r.poster_compare.umumiy.farq,
  }));
  res.json({ rows: result });
});

router.get('/farq-journal/export.xlsx', requireRole('admin'), async (req, res) => {
  const to = req.query.to || businessDateFor();
  const from = req.query.from || to;
  const rows = await journalRows(from, to);
  const aoa = [['Sana', 'Fakt', 'Poster', 'Farq']];
  for (const r of rows) {
    if (!r.poster_compare) continue;
    aoa.push([r.business_date, r.poster_compare.umumiy.fakt, r.poster_compare.umumiy.poster, r.poster_compare.umumiy.farq]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Farq jurnali');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Farq_jurnali_${from}_${to}.xlsx"`);
  res.send(buf);
});

module.exports = router;
