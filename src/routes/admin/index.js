const express = require('express');

const router = express.Router();

router.use('/positions', require('./positions'));
router.use('/employees', require('./employees'));
router.use('/expense-types', require('./expenseTypes'));
router.use('/payment-types', require('./paymentTypes'));
router.use('/ingredients', require('./ingredients'));
router.use('/categories', require('./categories'));
router.use('/users', require('./users'));

module.exports = router;
