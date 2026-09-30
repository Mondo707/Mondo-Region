const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) {
    return res.status(400).json({ error: 'login va password kerak' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Login yoki parol xato' });

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Login yoki parol xato' });

    if (!user.is_active) {
      return res.status(403).json({ error: 'Bu foydalanuvchi faolsizlantirilgan. Administratorga murojaat qiling.' });
    }

    await pool.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await pool.query(
      'INSERT INTO login_history (user_id, login, role, logged_in_at) VALUES ($1, $2, $3, now())',
      [user.id, user.login, user.role]
    );

    const allowedSpots = JSON.parse(user.allowed_spots || '[]');
    const allowedSections = JSON.parse(user.allowed_sections || '["kpi","daily_sales","bonus_table","cash","savdo","login_history","portsiya"]');
    const token = jwt.sign(
      { id: user.id, login: user.login, role: user.role, allowed_spots: allowedSpots, allowed_sections: allowedSections },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: { id: user.id, login: user.login, role: user.role, allowed_spots: allowedSpots, allowed_sections: allowedSections },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
