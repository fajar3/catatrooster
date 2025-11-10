const express = require('express');
const bodyParser = require('body-parser');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const db = new Database(path.join(__dirname, 'database.db'));
app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    next();
});

// --- Buat tabel kalau belum ada ---
db.prepare(`CREATE TABLE IF NOT EXISTS kebutuhan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    harga INTEGER NOT NULL
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS pengeluaran (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    jumlah INTEGER NOT NULL,
    harga INTEGER NOT NULL,
    tanggal TEXT NOT NULL
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS ayam (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jumlah INTEGER NOT NULL,
    harga INTEGER NOT NULL,
    tanggal TEXT NOT NULL
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS pemasukan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jumlah INTEGER NOT NULL,
    harga INTEGER NOT NULL,
    total INTEGER NOT NULL,
    tanggal TEXT NOT NULL
)`).run();

// --- Layout & Middleware ---
app.use(expressLayouts);
app.set('layout', 'layouts/index');
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Helper ---
const totalPengeluaran = () => {
    const row = db.prepare('SELECT SUM(harga) as total FROM pengeluaran').get();
    return row.total || 0;
};

const totalPemasukan = () => {
    const row = db.prepare('SELECT SUM(total) as total FROM pemasukan').get();
    return row.total || 0;
};

const totalAyam = () => {
    const row = db.prepare('SELECT SUM(jumlah) as total FROM ayam').get();
    return row.total || 0;
};

const totalKeuangan = () => totalPengeluaran() - totalPemasukan();

// --- Routes ---
app.get('/', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const perPage = 3;
    const offset = (page - 1) * perPage;

    // Ambil data pengeluaran terbaru dulu
    const pengeluaran = db.prepare(`
        SELECT * FROM pengeluaran
        ORDER BY id DESC
        LIMIT ? OFFSET ?
    `).all(perPage, offset);

    // Hitung total halaman
    const totalRows = db.prepare('SELECT COUNT(*) as total FROM pengeluaran').get().total;
    const totalPages = Math.ceil(totalRows / perPage);

    // Hitung total mingguan, bulanan, semua
    const totalMingguRow = db.prepare(`
        SELECT SUM(harga) as total FROM pengeluaran
        WHERE tanggal >= date('now', '-7 days')
    `).get();
    const totalBulanRow = db.prepare(`
        SELECT SUM(harga) as total FROM pengeluaran
        WHERE strftime('%Y-%m', tanggal) = strftime('%Y-%m', 'now')
    `).get();
    const totalAllRow = db.prepare('SELECT SUM(harga) as total FROM pengeluaran').get();

    const totalMinggu = totalMingguRow.total || 0;
    const totalBulan = totalBulanRow.total || 0;
    const totalAll = totalAllRow.total || 0;
    const pemasukanTotal = totalPemasukan();
    const ayamTotal = totalAyam();
    const keuanganTotal = pemasukanTotal - totalAll;

    // Chart data
    const chartRows = db.prepare(`
        SELECT nama, SUM(harga) as total FROM pengeluaran GROUP BY nama
    `).all();
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
});

// Halaman daftar kebutuhan
app.get('/kebutuhan', (req, res) => {
    const kebutuhan = db.prepare('SELECT * FROM kebutuhan').all();
    res.render('kebutuhan', { kebutuhan, title: 'Daftar Kebutuhan' });
});

app.post('/kebutuhan', (req, res) => {
    const { nama, harga } = req.body;
    db.prepare('INSERT INTO kebutuhan(nama,harga) VALUES(?,?)').run(nama, parseInt(harga));
    res.redirect('/kebutuhan');
});

// Tambah pengeluaran
app.get('/add', (req, res) => {
    const kebutuhan = db.prepare('SELECT * FROM kebutuhan').all();
    res.render('add', { kebutuhan, title: 'Tambah Pengeluaran' });
});

app.post('/add', (req, res) => {
    const { nama, jumlah } = req.body;
    const pakan = db.prepare('SELECT * FROM kebutuhan WHERE nama=?').get(nama);
    if (!pakan) return res.send('Kebutuhan tidak ditemukan');

    const tgl = new Date().toISOString().split('T')[0];
    db.prepare('INSERT INTO pengeluaran(nama,jumlah,harga,tanggal) VALUES(?,?,?,?)')
        .run(nama, parseInt(jumlah), parseInt(jumlah) * pakan.harga, tgl);
    res.redirect('/add');
});

// Halaman aset ayam
app.get('/ayam', (req, res) => {
    const ayam = db.prepare('SELECT * FROM ayam ORDER BY id DESC').all();
    res.render('ayam', {
        ayam,
        totalPengeluaran: totalPengeluaran(),
        totalPemasukan: totalPemasukan(),
        totalKeuangan: totalKeuangan(),
        title: 'Daftar Ayam'
    });
});

app.post('/ayam', (req, res) => {
    const { jumlah, harga } = req.body;
    const tgl = new Date().toISOString().split('T')[0];

    db.prepare('INSERT INTO ayam(jumlah,harga,tanggal) VALUES(?,?,?)').run(parseInt(jumlah), parseInt(harga), tgl);
    db.prepare('INSERT INTO pengeluaran(nama,jumlah,harga,tanggal) VALUES(?,?,?,?)').run('Beli Anak Ayam', parseInt(jumlah), parseInt(harga), tgl);

    res.redirect('/ayam');
});

// Halaman pemasukan (jual ayam)
app.get('/pemasukan', (req, res) => {
    const pemasukan = db.prepare('SELECT * FROM pemasukan ORDER BY id DESC').all();
    res.render('pemasukan', { pemasukan, title: 'Penjualan Ayam' });
});

app.post('/pemasukan', (req, res) => {
    const { jumlah, harga } = req.body;
    const tgl = new Date().toISOString().split('T')[0];
    const total = parseInt(jumlah) * parseInt(harga);

    // Catat pemasukan
    db.prepare('INSERT INTO pemasukan(jumlah,harga,total,tanggal) VALUES(?,?,?,?)')
        .run(parseInt(jumlah), parseInt(harga), total, tgl);

    // Kurangi jumlah ayam di tabel ayam
    db.prepare('INSERT INTO ayam(jumlah,harga,tanggal) VALUES(?,?,?)')
        .run(-parseInt(jumlah), parseInt(harga), tgl);

    res.redirect('/pemasukan');
});

// Export data JSON
app.get('/export', (req, res) => {
    const pengeluaran = db.prepare('SELECT * FROM pengeluaran').all();
    const kebutuhan = db.prepare('SELECT * FROM kebutuhan').all();
    const ayam = db.prepare('SELECT * FROM ayam').all();
    const pemasukan = db.prepare('SELECT * FROM pemasukan').all();

    const allData = { pengeluaran, kebutuhan, ayam, pemasukan };
    const fileName = `data_export_${new Date().toISOString().split('T')[0]}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(allData, null, 2));
});
app.use((req, res, next) => {
  res.status(404).render('404',{layout : false});
});
// Jalankan server
app.listen(3000, () => console.log('✅ Server jalan di http://localhost:3000'));
