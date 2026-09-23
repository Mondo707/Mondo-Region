const express = require('express');
const { pool } = require('../db');
const { requireSection } = require('../middleware/auth');
const { businessDateFor } = require('../lib/businessDay');

const router = express.Router();

router.get('/', requireSection('expenses'), async (req, res) => {
  const businessDate = req.query.date || businessDateFor();
  const { rows } = await pool.query(
    `SELECT ex.*, et.name AS expense_type_name, et.fot_bucket, emp.full_name AS employee_name,
            u.full_name AS created_by_name
     FROM expenses ex
     JOIN expense_types et ON et.id = ex.expense_type_id
     LEFT JOIN employees emp ON emp.id = ex.employee_id
     LEFT JOIN users u ON u.id = ex.created_by
     WHERE ex.business_date = $1
     ORDER BY ex.created_at DESC`,
    [businessDate]
  );
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  res.json({ expenses: rows, total, business_date: businessDate });
});

router.post('/', requireSection('expenses'), async (req, res) => {
  const { expense_type_id, employee_id, amount, comment } = req.body || {};
  const amt = Number(amount);
  if (!expense_type_id || !(amt > 0)) {
    return res.status(400).json({ error: 'expense_type_id va musbat amount kerak' });
  }

  const { rows: etRows } = await pool.query('SELECT * FROM expense_types WHERE id = $1 AND active = true', [expense_type_id]);
  const expenseType = etRows[0];
  if (!expenseType) return res.status(404).json({ error: "Xarajat turi topilmadi" });
  if (expenseType.requires_employee && !employee_id) {
    return res.status(400).json({ error: `"${expenseType.name}" uchun xodim tanlanishi shart` });
  }

  const businessDate = businessDateFor();
  const { rows } = await pool.query(
    `INSERT INTO expenses(business_date, expense_type_id, employee_id, amount, comment, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [businessDate, expense_type_id, employee_id || null, amt, comment || null, req.session.user.id]
  );
  res.status(201).json({ expense: rows[0] });
});

router.delete('/:id', requireSection('expenses'), async (req, res) => {
  // Faqat admin yoki curator o'chira oladi (xodim faqat qo'sha oladi) — kassa/FOT bilan izchillik uchun.
  const u = req.session.user;
  if (u.role !== 'admin' && u.role !== 'curator') {
    return res.status(403).json({ error: "Faqat admin yoki curator xarajatni o'chira oladi" });
  }
  const { rowCount } = await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ ok: true });
});

module.exports = router;
