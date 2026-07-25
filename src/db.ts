import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

mkdirSync(config.dataDir, { recursive: true });

const db = new Database(resolve(config.dataDir, "birdsong.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS detections (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    species        TEXT NOT NULL,            -- common name, our canonical display key
    scientific     TEXT,
    confidence     REAL,
    detected_at    INTEGER NOT NULL,         -- unix ms
    source         TEXT                      -- 'mqtt' | 'webhook' | 'simulate'
  );
  CREATE INDEX IF NOT EXISTS idx_detections_time ON detections(detected_at);
  CREATE INDEX IF NOT EXISTS idx_detections_species_time ON detections(species, detected_at);

  CREATE TABLE IF NOT EXISTS art (
    species        TEXT PRIMARY KEY,         -- matches detections.species
    slug           TEXT NOT NULL,            -- filename stem under art/
    status         TEXT NOT NULL DEFAULT 'pending', -- pending | ready | failed
    updated_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key            TEXT PRIMARY KEY,
    value          TEXT NOT NULL
  );
`);

export default db;
