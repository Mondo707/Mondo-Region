const express = require('express');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { requireSection, requireRole } = require('../middleware/auth');
const { businessDateFor } = require('../lib/businessDay');
const { syncBusinessDate } = require('../jobs/salesSync');

const router = express.Router();

async function buildTable(req) {
  const to = req.query.to || businessDateFor();
  const from = req.query.from || (req.query.days
    ? null // days berilgan bo'lsa quyida hisoblanadi
    : to);
  const categoryIds = (req.query.category_ids || '').split(',').filter(Boolean).map(Number);

  const { rows: allCategories } = await pool.query('SELECT * FROM sales_categories WHERE active = true ORDER BY sort_order');
  const selectedCategories = categoryIds.length
    ? allCategories.filter((c) => categoryIds.includes(c.id))
    : allCategories.slice(0, 5);

  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 366);
  const fromDate = from || null;

  const { rows } = await pool.query(
    fromDate
      ? `SELECT business_date::text AS business_date, category_id, quantity, amount
         FROM daily_sales_cache WHERE business_date BETWEEN $1 AND $2 ORDER BY business_date DESC`
      : `SELECT business_date::text AS business_date, category_id, quantity, amount
         FROM daily_sales_cache WHERE business_date <= $1 AND business_date > ($1::date - $2::int) ORDER BY business_date DESC`,
    fromDate ? [fromDate, to] : [to, days]
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

  return { allCategories, selectedCategories, table };
}

router.get('/', requireSection('daily_sales'), async (req, res) => {
  const { allCategories, selectedCategories, table } = await buildTable(req);
  res.json({ categories: allCategories, selected_categories: selectedCategories, table });
});

router.get('/export/xlsx', requireSection('daily_sales'), async (req, res) => {
  const { selectedCategories, table } = await buildTable(req);
  const header = ['Sana', ...selectedCategories.map((c) => c.name), 'Jami (dona)'];
  const aoa = [header];
  for (const row of table) {
    aoa.push([row.business_date, ...selectedCategories.map((c) => row[c.id] || 0), row.total_quantity]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kunlik savdo');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Kunlik_savdo.xlsx"');
  res.send(buf);
});

// Admin/curator — qo'lda sinxronlashni majburlash (masalan yangi mahsulot bog'langandan keyin).
router.post('/sync', requireRole('admin', 'curator'), async (req, res) => {
  const businessDate = req.body.business_date || businessDateFor();
  const count = await syncBusinessDate(businessDate);
  res.json({ ok: true, categories_updated: count, business_date: businessDate });
});

module.exports = router;
