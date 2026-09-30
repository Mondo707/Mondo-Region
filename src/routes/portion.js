// "Portsiya" bo'limi - xodimlar uchun kiritish/solishtirish, va filiallar
// bo'yicha farq hisoboti.

const express = require('express');
const { pool } = require('../db/db');
const { authRequired, requireSection } = require('../middleware/auth');
const { getTrackedIngredients, getComparison, getBranchReport } = require('../services/portionService');

const router = express.Router();

router.use(authRequired, requireSection('portsiya'));

// GET /api/portion/ingredients - kiritish formasi uchun kuzatilayotgan ingredientlar ro'yxati
router.get('/ingredients', async (req, res) => {
  const ingredients = await getTrackedIngredients();
  res.json({ ingredients });
});

// POST /api/portion/entry - kunlik o'lchovni yuborish
// body: { date, spot_id, values: { "1": 18.5, "2": 7.2 } } (kalitlar - ingredient id)
router.post('/entry', async (req, res) => {
  const { date, spot_id, values } = req.body || {};
  if (!date || !spot_id || !values) {
    return res.status(400).json({ error: 'date, spot_id, values kerak' });
  }

  const allowedSpots = req.user.allowed_spots || [];
  if (allowedSpots.length > 0 && !allowedSpots.includes(Number(spot_id))) {
    return res.status(403).json({ error: 'Bu filialga ruxsatingiz yo\'q' });
  }

  const existing = await pool.query('SELECT id FROM portion_entries WHERE date = $1 AND spot_id = $2', [date, Number(spot_id)]);
  if (existing.rows.length > 0 && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Bu kun uchun allaqachon yuborilgan, faqat admin tahrirlashi mumkin' });
  }

  if (existing.rows.length > 0) {
    await pool.query(
      'UPDATE portion_entries SET values_json = $1, poster_snapshot = NULL, poster_synced_at = NULL, entered_by = $2 WHERE id = $3',
      [JSON.stringify(values), req.user.login, existing.rows[0].id]
    );
  } else {
    await pool.query(
      'INSERT INTO portion_entries (date, spot_id, values_json, entered_by) VALUES ($1, $2, $3, $4)',
      [date, Number(spot_id), JSON.stringify(values), req.user.login]
    );
  }

  res.json({ ok: true });
});

// GET /api/portion/entry?date=&spot_id= - kiritilgan qiymatlarni o'qish
router.get('/entry', async (req, res) => {
  const { date, spot_id } = req.query;
  if (!date || !spot_id) return res.status(400).json({ error: 'date, spot_id kerak' });

  const result = await pool.query('SELECT * FROM portion_entries WHERE date = $1 AND spot_id = $2', [date, Number(spot_id)]);
  if (!result.rows.length) return res.json({ entry: null });
  res.json({ entry: result.rows[0] });
});

// GET /api/portion/compare?date=&spot_id= - Poster bilan solishtirish
router.get('/compare', async (req, res) => {
  const { date, spot_id } = req.query;
  if (!date || !spot_id) return res.status(400).json({ error: 'date, spot_id kerak' });

  const result = await pool.query('SELECT * FROM portion_entries WHERE date = $1 AND spot_id = $2', [date, Number(spot_id)]);
  if (!result.rows.length) return res.status(404).json({ error: 'Bu kun uchun ma\'lumot kiritilmagan' });

  const forceUnlock = req.user.role === 'admin';
  const comparison = await getComparison(result.rows[0], { forceUnlock });
  res.json(comparison);
});

// GET /api/portion/branch-report?spot_ids=1,2,3&date_from=&date_to=
router.get('/branch-report', async (req, res) => {
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
    const distinctRes = await pool.query(
      'SELECT DISTINCT spot_id FROM portion_entries WHERE date >= $1 AND date <= $2',
      [date_from, date_to]
    );
    spotIds = distinctRes.rows.map((r) => r.spot_id);
  }
  if (!spotIds.length) return res.json({ ingredients: [], rows: [] });

  const report = await getBranchReport(spotIds, date_from, date_to);
  res.json(report);
});

module.exports = router;
