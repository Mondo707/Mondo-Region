const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/db');
const { authRequired, adminOnly } = require('../middleware/auth');
const { getEffectiveCategories, setTierConfig, validateTierContinuity } = require('../services/configService');
const { syncDate } = require('../services/scheduler');
const { getSpotCategoryStatus, setCategoryEnabled } = require('../services/spotCategoryConfig');
const { getMappingDetailed, setMapping, discoverPaymentMethods, KNOWN_CHANNELS } = require('../services/posterPaymentMethods');
const { getSettingNumber, setSetting } = require('../services/appSettings');
const { getAllProductsWithStatus, setOverride, removeOverride } = require('../services/productCategoryOverride');
const { getProductById } = require('../services/bonusCalculator');
const { getComparison } = require('../services/cashReconcile');
const { getAllIngredients } = require('../services/posterStorage');

const router = express.Router();

router.use(authRequired, adminOnly);

// GET /api/admin/bonus-config - joriy bonus jadvalini ko'rish
router.get('/bonus-config', async (req, res) => {
  res.json({ categories: await getEffectiveCategories() });
});

// PUT /api/admin/bonus-config - bitta pog'onaning bonus summasini va/yoki min/max
// chegarasini o'zgartirish (har biri ixtiyoriy)
// body: { category: "Лимонады", tier_index: 0, bonus: 15000, min: 10, max: 19 }
router.put('/bonus-config', async (req, res) => {
  const { category, tier_index, bonus, min, max } = req.body || {};
  if (!category || tier_index === undefined) {
    return res.status(400).json({ error: 'category, tier_index kerak' });
  }
  try {
    await setTierConfig(category, Number(tier_index), {
      bonus: bonus !== undefined ? Number(bonus) : undefined,
      min: min !== undefined && min !== null && min !== '' ? Number(min) : undefined,
      max: max !== undefined && max !== null && max !== '' ? Number(max) : undefined,
    });

    const categories = await getEffectiveCategories();
    const warnings = validateTierContinuity(categories[category].tiers);

    res.json({ ok: true, categories, warnings });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/admin/spot-categories?spot_id=6 - filial uchun kategoriyalar holati
router.get('/spot-categories', async (req, res) => {
  const { spot_id } = req.query;
  if (!spot_id) return res.status(400).json({ error: 'spot_id kerak' });
  const status = await getSpotCategoryStatus(Number(spot_id));
  res.json({ categories: status });
});

// PUT /api/admin/spot-categories - bitta kategoriyani filial uchun yoqish/o'chirish
// body: { spot_id: 6, category: "Лимонады", enabled: false }
router.put('/spot-categories', async (req, res) => {
  const { spot_id, category, enabled } = req.body || {};
  if (!spot_id || !category || enabled === undefined) {
    return res.status(400).json({ error: 'spot_id, category, enabled kerak' });
  }
  try {
    await setCategoryEnabled(Number(spot_id), category, enabled);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/admin/client-mapping?spot_id=6 - Poster client_id xaritasi (Yandex eats, Jiz-Biz)
// spot_id=0 = "barchasi" (global) sozlama
router.get('/client-mapping', async (req, res) => {
  const { spot_id } = req.query;
  if (spot_id === undefined || spot_id === '') return res.status(400).json({ error: 'spot_id kerak' });
  const result = await pool.query(
    'SELECT channel_key, poster_client_id FROM poster_client_mapping WHERE spot_id = $1',
    [Number(spot_id)]
  );
  const map = {};
  result.rows.forEach((r) => { map[r.channel_key] = r.poster_client_id; });
  res.json({ mapping: map });
});

// PUT /api/admin/client-mapping - bitta kanal uchun Poster client_id'ni sozlash
// body: { spot_id: 6, channel_key: "yandex_eats", poster_client_id: "1234" }
// spot_id=0 = "barchasi" (global) sozlama - barcha filiallar uchun ishlatiladi
router.put('/client-mapping', async (req, res) => {
  const { spot_id, channel_key, poster_client_id } = req.body || {};
  if (spot_id === undefined || spot_id === null || !channel_key || !poster_client_id) {
    return res.status(400).json({ error: 'spot_id, channel_key, poster_client_id kerak' });
  }
  await pool.query(
    `INSERT INTO poster_client_mapping (spot_id, channel_key, poster_client_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (spot_id, channel_key) DO UPDATE SET poster_client_id = EXCLUDED.poster_client_id, updated_at = EXCLUDED.updated_at`,
    [Number(spot_id), channel_key, String(poster_client_id)]
  );
  res.json({ ok: true });
});

// GET /api/admin/cash-entries?spot_id=&date_from=&date_to= - kassa yozuvlari ro'yxati (admin uchun)
router.get('/cash-entries', async (req, res) => {
  const { spot_id, date_from, date_to } = req.query;
  const conditions = [];
  const params = [];
  let i = 1;
  if (spot_id) { conditions.push(`spot_id = $${i++}`); params.push(Number(spot_id)); }
  if (date_from) { conditions.push(`date >= $${i++}`); params.push(date_from); }
  if (date_to) { conditions.push(`date <= $${i++}`); params.push(date_to); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `SELECT * FROM cash_entries ${where} ORDER BY date DESC, spot_id ASC`,
    params
  );
  res.json({
    entries: result.rows.map((r) => ({
      ...r,
      expenses: JSON.parse(r.expenses || '[]'),
      banknotes: JSON.parse(r.banknotes || '{}'),
      payment_types: JSON.parse(r.payment_types || '{}'),
      poster_snapshot: r.poster_snapshot ? JSON.parse(r.poster_snapshot) : null,
    })),
  });
});

// PUT /api/admin/cash-entries/:id - admin tomonidan kassa yozuvini tahrirlash
// body: { expenses, banknotes, payment_types } (har biri ixtiyoriy - faqat berilganlari yangilanadi)
router.put('/cash-entries/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await pool.query('SELECT * FROM cash_entries WHERE id = $1', [id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'Yozuv topilmadi' });
  const row = existing.rows[0];

  const expenses = req.body.expenses !== undefined ? req.body.expenses : JSON.parse(row.expenses || '[]');
  const banknotes = req.body.banknotes !== undefined ? req.body.banknotes : JSON.parse(row.banknotes || '{}');
  const paymentTypes = req.body.payment_types !== undefined ? req.body.payment_types : JSON.parse(row.payment_types || '{}');

  const totalExpense = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const toza = Object.entries(banknotes).reduce((s, [denom, count]) => s + Number(denom) * (Number(count) || 0), 0);
  const totalPaytypes = Object.values(paymentTypes).reduce((s, v) => s + (Number(v) || 0), 0);
  const totalAmount = toza + totalExpense + totalPaytypes;

  await pool.query(
    `UPDATE cash_entries SET
       expenses = $1, banknotes = $2, payment_types = $3,
       toza = $4, total_expense = $5, total_paytypes = $6, total_amount = $7,
       entered_amount = $7, poster_synced_at = NULL, poster_snapshot = NULL
     WHERE id = $8`,
    [JSON.stringify(expenses), JSON.stringify(banknotes), JSON.stringify(paymentTypes),
     toza, totalExpense, totalPaytypes, totalAmount, id]
  );
  res.json({ ok: true });
});

// DELETE /api/admin/cash-entries/:id - kassa yozuvini o'chirish
router.delete('/cash-entries/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await pool.query('SELECT date, spot_id FROM cash_entries WHERE id = $1', [id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'Yozuv topilmadi' });
  const { date, spot_id } = existing.rows[0];

  await pool.query('DELETE FROM cash_entries WHERE id = $1', [id]);
  // Fakt ma'lumot yo'q endi - bonus holatini "OK" ga qaytaramiz (qo'lda tekshirilishi kerak)
  await pool.query('UPDATE daily_bonus SET cash_diff_ok = 1 WHERE date = $1 AND spot_id = $2', [date, spot_id]);

  res.json({ ok: true });
});

// POST /api/admin/users - yangi foydalanuvchi (masalan filial menejeri/supervizor) yaratish
// body: { login, password, role: 'viewer'|'admin', allowed_spots: [1,2,3], allowed_sections: [...] }
router.post('/users', async (req, res) => {
  const { login, password, role = 'viewer', allowed_spots = [], allowed_sections = ['kpi', 'daily_sales', 'bonus_table', 'cash', 'savdo', 'login_history', 'portsiya'] } = req.body || {};
  if (!login || !password) {
    return res.status(400).json({ error: 'login va password kerak' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    await pool.query(
      'INSERT INTO users (login, password_hash, password_plain, role, allowed_spots, allowed_sections) VALUES ($1, $2, $3, $4, $5, $6)',
      [login, hash, password, role, JSON.stringify(allowed_spots), JSON.stringify(allowed_sections)]
    );
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('duplicate key') || String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Bu login allaqachon mavjud' });
    }
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/users - foydalanuvchilar ro'yxati
router.get('/users', async (req, res) => {
  const result = await pool.query(
    'SELECT id, login, role, allowed_spots, allowed_sections, password_plain, is_active, last_login_at, created_at FROM users ORDER BY id'
  );
  res.json({
    users: result.rows.map((u) => ({
      ...u,
      allowed_spots: JSON.parse(u.allowed_spots),
      allowed_sections: JSON.parse(u.allowed_sections || '["kpi","daily_sales","bonus_table","cash","savdo","login_history","portsiya"]'),
      is_active: !!u.is_active,
    })),
  });
});

// PUT /api/admin/users/:id/status - foydalanuvchini faollashtirish/faolsizlantirish
router.put('/users/:id/status', async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body || {};
  if (is_active === undefined) {
    return res.status(400).json({ error: 'is_active kerak' });
  }
  if (Number(id) === req.user.id && !is_active) {
    return res.status(400).json({ error: 'O\'zingizni faolsizlantira olmaysiz' });
  }
  const result = await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [is_active ? 1 : 0, id]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  }
  res.json({ ok: true });
});

// PUT /api/admin/users/:id/spots
router.put('/users/:id/spots', async (req, res) => {
  const { id } = req.params;
  const { allowed_spots } = req.body || {};
  if (!Array.isArray(allowed_spots)) {
    return res.status(400).json({ error: 'allowed_spots massiv bo\'lishi kerak' });
  }
  const result = await pool.query('UPDATE users SET allowed_spots = $1 WHERE id = $2', [
    JSON.stringify(allowed_spots),
    id,
  ]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  }
  res.json({ ok: true });
});

// PUT /api/admin/users/:id/sections
router.put('/users/:id/sections', async (req, res) => {
  const { id } = req.params;
  const { allowed_sections } = req.body || {};
  if (!Array.isArray(allowed_sections)) {
    return res.status(400).json({ error: 'allowed_sections massiv bo\'lishi kerak' });
  }
  const result = await pool.query('UPDATE users SET allowed_sections = $1 WHERE id = $2', [
    JSON.stringify(allowed_sections),
    id,
  ]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  }
  res.json({ ok: true });
});

// PUT /api/admin/users/:id/password
router.put('/users/:id/password', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body || {};
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Parol kamida 4 belgidan iborat bo\'lishi kerak' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const result = await pool.query('UPDATE users SET password_hash = $1, password_plain = $2 WHERE id = $3', [
    hash,
    password,
    id,
  ]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  }
  res.json({ ok: true });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'O\'zingizni o\'chira olmaysiz' });
  }
  const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });
  }
  res.json({ ok: true });
});

// POST /api/admin/sync-range
router.post('/sync-range', async (req, res) => {
  const { date_from, date_to } = req.body || {};
  if (!date_from || !date_to) {
    return res.status(400).json({ error: 'date_from va date_to kerak' });
  }
  if (date_from > date_to) {
    return res.status(400).json({ error: 'date_from date_to dan katta bo\'lmasligi kerak' });
  }

  const dates = [];
  let cur = new Date(date_from + 'T00:00:00');
  const end = new Date(date_to + 'T00:00:00');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }

  if (dates.length > 92) {
    return res.status(400).json({ error: 'Bir martada eng ko\'pi bilan 92 kun (taxminan 3 oy) sinxronlash mumkin' });
  }

  const results = [];
  for (const date of dates) {
    try {
      await syncDate(date);
      results.push({ date, ok: true });
    } catch (e) {
      results.push({ date, ok: false, error: e.message });
    }
  }

  const failed = results.filter((r) => !r.ok);
  res.json({
    ok: failed.length === 0,
    total_days: dates.length,
    failed_days: failed.length,
    results,
  });
});

// GET /api/admin/payment-methods - hozirgi payment_method_id xaritasi
router.get('/payment-methods', async (req, res) => {
  const mapping = await getMappingDetailed();
  res.json({ mapping, known_channels: KNOWN_CHANNELS });
});

// PUT /api/admin/payment-methods - bitta payment_method_id'ni kanalga bog'lash
// body: { payment_method_id: "3", channel_key: "uzcard", label: "UZCARD karta" }
router.put('/payment-methods', async (req, res) => {
  const { payment_method_id, channel_key, label } = req.body || {};
  if (!payment_method_id || !channel_key) {
    return res.status(400).json({ error: 'payment_method_id va channel_key kerak' });
  }
  await setMapping(payment_method_id, channel_key, label);
  res.json({ ok: true });
});

// GET /api/admin/payment-methods/discover?spot_id=&days=7 - oxirgi kunlardagi
// tranzaksiyalarni skanerlab, qanday payment_method_id'lar uchraganini topadi
router.get('/payment-methods/discover', async (req, res) => {
  const { spot_id, days } = req.query;
  try {
    const found = await discoverPaymentMethods(spot_id ? Number(spot_id) : null, days ? Number(days) : 7);
    res.json({ found });
  } catch (e) {
    // Poster'ga ulanib bo'lmasa ham, sahifa buzilmasin - bo'sh natija bilan xatoni bildiramiz
    res.json({ found: [], warning: `Poster'dan ma'lumot olib bo'lmadi: ${e.message}` });
  }
});

// GET /api/admin/cash-diff-limit - kassa farqi chegarasini (bonus qoidasi) olish
router.get('/cash-diff-limit', async (req, res) => {
  const value = await getSettingNumber('cash_diff_limit_percent', Number(process.env.CASH_DIFF_LIMIT_PERCENT || 0.3));
  res.json({ cash_diff_limit_percent: value });
});

// PUT /api/admin/cash-diff-limit - kassa farqi chegarasini o'zgartirish
// body: { cash_diff_limit_percent: 0.5 }
router.put('/cash-diff-limit', async (req, res) => {
  const { cash_diff_limit_percent } = req.body || {};
  if (cash_diff_limit_percent === undefined || Number(cash_diff_limit_percent) < 0) {
    return res.status(400).json({ error: 'cash_diff_limit_percent (0 yoki musbat son) kerak' });
  }
  await setSetting('cash_diff_limit_percent', Number(cash_diff_limit_percent));
  res.json({ ok: true });
});

// GET /api/admin/products?only_unmatched=true - Poster'dagi barcha mahsulotlar va
// ularning bonus kategoriyasiga bog'lanish holati (avtomatik/qo'lda/bog'lanmagan)
router.get('/products', async (req, res) => {
  try {
    const products = await getAllProductsWithStatus(getProductById());
    const { only_unmatched } = req.query;
    const filtered = only_unmatched === 'true' ? products.filter((p) => p.source === 'unmatched') : products;
    res.json({ products: filtered });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/products/:product_id/category - mahsulotni qo'lda bonus
// kategoriyasiga bog'lash (yangi qo'shilgan, hali avtomatik moslashtirilmagan mahsulotlar uchun)
// body: { category: "Лимонады", product_name: "Latte Karamel 300мл" }
router.put('/products/:product_id/category', async (req, res) => {
  const { product_id } = req.params;
  const { category, product_name } = req.body || {};
  if (!category) {
    return res.status(400).json({ error: 'category kerak' });
  }
  try {
    await setOverride(product_id, product_name, category);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/products/:product_id/category - qo'lda bog'lashni bekor qilish
router.delete('/products/:product_id/category', async (req, res) => {
  try {
    await removeOverride(req.params.product_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/cash-entries/:id/recompute - Poster bilan solishtirishni
// keshdan tashlab, qayta hisoblaydi (masalan Poster'da chek o'chirilgan/tuzatilgan bo'lsa)
router.post('/cash-entries/:id/recompute', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await pool.query('SELECT * FROM cash_entries WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Yozuv topilmadi' });

    await pool.query('UPDATE cash_entries SET poster_snapshot = NULL, poster_synced_at = NULL WHERE id = $1', [id]);

    const refreshed = await pool.query('SELECT * FROM cash_entries WHERE id = $1', [id]);
    const comparison = await getComparison(refreshed.rows[0], { forceUnlock: true });
    res.json(comparison);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/portion-ingredients - kuzatilayotgan ingredientlar ro'yxati
router.get('/portion-ingredients', async (req, res) => {
  const result = await pool.query('SELECT id, display_name, poster_ingredient_id, poster_ingredient_name FROM portion_ingredients ORDER BY id');
  res.json({ ingredients: result.rows });
});

// GET /api/admin/poster-ingredients - Poster'dagi BARCHA ingredientlar (tanlash uchun)
router.get('/poster-ingredients', async (req, res) => {
  try {
    const ingredients = await getAllIngredients();
    res.json({ ingredients });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/portion-ingredients - yangi kuzatilayotgan ingredient qo'shish
// body: { display_name: "Смесь", poster_ingredient_id: "12", poster_ingredient_name: "Смесь (ombor)" }
router.post('/portion-ingredients', async (req, res) => {
  const { display_name, poster_ingredient_id, poster_ingredient_name } = req.body || {};
  if (!display_name || !poster_ingredient_id) {
    return res.status(400).json({ error: 'display_name, poster_ingredient_id kerak' });
  }
  const result = await pool.query(
    'INSERT INTO portion_ingredients (display_name, poster_ingredient_id, poster_ingredient_name) VALUES ($1, $2, $3) RETURNING id',
    [display_name, String(poster_ingredient_id), poster_ingredient_name || null]
  );
  res.json({ ok: true, id: result.rows[0].id });
});

// DELETE /api/admin/portion-ingredients/:id
router.delete('/portion-ingredients/:id', async (req, res) => {
  await pool.query('DELETE FROM portion_ingredients WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
