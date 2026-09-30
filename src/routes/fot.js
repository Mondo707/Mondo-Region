const express = require('express');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { requireSection, requireRole } = require('../middleware/auth');

const router = express.Router();

function daysInPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = [];
  for (let d = 1; d <= last; d++) {
    days.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return days;
}

async function buildFot(period) {
  const days = daysInPeriod(period);
  const start = `${period}-01`;
  const end = days[days.length - 1];

  const { rows: employees } = await pool.query(
    `SELECT e.*, p.name AS position_name, p.sort_order AS position_sort
     FROM employees e LEFT JOIN positions p ON p.id = e.position_id
     WHERE e.hidden = false
     ORDER BY p.sort_order NULLS LAST, e.full_name`
  );

  const { rows: dailyRows } = await pool.query(
    `SELECT ex.employee_id, ex.business_date::text AS business_date, SUM(ex.amount) AS amount
     FROM expenses ex JOIN expense_types et ON et.id = ex.expense_type_id
     WHERE et.fot_bucket IS NOT NULL AND ex.employee_id IS NOT NULL
       AND ex.business_date BETWEEN $1 AND $2
     GROUP BY ex.employee_id, ex.business_date`,
    [start, end]
  );
  const dailyMap = new Map(); // employee_id -> { date: amount }
  for (const r of dailyRows) {
    if (!dailyMap.has(r.employee_id)) dailyMap.set(r.employee_id, {});
    dailyMap.get(r.employee_id)[r.business_date] = Number(r.amount);
  }

  const { rows: raschetRows } = await pool.query('SELECT * FROM fot_raschet WHERE period = $1', [period]);
  const raschetMap = new Map(raschetRows.map((r) => [r.employee_id, Number(r.raschet_amount)]));

  const result = employees.map((e) => {
    const daily = dailyMap.get(e.id) || {};
    const fakt = Object.values(daily).reduce((s, v) => s + v, 0);
    const fiksaAmount = Number(e.fiksa_amount);
    const percent = e.fiksa_type === 'summa' && fiksaAmount > 0 ? Math.round((fakt / fiksaAmount) * 100) : null;
    return {
      employee_id: e.id,
      full_name: e.full_name,
      position_name: e.position_name || '—',
      position_sort: e.position_sort === null ? 999 : e.position_sort,
      daily,
      fakt,
      raschet: raschetMap.get(e.id) || 0,
      fiksa_type: e.fiksa_type,
      fiksa_amount: fiksaAmount,
      percent,
    };
  });

  return { period, days, rows: result };
}

router.get('/', requireSection('fot'), async (req, res) => {
  const period = req.query.period || new Date().toISOString().slice(0, 7);
  const data = await buildFot(period);
  res.json(data);
});

router.put('/raschet', requireRole('admin'), async (req, res) => {
  const { employee_id, period, raschet_amount } = req.body || {};
  if (!employee_id || !period) return res.status(400).json({ error: 'employee_id va period kerak' });
  const { rows } = await pool.query(
    `INSERT INTO fot_raschet(employee_id, period, raschet_amount, updated_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (employee_id, period) DO UPDATE SET raschet_amount = EXCLUDED.raschet_amount,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [employee_id, period, Number(raschet_amount) || 0, req.session.user.id]
  );
  res.json({ raschet: rows[0] });
});

router.get('/export.xlsx', requireSection('fot'), async (req, res) => {
  const period = req.query.period || new Date().toISOString().slice(0, 7);
  const data = await buildFot(period);

  const header = ['F.I.O', 'Lavozim', ...data.days.map((d) => d.slice(8, 10) + '.' + d.slice(5, 7)), 'Raschet', 'Fakt', 'Fiksa', '%'];
  const aoa = [header];
  for (const r of data.rows) {
    const dayCells = data.days.map((d) => r.daily[d] || '');
    const fiksaCell = r.fiksa_type === 'summa' ? r.fiksa_amount : (r.fiksa_type === 'kunlik' ? 'Kunlik' : 'Haftalik');
    aoa.push([r.full_name, r.position_name, ...dayCells, r.raschet, r.fakt, fiksaCell, r.percent === null ? '' : `${r.percent}%`]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FOT');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="FOT_${period}.xlsx"`);
  res.send(buf);
});

module.exports = router;
