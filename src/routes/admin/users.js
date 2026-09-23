const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../../db');
const { requireRole } = require('../../middleware/auth');

const router = express.Router();

const VALID_SECTIONS = ['bozorlik', 'daily_sales', 'expenses', 'cash', 'savdo', 'fot', 'admin', 'login_history'];

router.get('/', requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.full_name, u.role, u.position_id, p.name AS position_name,
            u.allowed_sections, u.show_sales_widget, u.active, u.created_at
     FROM users u LEFT JOIN positions p ON p.id = u.position_id
     ORDER BY u.full_name`
  );
  res.json({ users: rows });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { username, password, full_name, role, position_id, allowed_sections, show_sales_widget } = req.body || {};
  if (!username || !password || !full_name || !role) {
    return res.status(400).json({ error: 'username, password, full_name, role kerak' });
  }
  if (!['admin', 'curator', 'employee'].includes(role)) {
    return res.status(400).json({ error: "role admin | curator | employee bo'lishi kerak" });
  }
  const sections = (Array.isArray(allowed_sections) ? allowed_sections : []).filter((s) => VALID_SECTIONS.includes(s));
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users(username, password_hash, full_name, role, position_id, allowed_sections, show_sales_widget)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, username, full_name, role, position_id, allowed_sections, show_sales_widget, active, created_at`,
      [username.trim(), passwordHash, full_name.trim(), role, position_id || null, sections, show_sales_widget !== false]
    );
    res.status(201).json({ user: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Bunday login allaqachon mavjud' });
    throw e;
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { full_name, role, position_id, allowed_sections, show_sales_widget, active, password } = req.body || {};
  const sections = allowed_sections === undefined
    ? undefined
    : (Array.isArray(allowed_sections) ? allowed_sections.filter((s) => VALID_SECTIONS.includes(s)) : []);

  let passwordHash;
  if (password) passwordHash = await bcrypt.hash(password, 10);

  const { rows } = await pool.query(
    `UPDATE users SET
       full_name = COALESCE($1, full_name),
       role = COALESCE($2, role),
       position_id = COALESCE($3, position_id),
       allowed_sections = COALESCE($4, allowed_sections),
       show_sales_widget = COALESCE($5, show_sales_widget),
       active = COALESCE($6, active),
       password_hash = COALESCE($7, password_hash)
     WHERE id = $8
     RETURNING id, username, full_name, role, position_id, allowed_sections, show_sales_widget, active, created_at`,
    [full_name, role, position_id, sections, show_sales_widget, active, passwordHash, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ user: rows[0] });
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query('UPDATE users SET active = false WHERE id = $1 RETURNING id', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Topilmadi' });
  res.json({ ok: true });
});

module.exports = router;
