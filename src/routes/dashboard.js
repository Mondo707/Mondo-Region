const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { businessDateFor } = require('../lib/businessDay');

const router = express.Router();

router.get('/summary', requireAuth, async (req, res) => {
  const u = req.session.user;
  const today = businessDateFor();
  const summary = { business_date: today, show_sales_widget: !!u.show_sales_widget };

  if (u.show_sales_widget) {
    const { rows } = await pool.query('SELECT jami FROM cash_entries WHERE business_date = $1', [today]);
    summary.today_sales = rows[0] ? Number(rows[0].jami) : null;
  } else {
    summary.today_sales = null; // admin panelda o'chirilgan — frontend kartani butunlay yashiradi
  }

  const { rows: bozRows } = await pool.query(
    "SELECT COUNT(*)::int AS c FROM bozorlik_entries WHERE status = 'pending'"
  );
  summary.pending_bozorlik = bozRows[0].c;

  const { rows: expRows } = await pool.query(
    'SELECT COALESCE(SUM(amount),0) AS s FROM expenses WHERE business_date = $1',
    [today]
  );
  summary.today_expenses = Number(expRows[0].s);

  const { rows: cashRows } = await pool.query('SELECT submitted_at FROM cash_entries WHERE business_date = $1', [today]);
  summary.cash_submitted = !!(cashRows[0] && cashRows[0].submitted_at);

  res.json(summary);
});

module.exports = router;
