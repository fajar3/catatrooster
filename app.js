const express = require('express');
const bodyParser = require('body-parser');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const app = express();
let db;

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

  // Buat tabel kalau belum ada
  db.run(`
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

  console.log('✅ Database siap!');
})();

// Middleware untuk sidebar aktif
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// Layout & Middleware
app.use(expressLayouts);
app.set('layout', 'layouts/index');
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

// --- Routes ---
app.get('/', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 3;
    const offset = (page - 1) * perPage;

    const pengeluaran = queryAll(
      `SELECT * FROM pengeluaran ORDER BY id DESC LIMIT ? OFFSET ?`,
      [perPage, offset]
    );

    const totalRow = querySingle(`SELECT COUNT(*) as total FROM pengeluaran`);
    const totalPages = Math.ceil((totalRow.total || 0) / perPage);

    const totalMingguRow = querySingle(`
      SELECT SUM(harga) as total FROM pengeluaran
      WHERE tanggal >= date('now', '-7 days')
    `);
    const totalBulanRow = querySingle(`
      SELECT SUM(harga) as total FROM pengeluaran
      WHERE strftime('%Y-%m', tanggal) = strftime('%Y-%m', 'now')
    `);
    const totalAllRow = querySingle(`SELECT SUM(harga) as total FROM pengeluaran`);

    const pemasukanRow = querySingle(`SELECT SUM(total) as total FROM pemasukan`);
    const ayamRow = querySingle(`SELECT SUM(jumlah) as total FROM ayam`);

    const totalMinggu = totalMingguRow.total || 0;
    const totalBulan = totalBulanRow.total || 0;
    const totalAll = totalAllRow.total || 0;
    const pemasukanTotal = pemasukanRow.total || 0;
    const ayamTotal = ayamRow.total || 0;
    const keuanganTotal = pemasukanTotal - totalAll;

    const chartRows = queryAll(`
      SELECT nama, SUM(harga) as total FROM pengeluaran GROUP BY nama
    `);
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
      title: 'Dashboard Pakan Ayam'
    });
  } catch (err) {
    res.status(500).send('Error: ' + err.message);
  }
});

// --- Kebutuhan ---
app.get('/kebutuhan', (req, res) => {
  const kebutuhan = queryAll(`SELECT * FROM kebutuhan`);
  res.render('kebutuhan', { kebutuhan, title: 'Daftar Kebutuhan' });
});

app.post('/kebutuhan', (req, res) => {
  const { nama, harga } = req.body;
  runQuery(`INSERT INTO kebutuhan(nama,harga) VALUES(?,?)`, [nama, parseInt(harga)]);
  res.redirect('/kebutuhan');
});

// --- Pengeluaran ---
app.get('/add', (req, res) => {
  const kebutuhan = queryAll(`SELECT * FROM kebutuhan`);
  res.render('add', { kebutuhan, title: 'Tambah Pengeluaran' });
});

app.post('/add', (req, res) => {
  const { nama, jumlah } = req.body;
  const pakan = querySingle(`SELECT * FROM kebutuhan WHERE nama=?`, [nama]);
  if (!pakan.nama) return res.send('Kebutuhan tidak ditemukan');

  const tgl = new Date().toISOString().split('T')[0];
  runQuery(
    `INSERT INTO pengeluaran(nama,jumlah,harga,tanggal) VALUES(?,?,?,?)`,
    [nama, parseInt(jumlah), parseInt(jumlah) * pakan.harga, tgl]
  );
  res.redirect('/add');
});

// --- Ayam ---
app.get('/ayam', (req, res) => {
  const ayam = queryAll(`SELECT * FROM ayam ORDER BY id DESC`);
  const pengeluaranRow = querySingle(`SELECT SUM(harga) as total FROM pengeluaran`);
  const pemasukanRow = querySingle(`SELECT SUM(total) as total FROM pemasukan`);
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
  const tgl = new Date().toISOString().split('T')[0];
  runQuery(
    `INSERT INTO ayam(jumlah,harga,tanggal) VALUES(?,?,?)`,
    [parseInt(jumlah), parseInt(harga), tgl]
  );
  runQuery(
    `INSERT INTO pengeluaran(nama,jumlah,harga,tanggal) VALUES(?,?,?,?)`,
    ['Beli Anak Ayam', parseInt(jumlah), parseInt(harga), tgl]
  );
  res.redirect('/ayam');
});

// --- Pemasukan ---
app.get('/pemasukan', (req, res) => {
  const pemasukan = queryAll(`SELECT * FROM pemasukan ORDER BY id DESC`);
  res.render('pemasukan', { pemasukan, title: 'Penjualan Ayam' });
});

app.post('/pemasukan', (req, res) => {
  const { jumlah, harga } = req.body;
  const tgl = new Date().toISOString().split('T')[0];
  const total = parseInt(jumlah) * parseInt(harga);

  runQuery(
    `INSERT INTO pemasukan(jumlah,harga,total,tanggal) VALUES(?,?,?,?)`,
    [parseInt(jumlah), parseInt(harga), total, tgl]
  );
  runQuery(
    `INSERT INTO ayam(jumlah,harga,tanggal) VALUES(?,?,?)`,
    [-parseInt(jumlah), parseInt(harga), tgl]
  );
  res.redirect('/pemasukan');
});

// --- Export JSON ---
app.get('/export', (req, res) => {
  const pengeluaran = queryAll(`SELECT * FROM pengeluaran`);
  const kebutuhan = queryAll(`SELECT * FROM kebutuhan`);
  const ayam = queryAll(`SELECT * FROM ayam`);
  const pemasukan = queryAll(`SELECT * FROM pemasukan`);

  const allData = { pengeluaran, kebutuhan, ayam, pemasukan };
  const fileName = `data_export_${new Date().toISOString().split('T')[0]}.json`;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(JSON.stringify(allData, null, 2));
});

// --- 404 ---
app.use((req, res) => {
  res.status(404).render('404', { layout: false });
});

// --- Server ---
app.listen(3000, () => console.log('✅ Server jalan di http://localhost:3000'));
