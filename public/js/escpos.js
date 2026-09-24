// USB termal printerga (masalan Xprinter XP-80C) to'g'ridan-to'g'ri ESC/POS
// baytlarini yuborish — Poster POS drayverni WinUSB'ga o'zgartirib qo'yganda
// oddiy window.print() ishlamay qoladi, shuning uchun WebUSB ishlatiladi.
// Chek matn buyruqlari bilan emas, Canvas'da chizilib bitmap (rasm) sifatida
// yuboriladi — HAQIQIY JADVAL (tashqi ramka + har qator orasida chiziq +
// ustunlar orasida vertikal chiziq) chizilib, shundan keyin bosiladi.
// MUHIM: chop etishdan keyin USB port har doim (finally blokida) bo'shatiladi —
// aks holda brauzer printerni band qilib qo'yadi va Poster o'z chekini
// chiqara olmay qoladi.

const PRINTER_WIDTH_PX = 384; // 80mm termal printer uchun odatiy piksel kengligi

async function getUsbDevice() {
  const filters = [{ vendorId: 0x0483 }]; // ko'p Xprinter modellari shu vendor ID orqali tanilgan
  try {
    return await navigator.usb.requestDevice({ filters });
  } catch (e) {
    throw new Error('USB printer tanlanmadi');
  }
}

/**
 * Haqiqiy jadval (grid) chek chizadi.
 * columns: [{ label, width }] — width nisbiy (masalan 0.4, 0.2, 0.2, 0.2 -> yig'indisi 1)
 * rows: [[cell1, cell2, ...], ...]
 * totals: [[label, value], ...] — jadvaldan keyin, chiziqsiz, qalin
 */
function drawGridReceipt({ title, subtitle, columns, rows, totals }) {
  const PAD = 8;
  const rowH = 24;
  const headerH = 26;
  const usableW = PRINTER_WIDTH_PX - PAD * 2;
  const colWidths = columns.map((c) => Math.round(c.width * usableW));

  let headerLines = 2;
  const canvas = document.createElement('canvas');
  canvas.width = PRINTER_WIDTH_PX;
  canvas.height = headerLines * 26 + 14 + headerH + rows.length * rowH + 10 + (totals.length * 22) + 30;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';

  let y = 14;
  ctx.font = 'bold 21px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(title, canvas.width / 2, y); y += 24;
  if (subtitle) {
    ctx.font = '13px monospace';
    ctx.fillText(subtitle, canvas.width / 2, y); y += 22;
  }
  y += 4;

  const tableTop = y;
  const tableLeft = PAD;
  const tableWidth = usableW;

  // Header row
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  let cx = tableLeft;
  columns.forEach((c, i) => {
    ctx.fillText(c.label, cx + 4, y + headerH / 2);
    cx += colWidths[i];
  });
  y += headerH;

  // Data rows
  ctx.font = '12.5px monospace';
  rows.forEach((row) => {
    let cxr = tableLeft;
    row.forEach((cell, i) => {
      ctx.textAlign = i === 0 ? 'left' : 'right';
      const textX = i === 0 ? cxr + 4 : cxr + colWidths[i] - 4;
      ctx.fillText(String(cell), textX, y + rowH / 2);
      cxr += colWidths[i];
    });
    y += rowH;
  });

  const tableBottom = y;

  // Grid lines: outer border, header separator, row separators, column separators
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(tableLeft + 0.5, tableTop + 0.5, tableWidth, tableBottom - tableTop);
  ctx.beginPath();
  ctx.moveTo(tableLeft, tableTop + headerH); ctx.lineTo(tableLeft + tableWidth, tableTop + headerH);
  ctx.stroke();
  for (let ry = tableTop + headerH; ry <= tableBottom; ry += rowH) {
    ctx.beginPath(); ctx.moveTo(tableLeft, ry); ctx.lineTo(tableLeft + tableWidth, ry); ctx.stroke();
  }
  let colX = tableLeft;
  columns.forEach((c, i) => {
    if (i > 0) { ctx.beginPath(); ctx.moveTo(colX, tableTop); ctx.lineTo(colX, tableBottom); ctx.stroke(); }
    colX += colWidths[i];
  });

  y = tableBottom + 14;
  ctx.font = 'bold 14px monospace';
  totals.forEach(([label, value]) => {
    ctx.textAlign = 'left'; ctx.fillText(label, tableLeft, y);
    ctx.textAlign = 'right'; ctx.fillText(String(value), tableLeft + tableWidth, y);
    y += 22;
  });
  y += 10;
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(new Date().toLocaleString('uz-UZ'), canvas.width / 2, y);

  return canvas;
}

function canvasToEscposRaster(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height).data;
  const widthBytes = Math.ceil(width / 8);
  const raster = new Uint8Array(widthBytes * height);
  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < width; xx++) {
      const idx = (yy * width + xx) * 4;
      const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2], a = imgData[idx + 3];
      const luminance = r * 0.3 + g * 0.59 + b * 0.11;
      if (a > 10 && luminance < 200) {
        const byteIndex = yy * widthBytes + (xx >> 3);
        raster[byteIndex] |= 0x80 >> (xx % 8);
      }
    }
  }
  const header = new Uint8Array([0x1d, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff]);
  const cut = new Uint8Array([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]);
  const out = new Uint8Array(header.length + raster.length + cut.length);
  out.set(header, 0);
  out.set(raster, header.length);
  out.set(cut, header.length + raster.length);
  return out;
}

async function printCanvas(canvas, statusEl) {
  if (!navigator.usb) {
    if (statusEl) statusEl.textContent = "Brauzer WebUSB'ni qo'llab-quvvatlamaydi";
    return;
  }
  let device = null;
  try {
    if (statusEl) statusEl.textContent = 'Printer tanlanmoqda...';
    device = await getUsbDevice();
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    const iface = device.configuration.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === 0x07))
      || device.configuration.interfaces[0];
    await device.claimInterface(iface.interfaceNumber);
    const outEndpoint = iface.alternates[0].endpoints.find((e) => e.direction === 'out');
    if (!outEndpoint) throw new Error('Printerda chiqish endpointi topilmadi');

    if (statusEl) statusEl.textContent = 'Chop etilmoqda...';
    const bytes = canvasToEscposRaster(canvas);
    await device.transferOut(outEndpoint.endpointNumber, bytes);
    if (statusEl) statusEl.textContent = 'Chek chop etildi';
  } catch (e) {
    if (statusEl) statusEl.textContent = `Xato: ${e.message}`;
  } finally {
    // MUHIM: har doim bo'shatiladi — aks holda Poster o'z chekini chiqara olmay qoladi.
    if (device) {
      try { await device.releaseInterface(0); } catch (e) { /* allaqachon bo'shatilgan bo'lishi mumkin */ }
      try { await device.close(); } catch (e) { /* ignore */ }
    }
  }
}

async function printCashReceipt(entry, paymentTypes, statusEl) {
  const paymentRows = paymentTypes.filter((p) => Number((entry.payment_amounts || {})[p.id]) > 0);
  const columns = [{ label: 'Nomi', width: 0.62 }, { label: 'Summa', width: 0.38 }];
  const rows = [
    ['Тоза', fmtMoney(entry.toza_naqd)],
    ['Avans', fmtMoney(entry.rasxod.avans)],
    ['Ofitsant', fmtMoney(entry.rasxod.ofitsant)],
    ['Texnichka', fmtMoney(entry.rasxod.texnichka)],
    ['Prochiy', fmtMoney(entry.rasxod.prochiy)],
    ['Bozorlik', fmtMoney(entry.rasxod.bozorlik)],
    ...paymentRows.map((p) => [p.name, fmtMoney(entry.payment_amounts[p.id])]),
  ];
  const canvas = drawGridReceipt({
    title: 'MONDO REGION', subtitle: `Kassa hisoboti — ${entry.business_date}`,
    columns, rows,
    totals: [['JAMI', fmtMoney(entry.jami) + " so'm"]],
  });
  await printCanvas(canvas, statusEl);
}

async function printBozorlikReceipt(entry, items, statusEl) {
  const columns = [{ label: 'Ingredient', width: 0.42 }, { label: 'Miqdor', width: 0.18 }, { label: 'Narx', width: 0.2 }, { label: 'Summa', width: 0.2 }];
  const rows = items.map((it) => [it.ingredient_name, `${it.quantity} ${it.unit}`, fmtMoney(it.unit_price), fmtMoney(it.sum)]);
  const canvas = drawGridReceipt({
    title: 'MONDO REGION', subtitle: `Bozorlik — ${entry.business_date}`,
    columns, rows,
    totals: [['JAMI', fmtMoney(entry.total_amount) + " so'm"]],
  });
  await printCanvas(canvas, statusEl);
}

async function printExpensesReceipt(businessDate, expenses, total, statusEl) {
  const columns = [{ label: 'Turi', width: 0.55 }, { label: 'Summa', width: 0.45 }];
  const rows = expenses.map((e) => [e.employee_name ? `${e.expense_type_name} — ${e.employee_name}` : e.expense_type_name, fmtMoney(e.amount)]);
  const canvas = drawGridReceipt({
    title: 'MONDO REGION', subtitle: `Xarajatlar — ${businessDate}`,
    columns, rows,
    totals: [['JAMI', fmtMoney(total) + " so'm"]],
  });
  await printCanvas(canvas, statusEl);
}
