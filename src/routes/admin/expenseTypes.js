const express = require('express');
const { pool } = require('../../db');
const { requireRole } = require('../../middleware/auth');

const router = express.Router();

router.get('/', requireRole('admin', 'curator', 'employee'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM expense_types WHERE active = true ORDER BY sort_order, name');
  res.json({ expense_types: rows });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, requires_employee, fot_bucket } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nomi kerak' });
  const { rows: maxRows } = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM expense_types');
  try {
    const { rows } = await pool.query(
      'INSERT INTO expense_types(name, requires_employee, fot_bucket, sort_order) VALUES ($1,$2,$3,$4) RETURNING *',
      [name.trim(), !!requires_employee, fot_bucket || null, maxRows[0].next]
    );
    res.status(201).json({ expense_type: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bunday xarajat turi allaqachon mavjud' });
    throw e;
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { name, requires_employee, fot_bucket, active } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE expense_types SET
       name = COALESCE($1, name),
       requires_employee = COALESCE($2, requires_employee),
       fot_bucket = COALESCE($3, fot_bucket),
       active = COALESCE($4, active)
     WHERE id = $5 RETURNING *`,
    [name, requires_employee, fot_bucket, active, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ expense_type: rows[0] });
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  // Yumshoq o'chirish — tarixiy xarajatlar buzilmasligi uchun faqat active=false qilinadi.
  const { rows } = await pool.query('UPDATE expense_types SET active = false WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ ok: true });
});

module.exports = router;
