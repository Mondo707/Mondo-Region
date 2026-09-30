// Poster'dagi ombor (ingredient) qoldiqlari bilan ishlash - "Portsiya" bo'limi uchun.
// Diagnostika orqali tasdiqlangan: storage.getStorageLeftovers va menu.getIngredients
// ishlaydi. storage.getStorages'dagi storage_id'lar bizning spot_id bilan bir xil.

const poster = require('./posterClient');

/**
 * Poster'dagi barcha ingredientlar ro'yxatini oladi (admin panelda "Portsiya
 * ingredientlari" qo'shishda tanlash uchun).
 */
async function getAllIngredients() {
  const result = await poster.call('menu.getIngredients');
  const list = Array.isArray(result) ? result : (result && result.response) || [];
  return list.map((ing) => ({
    ingredient_id: String(ing.ingredient_id),
    name: ing.ingredient_name,
    unit: ing.ingredient_unit,
  }));
}

/**
 * Berilgan filial (storage_id = spot_id) uchun barcha ingredientlarning joriy
 * qoldig'ini oladi. Natija: { ingredient_id: qoldiq_son }
 */
async function getStorageLeftovers(spotId) {
  const result = await poster.call('storage.getStorageLeftovers', { storage_id: spotId });
  const list = Array.isArray(result) ? result : (result && result.response) || [];
  const map = new Map();
  list.forEach((item) => {
    map.set(String(item.ingredient_id), Number(item.ingredient_left) || 0);
  });
  return map;
}

module.exports = { getAllIngredients, getStorageLeftovers };
