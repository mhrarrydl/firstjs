const express = require("express");
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

app.listen(PORT, () => {
  ensureDataDir();
  console.log(`Aplikasi gadai berjalan di http://localhost:${PORT}`);
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
    <div class="app">
      <aside class="sidebar">
        <h1>Aplikasi Gadai</h1>
        <nav>
          <a href="/dashboard">Dashboard</a>
          <a href="/gadai-baru">Gadai Baru</a>
          <a href="/aktif">Aktif</a>
          <a href="/riwayat">Riwayat</a>
        </nav>
      </aside>
      <main>
        <header>
          <h2>${title}</h2>
        </header>
        ${content}
      </main>
    </div>
  </body>
</html>`;
}

function renderDashboard(totals, records) {
  const latest = records.slice(0, 5);
  return `
    <section class="cards">
      <div class="card">
        <h3>Gadai Aktif</h3>
        <p>${totals.activeCount} transaksi</p>
      </div>
      <div class="card">
        <h3>Total Nilai Gadai Aktif</h3>
        <p>${rupiah(totals.totalActiveAmount)}</p>
      </div>
      <div class="card">
        <h3>Total Nilai Tebus</h3>
        <p>${rupiah(totals.totalRedeemed)}</p>
      </div>
      <div class="card">
        <h3>Total Transaksi</h3>
        <p>${totals.totalRecords} transaksi</p>
      </div>
    </section>
    <section>
      <h3>Transaksi Terbaru</h3>
      <div class="table">
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
    <form class="form" method="post" action="/gadai-baru">
      <div class="form-grid">
        <label>
          Nama Pegadai
          <input type="text" name="name" required />
        </label>
        <label>
          No HP
          <input type="text" name="phone" />
        </label>
        <label>
          Barang
          <input type="text" name="item" required />
        </label>
        <label>
          Harga Gadai (Rp)
          <input type="number" name="amount" min="0" step="1000" required />
        </label>
        <label>
          Tanggal Gadai
          <input type="date" name="pawnDate" value="${todayValue}" />
          <small>Biarkan otomatis jika kosong.</small>
        </label>
        <label>
          Tipe Fee
          <select name="feeType">
            <option value="belakang">Belakang (bayar saat tebus)</option>
            <option value="depan">Depan (potong fee awal)</option>
          </select>
        </label>
      </div>
      <button class="primary" type="submit">Simpan Gadai</button>
    </form>
  `;
}

function renderActiveList(rows) {
  if (!rows.length) {
    return `<p>Belum ada data gadai aktif.</p>`;
  }
  return `
    <div class="table">
      <div class="table-row header">
        <span>ID</span>
        <span>Nama</span>
        <span>Barang</span>
        <span>Gadai</span>
        <span>Fee Saat Ini</span>
        <span>Aksi</span>
      </div>
      ${rows
        .map(({ record, feeSummary }) => {
          return `
            <div class="table-row">
              <span>${record.id}</span>
              <span>${record.name || "-"}</span>
              <span>${record.item || "-"}</span>
              <span>${rupiah(record.amount)}</span>
              <span>${rupiah(feeSummary.feeDue)} (${feeSummary.weeks} minggu)</span>
              <span class="actions">
                <form method="post" action="/aktif/${record.id}/bayar-fee">
                  <button type="submit">Bayar Fee</button>
                </form>
                <form method="post" action="/aktif/${record.id}/tebus">
                  <button type="submit" class="secondary">Tebus</button>
                </form>
                <a class="link" href="/print/${record.id}" target="_blank">Print</a>
              </span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderHistory(records) {
  if (!records.length) {
    return `<p>Belum ada transaksi tebus.</p>`;
  }
  return `
    <div class="table">
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
        font-family: Arial, sans-serif;
        margin: 16px;
      }
      .ticket {
        max-width: 320px;
        border: 1px solid #ddd;
        padding: 16px;
      }
      h1 {
        font-size: 18px;
        margin: 0 0 8px;
      }
      .row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 6px;
      }
      .muted {
        color: #666;
      }
      .total {
        font-weight: bold;
        font-size: 16px;
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
      <h1>Nota ${data.status === "tebus" ? "Tebus" : "Gadai"}</h1>
      <div class="row"><span>ID</span><span>${data.id}</span></div>
      <div class="row"><span>Nama</span><span>${data.name || "-"}</span></div>
      <div class="row"><span>Barang</span><span>${data.item || "-"}</span></div>
      <div class="row"><span>Gadai</span><span>${rupiah(data.amount)}</span></div>
      <div class="row"><span>Tgl Gadai</span><span>${data.pawnDate.toLocaleDateString("id-ID")}</span></div>
      <div class="row"><span>Minggu</span><span>${data.feeSummary.weeks}</span></div>
      <div class="row"><span>Fee</span><span>${rupiah(data.feeSummary.feeDue)}</span></div>
      <div class="row total"><span>Total Tebus</span><span>${rupiah(data.totalDue)}</span></div>
      <p class="muted">Simpan nota ini baik-baik.</p>
    </div>
  </body>
</html>`;
}
