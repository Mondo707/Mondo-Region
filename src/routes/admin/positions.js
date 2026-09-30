const express = require('express');
const { pool } = require('../../db');
const { requireRole, requireAuth } = require('../../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM positions ORDER BY sort_order, name');
  res.json({ positions: rows });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Lavozim nomi kerak' });
  const { rows: maxRows } = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM positions');
  try {
    const { rows } = await pool.query(
      'INSERT INTO positions(name, sort_order) VALUES ($1,$2) RETURNING *',
      [name.trim(), maxRows[0].next]
    );
    res.status(201).json({ position: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bunday lavozim allaqachon mavjud' });
    throw e;
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { name, sort_order } = req.body || {};
  const { rows } = await pool.query(
    'UPDATE positions SET name = COALESCE($1, name), sort_order = COALESCE($2, sort_order) WHERE id = $3 RETURNING *',
    [name, sort_order, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ position: rows[0] });
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM positions WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23503') {
      return res.status(409).json({ error: "Bu lavozimga bog'langan xodimlar bor — avval ularni boshqa lavozimga o'tkazing" });
    }
    throw e;
  }
});

module.exports = router;
