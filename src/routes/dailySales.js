const express = require('express');
const { pool } = require('../db');
const { requireSection, requireRole } = require('../middleware/auth');
const { businessDateFor } = require('../lib/businessDay');
const { syncBusinessDate } = require('../jobs/salesSync');

const router = express.Router();

router.get('/', requireSection('daily_sales'), async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 31);
  const categoryIds = (req.query.category_ids || '').split(',').filter(Boolean).map(Number);

  const { rows: allCategories } = await pool.query('SELECT * FROM sales_categories WHERE active = true ORDER BY sort_order');
  const selectedCategories = categoryIds.length
    ? allCategories.filter((c) => categoryIds.includes(c.id))
    : allCategories.slice(0, 5);

  const today = businessDateFor();
  const { rows } = await pool.query(
    `SELECT business_date::text AS business_date, category_id, quantity, amount
     FROM daily_sales_cache
     WHERE business_date <= $1 AND business_date > ($1::date - $2::int)
     ORDER BY business_date DESC`,
    [today, days]
  );

  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.business_date)) byDate.set(r.business_date, {});
    byDate.get(r.business_date)[r.category_id] = { quantity: Number(r.quantity), amount: Number(r.amount) };
  }

  const dates = Array.from(byDate.keys()).sort().reverse();
  const table = dates.map((date) => {
    const cats = byDate.get(date);
    const row = { business_date: date };
    let totalQty = 0;
    for (const c of selectedCategories) {
      const v = cats[c.id] || { quantity: 0, amount: 0 };
      row[c.id] = v.quantity;
      totalQty += v.quantity;
    }
    row.total_quantity = totalQty;
    return row;
  });

  res.json({ categories: allCategories, selected_categories: selectedCategories, table });
});

// Admin/curator — qo'lda sinxronlashni majburlash (masalan yangi mahsulot bog'langandan keyin).
router.post('/sync', requireRole('admin', 'curator'), async (req, res) => {
  const businessDate = req.body.business_date || businessDateFor();
  const count = await syncBusinessDate(businessDate);
  res.json({ ok: true, categories_updated: count, business_date: businessDate });
});

module.exports = router;
