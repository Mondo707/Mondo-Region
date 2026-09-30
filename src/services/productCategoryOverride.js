// Poster'da yangi mahsulot qo'shilganda, uni admin panelda qo'lda bonus
// kategoriyasiga bog'lash uchun. Bu - avtomatik nom bo'yicha moslashtirish
// (productMatcher.js) qila olmagan/hali ulgurmagan mahsulotlar uchun zaxira yo'l.

const { pool } = require('../db/db');
const poster = require('./posterClient');

async function getOverridesMap() {
  const result = await pool.query('SELECT poster_product_id, category FROM product_category_overrides');
  const map = new Map();
  result.rows.forEach((r) => map.set(String(r.poster_product_id), r.category));
  return map;
}

async function setOverride(productId, productName, category) {
  await pool.query(
    `INSERT INTO product_category_overrides (poster_product_id, product_name, category, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (poster_product_id) DO UPDATE SET
       product_name = EXCLUDED.product_name,
       category = EXCLUDED.category,
       updated_at = EXCLUDED.updated_at`,
    [String(productId), productName || null, category]
  );
}

async function removeOverride(productId) {
  await pool.query('DELETE FROM product_category_overrides WHERE poster_product_id = $1', [String(productId)]);
}

/**
 * Poster'dagi BARCHA mahsulotlarni oladi va har biri uchun hozirgi holatini
 * aniqlaydi: avtomatik moslashtirilgan (productMap.json), qo'lda bog'langan
 * (product_category_overrides), yoki hali bog'lanmagan.
 * @param {Map} autoProductById productMap.json'dan yuklangan xarita (bonusCalculator'dagi)
 */
async function getAllProductsWithStatus(autoProductById) {
  const result = await poster.call('menu.getProducts');
  const products = Array.isArray(result) ? result : (result && result.response) || [];

  const overrides = await getOverridesMap();

  return products.map((p) => {
    const id = String(p.product_id);
    const auto = autoProductById.get(Number(p.product_id));
    const overrideCategory = overrides.get(id);

    let category = null;
    let source = 'unmatched';
    if (overrideCategory) {
      category = overrideCategory;
      source = 'manual';
    } else if (auto && auto.counts_for_bonus) {
      category = auto.bonus_category;
      source = 'auto';
    }

    return {
      product_id: id,
      name: p.product_name || p.name,
      category,
      source, // 'auto' | 'manual' | 'unmatched'
    };
  });
}

module.exports = { getOverridesMap, setOverride, removeOverride, getAllProductsWithStatus };
