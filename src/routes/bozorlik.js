const express = require('express');
const { pool } = require('../db');
const { requireSection, requireAdminOrCurator } = require('../middleware/auth');
const { businessDateFor } = require('../lib/businessDay');
const poster = require('../lib/poster');

const router = express.Router();

router.get('/', requireSection('bozorlik'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT be.*, u1.full_name AS created_by_name, u2.full_name AS approved_by_name
     FROM bozorlik_entries be
     LEFT JOIN users u1 ON u1.id = be.created_by
     LEFT JOIN users u2 ON u2.id = be.approved_by
     ORDER BY be.created_at DESC LIMIT 50`
  );
  res.json({ entries: rows });
});

router.get('/:id', requireSection('bozorlik'), async (req, res) => {
  const { rows: entryRows } = await pool.query('SELECT * FROM bozorlik_entries WHERE id = $1', [req.params.id]);
  if (!entryRows[0]) return res.status(404).json({ error: 'Topilmadi' });
  const { rows: itemRows } = await pool.query(
    `SELECT bi.*, i.name AS ingredient_name, i.unit
     FROM bozorlik_items bi JOIN ingredients i ON i.id = bi.ingredient_id
     WHERE bi.bozorlik_entry_id = $1`,
    [req.params.id]
  );
  res.json({ entry: entryRows[0], items: itemRows });
});

router.post('/', requireSection('bozorlik'), async (req, res) => {
  const { items, comment } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Kamida bitta ingredient kiritilishi shart' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const businessDate = businessDateFor();
    let total = 0;
    const { rows: entryRows } = await client.query(
      `INSERT INTO bozorlik_entries(business_date, status, total_amount, comment, created_by)
       VALUES ($1,'pending',0,$2,$3) RETURNING *`,
      [businessDate, comment || null, req.session.user.id]
    );
    const entry = entryRows[0];

    for (const it of items) {
      const qty = Number(it.quantity);
      const price = Number(it.unit_price);
      if (!it.ingredient_id || !(qty > 0) || !(price >= 0)) {
        throw Object.assign(new Error("Ingredient qatorlarida xato bor"), { status: 400 });
      }
      const sum = qty * price;
      total += sum;
      await client.query(
        `INSERT INTO bozorlik_items(bozorlik_entry_id, ingredient_id, quantity, unit_price, sum)
         VALUES ($1,$2,$3,$4,$5)`,
        [entry.id, it.ingredient_id, qty, price, sum]
      );
    }

    const { rows: updated } = await client.query(
      'UPDATE bozorlik_entries SET total_amount = $1 WHERE id = $2 RETURNING *',
      [total, entry.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ entry: updated[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.status === 400) return res.status(400).json({ error: e.message });
    throw e;
  } finally {
    client.release();
  }
});

// Curator/buxgalter yoki admin ko'rib chiqadi va tasdiqlaydi.
router.post('/:id/approve', requireAdminOrCurator('bozorlik:approve_post'), async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE bozorlik_entries SET status = 'approved', approved_by = $1
     WHERE id = $2 AND status = 'pending' RETURNING *`,
    [req.session.user.id, req.params.id]
  );
  if (!rows[0]) return res.status(409).json({ error: 'Bu yozuv allaqachon ko\'rib chiqilgan yoki topilmadi' });
  res.json({ entry: rows[0] });
});

// "Posterga kiritish" — avtomatik ravishda Poster'ga Закупка (Bozor) supply sifatida yuboradi.
router.post('/:id/post-to-poster', requireAdminOrCurator('bozorlik:approve_post'), async (req, res) => {
  const { rows: entryRows } = await pool.query('SELECT * FROM bozorlik_entries WHERE id = $1', [req.params.id]);
  const entry = entryRows[0];
  if (!entry) return res.status(404).json({ error: 'Topilmadi' });
  if (entry.status === 'posted') return res.status(409).json({ error: 'Bu yozuv allaqachon Posterga kiritilgan' });
  if (entry.status !== 'approved') return res.status(409).json({ error: 'Avval tasdiqlanishi kerak' });

  const { rows: itemRows } = await pool.query(
    `SELECT bi.*, i.poster_ingredient_id FROM bozorlik_items bi
     JOIN ingredients i ON i.id = bi.ingredient_id WHERE bi.bozorlik_entry_id = $1`,
    [entry.id]
  );
  const missing = itemRows.filter((it) => !it.poster_ingredient_id);
  if (missing.length) {
    return res.status(409).json({
      error: "Ba'zi ingredientlar Poster ID'siga bog'lanmagan — avval admin panelda bog'lang",
      missing_items: missing.map((m) => m.ingredient_id),
    });
  }

  const result = await poster.createSupply({
    business_date: entry.business_date,
    ingredients: itemRows.map((it) => ({
      poster_ingredient_id: it.poster_ingredient_id,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
    })),
  });

  const { rows: updated } = await pool.query(
    `UPDATE bozorlik_entries SET status = 'posted', posted_at = now(), poster_supply_id = $1 WHERE id = $2 RETURNING *`,
    [result.supply_id, entry.id]
  );
  res.json({ entry: updated[0] });
});

module.exports = router;
