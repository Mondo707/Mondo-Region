// "Kirish tarixi" bo'limi - endi to'liq ruxsat tizimiga (allowed_sections)
// bog'langan, faqat admin uchun emas. Lekin oddiy foydalanuvchilarga (viewer)
// admin'ning qachon kirgani ko'rsatilmaydi - bu backend darajasida filtrlanadi.

const express = require('express');
const { pool } = require('../db/db');
const { authRequired, requireSection } = require('../middleware/auth');

const router = express.Router();

router.use(authRequired, requireSection('login_history'));

// GET /api/login-history/users - filtr uchun foydalanuvchilar ro'yxati.
// Oddiy foydalanuvchiga faqat boshqa (admin bo'lmagan) foydalanuvchilar ko'rsatiladi.
router.get('/users', async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const query = isAdmin
    ? 'SELECT id, login FROM users ORDER BY login'
    : "SELECT id, login FROM users WHERE role != 'admin' ORDER BY login";
  const result = await pool.query(query);
  res.json({ users: result.rows });
});

// GET /api/login-history?user_id=&date_from=&date_to=
router.get('/', async (req, res) => {
  const { user_id, date_from, date_to } = req.query;
  const isAdmin = req.user.role === 'admin';

  const conditions = [];
  const params = [];
  let i = 1;

  if (!isAdmin) {
    // Oddiy foydalanuvchiga admin'ning kirishlari umuman ko'rsatilmaydi
    conditions.push(`role != 'admin'`);
  }
  if (user_id) { conditions.push(`user_id = $${i++}`); params.push(Number(user_id)); }
  if (date_from) { conditions.push(`logged_in_at >= $${i++}`); params.push(date_from); }
  if (date_to) { conditions.push(`logged_in_at <= $${i++}::date + interval '1 day'`); params.push(date_to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT id, user_id, login, role, logged_in_at FROM login_history ${where} ORDER BY logged_in_at DESC LIMIT 500`,
    params
  );
  res.json({ entries: result.rows });
});

module.exports = router;
