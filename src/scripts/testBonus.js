// Bugungi kun uchun barcha filiallar bo'yicha bonus hisobotini chiqaradi.
// Ishga tushirish: npm run test:bonus
// OLDIN: npm run match:products ishga tushirilgan bo'lishi shart (productMap.json yaratadi).

const poster = require('../services/posterClient');
const { calculateDailyBonus, sumCashCard } = require('../services/bonusCalculator');

async function run() {
  const today = new Date().toISOString().slice(0, 10);

  console.log(`Sana: ${today}`);
  console.log('Tranzaksiyalar yuklanmoqda...');

  let allTx = [];
  let page = 1;
  while (true) {
    const res = await poster.call('transactions.getTransactions', {
      date_from: today,
      date_to: today,
      per_page: 100,
      page,
    });
    allTx = allTx.concat(res.data);
    if (res.data.length < 100) break;
    page += 1;
  }

  console.log(`Jami tranzaksiyalar: ${allTx.length}`);

  // Filial bo'yicha guruhlash
  const bySpot = new Map();
  for (const tx of allTx) {
    const arr = bySpot.get(tx.spot_id) || [];
    arr.push(tx);
    bySpot.set(tx.spot_id, arr);
  }

  for (const [spotId, txs] of bySpot.entries()) {
    const { breakdown, total } = calculateDailyBonus(txs);
    const cashCard = sumCashCard(txs);

    console.log(`\n=== Filial #${spotId} ===`);
    console.log(`Naqd: ${cashCard.cash.toLocaleString()} so'm | Naqdsiz: ${cashCard.card.toLocaleString()} so'm | Jami: ${cashCard.total.toLocaleString()} so'm`);
    if (breakdown.length === 0) {
      console.log('Bonusga hisoblanadigan sotuv yo\'q.');
    } else {
      breakdown.forEach((b) => {
        console.log(`  ${b.category}: ${b.quantity} dona/kg -> ${b.bonus.toLocaleString()} so'm bonus`);
      });
      console.log(`  JAMI BONUS: ${total.toLocaleString()} so'm`);
    }
  }
}

run().catch((e) => console.error('Xato:', e));
