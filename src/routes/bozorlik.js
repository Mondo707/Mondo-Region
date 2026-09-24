const express = require('express');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { requireSection, requireAdminOrCurator } = require('../middleware/auth');
const { businessDateFor } = require('../lib/businessDay');
const poster = require('../lib/poster');

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

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('Kamida bitta ingredient kiritilishi shart'), { status: 400 });
  }
  for (const it of items) {
    const qty = Number(it.quantity);
    const price = Number(it.unit_price);
    if (!it.ingredient_id || !(qty > 0) || !(price >= 0) || Number.isNaN(price)) {
      throw Object.assign(new Error('Har bir qatorda ingredient, miqdor va narx to\'liq kiritilishi shart'), { status: 400 });
    }
  }
}

router.get('/', requireSection('bozorlik'), async (req, res) => {
  const to = req.query.to || businessDateFor();
  const from = req.query.from || to;
  const { rows } = await pool.query(
    `SELECT be.*, u1.full_name AS created_by_name, u2.full_name AS approved_by_name
     FROM bozorlik_entries be
     LEFT JOIN users u1 ON u1.id = be.created_by
     LEFT JOIN users u2 ON u2.id = be.approved_by
     WHERE be.business_date BETWEEN $1 AND $2
     ORDER BY be.created_at DESC LIMIT 200`,
    [from, to]
  );

  // Ko'rib chiqilayotgan (pending) yozuvlar uchun ingredientlar ro'yxatini shu yerda qo'shib yuboramiz —
  // frontend tasdiqlashdan oldin "nima sotib olingani"ni alohida so'rovsiz ko'rsata oladi.
  const pendingIds = rows.filter((r) => r.status === 'pending').map((r) => r.id);
  let itemsByEntry = {};
  if (pendingIds.length) {
    const { rows: itemRows } = await pool.query(
      `SELECT bi.*, i.name AS ingredient_name, i.unit
       FROM bozorlik_items bi JOIN ingredients i ON i.id = bi.ingredient_id
       WHERE bi.bozorlik_entry_id = ANY($1::int[])`,
      [pendingIds]
    );
    itemsByEntry = itemRows.reduce((acc, it) => {
      (acc[it.bozorlik_entry_id] = acc[it.bozorlik_entry_id] || []).push(it);
      return acc;
    }, {});
  }

  res.json({ entries: rows.map((r) => ({ ...r, items: itemsByEntry[r.id] || undefined })) });
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
  let businessDate;
  try {
    businessDate = resolveWriteDate(req);
    validateItems(items);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
    throw e;
  } finally {
    client.release();
  }
});

// Ingredient qatorlarini tahrirlash — faqat admin/curator, faqat status='pending' bo'lganda.
router.put('/:id', requireAdminOrCurator('bozorlik:approve_post'), async (req, res) => {
  const { items, comment } = req.body || {};
  try { validateItems(items); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

  const { rows: existingRows } = await pool.query('SELECT * FROM bozorlik_entries WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Topilmadi' });
  if (existing.status !== 'pending') {
    return res.status(409).json({ error: "Faqat 'ko'rib chiqilmoqda' holatidagi yozuvni tahrirlash mumkin" });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM bozorlik_items WHERE bozorlik_entry_id = $1', [req.params.id]);
    let total = 0;
    for (const it of items) {
      const qty = Number(it.quantity);
      const price = Number(it.unit_price);
      const sum = qty * price;
      total += sum;
      await client.query(
        `INSERT INTO bozorlik_items(bozorlik_entry_id, ingredient_id, quantity, unit_price, sum)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.params.id, it.ingredient_id, qty, price, sum]
      );
    }
    const { rows: updated } = await client.query(
      'UPDATE bozorlik_entries SET total_amount = $1, comment = COALESCE($2, comment) WHERE id = $3 RETURNING *',
      [total, comment, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ entry: updated[0] });
  } catch (e) {
    await client.query('ROLLBACK');
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

router.post('/:id/reject', requireAdminOrCurator('bozorlik:approve_post'), async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE bozorlik_entries SET status = 'rejected', approved_by = $1
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

router.get('/export/xlsx', requireSection('bozorlik'), async (req, res) => {
  const to = req.query.to || businessDateFor();
  const from = req.query.from || to;
  const { rows } = await pool.query(
    `SELECT be.business_date::text AS business_date, be.status, be.total_amount, be.comment,
            i.name AS ingredient_name, i.unit, bi.quantity, bi.unit_price, bi.sum
     FROM bozorlik_entries be
     JOIN bozorlik_items bi ON bi.bozorlik_entry_id = be.id
     JOIN ingredients i ON i.id = bi.ingredient_id
     WHERE be.business_date BETWEEN $1 AND $2
     ORDER BY be.business_date DESC, be.id`,
    [from, to]
  );
  const aoa = [['Sana', 'Holat', 'Ingredient', 'Birlik', 'Miqdor', 'Narx', 'Summa']];
  for (const r of rows) {
    aoa.push([r.business_date, r.status, r.ingredient_name, r.unit, Number(r.quantity), Number(r.unit_price), Number(r.sum)]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bozorlik');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Bozorlik_${from}_${to}.xlsx"`);
  res.send(buf);
});

module.exports = router;
