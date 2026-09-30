// Admin panelda o'zgartirilishi mumkin bo'lgan umumiy sozlamalar (baza orqali,
// server qayta ishga tushirilishi shart emas).

const { pool } = require('../db/db');

async function getSetting(key, defaultValue) {
  const result = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  if (result.rows.length === 0) return defaultValue;
  return result.rows[0].value;
}

async function getSettingNumber(key, defaultValue) {
  const value = await getSetting(key, null);
  if (value === null) return defaultValue;
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, String(value)]
  );
}

module.exports = { getSetting, getSettingNumber, setSetting };
