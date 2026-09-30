const express = require('express');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { requireSection } = require('../middleware/auth');
const { businessDateFor } = require('../lib/businessDay');

const router = express.Router();

async function loadSeries(req) {
  const to = req.query.to || businessDateFor();
  if (req.query.from) {
    const { rows } = await pool.query(
      `SELECT business_date::text AS business_date, jami
       FROM cash_entries WHERE business_date BETWEEN $1 AND $2 AND submitted_at IS NOT NULL
       ORDER BY business_date ASC`,
      [req.query.from, to]
    );
    return rows;
  }
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 366);
  const { rows } = await pool.query(
    `SELECT business_date::text AS business_date, jami
     FROM cash_entries
     WHERE business_date <= $1 AND business_date > ($1::date - $2::int) AND submitted_at IS NOT NULL
     ORDER BY business_date ASC`,
    [to, days]
  );
  return rows;
}

router.get('/', requireSection('savdo'), async (req, res) => {
  const rows = await loadSeries(req);
  const amounts = rows.map((r) => Number(r.jami));
  const avg = amounts.length ? amounts.reduce((s, v) => s + v, 0) / amounts.length : 0;
  const max = amounts.length ? Math.max(...amounts) : 0;
  const min = amounts.length ? Math.min(...amounts) : 0;
  res.json({ series: rows, average: avg, max, min });
});

router.get('/export/xlsx', requireSection('savdo'), async (req, res) => {
  const rows = await loadSeries(req);
  const aoa = [['Sana', 'Umumiy kassa']];
  for (const r of rows) aoa.push([r.business_date, Number(r.jami)]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Savdo');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Savdo.xlsx"');
  res.send(buf);
});

module.exports = router;
