const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { nanoid } = require("nanoid");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.GADAI_DATA_DIR || path.join(__dirname, "datagadai");
const DB_FILE = path.join(DATA_DIR, "gadai_db.json");

const FEE_RATE = 0.1;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDb() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    return { records: [] };
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.records || !Array.isArray(parsed.records)) {
      return { records: [] };
    }
    return parsed;
  } catch (error) {
    return { records: [] };
  }
}

function saveDb(db) {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function rupiah(amount) {
  const number = Number(amount || 0);
  return `Rp ${number.toLocaleString("id-ID")}`;
}

function toDateInputValue(date) {
  const dt = new Date(date);
  const year = dt.getFullYear();
  const month = `${dt.getMonth() + 1}`.padStart(2, "0");
  const day = `${dt.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  if (!value) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day, 0, 0, 0);
}

function diffDays(fromDate, toDate) {
  const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const end = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
  const diff = end - start;
  return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)));
}

function weeksFromDays(days) {
  const effectiveDays = Math.max(1, days || 0);
  return Math.max(1, Math.ceil(effectiveDays / 7));
}

function calcWeeklyFee(amount) {
  return Math.round(Number(amount || 0) * FEE_RATE);
}

function calcFeeSummary(record, now = new Date()) {
  const pawnDate = new Date(record.pawnDate);
  const days = diffDays(pawnDate, now);
  const weeks = weeksFromDays(days);
  const weeklyFee = calcWeeklyFee(record.amount);
  const totalFee = weeks * weeklyFee;
  const alreadyPaid = record.feeType === "depan" ? weeklyFee : 0;
  const feeDue = Math.max(0, totalFee - alreadyPaid);

  return {
    days,
    weeks,
    weeklyFee,
    totalFee,
    feeDue,
  };
}

function calcTotals(records) {
  const activeRecords = records.filter((rec) => rec.status === "aktif");
  const redeemedRecords = records.filter((rec) => rec.status === "tebus");
  const totalActiveAmount = activeRecords.reduce((sum, rec) => sum + rec.amount, 0);
  const totalRedeemed = redeemedRecords.reduce((sum, rec) => sum + (rec.tebusTotal || 0), 0);

  return {
    activeCount: activeRecords.length,
    totalActiveAmount,
    totalRedeemed,
    totalRecords: records.length,
  };
}

function buildPrintableData(record) {
  const now = new Date();
  const feeSummary = calcFeeSummary(record, now);
  const totalDue = record.amount + feeSummary.feeDue;

  return {
    id: record.id,
    name: record.name,
    phone: record.phone,
    item: record.item,
    amount: record.amount,
    feeType: record.feeType,
    pawnDate: new Date(record.pawnDate),
    status: record.status,
    feeSummary,
    totalDue,
  };
}

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.redirect("/dashboard");
});

app.get("/dashboard", (req, res) => {
  const db = loadDb();
  const totals = calcTotals(db.records);
  res.send(renderLayout("Dashboard", renderDashboard(totals, db.records)));
});

app.get("/gadai-baru", (req, res) => {
  const todayValue = toDateInputValue(new Date());
  res.send(renderLayout("Gadai Baru", renderNewForm(todayValue)));
});

app.post("/gadai-baru", (req, res) => {
  const db = loadDb();
  const pawnDateInput = parseLocalDate(req.body.pawnDate);
  const pawnDate = pawnDateInput || new Date();

  const record = {
    id: `MC${nanoid(8).toUpperCase()}`,
    name: (req.body.name || "").trim(),
    phone: (req.body.phone || "").trim(),
    item: (req.body.item || "").trim(),
    amount: Number(req.body.amount || 0),
    feeType: req.body.feeType === "depan" ? "depan" : "belakang",
    pawnDate: pawnDate.toISOString(),
    status: "aktif",
    events: [
      {
        type: "gadai",
        at: new Date().toISOString(),
        pawnDate: pawnDate.toISOString(),
      },
    ],
  };

  db.records.unshift(record);
  saveDb(db);

  res.redirect("/aktif");
});

app.get("/aktif", (req, res) => {
  const db = loadDb();
  const records = db.records.filter((rec) => rec.status === "aktif");
  const rows = records.map((record) => ({
    record,
    feeSummary: calcFeeSummary(record),
  }));
  res.send(renderLayout("Gadai Aktif", renderActiveList(rows)));
});

app.get("/riwayat", (req, res) => {
  const db = loadDb();
  const history = db.records.filter((rec) => rec.status !== "aktif");
  res.send(renderLayout("Riwayat", renderHistory(history)));
});

app.post("/aktif/:id/bayar-fee", (req, res) => {
  const db = loadDb();
  const record = db.records.find((rec) => rec.id === req.params.id);
  if (!record) {
    return res.redirect("/aktif");
  }

  const feeSummary = calcFeeSummary(record);
  record.events = record.events || [];
  record.events.push({
    type: "bayar-fee",
    at: new Date().toISOString(),
    weeks: feeSummary.weeks,
    feePaid: feeSummary.feeDue,
    note: "Fee dibayar, tanggal gadai direset.",
  });
  record.pawnDate = new Date().toISOString();
  record.updatedAt = new Date().toISOString();

  saveDb(db);
  res.redirect("/aktif");
});

app.post("/aktif/:id/tebus", (req, res) => {
  const db = loadDb();
  const record = db.records.find((rec) => rec.id === req.params.id);
  if (!record) {
    return res.redirect("/aktif");
  }
  const feeSummary = calcFeeSummary(record);
  const tebusTotal = record.amount + feeSummary.feeDue;

  record.status = "tebus";
  record.tebusAt = new Date().toISOString();
  record.tebusTotal = tebusTotal;
  record.events = record.events || [];
  record.events.push({
    type: "tebus",
    at: new Date().toISOString(),
    feePaid: feeSummary.feeDue,
    totalPaid: tebusTotal,
  });

  saveDb(db);
  res.redirect("/riwayat");
});

app.get("/print/:id", (req, res) => {
  const db = loadDb();
  const record = db.records.find((rec) => rec.id === req.params.id);
  if (!record) {
    return res.status(404).send("Data tidak ditemukan");
  }
  res.send(renderPrint(buildPrintableData(record)));
});

function openBrowser(url) {
  const platform = process.platform;
  if (platform === "win32") {
    exec(`start "" "${url}"`);
    return;
  }
  if (platform === "darwin") {
    exec(`open "${url}"`);
    return;
  }
  exec(`xdg-open "${url}"`);
}

app.listen(PORT, () => {
  ensureDataDir();
  const url = `http://localhost:${PORT}`;
  console.log(`Aplikasi gadai berjalan di ${url}`);
  openBrowser(url);
});

function renderLayout(title, content) {
  return `<!DOCTYPE html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} | Aplikasi Gadai</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="page">
      <header class="topbar">
        <div class="brand">
          <div class="brand-icon">MC</div>
          <div>
            <h1>Mahir Cell</h1>
            <p>Sistem Manajemen Gadai</p>
          </div>
        </div>
        <button class="ghost">Install App</button>
      </header>
      <nav class="tabs">
        <a class="${title === "Dashboard" ? "active" : ""}" href="/dashboard">
          <span class="tab-icon">▦</span> Dashboard
        </a>
        <a class="${title === "Gadai Baru" ? "active" : ""}" href="/gadai-baru">
          <span class="tab-icon">＋</span> Gadai Baru
        </a>
        <a class="${title === "Gadai Aktif" ? "active" : ""}" href="/aktif">
          <span class="tab-icon">◼</span> Aktif
        </a>
        <a class="${title === "Riwayat" ? "active" : ""}" href="/riwayat">
          <span class="tab-icon">↺</span> Riwayat
        </a>
      </nav>
      <main class="content">
        ${content}
      </main>
    </div>
  </body>
</html>`;
}

function renderDashboard(totals, records) {
  const latest = records.slice(0, 5);
  return `
    <section class="stats">
      <div class="stat-card">
        <div>
          <h3>Gadai Aktif</h3>
          <p class="stat-value">${totals.activeCount}</p>
          <span class="stat-meta">transaksi</span>
        </div>
        <div class="stat-icon blue">◼</div>
      </div>
      <div class="stat-card">
        <div>
          <h3>Total Nilai Gadai</h3>
          <p class="stat-value">${rupiah(totals.totalActiveAmount)}</p>
          <span class="stat-meta">outstanding</span>
        </div>
        <div class="stat-icon green">💵</div>
      </div>
      <div class="stat-card">
        <div>
          <h3>Sudah Ditebus</h3>
          <p class="stat-value">${totals.totalRedeemed > 0 ? rupiah(totals.totalRedeemed) : "0"}</p>
          <span class="stat-meta">transaksi</span>
        </div>
        <div class="stat-icon purple">↗</div>
      </div>
      <div class="stat-card">
        <div>
          <h3>Total Transaksi</h3>
          <p class="stat-value">${totals.totalRecords}</p>
          <span class="stat-meta">semua waktu</span>
        </div>
        <div class="stat-icon orange">⟳</div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-header">
        <h3>Transaksi Terbaru</h3>
      </div>
      <div class="table modern">
        <div class="table-row header">
          <span>ID</span>
          <span>Nama</span>
          <span>Barang</span>
          <span>Status</span>
        </div>
        ${latest
          .map(
            (rec) => `
          <div class="table-row">
            <span>${rec.id}</span>
            <span>${rec.name || "-"}</span>
            <span>${rec.item || "-"}</span>
            <span class="pill ${rec.status}">${rec.status}</span>
          </div>
        `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderNewForm(todayValue) {
  return `
    <section class="panel panel-form">
      <div class="panel-header">
        <h3>Gadai Baru</h3>
      </div>
      <form class="form clean" method="post" action="/gadai-baru">
        <div class="form-row">
          <label>
            Nama Pegadai
            <input type="text" name="name" placeholder="Masukkan nama..." required />
          </label>
          <label>
            No. HP (opsional)
            <input type="text" name="phone" placeholder="08xx..." />
          </label>
        </div>
        <label>
          Nama Barang
          <input type="text" name="item" placeholder="Contoh: HP Samsung A54" required />
        </label>
        <div class="form-row">
          <label>
            Nilai Gadai (Rp)
            <input type="number" name="amount" min="0" step="1000" value="0" required />
          </label>
          <label>
            Tanggal Gadai
            <input type="date" name="pawnDate" value="${todayValue}" />
            <small>Biarkan otomatis jika kosong.</small>
          </label>
        </div>
        <label>
          Pembayaran Fee
          <select name="feeType">
            <option value="belakang">Bayar di Belakang</option>
            <option value="depan">Bayar di Depan</option>
          </select>
        </label>
        <button class="primary" type="submit">Simpan Gadai</button>
      </form>
    </section>
  `;
}

function renderActiveList(rows) {
  if (!rows.length) {
    return `<section class="panel"><p>Belum ada data gadai aktif.</p></section>`;
  }
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Gadai Aktif</h3>
          <p class="muted">Daftar barang gadai yang masih berjalan.</p>
        </div>
        <span class="badge">${rows.length} item</span>
      </div>
      <div class="search">
        <span>🔍</span>
        <input type="text" placeholder="Cari nota, nama, atau barang..." disabled />
      </div>
      <div class="cards-list">
        ${rows
          .map(({ record, feeSummary }) => {
            const pawnDate = new Date(record.pawnDate).toLocaleDateString("id-ID", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            });
            const totalDue = record.amount + feeSummary.feeDue;
            return `
            <div class="active-card">
              <div class="active-header">
                <div>
                  <div class="active-id">
                    <strong>${record.id}</strong>
                    <span class="pill aktif">aktif</span>
                    <span class="pill neutral">Fee ${record.feeType === "depan" ? "Depan" : "Belakang"}</span>
                  </div>
                  <div class="active-meta">
                    <span>👤 ${record.name || "-"}</span>
                    <span>📦 ${record.item || "-"}</span>
                  </div>
                </div>
                <div class="active-actions">
                  <form method="post" action="/aktif/${record.id}/tebus">
                    <button type="submit" class="secondary">Tebus</button>
                  </form>
                  <form method="post" action="/aktif/${record.id}/bayar-fee">
                    <button type="submit">Bayar Fee</button>
                  </form>
                  <a class="ghost" href="/print/${record.id}" target="_blank">Print</a>
                </div>
              </div>
              <div class="active-details">
                <span>📞 ${record.phone || "-"}</span>
                <span>📅 ${pawnDate}</span>
              </div>
              <div class="active-footer">
                <div>
                  <p class="label">Gadai</p>
                  <p class="value">${rupiah(record.amount)}</p>
                </div>
                <div>
                  <p class="label">${feeSummary.weeks} minggu</p>
                  <p class="value fee">Fee: ${rupiah(feeSummary.feeDue)}</p>
                </div>
                <div>
                  <p class="label">Total Tebus</p>
                  <p class="value">${rupiah(totalDue)}</p>
                </div>
              </div>
            </div>
          `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderHistory(records) {
  if (!records.length) {
    return `<section class="panel"><p>Belum ada transaksi tebus.</p></section>`;
  }
  return `
    <section class="panel">
      <div class="panel-header">
        <h3>Riwayat Tebus</h3>
      </div>
      <div class="table modern">
        <div class="table-row header">
          <span>ID</span>
          <span>Nama</span>
          <span>Barang</span>
          <span>Total Tebus</span>
          <span>Tanggal Tebus</span>
          <span>Print</span>
        </div>
        ${records
          .map(
            (rec) => `
        <div class="table-row">
          <span>${rec.id}</span>
          <span>${rec.name || "-"}</span>
          <span>${rec.item || "-"}</span>
          <span>${rupiah(rec.tebusTotal || 0)}</span>
          <span>${rec.tebusAt ? new Date(rec.tebusAt).toLocaleDateString("id-ID") : "-"}</span>
          <span><a class="link" href="/print/${rec.id}" target="_blank">Print</a></span>
        </div>
      `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderPrint(data) {
  return `<!DOCTYPE html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Print ${data.id}</title>
    <style>
      body {
        font-family: "Helvetica", Arial, sans-serif;
        margin: 0;
      }
      .ticket {
        width: 58mm;
        padding: 6mm 5mm 8mm 5mm;
        box-sizing: border-box;
      }
      h1 {
        font-size: 12px;
        margin: 0 0 4px;
        text-align: center;
        font-weight: 700;
      }
      h2 {
        font-size: 9px;
        margin: 0 0 8px;
        text-align: center;
        font-weight: 700;
      }
      .rule {
        border-top: 1px solid #000;
        margin: 6px 0;
      }
      .row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 4px;
        font-size: 9.5px;
      }
      .muted {
        color: #666;
        font-size: 8.5px;
        text-align: center;
      }
      .total {
        font-weight: bold;
        font-size: 11px;
      }
      .label {
        font-weight: 700;
      }
      .value {
        font-weight: 700;
      }
      .section {
        font-size: 8.5px;
        margin-top: 4px;
        line-height: 1.3;
      }
      @media print {
        button {
          display: none;
        }
      }
    </style>
  </head>
  <body>
    <button onclick="window.print()">Print</button>
    <div class="ticket">
      <h1>MAHIR CELL</h1>
      <h2>BUKTI ${data.status === "tebus" ? "TEBUS" : "GADAI"} (58mm)</h2>
      <div class="rule"></div>
      <div class="row"><span class="label">ID Nota</span><span class="value">${data.id}</span></div>
      <div class="row"><span class="label">Tanggal</span><span class="value">${data.pawnDate.toLocaleDateString("id-ID")}</span></div>
      <div class="rule"></div>
      <div class="row"><span class="label">Nama</span><span class="value">${(data.name || "-").toUpperCase()}</span></div>
      <div class="row"><span class="label">No HP</span><span class="value">${data.phone || "-"}</span></div>
      <div class="rule"></div>
      <div class="row"><span class="label">Barang</span><span class="value">${(data.item || "-").toUpperCase()}</span></div>
      <div class="rule"></div>
      <div class="row"><span class="label">Harga Gadai</span><span class="value">${rupiah(data.amount)}</span></div>
      <div class="row"><span class="label">Fee</span><span class="value">${rupiah(data.feeSummary.feeDue)}</span></div>
      <div class="row"><span class="label">Tipe</span><span class="value">${data.feeType === "depan" ? "Depan" : "Belakang"}</span></div>
      <div class="rule"></div>
      <div class="row total"><span>Harga Tebus</span><span>${rupiah(data.totalDue)}</span></div>
      <div class="section">
        Fee 10% per minggu dari harga gadai. Jika lebih dari 1 minggu, fee bertambah 10% tiap minggu.
      </div>
      <div class="rule"></div>
      <div class="section">
        1) Barang disimpan baik & tidak digunakan. 2) Tidak ambil komponen sebelum tebus.
        3) Kerusakan tersembunyi di luar tanggung jawab. 4) Lewat ketentuan = hangus (maksimal 3 minggu).
        5) Nota wajib dibawa saat tebus. 6) Hub 085136661556 jika ada pertanyaan.
      </div>
      <p class="muted">Simpan nota ini baik-baik.</p>
    </div>
  </body>
</html>`;
}
