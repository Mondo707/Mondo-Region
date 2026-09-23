// Kichik fetch o'rovchi — JSON so'rov/javob, xatolarni birxil ko'rinishda uloqtiradi.
async function api(path, options = {}) {
  const opts = {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (options.body !== undefined) opts.body = JSON.stringify(options.body);

  const res = await fetch(`/api${path}`, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* bo'sh javob (masalan fayl) */ }

  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error("Tizimga kiring");
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Xato (HTTP ${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('ru-RU').replace(/,/g, ' ');
}

function fmtDate(d) {
  const [y, m, day] = String(d).split('-');
  return `${day}.${m.slice(0, 2) === '0' + m[1] ? m : m}`;
}

async function requireSession() {
  const { user } = await api('/auth/me');
  if (!user) {
    window.location.href = '/login.html';
    return null;
  }
  return user;
}
