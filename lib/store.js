'use strict';
const fs = require('fs');
const path = require('path');
const { validateConfig } = require('./core');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'config.json');
const SEED = path.join(__dirname, '..', 'data', 'seed.json');
const VERSION = 3;

let current;
let rev = 1;
let writable = true;

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function loadSeed() {
  const { errors, config } = validateConfig(readJson(SEED));
  if (errors.length) throw new Error('seed.json invalid: ' + errors.join('; '));
  return config;
}

function backup(reason) {
  try {
    const dest = path.join(DATA_DIR, `config.bak-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.copyFileSync(FILE, dest);
    console.error(`config.json ${reason}; copy kept at ${dest}`);
  } catch (e) { /* nothing to back up */ }
}

function init() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.accessSync(DATA_DIR, fs.constants.W_OK); } catch (e) {
    writable = false;
    console.error(`WARNING: ${DATA_DIR} is not writable (${e.message}). Changes will be lost on restart. On Railway, attach a Volume and set DATA_DIR to its mount path.`);
  }
  if (fs.existsSync(FILE)) {
    try {
      const raw = readJson(FILE);
      if (raw.version !== VERSION) backup('is from an older version and was replaced with the new defaults');
      else {
        const { errors, config } = validateConfig(raw);
        if (!errors.length) { current = config; return; }
        backup('failed validation (' + errors[0] + ') and was replaced with the defaults');
      }
    } catch (err) { backup('was unreadable (' + err.message + ')'); }
  }
  current = loadSeed();
  try { persist(current); } catch (e) { writable = false; console.error('Could not write config:', e.message); }
}

function persist(cfg) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg));
  fs.renameSync(tmp, FILE);
}

const get = () => current;
const getRev = () => rev;
const isPersistent = () => writable;

function set(cfg) {
  persist(cfg); // throws if the disk is not writable, so the admin sees the failure
  current = cfg;
  rev++;
}

function reset() { set(loadSeed()); }

module.exports = { init, get, getRev, set, reset, isPersistent, DATA_DIR };
