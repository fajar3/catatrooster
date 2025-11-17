const express = require('express');
const bodyParser = require('body-parser');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
let db;

// --- Helper ---
function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(path.join(__dirname, 'database.db'), buffer);
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function querySingle(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || {};
}

function runQuery(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

// --- Inisialisasi database ---
(async () => {
  const SQL = await initSqlJs();
  const dbPath = path.join(__dirname, 'database.db');

  if (fs.existsSync(dbPath)) {
    const filebuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }

  // --- Buat tabel kalau belum ada ---
  db.run(`
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kebutuhan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      harga INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pengeluaran (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      jumlah INTEGER NOT NULL,
      harga INTEGER NOT NULL,
      tanggal TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ayam (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jumlah INTEGER NOT NULL,
      harga INTEGER NOT NULL,
      tanggal TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pemasukan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jumlah INTEGER NOT NULL,
      harga INTEGER NOT NULL,
      total INTEGER NOT NULL,
      tanggal TEXT NOT NULL
    );
  `);

  // --- Pastikan ada Asset default ---
  const assetExist = querySingle(`SELECT * FROM assets WHERE id=1`);
  if (!assetExist.id) {
    runQuery(`INSERT INTO assets(id,name) VALUES(1,'Asset 1')`);
  }

  // --- Auto upgrade: tambah kolom asset_id jika belum ada ---
  const addColumnIfNotExists = (table) => {
    const stmt = db.prepare(`PRAGMA table_info(${table})`);
    const info = [];
    while (stmt.step()) info.push(stmt.getAsObject());
    stmt.free();
    if (!info.find(c => c.name === 'asset_id')) {
      db.run(`ALTER TABLE ${table} ADD COLUMN asset_id INTEGER DEFAULT 1`);
    }
  };
  ['kebutuhan', 'pengeluaran', 'ayam', 'pemasukan'].forEach(addColumnIfNotExists);

  console.log('✅ Database siap dan sudah upgrade kolom asset_id jika perlu!');
})();

// --- Middleware & Layout ---
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.currentAsset = parseInt(req.query.asset) || 1;
  res.locals.assets = queryAll(`SELECT * FROM assets`);
  next();
});

app.use(expressLayouts);
app.set('layout', 'layouts/index');
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---

// Dashboard
app.get('/', (req, res) => {
  const assetId = res.locals.currentAsset;
  const page = parseInt(req.query.page) || 1;
  const perPage = 5;
  const offset = (page - 1) * perPage;

  const pengeluaran = queryAll(
    `SELECT * FROM pengeluaran WHERE asset_id=? ORDER BY id DESC LIMIT ? OFFSET ?`,
    [assetId, perPage, offset]
  );

  const totalRow = querySingle(`SELECT COUNT(*) as total FROM pengeluaran WHERE asset_id=?`, [assetId]);
  const totalPages = Math.ceil((totalRow.total || 0) / perPage);

  const totalMingguRow = querySingle(
    `SELECT SUM(harga) as total FROM pengeluaran WHERE asset_id=? AND tanggal >= date('now', '-7 days')`,
    [assetId]
  );
  const totalBulanRow = querySingle(
    `SELECT SUM(harga) as total FROM pengeluaran WHERE asset_id=? AND strftime('%Y-%m', tanggal) = strftime('%Y-%m', 'now')`,
    [assetId]
  );
  const totalAllRow = querySingle(`SELECT SUM(harga) as total FROM pengeluaran WHERE asset_id=?`, [assetId]);
  const pemasukanRow = querySingle(`SELECT SUM(total) as total FROM pemasukan WHERE asset_id=?`, [assetId]);
  const ayamRow = querySingle(`SELECT SUM(jumlah) as total FROM ayam WHERE asset_id=?`, [assetId]);

  const totalMinggu = totalMingguRow.total || 0;
  const totalBulan = totalBulanRow.total || 0;
  const totalAll = totalAllRow.total || 0;
  const pemasukanTotal = pemasukanRow.total || 0;
  const ayamTotal = ayamRow.total || 0;
  const keuanganTotal = totalAll - pemasukanTotal;

  const chartRows = queryAll(
    `SELECT nama, SUM(harga) as total FROM pengeluaran WHERE asset_id=? GROUP BY nama`,
    [assetId]
  );
  const chartLabels = chartRows.map(r => r.nama);
  const chartValues = chartRows.map(r => r.total);

  res.render('index', {
    pengeluaran,
    totalMinggu,
    totalBulan,
    totalAll,
    totalPemasukan: pemasukanTotal,
    totalKeuangan: keuanganTotal,
    totalAyam: ayamTotal,
    chartLabels,
    chartValues,
    page,
    totalPages,
    title: 'Dashboard Aset'
  });
});

// Assets
app.get('/assets', (req, res) => {
  const assets = queryAll(`SELECT * FROM assets`);
  res.render('assets', { assets, title: 'Daftar Asset' });
});

app.post('/assets', (req, res) => {
  const { name } = req.body;
  runQuery(`INSERT INTO assets(name) VALUES(?)`, [name]);
  res.redirect('/assets');
});

// Kebutuhan
app.get('/kebutuhan', (req, res) => {
  const assetId = res.locals.currentAsset;
  const kebutuhan = queryAll(`SELECT * FROM kebutuhan WHERE asset_id=?`, [assetId]);
  res.render('kebutuhan', { kebutuhan, title: 'Daftar Kebutuhan' });
});

app.post('/kebutuhan', (req, res) => {
  const { nama, harga } = req.body;
  const assetId = res.locals.currentAsset;
  runQuery(`INSERT INTO kebutuhan(nama,harga,asset_id) VALUES(?,?,?)`, [nama, parseInt(harga), assetId]);
  res.redirect(`/kebutuhan?asset=${assetId}`);
});

app.get('/kebutuhan/edit/:id', (req, res) => {
  const id = req.params.id;
  const item = querySingle(`SELECT * FROM kebutuhan WHERE id=?`, [id]);
  if (!item.id) return res.send('Kebutuhan tidak ditemukan');
  res.render('edit_kebutuhan', { item, title: 'Edit Kebutuhan' });
});

app.post('/kebutuhan/edit/:id', (req, res) => {
  const id = req.params.id;
  const { nama, harga } = req.body;
  runQuery(`UPDATE kebutuhan SET nama=?, harga=? WHERE id=?`, [nama, parseInt(harga), id]);
  res.redirect(`/kebutuhan?asset=${res.locals.currentAsset}`);
});

app.post('/kebutuhan/delete/:id', (req, res) => {
  const id = req.params.id;
  runQuery(`DELETE FROM kebutuhan WHERE id=?`, [id]);
  res.redirect(`/kebutuhan?asset=${res.locals.currentAsset}`);
});

// Pengeluaran
app.get('/pengeluaran', (req, res) => {
  const assetId = res.locals.currentAsset;
  const pengeluaran = queryAll(`SELECT * FROM pengeluaran WHERE asset_id=? ORDER BY id DESC`, [assetId]);
  res.render('pengeluaran', { pengeluaran, title: 'List Pengeluaran' });
});

app.get('/pengeluaran/edit/:id', (req, res) => {
  const id = req.params.id;
  const item = querySingle(`SELECT * FROM pengeluaran WHERE id=?`, [id]);
  if (!item.id) return res.send('Pengeluaran tidak ditemukan');
  res.render('edit_pengeluaran', { item, title: 'Edit Pengeluaran' });
});

app.post('/pengeluaran/edit/:id', (req, res) => {
  const id = req.params.id;
  const { nama, jumlah, harga } = req.body;
  runQuery(`UPDATE pengeluaran SET nama=?, jumlah=?, harga=? WHERE id=?`, [nama, parseInt(jumlah), parseInt(harga), id]);
  res.redirect(`/pengeluaran?asset=${res.locals.currentAsset}`);
});

app.post('/pengeluaran/delete/:id', (req, res) => {
  const id = req.params.id;
  runQuery(`DELETE FROM pengeluaran WHERE id=?`, [id]);
  res.redirect(`/pengeluaran?asset=${res.locals.currentAsset}`);
});
// Tampilkan form tambah pengeluaran
app.get('/add', (req, res) => {
  const assetId = res.locals.currentAsset;
  const kebutuhan = queryAll(`SELECT * FROM kebutuhan WHERE asset_id=?`, [assetId]);
  res.render('add', { kebutuhan, title: 'Tambah Pengeluaran' });
});

// Proses submit pengeluaran
app.post('/add', (req, res) => {
  const assetId = res.locals.currentAsset;
  const { nama, jumlah } = req.body;
  const pakan = querySingle(`SELECT * FROM kebutuhan WHERE nama=? AND asset_id=?`, [nama, assetId]);
  if (!pakan.nama) return res.send('Kebutuhan tidak ditemukan');

  const tgl = new Date().toISOString().split('T')[0];
  runQuery(
    `INSERT INTO pengeluaran(nama,jumlah,harga,tanggal,asset_id) VALUES(?,?,?,?,?)`,
    [nama, parseInt(jumlah), parseInt(jumlah) * pakan.harga, tgl, assetId]
  );
  res.redirect(`/add?asset=${assetId}`);
});

// Ayam
app.get('/ayam', (req, res) => {
  const assetId = res.locals.currentAsset;
  const ayam = queryAll(`SELECT * FROM ayam WHERE asset_id=? ORDER BY id DESC`, [assetId]);
  const pengeluaranRow = querySingle(`SELECT SUM(harga) as total FROM pengeluaran WHERE asset_id=?`, [assetId]);
  const pemasukanRow = querySingle(`SELECT SUM(total) as total FROM pemasukan WHERE asset_id=?`, [assetId]);
  const totalKeuangan = (pemasukanRow.total || 0) - (pengeluaranRow.total || 0);

  res.render('ayam', {
    ayam,
    totalPengeluaran: pengeluaranRow.total || 0,
    totalPemasukan: pemasukanRow.total || 0,
    totalKeuangan,
    title: 'Daftar Ayam'
  });
});
app.post('/ayam', (req, res) => {
  const { jumlah, harga } = req.body;
  const assetId = res.locals.currentAsset; // ambil current asset
  const tgl = new Date().toISOString().split('T')[0];

  // Insert ke tabel ayam dengan asset_id
  runQuery(
    `INSERT INTO ayam(jumlah,harga,tanggal,asset_id) VALUES(?,?,?,?)`,
    [parseInt(jumlah), parseInt(harga), tgl, assetId]
  );

  // Insert ke tabel pengeluaran terkait ayam dengan asset_id
  runQuery(
    `INSERT INTO pengeluaran(nama,jumlah,harga,tanggal,asset_id) VALUES(?,?,?,?,?)`,
    ['Beli Anak Ayam', parseInt(jumlah), parseInt(harga), tgl, assetId]
  );

  // Redirect ke halaman ayam dengan asset_id yang sama
  res.redirect(`/ayam?asset=${assetId}`);
});

app.get('/ayam/edit/:id', (req, res) => {
  const id = req.params.id;
  const item = querySingle(`SELECT * FROM ayam WHERE id=?`, [id]);
  if (!item.id) return res.send('Data ayam tidak ditemukan');
  res.render('edit_ayam', { item, title: 'Edit Ayam' });
});

app.post('/ayam/edit/:id', (req, res) => {
  const id = req.params.id;
  const { jumlah, harga } = req.body;
  runQuery(`UPDATE ayam SET jumlah=?, harga=? WHERE id=?`, [parseInt(jumlah), parseInt(harga), id]);
  res.redirect(`/ayam?asset=${res.locals.currentAsset}`);
});
app.post('/ayam/delete/:id', (req, res) => {
  const id = req.params.id;
  runQuery(`DELETE FROM ayam WHERE id=?`, [id]);
  res.redirect(`/ayam?asset=${res.locals.currentAsset}`);
});

// Pemasukan
app.get('/pemasukan', (req, res) => {
  const assetId = res.locals.currentAsset;
  const pemasukan = queryAll(`SELECT * FROM pemasukan WHERE asset_id=? ORDER BY id DESC`, [assetId]);
  res.render('pemasukan', { pemasukan, title: 'Penjualan Ayam' });
});

app.post('/pemasukan', (req, res) => {
  const { jumlah, harga } = req.body;
  const assetId = res.locals.currentAsset; // ambil current asset
  const tgl = new Date().toISOString().split('T')[0];
  const total = parseInt(jumlah) * parseInt(harga);

  // Insert ke tabel pemasukan dengan asset_id
  runQuery(
    `INSERT INTO pemasukan(jumlah,harga,total,tanggal,asset_id) VALUES(?,?,?,?,?)`,
    [parseInt(jumlah), parseInt(harga), total, tgl, assetId]
  );

  // Insert ke tabel ayam dengan asset_id, jumlah negatif
  runQuery(
    `INSERT INTO ayam(jumlah,harga,tanggal,asset_id) VALUES(?,?,?,?)`,
    [-parseInt(jumlah), parseInt(harga), tgl, assetId]
  );

  // Redirect ke halaman pemasukan dengan asset_id yang sama
  res.redirect(`/pemasukan?asset=${assetId}`);
});
app.post('/pemasukan/delete/:id', (req, res) => {
  const id = req.params.id;
  const assetId = res.locals.currentAsset; // ambil current asset

  runQuery(`DELETE FROM pemasukan WHERE id=?`, [id]);
  
  // Redirect ke halaman pemasukan tetap di asset yang sama
  res.redirect(`/pemasukan?asset=${assetId}`);
});
// Export JSON
app.get('/export', (req, res) => {
  const assetId = res.locals.currentAsset;
  const pengeluaran = queryAll(`SELECT * FROM pengeluaran WHERE asset_id=?`, [assetId]);
  const kebutuhan = queryAll(`SELECT * FROM kebutuhan WHERE asset_id=?`, [assetId]);
  const ayam = queryAll(`SELECT * FROM ayam WHERE asset_id=?`, [assetId]);
  const pemasukan = queryAll(`SELECT * FROM pemasukan WHERE asset_id=?`, [assetId]);

  const allData = { pengeluaran, kebutuhan, ayam, pemasukan };
  const fileName = `data_export_asset_${assetId}_${new Date().toISOString().split('T')[0]}.json`;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(JSON.stringify(allData, null, 2));
});

// 404
app.use((req, res) => {
  res.status(404).render('404', { layout: false });
});

app.listen(3000, () => console.log('✅ Server jalan di http://localhost:3000'));
