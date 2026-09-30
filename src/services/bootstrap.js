// Ilova ishga tushganda avtomatik bajariladigan boshlang'ich sozlashlar.
// Render bepul tarifida terminal (shell) yo'q, shuning uchun "npm run seed:admin"
// kabi bir martalik buyruqlarni qo'lda ishga tushirib bo'lmaydi - buning o'rniga
// ADMIN_LOGIN / ADMIN_PASSWORD muhit o'zgaruvchilari orqali avtomatik yaratamiz.

const bcrypt = require('bcryptjs');
const { pool } = require('../db/db');

async function ensureAdminUser() {
  const login = process.env.ADMIN_LOGIN;
  const password = process.env.ADMIN_PASSWORD;

  if (!login || !password) {
    const countRes = await pool.query('SELECT COUNT(*) FROM users');
    if (Number(countRes.rows[0].count) === 0) {
      console.warn(
        '[bootstrap] Hech qanday foydalanuvchi yo\'q va ADMIN_LOGIN/ADMIN_PASSWORD sozlanmagan. ' +
        'Tizimga kirish uchun .env (yoki Render Environment) da ADMIN_LOGIN va ADMIN_PASSWORD ni belgilang.'
      );
    }
    return;
  }

  const existing = await pool.query('SELECT id FROM users WHERE login = $1', [login]);
  if (existing.rows.length > 0) {
    return; // Allaqachon mavjud, qayta yaratmaymiz
  }

  const hash = bcrypt.hashSync(password, 10);
  await pool.query(
    'INSERT INTO users (login, password_hash, password_plain, role, allowed_spots, allowed_sections) VALUES ($1, $2, $3, $4, $5, $6)',
    [login, hash, password, 'admin', '[]', '["dashboard","cash"]']
  );
  console.log(`[bootstrap] Admin foydalanuvchi yaratildi: ${login}`);
}

module.exports = { ensureAdminUser };
