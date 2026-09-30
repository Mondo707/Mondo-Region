// Bu skript Poster API bilan bog'lanishni tekshiradi.
// Ishga tushirish: cd backend && npm install && npm run test:poster
//
// DIQQAT: Buni Claude sandboxida emas, o'zingizning kompyuteringizda ishga tushiring,
// chunki bu yerdan mondopos.joinposter.com domenga chiqish cheklangan.

const poster = require('../services/posterClient');

async function run() {
  console.log('--- 1) Akkaunt ma\'lumoti (access.getAccountInfo) ---');
  try {
    const info = await poster.call('access.getAccountInfo');
    console.log(JSON.stringify(info, null, 2));
  } catch (e) {
    console.error('XATO:', e.message);
  }

  console.log('\n--- 2) Filiallar ro\'yxati (spots.getSpots) ---');
  try {
    const spots = await poster.call('spots.getSpots');
    console.log(JSON.stringify(spots, null, 2));
  } catch (e) {
    console.error('XATO:', e.message);
  }

  console.log('\n--- 3) Mahsulotlar (menu.getProducts) - birinchi 3 tasi ---');
  try {
    const products = await poster.call('menu.getProducts');
    console.log(JSON.stringify(Array.isArray(products) ? products.slice(0, 3) : products, null, 2));
    console.log('Jami mahsulotlar soni:', Array.isArray(products) ? products.length : '?');
  } catch (e) {
    console.error('XATO:', e.message);
  }

  console.log('\n--- 4) Kassa smenalari (dash.getCashShifts) - oxirgi 3 kun ---');
  try {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 3);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const shifts = await poster.call('dash.getCashShifts', {
      date_from: fmt(from),
      date_to: fmt(today),
    });
    console.log(JSON.stringify(shifts, null, 2));
  } catch (e) {
    console.error('XATO:', e.message);
  }

  console.log('\n--- 5) Sotuvlar tranzaksiyalari (transactions.getTransactions) - bugun ---');
  try {
    const today = new Date().toISOString().slice(0, 10);
    const tx = await poster.call('transactions.getTransactions', {
      date_from: today,
      date_to: today,
    });
    console.log(JSON.stringify(Array.isArray(tx) ? tx.slice(0, 2) : tx, null, 2));
  } catch (e) {
    console.error('XATO:', e.message);
  }
}

run().then(() => console.log('\nTest tugadi.')).catch((e) => console.error('Kutilmagan xato:', e));
