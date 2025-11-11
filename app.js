const express = require('express');
const bodyParser = require('body-parser');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.db');

const app = express();

// Middleware untuk sidebar aktif
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// --- Buat tabel kalau belum ada ---
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS kebutuhan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    harga INTEGER NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pengeluaran (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    jumlah INTEGER NOT NULL,
    harga INTEGER NOT NULL,
    tanggal TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ayam (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jumlah INTEGER NOT NULL,
    harga INTEGER NOT NULL,
    tanggal TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pemasukan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jumlah INTEGER NOT NULL,
    harga INTEGER NOT NULL,
    total INTEGER NOT NULL,
    tanggal TEXT NOT NULL
  )`);
});

// --- Layout & Middleware ---
app.use(expressLayouts);
app.set('layout', 'layouts/index');
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Helper Asinkron ---
function querySingle(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function queryAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// --- Routes ---
app.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 3;
    const offset = (page - 1) * perPage;

    const pengeluaran = await queryAll(
      `SELECT * FROM pengeluaran ORDER BY id DESC LIMIT ? OFFSET ?`,
      [perPage, offset]
    );

    const totalRow = await querySingle(`SELECT COUNT(*) as total FROM pengeluaran`);
    const totalPages = Math.ceil(totalRow.total / perPage);

    const totalMingguRow = await querySingle(`
      SELECT SUM(harga) as total FROM pengeluaran
      WHERE tanggal >= date('now', '-7 days')
    `);
    const totalBulanRow = await querySingle(`
      SELECT SUM(harga) as total FROM pengeluaran
      WHERE strftime('%Y-%m', tanggal) = strftime('%Y-%m', 'now')
    `);
    const totalAllRow = await querySingle(`SELECT SUM(harga) as total FROM pengeluaran`);

    const pemasukanRow = await querySingle(`SELECT SUM(total) as total FROM pemasukan`);
    const ayamRow = await querySingle(`SELECT SUM(jumlah) as total FROM ayam`);

    const totalMinggu = totalMingguRow.total || 0;
    const totalBulan = totalBulanRow.total || 0;
    const totalAll = totalAllRow.total || 0;
    const pemasukanTotal = pemasukanRow.total || 0;
    const ayamTotal = ayamRow.total || 0;
    const keuanganTotal = pemasukanTotal - totalAll;

    const chartRows = await queryAll(`
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
app.get('/kebutuhan', async (req, res) => {
  const kebutuhan = await queryAll(`SELECT * FROM kebutuhan`);
  res.render('kebutuhan', { kebutuhan, title: 'Daftar Kebutuhan' });
});

app.post('/kebutuhan', async (req, res) => {
  const { nama, harga } = req.body;
  await runQuery(`INSERT INTO kebutuhan(nama,harga) VALUES(?,?)`, [nama, parseInt(harga)]);
  res.redirect('/kebutuhan');
});

// --- Pengeluaran ---
app.get('/add', async (req, res) => {
  const kebutuhan = await queryAll(`SELECT * FROM kebutuhan`);
  res.render('add', { kebutuhan, title: 'Tambah Pengeluaran' });
});

app.post('/add', async (req, res) => {
  const { nama, jumlah } = req.body;
  const pakan = await querySingle(`SELECT * FROM kebutuhan WHERE nama=?`, [nama]);
  if (!pakan) return res.send('Kebutuhan tidak ditemukan');

  const tgl = new Date().toISOString().split('T')[0];
  await runQuery(
    `INSERT INTO pengeluaran(nama,jumlah,harga,tanggal) VALUES(?,?,?,?)`,
    [nama, parseInt(jumlah), parseInt(jumlah) * pakan.harga, tgl]
  );
  res.redirect('/add');
});

// --- Ayam ---
app.get('/ayam', async (req, res) => {
  const ayam = await queryAll(`SELECT * FROM ayam ORDER BY id DESC`);
  const pengeluaranRow = await querySingle(`SELECT SUM(harga) as total FROM pengeluaran`);
  const pemasukanRow = await querySingle(`SELECT SUM(total) as total FROM pemasukan`);
  const totalKeuangan = (pemasukanRow.total || 0) - (pengeluaranRow.total || 0);

  res.render('ayam', {
    ayam,
    totalPengeluaran: pengeluaranRow.total || 0,
    totalPemasukan: pemasukanRow.total || 0,
    totalKeuangan,
    title: 'Daftar Ayam'
  });
});

app.post('/ayam', async (req, res) => {
  const { jumlah, harga } = req.body;
  const tgl = new Date().toISOString().split('T')[0];
  await runQuery(
    `INSERT INTO ayam(jumlah,harga,tanggal) VALUES(?,?,?)`,
    [parseInt(jumlah), parseInt(harga), tgl]
  );
  await runQuery(
    `INSERT INTO pengeluaran(nama,jumlah,harga,tanggal) VALUES(?,?,?,?)`,
    ['Beli Anak Ayam', parseInt(jumlah), parseInt(harga), tgl]
  );
  res.redirect('/ayam');
});

// --- Pemasukan ---
app.get('/pemasukan', async (req, res) => {
  const pemasukan = await queryAll(`SELECT * FROM pemasukan ORDER BY id DESC`);
  res.render('pemasukan', { pemasukan, title: 'Penjualan Ayam' });
});

app.post('/pemasukan', async (req, res) => {
  const { jumlah, harga } = req.body;
  const tgl = new Date().toISOString().split('T')[0];
  const total = parseInt(jumlah) * parseInt(harga);

  await runQuery(
    `INSERT INTO pemasukan(jumlah,harga,total,tanggal) VALUES(?,?,?,?)`,
    [parseInt(jumlah), parseInt(harga), total, tgl]
  );
  await runQuery(
    `INSERT INTO ayam(jumlah,harga,tanggal) VALUES(?,?,?)`,
    [-parseInt(jumlah), parseInt(harga), tgl]
  );
  res.redirect('/pemasukan');
});

// --- Export JSON ---
app.get('/export', async (req, res) => {
  const pengeluaran = await queryAll(`SELECT * FROM pengeluaran`);
  const kebutuhan = await queryAll(`SELECT * FROM kebutuhan`);
  const ayam = await queryAll(`SELECT * FROM ayam`);
  const pemasukan = await queryAll(`SELECT * FROM pemasukan`);

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

// --- Jalankan server ---
app.listen(3000, () => console.log('✅ Server jalan di http://localhost:3000'));
