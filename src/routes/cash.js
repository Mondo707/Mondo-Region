const express = require('express');
const XLSX = require('xlsx');
const { pool } = require('../db/db');
const { authRequired, requireSection } = require('../middleware/auth');
const { getComparison, getBranchDiffReport } = require('../services/cashReconcile');
const { getShiftStatus } = require('../services/posterShiftStatus');
const poster = require('../services/posterClient');

const router = express.Router();

const PAYTYPE_EXPORT_ORDER = ['HUMO', 'UZCARD', 'Инкассация', 'Uz Qr Kod', 'Click', 'Payme', 'Uzum', 'Alif', 'Paynet', 'Yandex eats', 'Jiz-Biz restaurant'];

function computeTotals(expenses, banknotes, paymentTypes) {
  const totalExpense = (expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const toza = Object.entries(banknotes || {}).reduce(
    (s, [denom, count]) => s + Number(denom) * (Number(count) || 0), 0
  );
  const totalPaytypes = Object.values(paymentTypes || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  const totalAmount = toza + totalExpense + totalPaytypes;
  return { totalExpense, toza, totalPaytypes, totalAmount };
}

// POST /api/cash/entry - xodim kunlik kassa ma'lumotlarini kiritadi
// body: { date, spot_id, expenses: [{name,amount}], banknotes: {"1000":5,...}, payment_types: {"UZCARD":100000,...} }
router.post('/entry', authRequired, requireSection('cash'), async (req, res) => {
  const { date, spot_id, expenses = [], banknotes = {}, payment_types = {} } = req.body || {};
  if (!date || !spot_id) {
    return res.status(400).json({ error: 'date, spot_id kerak' });
  }

  try {
    // Agar bu kun uchun yozuv allaqachon bo'lsa - faqat admin tahrirlashi mumkin
    const existing = await pool.query('SELECT id FROM cash_entries WHERE date = $1 AND spot_id = $2', [date, spot_id]);
    if (existing.rows.length > 0 && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Bu kun uchun ma\'lumot allaqachon yuborilgan. O\'zgartirish uchun administratorga murojaat qiling.',
      });
    }

    // Kassa smenasi yopilganini tekshiramiz (faqat birinchi marta yuborishda,
    // eng yaxshi urinish bilan - aniqlab bo'lmasa, bloklamaymiz)
    if (existing.rows.length === 0) {
      try {
        const shift = await getShiftStatus(spot_id, date);
        if (shift.status === 'open') {
          return res.status(400).json({
            error: 'Bu kun uchun kassa smenasi hali yopilmagan. Smena yopilgandan keyin yuboring.',
          });
        }
      } catch (e) {
        console.warn('[cash] Smena holatini tekshirishda xato (o\'tkazib yuborildi):', e.message);
      }
    }

    const { totalExpense, toza, totalPaytypes, totalAmount } = computeTotals(expenses, banknotes, payment_types);

    await pool.query(
      `INSERT INTO cash_entries (date, spot_id, expenses, banknotes, payment_types, toza, total_expense, total_paytypes, total_amount, entered_amount, entered_by, created_at, poster_synced_at, poster_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, now(), NULL, NULL)
       ON CONFLICT (date, spot_id) DO UPDATE SET
         expenses = EXCLUDED.expenses,
         banknotes = EXCLUDED.banknotes,
         payment_types = EXCLUDED.payment_types,
         toza = EXCLUDED.toza,
         total_expense = EXCLUDED.total_expense,
         total_paytypes = EXCLUDED.total_paytypes,
         total_amount = EXCLUDED.total_amount,
         entered_amount = EXCLUDED.entered_amount,
         entered_by = EXCLUDED.entered_by,
         created_at = now(),
         poster_synced_at = NULL,
         poster_snapshot = NULL`,
      [date, spot_id, JSON.stringify(expenses), JSON.stringify(banknotes), JSON.stringify(payment_types),
       toza, totalExpense, totalPaytypes, totalAmount, req.user.id]
    );

    res.json({
      ok: true,
      toza, total_expense: totalExpense, total_paytypes: totalPaytypes, total_amount: totalAmount,
      message: 'Ma\'lumotlar saqlandi. Poster bilan solishtirish 6 soatdan keyin ko\'rinadi.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cash/entry?date=&spot_id=
router.get('/entry', authRequired, requireSection('cash'), async (req, res) => {
  const { date, spot_id } = req.query;
  if (!date || !spot_id) return res.status(400).json({ error: 'date va spot_id kerak' });

  const result = await pool.query('SELECT * FROM cash_entries WHERE date = $1 AND spot_id = $2', [
    date, Number(spot_id),
  ]);
  const row = result.rows[0];
  if (!row) return res.json({ entry: null });

  res.json({
    entry: {
      ...row,
      expenses: JSON.parse(row.expenses || '[]'),
      banknotes: JSON.parse(row.banknotes || '{}'),
      payment_types: JSON.parse(row.payment_types || '{}'),
      // Xodim uchun: bu yozuvni faqat admin tahrirlay oladimi
      editable_by_current_user: req.user.role === 'admin',
    },
  });
});

// GET /api/cash/compare?date=&spot_id= - Poster bilan solishtirish (6 soatdan keyin ochiladi)
router.get('/compare', authRequired, requireSection('cash'), async (req, res) => {
  const { date, spot_id } = req.query;
  if (!date || !spot_id) return res.status(400).json({ error: 'date va spot_id kerak' });

  const result = await pool.query('SELECT * FROM cash_entries WHERE date = $1 AND spot_id = $2', [
    date, Number(spot_id),
  ]);
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: 'Bu kun uchun kassa yozuvi topilmadi' });

  try {
    const comparison = await getComparison(row, { forceUnlock: req.user.role === 'admin' });
    res.json(comparison);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cash/diff-journal?spot_id=&date_from=&date_to= - har bir kun uchun
// Poster bilan solishtirilgan umumiy farq tarixi
router.get('/diff-journal', authRequired, requireSection('cash'), async (req, res) => {
  const { spot_id, date_from, date_to } = req.query;
  if (!spot_id || !date_from || !date_to) {
    return res.status(400).json({ error: 'spot_id, date_from, date_to kerak' });
  }

  const allowedSpots = req.user.allowed_spots || [];
  if (allowedSpots.length > 0 && !allowedSpots.includes(Number(spot_id))) {
    return res.status(403).json({ error: 'Bu filialga ruxsatingiz yo\'q' });
  }

  const result = await pool.query(
    `SELECT * FROM cash_entries WHERE spot_id = $1 AND date >= $2 AND date <= $3 ORDER BY date DESC`,
    [Number(spot_id), date_from, date_to]
  );

  const forceUnlock = req.user.role === 'admin';
  const entries = [];
  for (const row of result.rows) {
    try {
      const comparison = await getComparison(row, { forceUnlock });
      if (comparison.locked) {
        entries.push({ date: row.date, locked: true, unlock_at: comparison.unlock_at });
      } else {
        const totalRow = comparison.rows.find((r) => r.level === 'total');
        entries.push({
          date: row.date,
          locked: false,
          fakt: totalRow.fakt,
          poster: totalRow.poster,
          diff: totalRow.fakt - totalRow.poster,
        });
      }
    } catch (e) {
      entries.push({ date: row.date, locked: true, error: e.message });
    }
  }

  res.json({ entries });
});

// GET /api/cash/journal?spot_id=&date_from=&date_to=
router.get('/journal', authRequired, requireSection('cash'), async (req, res) => {
  const { spot_id, date_from, date_to } = req.query;
  if (!spot_id || !date_from || !date_to) {
    return res.status(400).json({ error: 'spot_id, date_from, date_to kerak' });
  }

  const allowedSpots = req.user.allowed_spots || [];
  if (allowedSpots.length > 0 && !allowedSpots.includes(Number(spot_id))) {
    return res.status(403).json({ error: 'Bu filialga ruxsatingiz yo\'q' });
  }

  const result = await pool.query(
    `SELECT id, date, toza, total_expense, total_paytypes, total_amount, created_at
     FROM cash_entries
     WHERE spot_id = $1 AND date >= $2 AND date <= $3
     ORDER BY date DESC`,
    [Number(spot_id), date_from, date_to]
  );

  res.json({ entries: result.rows });
});

// GET /api/cash/export?spot_id=&date_from=&date_to= - Excel (.xlsx), FAQAT ADMIN
// Har bir filial uchun alohida varaq, sanalar ustunlarda, to'lov turlari qatorlarda.
router.get('/export', authRequired, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Excel eksport faqat administratorlar uchun' });
  }

  const { spot_id, date_from, date_to } = req.query;
  if (!date_from || !date_to) {
    return res.status(400).json({ error: 'date_from va date_to kerak' });
  }

  const conditions = ['date >= $1', 'date <= $2'];
  const params = [date_from, date_to];
  if (spot_id) {
    conditions.push('spot_id = $3');
    params.push(Number(spot_id));
  }

  const result = await pool.query(
    `SELECT * FROM cash_entries WHERE ${conditions.join(' AND ')} ORDER BY date ASC`,
    params
  );

  let spotNames = {};
  try {
    const spots = await poster.call('spots.getSpots');
    spots.forEach((s) => { spotNames[s.spot_id] = s.name; });
  } catch (e) {
    // nom topilmasa ID bilan ko'rsatamiz
  }

  const bySpot = new Map();
  result.rows.forEach((r) => {
    if (!bySpot.has(r.spot_id)) bySpot.set(r.spot_id, []);
    bySpot.get(r.spot_id).push(r);
  });

  const workbook = XLSX.utils.book_new();

  for (const [spotId, entries] of bySpot.entries()) {
    entries.sort((a, b) => (a.date < b.date ? -1 : 1));
    const dates = entries.map((e) => e.date);

    const grid = [];
    grid.push(['', ...dates]);
    grid.push(['Umumiy Kassa', ...entries.map((e) => e.total_amount)]);
    grid.push([]);

    PAYTYPE_EXPORT_ORDER.forEach((ptName) => {
      grid.push([
        ptName,
        ...entries.map((e) => {
          const pt = JSON.parse(e.payment_types || '{}');
          return Number(pt[ptName]) || 0;
        }),
      ]);
    });

    grid.push([]);
    grid.push(['Total', ...entries.map((e) => e.total_paytypes)]);
    grid.push([]);
    grid.push(['Expenses', ...entries.map((e) => e.total_expense)]);
    grid.push(['Toza', ...entries.map((e) => e.toza)]);

    const worksheet = XLSX.utils.aoa_to_sheet(grid);
    const sheetName = (spotNames[spotId] || `Filial ${spotId}`).slice(0, 31);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }

  if (bySpot.size === 0) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Ma\'lumot topilmadi']]), 'Kassa');
  }

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="kassa-${date_from}_${date_to}.xlsx"`);
  res.send(buffer);
});

// GET /api/cash/sales-summary?spot_id=&date_from=&date_to= - "Savdo" sahifasi uchun:
// kunlik umumiy kassa (jurnal + diagramma uchun) va davr statistikasi.
// spot_id bo'sh bo'lsa - foydalanuvchi ko'ra oladigan barcha filiallar bo'yicha kunlik yig'indi.
router.get('/sales-summary', authRequired, requireSection('savdo'), async (req, res) => {
  const { spot_id, date_from, date_to } = req.query;
  if (!date_from || !date_to) {
    return res.status(400).json({ error: 'date_from va date_to kerak' });
  }

  const allowedSpots = req.user.allowed_spots || [];
  if (spot_id && allowedSpots.length > 0 && !allowedSpots.includes(Number(spot_id))) {
    return res.status(403).json({ error: 'Bu filialga ruxsatingiz yo\'q' });
  }

  async function fetchDailyTotals(from, to) {
    const conditions = ['date >= $1', 'date <= $2'];
    const params = [from, to];
    let i = 3;
    if (spot_id) {
      conditions.push(`spot_id = $${i++}`);
      params.push(Number(spot_id));
    } else if (allowedSpots.length > 0) {
      const placeholders = allowedSpots.map(() => `$${i++}`).join(',');
      conditions.push(`spot_id IN (${placeholders})`);
      params.push(...allowedSpots);
    }

    const result = await pool.query(
      `SELECT date, SUM(total_amount) AS total_amount
       FROM cash_entries
       WHERE ${conditions.join(' AND ')}
       GROUP BY date
       ORDER BY date ASC`,
      params
    );
    return result.rows.map((r) => ({ date: r.date, total_amount: Number(r.total_amount) }));
  }

  try {
    const entries = await fetchDailyTotals(date_from, date_to);

    const total = entries.reduce((s, e) => s + e.total_amount, 0);
    const average = entries.length ? total / entries.length : 0;

    let max = null;
    let min = null;
    entries.forEach((e) => {
      if (!max || e.total_amount > max.total_amount) max = e;
      if (!min || e.total_amount < min.total_amount) min = e;
    });

    // Oldingi (bir xil uzunlikdagi) davr bilan solishtirish uchun
    const fromDate = new Date(date_from + 'T00:00:00');
    const toDate = new Date(date_to + 'T00:00:00');
    const daySpan = Math.round((toDate - fromDate) / (24 * 60 * 60 * 1000)) + 1;
    const prevTo = new Date(fromDate);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - (daySpan - 1));
    const fmt = (d) => d.toISOString().slice(0, 10);

    const prevEntries = await fetchDailyTotals(fmt(prevFrom), fmt(prevTo));
    const prevTotal = prevEntries.reduce((s, e) => s + e.total_amount, 0);
    const trendPercent = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

    res.json({
      entries,
      total,
      average: Math.round(average),
      max,
      min,
      previous_period: { total: prevTotal, trend_percent: trendPercent !== null ? Math.round(trendPercent * 10) / 10 : null },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cash/branch-diff-report?spot_ids=1,2,3&date_from=&date_to=
// Filiallar bo'yicha "Umumiy kassa" farqi hisoboti (Poster'ga qo'shimcha
// so'rov yubormaydi, faqat allaqachon hisoblangan yozuvlardan foydalanadi).
router.get('/branch-diff-report', authRequired, requireSection('cash'), async (req, res) => {
  const { spot_ids, date_from, date_to } = req.query;
  if (!date_from || !date_to) return res.status(400).json({ error: 'date_from, date_to kerak' });

  const allowedSpots = req.user.allowed_spots || [];
  let spotIds;
  if (spot_ids) {
    spotIds = spot_ids.split(',').map(Number);
    if (allowedSpots.length > 0) spotIds = spotIds.filter((id) => allowedSpots.includes(id));
  } else if (allowedSpots.length > 0) {
    spotIds = allowedSpots;
  } else {
    // Cheklovsiz foydalanuvchi (admin) hech qanday filial tanlamagan -
    // shu davrda ma'lumoti bor barcha filiallarni olamiz
    const distinctRes = await pool.query(
      'SELECT DISTINCT spot_id FROM cash_entries WHERE date >= $1 AND date <= $2',
      [date_from, date_to]
    );
    spotIds = distinctRes.rows.map((r) => r.spot_id);
  }
  if (!spotIds.length) return res.json({ rows: [] });

  const rows = await getBranchDiffReport(spotIds, date_from, date_to);
  res.json({ rows });
});

module.exports = router;
