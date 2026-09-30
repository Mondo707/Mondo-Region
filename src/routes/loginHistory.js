const express = require('express');
const { pool } = require('../db');
const { requireSection } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireSection('login_history'), async (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const params = [];
  let where = '';
  if (!isAdmin) {
    // Oddiy foydalanuvchiga admin'ning kirishlari ko'rsatilmaydi (backend darajasida filtrlangan).
    where = "WHERE u.role <> 'admin'";
  }
  const { rows } = await pool.query(
    `SELECT lh.id, lh.logged_in_at, lh.ip, u.full_name, u.username, u.role
     FROM login_history lh JOIN users u ON u.id = lh.user_id
     ${where}
     ORDER BY lh.logged_in_at DESC
     LIMIT 200`,
    params
  );
  res.json({ history: rows });
});

module.exports = router;
