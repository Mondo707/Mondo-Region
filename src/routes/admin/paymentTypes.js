const express = require('express');
const { pool } = require('../../db');
const { requireRole } = require('../../middleware/auth');

const router = express.Router();

router.get('/', requireRole('admin', 'curator', 'employee'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM payment_types WHERE active = true ORDER BY sort_order, name');
  res.json({ payment_types: rows });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, group_type, poster_payment_method_id } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nomi kerak' });
  const { rows: maxRows } = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM payment_types');
  try {
    const { rows } = await pool.query(
      `INSERT INTO payment_types(name, group_type, poster_payment_method_id, sort_order)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name.trim(), group_type === 'certificate' ? 'certificate' : 'card', poster_payment_method_id || null, maxRows[0].next]
    );
    res.status(201).json({ payment_type: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bunday to\'lov turi allaqachon mavjud' });
    throw e;
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { name, group_type, poster_payment_method_id, active } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE payment_types SET
       name = COALESCE($1, name),
       group_type = COALESCE($2, group_type),
       poster_payment_method_id = COALESCE($3, poster_payment_method_id),
       active = COALESCE($4, active)
     WHERE id = $5 RETURNING *`,
    [name, group_type, poster_payment_method_id, active, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ payment_type: rows[0] });
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query('UPDATE payment_types SET active = false WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ ok: true });
});

module.exports = router;
