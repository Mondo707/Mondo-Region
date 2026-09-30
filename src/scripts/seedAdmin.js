// Birinchi admin foydalanuvchini yaratadi.
// Ishga tushirish: npm run seed:admin -- login parol
// Masalan: npm run seed:admin -- admin MyStrongPass123

const bcrypt = require('bcryptjs');
const { pool, ready } = require('../db/db');

const [, , login, password] = process.argv;

if (!login || !password) {
  console.error('Foydalanish: npm run seed:admin -- <login> <parol>');
  process.exit(1);
}

async function run() {
  await ready;
  const hash = bcrypt.hashSync(password, 10);
  try {
    await pool.query(
      'INSERT INTO users (login, password_hash, role, allowed_spots) VALUES ($1, $2, $3, $4)',
      [login, hash, 'admin', '[]']
    );
    console.log(`Admin yaratildi: ${login}`);
  } catch (e) {
    if (String(e.message).includes('duplicate key') || String(e.message).includes('UNIQUE')) {
      console.error(`"${login}" login allaqachon mavjud.`);
    } else {
      console.error('Xato:', e.message);
    }
  } finally {
    await pool.end();
  }
}

run();
