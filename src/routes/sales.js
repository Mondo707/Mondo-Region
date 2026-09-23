const express = require('express');
const { pool } = require('../db');
const { requireSection } = require('../middleware/auth');
const { businessDateFor } = require('../lib/businessDay');

const router = express.Router();

router.get('/', requireSection('savdo'), async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 90);
  const today = businessDateFor();

  const { rows } = await pool.query(
    `SELECT business_date::text AS business_date, jami
     FROM cash_entries
     WHERE business_date <= $1 AND business_date > ($1::date - $2::int) AND submitted_at IS NOT NULL
     ORDER BY business_date ASC`,
    [today, days]
  );

  const amounts = rows.map((r) => Number(r.jami));
  const avg = amounts.length ? amounts.reduce((s, v) => s + v, 0) / amounts.length : 0;
  const max = amounts.length ? Math.max(...amounts) : 0;
  const min = amounts.length ? Math.min(...amounts) : 0;

  res.json({ series: rows, average: avg, max, min });
});

module.exports = router;
