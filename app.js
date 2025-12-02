const express = require('express');
const bodyParser = require('body-parser');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const upload = multer({ dest: path.join(__dirname, 'tmp_uploads') });

// pastikan folder tmp_uploads ada (buat jika belum)
const tmpDir = path.join(__dirname, 'tmp_uploads');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

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
//Backup
// --- Backup page (tampilkan form import/export dan status) ---
// Backup page (tampilkan form import/export dan stats)
app.get('/backup', (req, res) => {
  const assetId = res.locals.currentAsset;

  try {
    // hitung jumlah record per tabel untuk asset saat ini
    const totalPengeluaranRow = querySingle(`SELECT COUNT(*) as c, SUM(harga) as s FROM pengeluaran WHERE asset_id=?`, [assetId]);
    const totalKebutuhanRow  = querySingle(`SELECT COUNT(*) as c FROM kebutuhan WHERE asset_id=?`, [assetId]);
    const totalAyamRow       = querySingle(`SELECT COUNT(*) as c, SUM(jumlah) as tot_jumlah FROM ayam WHERE asset_id=?`, [assetId]);
    const totalPemasukanRow  = querySingle(`SELECT COUNT(*) as c, SUM(total) as s FROM pemasukan WHERE asset_id=?`, [assetId]);

    // jumlah semua records (opsional)
    const totalRecordsRow = querySingle(`
      SELECT 
        (SELECT COUNT(*) FROM pengeluaran WHERE asset_id=?) +
        (SELECT COUNT(*) FROM kebutuhan WHERE asset_id=?) +
        (SELECT COUNT(*) FROM ayam WHERE asset_id=?) +
        (SELECT COUNT(*) FROM pemasukan WHERE asset_id=?) as total
    `, [assetId, assetId, assetId, assetId]);

    const stats = {
      totalPengeluaran: totalPengeluaranRow.c || 0,
      sumPengeluaran: totalPengeluaranRow.s || 0,
      totalKebutuhan: totalKebutuhanRow.c || 0,
      totalAyam: totalAyamRow.c || 0,
      totalAyamJumlah: totalAyamRow.tot_jumlah || 0,
      totalPemasukan: totalPemasukanRow.c || 0,
      sumPemasukan: totalPemasukanRow.s || 0,
      totalRecords: totalRecordsRow.total || 0
    };

    // render view dan kirim stats
    res.render('backup', {
      stats,
      currentAsset: assetId,
      success: req.query.success,
      error: req.query.error,
      title: 'Backup & Restore'
    });
  } catch (err) {
    console.error('Error fetching backup stats', err);
    // fallback: kirim stats default agar template tidak crash
    res.render('backup', {
      stats: {
        totalPengeluaran: 0,
        sumPengeluaran: 0,
        totalKebutuhan: 0,
        totalAyam: 0,
        totalAyamJumlah: 0,
        totalPemasukan: 0,
        sumPemasukan: 0,
        totalRecords: 0
      },
      currentAsset: assetId,
      success: req.query.success,
      error: 'stat_fetch_failed',
      title: 'Backup & Restore'
    });
  }
});


// Download raw database file (.db)
app.get('/export/db', (req, res) => {
  const dbPath = path.join(__dirname, 'database.db');
  if (!fs.existsSync(dbPath)) {
    return res.status(404).send('Database file not found.');
  }
  res.download(dbPath, `database_backup_${new Date().toISOString().split('T')[0]}.db`);
});
// Import full JSON (file upload). Query param: mode=merge|replace
app.post('/import/full', upload.single('backupFile'), (req, res) => {
  try {
    if (!req.file) return res.redirect(`/backup?error=no_file&asset=${res.locals.currentAsset}`);

    const mode = (req.query.mode || 'merge').toLowerCase(); // merge or replace
    const filePath = req.file.path;
    const raw = fs.readFileSync(filePath, 'utf8');
    fs.unlinkSync(filePath); // cleanup

    const data = JSON.parse(raw);

    // expected structure: { export_date, assets: [ { asset: {id,name}, data: { pengeluaran:[], kebutuhan:[], ayam:[], pemasukan:[] } } ] }
    if (!data.assets || !Array.isArray(data.assets)) {
      return res.redirect(`/backup?error=invalid_format&asset=${res.locals.currentAsset}`);
    }

    data.assets.forEach(aobj => {
      const assetInfo = aobj.asset || {};
      // ensure asset exists or create
      let assetId = assetInfo.id;
      if (!assetId) {
        // create new asset
        runQuery(`INSERT INTO assets(name) VALUES(?)`, [assetInfo.name || `Asset ${Date.now()}`]);
        const row = querySingle(`SELECT id FROM assets ORDER BY id DESC LIMIT 1`);
        assetId = row.id;
      } else {
        const exist = querySingle(`SELECT * FROM assets WHERE id=?`, [assetId]);
        if (!exist.id) {
          runQuery(`INSERT INTO assets(id,name) VALUES(?,?)`, [assetId, assetInfo.name || `Asset ${assetId}`]);
        }
      }

      if (mode === 'replace') {
        runQuery(`DELETE FROM pengeluaran WHERE asset_id=?`, [assetId]);
        runQuery(`DELETE FROM kebutuhan WHERE asset_id=?`, [assetId]);
        runQuery(`DELETE FROM ayam WHERE asset_id=?`, [assetId]);
        runQuery(`DELETE FROM pemasukan WHERE asset_id=?`, [assetId]);
      }

      const d = aobj.data || {};

      if (d.kebutuhan && Array.isArray(d.kebutuhan)) {
        d.kebutuhan.forEach(item => {
          runQuery(`INSERT INTO kebutuhan(nama,harga,asset_id) VALUES(?,?,?)`,
            [item.nama, item.harga || 0, assetId]);
        });
      }

      if (d.pengeluaran && Array.isArray(d.pengeluaran)) {
        d.pengeluaran.forEach(item => {
          runQuery(`INSERT INTO pengeluaran(nama,jumlah,harga,tanggal,asset_id) VALUES(?,?,?,?,?)`,
            [item.nama, item.jumlah || 0, item.harga || 0, item.tanggal || new Date().toISOString().split('T')[0], assetId]);
        });
      }

      if (d.ayam && Array.isArray(d.ayam)) {
        d.ayam.forEach(item => {
          runQuery(`INSERT INTO ayam(jumlah,harga,tanggal,asset_id) VALUES(?,?,?,?)`,
            [item.jumlah || 0, item.harga || 0, item.tanggal || new Date().toISOString().split('T')[0], assetId]);
        });
      }

      if (d.pemasukan && Array.isArray(d.pemasukan)) {
        d.pemasukan.forEach(item => {
          runQuery(`INSERT INTO pemasukan(jumlah,harga,total,tanggal,asset_id) VALUES(?,?,?,?,?)`,
            [item.jumlah || 0, item.harga || 0, item.total || 0, item.tanggal || new Date().toISOString().split('T')[0], assetId]);
        });
      }
    });

    res.redirect(`/backup?success=import`);
  } catch (err) {
    console.error(err);
    res.redirect(`/backup?error=import_failed`);
  }
});
// --- Hapus semua data untuk 1 asset (Danger Zone) ---
app.post('/backup/clear', (req, res) => {
  try {
    const assetId = parseInt(req.query.asset) || res.locals.currentAsset;
    const confirm = (req.body.confirm || '').trim();

    if (confirm !== 'HAPUS') {
      return res.redirect(`/backup?error=wrong_confirm&asset=${assetId}`);
    }

    // Hapus data dari tiap tabel untuk asset ini
    runQuery(`DELETE FROM pengeluaran WHERE asset_id=?`, [assetId]);
    runQuery(`DELETE FROM kebutuhan WHERE asset_id=?`, [assetId]);
    runQuery(`DELETE FROM ayam WHERE asset_id=?`, [assetId]);
    runQuery(`DELETE FROM pemasukan WHERE asset_id=?`, [assetId]);

    // redirect kembali dengan pesan sukses
    res.redirect(`/backup?success=clear&asset=${assetId}`);
  } catch (err) {
    console.error('Error clearing asset data', err);
    res.redirect(`/backup?error=import_failed&asset=${res.locals.currentAsset}`);
  }
});

// --- Hapus asset (hapus data + record asset) ---
app.post('/assets/delete/:id', (req, res) => {
  try {
    const aid = parseInt(req.params.id);
    if (!aid) return res.redirect('/assets');

    // Hapus semua data terkait asset terlebih dahulu
    runQuery(`DELETE FROM pengeluaran WHERE asset_id=?`, [aid]);
    runQuery(`DELETE FROM kebutuhan WHERE asset_id=?`, [aid]);
    runQuery(`DELETE FROM ayam WHERE asset_id=?`, [aid]);
    runQuery(`DELETE FROM pemasukan WHERE asset_id=?`, [aid]);

    // Hapus entry asset
    runQuery(`DELETE FROM assets WHERE id=?`, [aid]);

    res.redirect('/assets?success=deleted');
  } catch (err) {
    console.error('Error deleting asset', err);
    res.redirect('/assets?error=delete_failed');
  }
});

// Import raw database (.db) — will replace current database file
app.post('/import/db', upload.single('dbFile'), (req, res) => {
  try {
    if (!req.file) return res.redirect(`/backup?error=no_file&asset=${res.locals.currentAsset}`);

    const uploaded = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext !== '.db') {
      fs.unlinkSync(uploaded);
      return res.redirect(`/backup?error=invalid_format&asset=${res.locals.currentAsset}`);
    }

    const dbPath = path.join(__dirname, 'database.db');
    const backupPath = path.join(__dirname, `database_backup_before_restore_${Date.now()}.db`);
    if (fs.existsSync(dbPath)) fs.renameSync(dbPath, backupPath);
    fs.renameSync(uploaded, dbPath);

    // reload database into memory
    const SQL = initSqlJs ? initSqlJs : null;
    // we won't re-init here — suggest server restart to ensure clean load
    res.redirect(`/backup?success=import_db`);
  } catch (err) {
    console.error(err);
    res.redirect(`/backup?error=import_failed&asset=${res.locals.currentAsset}`);
  }
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
// Export JSON (single asset or all)
app.get('/export/json', (req, res) => {
  // contoh parsing assetParam (modifikasi /export/json jika diperlukan)
const assetParam = req.query.asset || 'all';
let assetsToExport = [];

if (assetParam === 'all') {
  assetsToExport = queryAll(`SELECT * FROM assets`);
} else {
  // support "1,2,3" or single id
  const ids = String(assetParam).split(',').map(x => parseInt(x)).filter(Boolean);
  if (ids.length === 0) {
    const id = parseInt(assetParam) || res.locals.currentAsset;
    ids.push(id);
  }
  assetsToExport = queryAll(`SELECT * FROM assets WHERE id IN (${ids.map(()=>'?').join(',')})`, ids);
}


  const exportData = {
    export_date: new Date().toISOString(),
    assets: []
  };

  assetsToExport.forEach(asset => {
  const aid = asset.id;
  const pengeluaran = queryAll(`SELECT * FROM pengeluaran WHERE asset_id=?`, [aid]);
  const kebutuhan = queryAll(`SELECT * FROM kebutuhan WHERE asset_id=?`, [aid]);
  const ayam = queryAll(`SELECT * FROM ayam WHERE asset_id=?`, [aid]);
  const pemasukan = queryAll(`SELECT * FROM pemasukan WHERE asset_id=?`, [aid]);

  exportData.assets.push({
    asset, // sekarang asset sudah ada (adalah parameter forEach)
    data: { pengeluaran, kebutuhan, ayam, pemasukan }
  });
});


  const fileName = `backup_${assetParam}_${new Date().toISOString().split('T')[0]}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(JSON.stringify(exportData, null, 2));
});


// 404
app.use((req, res) => {
  res.status(404).render('404', { layout: false });
});

app.listen(3000, () => console.log('✅ Server jalan di http://localhost:3000'));
