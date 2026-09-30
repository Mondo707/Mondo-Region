const express = require('express');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { requireSection } = require('../middleware/auth');
const { businessDateFor } = require('../lib/businessDay');

const router = express.Router();

function resolveWriteDate(req) {
  const isAdminOrCurator = req.session.user.role === 'admin' || req.session.user.role === 'curator';
  const requested = req.body.business_date;
  if (requested && isAdminOrCurator) return requested;
  if (requested && !isAdminOrCurator && requested !== businessDateFor()) {
    throw Object.assign(new Error("Faqat admin yoki curator eski sanaga kirita oladi"), { status: 403 });
  }
  return businessDateFor();
}

router.get('/', requireSection('expenses'), async (req, res) => {
  const to = req.query.to || req.query.date || businessDateFor();
  const from = req.query.from || req.query.date || to;
  const { rows } = await pool.query(
    `SELECT ex.*, et.name AS expense_type_name, et.fot_bucket, emp.full_name AS employee_name,
            u.full_name AS created_by_name
     FROM expenses ex
     JOIN expense_types et ON et.id = ex.expense_type_id
     LEFT JOIN employees emp ON emp.id = ex.employee_id
     LEFT JOIN users u ON u.id = ex.created_by
     WHERE ex.business_date BETWEEN $1 AND $2
     ORDER BY ex.business_date DESC, ex.created_at DESC`,
    [from, to]
  );
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  res.json({ expenses: rows, total, from, to });
});

router.post('/', requireSection('expenses'), async (req, res) => {
  const { expense_type_id, employee_id, amount, comment } = req.body || {};
  const amt = Number(amount);
  if (!expense_type_id || !(amt > 0)) {
    return res.status(400).json({ error: 'expense_type_id va musbat amount kerak' });
  }

  let businessDate;
  try { businessDate = resolveWriteDate(req); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

  const { rows: etRows } = await pool.query('SELECT * FROM expense_types WHERE id = $1 AND active = true', [expense_type_id]);
  const expenseType = etRows[0];
  if (!expenseType) return res.status(404).json({ error: "Xarajat turi topilmadi" });
  if (expenseType.requires_employee && !employee_id) {
    return res.status(400).json({ error: `"${expenseType.name}" uchun xodim tanlanishi shart` });
  }

  const { rows } = await pool.query(
    `INSERT INTO expenses(business_date, expense_type_id, employee_id, amount, comment, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [businessDate, expense_type_id, employee_id || null, amt, comment || null, req.session.user.id]
  );
  res.status(201).json({ expense: rows[0] });
});

router.delete('/:id', requireSection('expenses'), async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'admin' && u.role !== 'curator') {
    return res.status(403).json({ error: "Faqat admin yoki curator xarajatni o'chira oladi" });
  }
  const { rowCount } = await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ ok: true });
});

router.get('/export/xlsx', requireSection('expenses'), async (req, res) => {
  const to = req.query.to || businessDateFor();
  const from = req.query.from || to;
  const { rows } = await pool.query(
    `SELECT ex.business_date::text AS business_date, et.name AS expense_type_name,
            emp.full_name AS employee_name, ex.amount, ex.comment, ex.created_at
     FROM expenses ex
     JOIN expense_types et ON et.id = ex.expense_type_id
     LEFT JOIN employees emp ON emp.id = ex.employee_id
     WHERE ex.business_date BETWEEN $1 AND $2
     ORDER BY ex.business_date DESC, ex.created_at DESC`,
    [from, to]
  );
  const aoa = [['Sana', 'Turi', 'Xodim', 'Summa', 'Kommentariya']];
  for (const r of rows) aoa.push([r.business_date, r.expense_type_name, r.employee_name || '', Number(r.amount), r.comment || '']);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Xarajatlar');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Xarajatlar_${from}_${to}.xlsx"`);
  res.send(buf);
});

module.exports = router;
