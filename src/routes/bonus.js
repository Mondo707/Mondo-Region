const express = require('express');
const { pool } = require('../db/db');
const { authRequired, requireAnySection } = require('../middleware/auth');
const { getEffectiveCategories } = require('../services/configService');

const router = express.Router();

// GET /api/bonus/tiers - barcha kategoriyalarning pog'ona jadvalini qaytaradi.
// Har qanday login qilgan foydalanuvchi ko'ra oladi (maxfiy emas, xodimlar uchun
// ham "Bonus jadvali" sahifasida ko'rsatiladi).
router.get('/tiers', authRequired, async (req, res) => {
  res.json({ categories: await getEffectiveCategories() });
});

// GET /api/bonus/journal?spot_id=6&date_from=2026-08-01&date_to=2026-08-23&category=Лимонады
router.get('/journal', authRequired, requireAnySection('kpi'), async (req, res) => {
  const { spot_id, date_from, date_to, category } = req.query;
  if (!spot_id || !date_from || !date_to) {
    return res.status(400).json({ error: 'spot_id, date_from, date_to kerak' });
  }

  const allowedSpots = req.user.allowed_spots || [];
  if (allowedSpots.length > 0 && !allowedSpots.includes(Number(spot_id))) {
    return res.status(403).json({ error: 'Bu filialga ruxsatingiz yo\'q' });
  }

  const params = [Number(spot_id), date_from, date_to];
  let categoryClause = '';
  if (category) {
    params.push(category);
    categoryClause = `AND category = $${params.length}`;
  }

  const result = await pool.query(
    `SELECT date,
            SUM(CASE WHEN cash_diff_ok = 1 THEN bonus ELSE 0 END) AS calc_bonus,
            MIN(cash_diff_ok) AS ok
     FROM daily_bonus
     WHERE spot_id = $1 AND date >= $2 AND date <= $3 ${categoryClause}
     GROUP BY date
     ORDER BY date DESC`,
    params
  );

  const entries = result.rows.map((r) => ({
    date: r.date,
    bonus: r.ok ? Number(r.calc_bonus) : 0,
    calc_bonus: Number(r.calc_bonus),
    ok: !!r.ok,
  }));

  const total = entries.reduce((sum, e) => sum + e.bonus, 0);

  res.json({ entries, total });
});

// GET /api/bonus?date_from=2026-08-01&date_to=2026-08-23&spot_id=6&category=Лимонады
// KPI sahifasi va Kunlik savdo sahifasi ikkalasi ham shu endpointdan foydalanadi.
router.get('/', authRequired, requireAnySection('kpi', 'daily_sales'), async (req, res) => {
  const { date_from, date_to, spot_id, category, categories } = req.query;

  if (!date_from || !date_to) {
    return res.status(400).json({ error: 'date_from va date_to kerak' });
  }

  const conditions = [];
  const params = [];
  let i = 1;

  conditions.push(`date >= $${i++}`);
  params.push(date_from);
  conditions.push(`date <= $${i++}`);
  params.push(date_to);

  const allowedSpots = req.user.allowed_spots || [];
  if (allowedSpots.length > 0) {
    const placeholders = allowedSpots.map(() => `$${i++}`).join(',');
    conditions.push(`spot_id IN (${placeholders})`);
    params.push(...allowedSpots);
  }

  if (spot_id) {
    conditions.push(`spot_id = $${i++}`);
    params.push(Number(spot_id));
  }
  if (categories) {
    // Bir nechta kategoriya (vergul bilan ajratilgan) - Kunlik savdo sahifasida ishlatiladi
    const categoryList = categories.split(',').map((c) => c.trim()).filter(Boolean);
    if (categoryList.length) {
      const placeholders = categoryList.map(() => `$${i++}`).join(',');
      conditions.push(`category IN (${placeholders})`);
      params.push(...categoryList);
    }
  } else if (category) {
    conditions.push(`category = $${i++}`);
    params.push(category);
  }

  const sql = `
    SELECT date, spot_id, category, quantity, bonus, cash_diff_ok
    FROM daily_bonus
    WHERE ${conditions.join(' AND ')}
    ORDER BY date DESC, spot_id ASC, category ASC
  `;

  const result = await pool.query(sql, params);
  const rows = result.rows.map((r) => ({ ...r, quantity: Number(r.quantity), bonus: Number(r.bonus) }));

  const totalBonus = rows.reduce((sum, r) => sum + (r.cash_diff_ok ? r.bonus : 0), 0);

  res.json({ rows, total_bonus: totalBonus, count: rows.length });
});

module.exports = router;
