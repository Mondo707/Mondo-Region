const express = require('express');
const { pool } = require('../../db');
const { requireAdminOrCurator, requireAuth } = require('../../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM ingredients WHERE active = true ORDER BY name');
  res.json({ ingredients: rows });
});

router.post('/', requireAdminOrCurator('ingredients:write'), async (req, res) => {
  const { name, unit, poster_ingredient_id } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nomi kerak' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO ingredients(name, unit, poster_ingredient_id) VALUES ($1,$2,$3) RETURNING *',
      [name.trim(), unit || 'kg', poster_ingredient_id || null]
    );
    res.status(201).json({ ingredient: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bunday ingredient allaqachon mavjud' });
    throw e;
  }
});

router.put('/:id', requireAdminOrCurator('ingredients:write'), async (req, res) => {
  const { name, unit, poster_ingredient_id, active } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE ingredients SET name = COALESCE($1,name), unit = COALESCE($2,unit),
       poster_ingredient_id = COALESCE($3, poster_ingredient_id), active = COALESCE($4, active)
     WHERE id = $5 RETURNING *`,
    [name, unit, poster_ingredient_id, active, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ ingredient: rows[0] });
});

router.delete('/:id', requireAdminOrCurator('ingredients:write'), async (req, res) => {
  const { rows } = await pool.query('UPDATE ingredients SET active = false WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ ok: true });
});

module.exports = router;
