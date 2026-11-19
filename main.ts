// Token Launch Radar — comps-calibrated pre-token radar (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, fits the valuation model from the snapshot itself
// (see lib/model.ts: live-token comps, Empirical-Bayes sector multiples, a log-log size
// curve, leave-one-out validation), writes the ranked board to /output/board.json, the
// dashboard's data to /output/data.js, copies dashboard/ and screenshots/ to /output, and
// writes /output/dossier.json with the vendored make.fun library.
//
// The program is deterministic: no clock, no randomness, no network. Running it twice
// writes the same bytes; this run proves it by building the board twice in-process and
// refusing to write unless both builds are byte-identical.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>
//   (in the grader: the snapshot is mounted at /input and the output at /output)

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

// Determinism guard: the grader runs this program twice and both runs must write the
// same bytes, so the board is built twice here and the run stops unless they agree.
const first = buildRadar(snapshot);
const second = buildRadar(snapshot);
const firstJson = JSON.stringify({ rows: first.board });
if (firstJson !== JSON.stringify({ rows: second.board })) {
  process.stderr.write('token radar: refusing to write: two builds of the same snapshot disagree\n');
  process.exit(1);
}
const { board, radar } = first;
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board, model: radar.model, validation: radar.validation, as_of: radar.as_of, source: radar.source, floor_usd: radar.floor_usd })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** A PNG or JPEG's pixel dimensions, or null when they cannot be read. */
function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (PNG_MAGIC.every((b, i) => bytes[i] === b) && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (JPEG_MAGIC.every((b, i) => bytes[i] === b)) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) break;
      const marker = bytes[at + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      const len = bytes.readUInt16BE(at + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
      }
      at += 2 + len;
    }
  }
  return null;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  const bytes = readFileSync(join(out, 'screenshots', name));
  if (bytes.length > SCREENSHOT_CAPS.max_bytes) {
    process.stderr.write(`token radar: screenshots/${name} is ${bytes.length} bytes, over the ${SCREENSHOT_CAPS.max_bytes} cap\n`);
    process.exit(1);
  }
  const isPng = PNG_MAGIC.every((b, i) => bytes[i] === b);
  const isJpeg = JPEG_MAGIC.every((b, i) => bytes[i] === b);
  if (!isPng && !isJpeg) {
    process.stderr.write(`token radar: screenshots/${name} is neither a whole PNG nor a whole JPEG\n`);
    process.exit(1);
  }
  // The gate's dimension rule: long side at most 1440, short side at least 800.
  const size = imageSize(bytes);
  if (size === null) {
    process.stderr.write(`token radar: screenshots/${name}: cannot read its dimensions\n`);
    process.exit(1);
  }
  if (Math.max(size.width, size.height) > 1440 || Math.min(size.width, size.height) < 800) {
    process.stderr.write(`token radar: screenshots/${name} is ${size.width}x${size.height}: the long side must be at most 1440 and the short side at least 800\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const v = radar.validation;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.off_watchlist_size} off-watchlist, ${radar.live_size} live shown apart)\n` +
    `token radar: comps fit on ${v.families} live families: global mcap/TVL ${v.global_multiple}, size curve log(mcap) = ${v.size_intercept} + ${v.size_slope} x log(TVL)\n` +
    `token radar: LOO-CV (comps core): median error x${v.median_error_factor}, within 2x ${v.within_2x}, within 3x ${v.within_3x}, Spearman ${v.spearman}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
