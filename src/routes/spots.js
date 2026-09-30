const express = require('express');
const poster = require('../services/posterClient');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

let cache = { data: null, ts: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 daqiqa

router.get('/', authRequired, async (req, res) => {
  try {
    const now = Date.now();
    if (!cache.data || now - cache.ts > CACHE_TTL_MS) {
      cache.data = await poster.call('spots.getSpots');
      cache.ts = now;
    }

    let spots = cache.data;
    const allowed = req.user.allowed_spots || [];
    if (allowed.length > 0) {
      spots = spots.filter((s) => allowed.includes(Number(s.spot_id)));
    }

    res.json({ spots });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
