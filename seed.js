const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.db');
const db = new Database(dbPath);

// ======= FUNGSI BANTU =======
function safeInsert(stmt, values) {
  try {
    stmt.run(values);
  } catch (err) {
    console.warn('⚠️ Gagal insert data:', err.message);
  }
}

// ======= BUAT TABEL JIKA BELUM ADA =======
db.exec(`
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
  sumber TEXT NOT NULL,
  nominal INTEGER NOT NULL,
  tanggal TEXT NOT NULL
);
`);

console.log('✅ Tabel dicek/dibuat jika belum ada.');

// ======= BACA FILE JSON =======
const jsonPath = path.join(__dirname, 'data.json');
let data = { kebutuhan: [], pengeluaran: [], ayam: [], pemasukan: [] };

if (fs.existsSync(jsonPath)) {
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    console.error('❌ Gagal membaca data.json:', err);
  }
} else {
  console.warn('⚠️ File data.json tidak ditemukan, data kosong digunakan.');
}

// ======= CEK APAKAH TABEL SUDAH TERISI =======
const checkTable = (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;

// ======= MASUKKAN DATA JIKA BELUM ADA =======
if (checkTable('kebutuhan') === 0 && data.kebutuhan?.length) {
  const insert = db.prepare('INSERT INTO kebutuhan (nama, harga) VALUES (?, ?)');
  data.kebutuhan.forEach(k => safeInsert(insert, [k.nama, k.harga]));
}

if (checkTable('pengeluaran') === 0 && data.pengeluaran?.length) {
  const insert = db.prepare('INSERT INTO pengeluaran (nama, jumlah, harga, tanggal) VALUES (?, ?, ?, ?)');
  data.pengeluaran.forEach(p => safeInsert(insert, [p.nama, p.jumlah, p.harga, p.tanggal]));
}

if (checkTable('ayam') === 0 && data.ayam?.length) {
  const insert = db.prepare('INSERT INTO ayam (jumlah, harga, tanggal) VALUES (?, ?, ?)');
  data.ayam.forEach(a => safeInsert(insert, [a.jumlah, a.harga, a.tanggal]));
}

if (checkTable('pemasukan') === 0 && data.pemasukan?.length) {
  const insert = db.prepare('INSERT INTO pemasukan (sumber, nominal, tanggal) VALUES (?, ?, ?)');
  data.pemasukan.forEach(m => safeInsert(insert, [m.sumber, m.nominal, m.tanggal]));
}

console.log('✅ Data dari JSON berhasil dimasukkan ke SQLite!');
