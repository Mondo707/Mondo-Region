// Poster'dan tranzaksiyalarni olib, mahsulot->kategoriya xaritasi orqali
// kunlik dona va summa bo'yicha jamlab, daily_sales_cache'ga yozadi.
// SYNC_INTERVAL_MINUTES dan tez-tez ishlamaydi (config.js'da kamida 10-15
// daqiqa bilan cheklangan) — Neon bazasi "uxlab" ulguradi, compute tejaladi.
const { pool } = require('../db');
const poster = require('../lib/poster');
const config = require('../config');
const { businessDateFor } = require('../lib/businessDay');

async function syncBusinessDate(businessDate) {
  const { rows: mapRows } = await pool.query('SELECT poster_product_id, category_id FROM product_category_map');
  const productToCategory = new Map(mapRows.map((m) => [m.poster_product_id, m.category_id]));

  const transactions = await poster.transactionsGetTransactions({ dateFrom: businessDate, dateTo: businessDate });

  const agg = new Map(); // category_id -> { quantity, amount }
  for (const tx of transactions) {
    for (const p of tx.products || []) {
      const categoryId = productToCategory.get(p.product_id);
      if (!categoryId) continue; // hali kategoriyaga bog'lanmagan mahsulot — admin panelda bog'lanadi
      const qty = Number(p.num) || 0;
      const sum = Number(p.product_sum) || 0;
      const cur = agg.get(categoryId) || { quantity: 0, amount: 0 };
      cur.quantity += qty;
      cur.amount += sum;
      agg.set(categoryId, cur);
    }
  }

  for (const [categoryId, vals] of agg.entries()) {
    await pool.query(
      `INSERT INTO daily_sales_cache(business_date, category_id, quantity, amount)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (business_date, category_id) DO UPDATE SET quantity = EXCLUDED.quantity, amount = EXCLUDED.amount`,
      [businessDate, categoryId, vals.quantity, vals.amount]
    );
  }
  return agg.size;
}

function startSyncScheduler() {
  const run = async () => {
    try {
      const today = businessDateFor();
      await syncBusinessDate(today);
      // eslint-disable-next-line no-console
      console.log(`[sync] ${new Date().toISOString()} — ${today} kunlik savdo sinxronlandi`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[sync] xato:', e.message);
    }
  };
  run(); // darhol bir marta
  setInterval(run, config.syncIntervalMinutes * 60 * 1000);
}

module.exports = { syncBusinessDate, startSyncScheduler };
