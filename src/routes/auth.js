const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Login va parol kiritilishi shart" });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !user.active) {
    return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    position_id: user.position_id,
    allowed_sections: user.allowed_sections || [],
    show_sales_widget: user.show_sales_widget,
  };

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  await pool.query('INSERT INTO login_history(user_id, ip) VALUES ($1,$2)', [user.id, ip]);

  res.json({ user: req.session.user });
});

router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('mondo.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

module.exports = router;
