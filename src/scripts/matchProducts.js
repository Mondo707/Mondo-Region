// Qo'lda ishga tushirish uchun: cd backend && npm run match:products
// (Server ham buni har ishga tushganda avtomatik bajaradi - src/services/productMatcher.js)

const { matchProducts } = require('../services/productMatcher');

matchProducts()
  .then((res) => {
    console.log(`\nYakuniy natija: ${res.matched}/${res.total} mos keldi.`);
  })
  .catch((e) => console.error('Xato:', e));
