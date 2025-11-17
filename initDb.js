const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname,'database.db'));

// Buat tabel kebutuhan (pakan)
db.prepare(`CREATE TABLE IF NOT EXISTS kebutuhan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    harga INTEGER NOT NULL
)`).run();

// Buat tabel pengeluaran
db.prepare(`CREATE TABLE IF NOT EXISTS pengeluaran (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    jumlah INTEGER NOT NULL,
    harga INTEGER NOT NULL,
    tanggal TEXT NOT NULL
)`).run();

// Buat tabel ayam (aset)
db.prepare(`CREATE TABLE IF NOT EXISTS ayam (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jumlah INTEGER NOT NULL,
    harga INTEGER NOT NULL,
    tanggal TEXT NOT NULL
)`).run();

// Buat tabel pemasukan
db.prepare(`
    CREATE TABLE IF NOT EXISTS pemasukan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jumlah INTEGER NOT NULL,
        harga INTEGER NOT NULL,
        total INTEGER NOT NULL,
        tanggal TEXT NOT NULL
    )
`).run();

console.log('Database dan tabel berhasil dibuat!');
