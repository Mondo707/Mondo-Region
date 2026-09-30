// Har bir filial uchun qaysi bonus kategoriyalari faol/yashirin ekanini boshqaradi.
// Standart holat: agar sozlama yozilmagan bo'lsa, kategoriya FAOL hisoblanadi
// (ya'ni admin faqat kerak bo'lganlarini o'chirib qo'yadi).

const { pool } = require('../db/db');
const bonusConfig = require('../data/bonusConfig.json');

const ALL_CATEGORIES = Object.keys(bonusConfig.categories);

/**
 * Berilgan filial uchun O'CHIRILGAN (hisoblanmaydigan) kategoriyalar to'plamini qaytaradi.
 */
async function getDisabledCategories(spotId) {
  const result = await pool.query(
    'SELECT category FROM spot_category_config WHERE spot_id = $1 AND enabled = 0',
    [spotId]
  );
  return new Set(result.rows.map((r) => r.category));
}

/**
 * Admin panel uchun: berilgan filialning barcha kategoriyalari va ularning
 * faol/yashirin holatini qaytaradi.
 */
async function getSpotCategoryStatus(spotId) {
  const disabled = await getDisabledCategories(spotId);
  return ALL_CATEGORIES.map((category) => ({
    category,
    enabled: !disabled.has(category),
  }));
}

async function setCategoryEnabled(spotId, category, enabled) {
  if (!ALL_CATEGORIES.includes(category)) {
    throw new Error(`Noma'lum kategoriya: ${category}`);
  }
  await pool.query(
    `INSERT INTO spot_category_config (spot_id, category, enabled, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (spot_id, category) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
    [spotId, category, enabled ? 1 : 0]
  );
}

module.exports = { getDisabledCategories, getSpotCategoryStatus, setCategoryEnabled, ALL_CATEGORIES };
