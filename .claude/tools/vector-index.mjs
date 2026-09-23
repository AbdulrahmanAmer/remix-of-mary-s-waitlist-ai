#!/usr/bin/env node
/**
 * vector-index.mjs - local semantic search over this repo (code, docs, Lovable plans, diagram).
 * Zero cloud cost: all-MiniLM-L6-v2 via transformers.js (ONNX, CPU), same embedder as the
 * machine's cortex-index. The index is derived and gitignored: .claude/index/vectors.json.
 * Incremental: only chunks whose text changed are re-embedded.
 *
 *   node .claude/tools/vector-index.mjs index            # (re)build
 *   node .claude/tools/vector-index.mjs find "<query>"   # top matches, path:line + preview
 *   node .claude/tools/vector-index.mjs stats
 *
 * Env: VECTOR_K (default 8), TRANSFORMERS_DIR (a node_modules dir holding
 * @huggingface/transformers), VECTOR_MODEL_CACHE (model cache dir).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = path.join(ROOT, ".claude", "index");
const SIDECAR = path.join(OUT_DIR, "vectors.json");
const K = Number(process.env.VECTOR_K || 8);
const CHUNK = 60; // lines per chunk
const OVERLAP = 12;

// What gets indexed. Generated files and shadcn primitives are skipped: they drown real matches.
const INCLUDE_DIRS = ["src", "docs", ".lovable/plan"];
const INCLUDE_ROOT_FILES = ["README.md", "roadmap.md", "AGENTS.md", "CLAUDE.md", "PROJECT-STATE.md", ".claude/POSITION.md"];
const EXT = new Set([".ts", ".tsx", ".css", ".md", ".txt", ".gs", ".json", ".mmd"]);
const SKIP = [/routeTree\.gen\.ts$/, /[\\/]components[\\/]ui[\\/]/, /\.asset\.json$/];

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name)) && !SKIP.some((re) => re.test(p))) out.push(p);
  }
}

function collectFiles() {
  const files = [];
  for (const d of INCLUDE_DIRS) walk(path.join(ROOT, d), files);
  for (const f of INCLUDE_ROOT_FILES) if (fs.existsSync(path.join(ROOT, f))) files.push(path.join(ROOT, f));
  return files.map((f) => path.relative(ROOT, f).split(path.sep).join("/"));
}

function chunkFile(rel) {
  const lines = fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/);
  const chunks = [];
  for (let start = 0; start < lines.length; start += CHUNK - OVERLAP) {
    const end = Math.min(lines.length, start + CHUNK);
    const body = lines.slice(start, end).join("\n").trim();
    if (body) chunks.push({ id: `${rel}:${start + 1}`, path: rel, start: start + 1, end, text: `${rel}\n${body}` });
    if (end >= lines.length) break;
  }
  return chunks;
}

const hashOf = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

async function embedder() {
  const bases = [process.env.TRANSFORMERS_DIR, path.join(ROOT, "node_modules"), path.join(os.homedir(), ".claude", "node_modules")].filter(Boolean);
  let mod;
  for (const b of bases) {
    try {
      const resolved = createRequire(path.join(b, "noop.js")).resolve("@huggingface/transformers");
      mod = await import(pathToFileURL(resolved).href);
      break;
    } catch { /* try next */ }
  }
  if (!mod) throw new Error("@huggingface/transformers not found. Install it (npm i -g or in ~/.claude) or set TRANSFORMERS_DIR.");
  const { pipeline, env } = mod;
  env.cacheDir = process.env.VECTOR_MODEL_CACHE || path.join(os.homedir(), ".claude", "cortex", ".models");
  const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
  return async (text) => Array.from((await pipe(text, { pooling: "mean", normalize: true })).data);
}

function loadSidecar() {
  try { return JSON.parse(fs.readFileSync(SIDECAR, "utf8")); } catch { return { model: "all-MiniLM-L6-v2", chunks: {} }; }
}

const cmd = process.argv[2];
if (cmd === "index") {
  const side = loadSidecar();
  const all = collectFiles().flatMap(chunkFile);
  const live = new Set(all.map((c) => c.id));
  for (const id of Object.keys(side.chunks)) if (!live.has(id)) delete side.chunks[id];
  const todo = all.filter((c) => side.chunks[c.id]?.h !== hashOf(c.text));
  if (todo.length) {
    const embed = await embedder();
    for (const c of todo) {
      side.chunks[c.id] = { h: hashOf(c.text), path: c.path, start: c.start, end: c.end, v: (await embed(c.text)).map((x) => +x.toFixed(5)) };
    }
  }
  side.builtAt = new Date().toISOString();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(SIDECAR, JSON.stringify(side));
  console.log(JSON.stringify({ files: new Set(all.map((c) => c.path)).size, chunks: all.length, embedded: todo.length, sidecarKB: Math.round(fs.statSync(SIDECAR).size / 1024) }));
} else if (cmd === "find") {
  const query = process.argv.slice(3).join(" ").trim();
  if (!query) { console.error('usage: vector-index.mjs find "<query>"'); process.exit(1); }
  const side = loadSidecar();
  const ids = Object.keys(side.chunks);
  if (!ids.length) { console.error("index empty - run: node .claude/tools/vector-index.mjs index"); process.exit(1); }
  const q = await (await embedder())(query);
  const hits = ids.map((id) => {
    const v = side.chunks[id].v;
    let dot = 0; for (let i = 0; i < q.length; i++) dot += q[i] * v[i];
    return { id, score: dot };
  }).sort((a, b) => b.score - a.score).slice(0, K);
  for (const { id, score } of hits) {
    const c = side.chunks[id];
    let preview = "";
    try {
      preview = fs.readFileSync(path.join(ROOT, c.path), "utf8").split(/\r?\n/).slice(c.start - 1, c.end)
        .map((l) => l.trim()).filter(Boolean).slice(0, 2).join(" | ").slice(0, 140);
    } catch { preview = "(file moved - re-index)"; }
    console.log(`${score.toFixed(3)}  ${c.path}:${c.start}-${c.end}  ${preview}`);
  }
} else if (cmd === "stats") {
  const side = loadSidecar();
  console.log(JSON.stringify({ chunks: Object.keys(side.chunks).length, builtAt: side.builtAt || null }));
} else {
  console.error('usage: vector-index.mjs index | find "<query>" | stats');
  process.exit(1);
}
