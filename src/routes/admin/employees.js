const express = require('express');
const { pool } = require('../../db');
const { requireAdminOrCurator, requireAuth } = require('../../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.*, p.name AS position_name
     FROM employees e LEFT JOIN positions p ON p.id = e.position_id
     ORDER BY p.sort_order NULLS LAST, e.full_name`
  );
  res.json({ employees: rows });
});

router.post('/', requireAdminOrCurator('employees:write'), async (req, res) => {
  const { full_name, position_id, fiksa_type, fiksa_amount, bonus_amount } = req.body || {};
  if (!full_name || !full_name.trim()) return res.status(400).json({ error: 'F.I.O kerak' });

  const isAdmin = req.session.user.role === 'admin';
  // Curator ham xodim yaratadi, lekin Fiksa/Bonus'ni faqat admin belgilaydi.
  const finalFiksaType = isAdmin ? (fiksa_type || 'summa') : 'summa';
  const finalFiksaAmount = isAdmin ? Number(fiksa_amount || 0) : 0;
  const finalBonusAmount = isAdmin ? Number(bonus_amount || 0) : 0;

  const { rows } = await pool.query(
    `INSERT INTO employees(full_name, position_id, fiksa_type, fiksa_amount, bonus_amount)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [full_name.trim(), position_id || null, finalFiksaType, finalFiksaAmount, finalBonusAmount]
  );
  res.status(201).json({ employee: rows[0] });
});

router.put('/:id', requireAdminOrCurator('employees:write'), async (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const { full_name, position_id, fiksa_type, fiksa_amount, bonus_amount, active, hidden } = req.body || {};

  if (!isAdmin && (fiksa_type !== undefined || fiksa_amount !== undefined || bonus_amount !== undefined)) {
    return res.status(403).json({ error: "Fiksa/Bonus maydonlarini faqat admin o'zgartira oladi" });
  }

  const { rows } = await pool.query(
    `UPDATE employees SET
       full_name = COALESCE($1, full_name),
       position_id = COALESCE($2, position_id),
       fiksa_type = CASE WHEN $6 THEN COALESCE($3, fiksa_type) ELSE fiksa_type END,
       fiksa_amount = CASE WHEN $6 THEN COALESCE($4, fiksa_amount) ELSE fiksa_amount END,
       bonus_amount = CASE WHEN $6 THEN COALESCE($5, bonus_amount) ELSE bonus_amount END,
       active = COALESCE($7, active),
       hidden = COALESCE($8, hidden)
     WHERE id = $9 RETURNING *`,
    [full_name, position_id, fiksa_type, fiksa_amount, bonus_amount, isAdmin, active, hidden, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ employee: rows[0] });
});

router.delete('/:id', requireAdminOrCurator('employees:write'), async (req, res) => {
  // O'chirish o'rniga yashirish tavsiya etiladi (FOT tarixi buzilmasligi uchun);
  // shunga qaramay to'g'ridan-to'g'ri o'chirish so'ralsa, FK bog'liq bo'lsa xato qaytariladi.
  try {
    const { rowCount } = await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23503') {
      return res.status(409).json({ error: "Bu xodimga bog'langan xarajat yozuvlari bor — o'rniga \"Nofaol\"/\"Yashirilgan\" qiling" });
    }
    throw e;
  }
});

module.exports = router;
