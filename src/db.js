const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl });

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','curator','employee')),
  position_id INT REFERENCES positions(id),
  allowed_sections TEXT[] NOT NULL DEFAULT '{}',
  show_sales_widget BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  position_id INT REFERENCES positions(id),
  fiksa_type TEXT NOT NULL DEFAULT 'summa' CHECK (fiksa_type IN ('summa','kunlik','haftalik')),
  fiksa_amount NUMERIC NOT NULL DEFAULT 0,
  bonus_amount NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  hidden BOOLEAN NOT NULL DEFAULT false,
  linked_user_id INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_types (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  requires_employee BOOLEAN NOT NULL DEFAULT false,
  fot_bucket TEXT, -- 'avans' | 'ofitsant' | 'texnichka' | null (FOT'da alohida ustunga yig'iladi)
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  business_date DATE NOT NULL,
  expense_type_id INT NOT NULL REFERENCES expense_types(id),
  employee_id INT REFERENCES employees(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  comment TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(business_date);
CREATE INDEX IF NOT EXISTS idx_expenses_employee ON expenses(employee_id);

CREATE TABLE IF NOT EXISTS ingredients (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  unit TEXT NOT NULL DEFAULT 'kg',
  poster_ingredient_id TEXT,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS bozorlik_entries (
  id SERIAL PRIMARY KEY,
  business_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','posted')),
  total_amount NUMERIC NOT NULL DEFAULT 0,
  comment TEXT,
  created_by INT REFERENCES users(id),
  approved_by INT REFERENCES users(id),
  posted_at TIMESTAMPTZ,
  poster_supply_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bozorlik_items (
  id SERIAL PRIMARY KEY,
  bozorlik_entry_id INT NOT NULL REFERENCES bozorlik_entries(id) ON DELETE CASCADE,
  ingredient_id INT NOT NULL REFERENCES ingredients(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
  sum NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS sales_categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS product_category_map (
  id SERIAL PRIMARY KEY,
  poster_product_id TEXT UNIQUE NOT NULL,
  product_name TEXT,
  category_id INT REFERENCES sales_categories(id)
);

CREATE TABLE IF NOT EXISTS daily_sales_cache (
  id SERIAL PRIMARY KEY,
  business_date DATE NOT NULL,
  category_id INT NOT NULL REFERENCES sales_categories(id),
  quantity NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  UNIQUE(business_date, category_id)
);

CREATE TABLE IF NOT EXISTS payment_types (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  poster_payment_method_id TEXT,
  group_type TEXT NOT NULL DEFAULT 'card' CHECK (group_type IN ('card','certificate')),
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS cash_entries (
  id SERIAL PRIMARY KEY,
  business_date DATE UNIQUE NOT NULL,
  denominations JSONB NOT NULL DEFAULT '{}',
  toza_naqd NUMERIC NOT NULL DEFAULT 0,
  rasxod NUMERIC NOT NULL DEFAULT 0,
  inkassatsiya NUMERIC NOT NULL DEFAULT 0,
  smena_farqi NUMERIC NOT NULL DEFAULT 0, -- Poster smenasi Yopilish-Ochilish farqi (solishtirishda to'ldiriladi)
  payment_amounts JSONB NOT NULL DEFAULT '{}',
  nalichnie_amount NUMERIC NOT NULL DEFAULT 0,
  beznal_amount NUMERIC NOT NULL DEFAULT 0,
  sertifikat_amount NUMERIC NOT NULL DEFAULT 0,
  jami NUMERIC NOT NULL DEFAULT 0,
  submitted_by INT REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ,
  poster_compare JSONB,
  recomputed_at TIMESTAMPTZ,
  recomputed_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fot_raschet (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id),
  period TEXT NOT NULL, -- 'YYYY-MM'
  raschet_amount NUMERIC NOT NULL DEFAULT 0,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, period)
);

CREATE TABLE IF NOT EXISTS login_history (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  logged_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB
);
`;

const DEFAULT_POSITIONS = [
  'Povar', 'Barista', 'Morojni', 'Hostes', 'Menejer', 'Kassir',
  'Povar ovqat', 'Qoravul', 'Ofitsant', 'Natrika', 'Texnichka',
];

const DEFAULT_EXPENSE_TYPES = [
  { name: 'Avans', requires_employee: true, fot_bucket: 'avans' },
  { name: 'Ofitsant to\'lovi', requires_employee: true, fot_bucket: 'ofitsant' },
  { name: 'Texnichka', requires_employee: true, fot_bucket: 'texnichka' },
  { name: 'Prochiy', requires_employee: false, fot_bucket: null },
];

const DEFAULT_PAYMENT_TYPES = [
  { name: 'UZCARD', group_type: 'card' },
  { name: 'HUMO', group_type: 'card' },
  { name: 'Uz Qr Kod', group_type: 'card' },
  { name: 'Click', group_type: 'card' },
  { name: 'Payme', group_type: 'card' },
  { name: 'Uzum', group_type: 'card' },
  { name: 'Alif', group_type: 'card' },
  { name: 'Paynet', group_type: 'card' },
];

const DEFAULT_CATEGORIES = [
  'Шарик', 'Смесь', 'Кофе 250 мл', 'Кофе 350 мл', 'Чашка кофе', 'Айс кофе',
  'Лимонады', 'Манго сок', 'Милкшейк', 'Вафли', 'Десерты', 'Сан-себастьян',
  'Фреш', 'Фрозен', 'Чай', 'Фасовка',
];

async function ensureSeed(client) {
  const { rows: posRows } = await client.query('SELECT COUNT(*)::int AS c FROM positions');
  if (posRows[0].c === 0) {
    for (let i = 0; i < DEFAULT_POSITIONS.length; i++) {
      await client.query('INSERT INTO positions(name, sort_order) VALUES ($1,$2)', [DEFAULT_POSITIONS[i], i]);
    }
  }

  const { rows: etRows } = await client.query('SELECT COUNT(*)::int AS c FROM expense_types');
  if (etRows[0].c === 0) {
    for (let i = 0; i < DEFAULT_EXPENSE_TYPES.length; i++) {
      const t = DEFAULT_EXPENSE_TYPES[i];
      await client.query(
        'INSERT INTO expense_types(name, requires_employee, fot_bucket, sort_order) VALUES ($1,$2,$3,$4)',
        [t.name, t.requires_employee, t.fot_bucket, i]
      );
    }
  }

  const { rows: ptRows } = await client.query('SELECT COUNT(*)::int AS c FROM payment_types');
  if (ptRows[0].c === 0) {
    for (let i = 0; i < DEFAULT_PAYMENT_TYPES.length; i++) {
      const p = DEFAULT_PAYMENT_TYPES[i];
      await client.query(
        'INSERT INTO payment_types(name, group_type, sort_order) VALUES ($1,$2,$3)',
        [p.name, p.group_type, i]
      );
    }
  }

  const { rows: catRows } = await client.query('SELECT COUNT(*)::int AS c FROM sales_categories');
  if (catRows[0].c === 0) {
    for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
      await client.query('INSERT INTO sales_categories(name, sort_order) VALUES ($1,$2)', [DEFAULT_CATEGORIES[i], i]);
    }
  }

  const { rows: userRows } = await client.query('SELECT COUNT(*)::int AS c FROM users');
  if (userRows[0].c === 0) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await client.query(
      `INSERT INTO users(username, password_hash, full_name, role, allowed_sections, show_sales_widget)
       VALUES ($1,$2,$3,'admin', $4, true)`,
      ['admin', passwordHash, 'Administrator', ['bozorlik', 'daily_sales', 'expenses', 'cash', 'savdo', 'fot', 'admin']]
    );
    // eslint-disable-next-line no-console
    console.log('>> Boshlang\'ich admin yaratildi: login "admin", parol "admin123" — birinchi kirishdan keyin almashtiring.');
  }
}

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA_SQL);
    await ensureSeed(client);
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb };
