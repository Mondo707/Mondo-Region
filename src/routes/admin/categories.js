const express = require('express');
const { pool } = require('../../db');
const { requireAdminOrCurator, requireRole } = require('../../middleware/auth');
const poster = require('../../lib/poster');

const router = express.Router();

router.get('/', requireRole('admin', 'curator', 'employee'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM sales_categories WHERE active = true ORDER BY sort_order, name');
  res.json({ categories: rows });
});

router.post('/', requireAdminOrCurator('sales_categories:write'), async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nomi kerak' });
  const { rows: maxRows } = await pool.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM sales_categories');
  try {
    const { rows } = await pool.query(
      'INSERT INTO sales_categories(name, sort_order) VALUES ($1,$2) RETURNING *',
      [name.trim(), maxRows[0].next]
    );
    res.status(201).json({ category: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bunday kategoriya allaqachon mavjud' });
    throw e;
  }
});

router.put('/:id', requireAdminOrCurator('sales_categories:write'), async (req, res) => {
  const { name, active } = req.body || {};
  const { rows } = await pool.query(
    'UPDATE sales_categories SET name = COALESCE($1,name), active = COALESCE($2,active) WHERE id = $3 RETURNING *',
    [name, active, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ category: rows[0] });
});

router.delete('/:id', requireAdminOrCurator('sales_categories:write'), async (req, res) => {
  const { rows } = await pool.query('UPDATE sales_categories SET active = false WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ ok: true });
});

// Poster'dagi mahsulotlardan hali kategoriyaga bog'lanmaganlarini ko'rsatadi.
router.get('/unmapped-products', requireAdminOrCurator('sales_categories:write'), async (req, res) => {
  const products = await poster.menuGetProducts();
  const { rows: mapped } = await pool.query('SELECT poster_product_id FROM product_category_map');
  const mappedIds = new Set(mapped.map((m) => m.poster_product_id));
  const unmapped = products.filter((p) => !mappedIds.has(p.product_id));
  res.json({ products: unmapped });
});

// Mahsulotni kategoriyaga bog'lash — darhol kuchga kiradi (server qayta ishga tushmasdan).
router.post('/map-product', requireAdminOrCurator('sales_categories:write'), async (req, res) => {
  const { poster_product_id, product_name, category_id } = req.body || {};
  if (!poster_product_id || !category_id) {
    return res.status(400).json({ error: 'poster_product_id va category_id kerak' });
  }
  const { rows } = await pool.query(
    `INSERT INTO product_category_map(poster_product_id, product_name, category_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (poster_product_id) DO UPDATE SET category_id = EXCLUDED.category_id, product_name = EXCLUDED.product_name
     RETURNING *`,
    [poster_product_id, product_name || null, category_id]
  );
  res.json({ mapping: rows[0] });
});

module.exports = router;
