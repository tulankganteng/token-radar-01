// The token radar's model: one sealed snapshot in, one ranked board out.
//
// The valuation is fitted from the snapshot itself, never from a hardcoded multiple:
// the 128 live-token protocols in the snapshot are the market's own revealed price of a
// dollar of TVL. Three layers:
//
//   1. Families: live protocols are deduplicated into families first (a V2, an AMM, a
//      CLMM or a staked variant of one protocol is one token), so one token never counts
//      twice. On this snapshot the dedup finds 128 families for 128 live protocols.
//   2. Sector multiples: the median mcap/TVL of each category, in log space, shrunk
//      Empirical-Bayes style toward the global median (weight n/(n+K), K = 6), so a
//      category with one or two protocols is pulled hard to the prior instead of
//      trusting a single outlier.
//   3. Size curve: an OLS fit of log(mcap) on log(TVL) across families. The slope is
//      below 1 (0.52 here), so a bigger protocol earns a lower multiple per TVL dollar.
//
//   blended multiple = exp(0.35 x ln(sector) + 0.65 x ln(size))
//   momentum         = 1 + 0.5 x clamp(change_7d, -30, +60) / 100
//   timing           = 0.90 + 0.20 x min(age_days, 1095) / 1095 (1.00 when age unknown)
//   conviction       = 0.90 + 0.05 (7d change known) + 0.05 (age known)
//   implied value    = TVL x blended x momentum x timing x conviction
//
// The sector/size blend weight was chosen by leave-one-out cross-validation on the 128
// families, not by taste: the LOO grid (sector weight 0, 0.35, 0.5, 0.65, 1) is computed
// at runtime and shipped in the validation block, with the pure size curve and the flat
// global-median baselines beside it. The CV tests only the comps core (sector + size);
// momentum, timing and conviction condition the launch value and are not backtested
// against market caps, because no live token's market cap knows them.
//
// No protocol name is ever special-cased: the same functions score every row. A protocol
// is pre-token when its record carries no token at all (no market cap, no CoinGecko id,
// no symbol); the board ranks pre-token protocols only, and the live-token protocols are
// kept apart and shown with the market's own values, never mixed into the ranking.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's hyperparameters. The fitted numbers (global multiple, sector multiples,
 *  size curve) are computed from the snapshot at runtime, never written here. */
export interface ModelConstants {
  sector_weight: number;
  eb_k: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  timing_floor: number;
  timing_range: number;
  timing_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  sector_weight: 0.35,
  eb_k: 6,
  growth_weight: 0.5,
  growth_floor: -30,
  growth_cap: 60,
  timing_floor: 0.9,
  timing_range: 0.2,
  timing_days: 1095,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the README quotes it. */
export const MODEL_VERSION = 'radar-comps-1';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many token-recorded-but-unpriced protocols the Recorded view carries, by TVL. */
export const RECORDED_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    sector_multiple: number;
    size_multiple: number;
    blended_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    timing_multiplier: number;
    conviction_multiplier: number;
    age_days: number | null;
  };
  farm_capital_usd: number;
  farm_gas_usd: number;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  sector_multiple: number;
  size_multiple: number;
  blended_multiple: number;
  growth_multiplier: number;
  timing_multiplier: number;
  conviction_multiplier: number;
  farm_capital_usd: number;
  farm_gas_usd: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** A protocol whose record names a token but carries no market cap for it. */
export interface RecordedRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  symbol: string | null;
}

/** One sector's fitted multiple, for the dashboard's model panel. */
export interface SectorRow {
  category: string;
  protocols: number;
  multiple: number;
}

/** The leave-one-out validation of the comps core, computed at runtime. */
export interface Validation {
  families: number;
  global_multiple: number;
  size_intercept: number;
  size_slope: number;
  median_error_factor: number;
  within_2x: number;
  within_3x: number;
  spearman: number;
  baseline_size_only: { median_error_factor: number; within_2x: number; within_3x: number };
  baseline_global_median: { median_error_factor: number; within_2x: number; within_3x: number };
  blend_grid: { sector_weight: number; median_error_factor: number; within_2x: number; within_3x: number }[];
}

/** Everything the dashboard needs: the board, the live set, the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants & { global_multiple: number; size_intercept: number; size_slope: number; families: number };
  model_version: string;
  watchlist_size: number;
  board_size: number;
  off_watchlist_size: number;
  live_size: number;
  recorded_size: number;
  validation: Validation;
  sectors: SectorRow[];
  rows: RadarRow[];
  live: LiveRow[];
  recorded: RecordedRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of numbers (the mean of the two middles when the count is even). */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return s[(n - 1) / 2]!;
  return (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped, staked or bridged product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchange names: a protocol beginning with one is the exchange's own product. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
/** Categories the house rule keeps off the watchlist. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or
 * bridged product of a token that trades, by every rule the snapshot's own fields can
 * check. DefiLlama's parentProtocol is not one of the snapshot's ten fields, so a
 * protocol the house left out for a parent alone still passes here; the dashboard flags
 * those rows as off-watchlist and says so.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

// ---------------------------------------------------------------- comps fit

/** One live-token family: the protocols that share one token, TVL and mcap summed. */
export interface Family {
  key: string;
  category: string | null;
  tvl: number;
  mcap: number;
}

/** A protocol name with its version markers and variant suffixes stripped, for family keys. */
export function familyKey(name: string): string {
  let n = name.toLowerCase();
  n = n.replace(/\s(v\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/, '');
  n = n.replace(/\s(amm|clmm|classic|staked|liquid staking)$/, '');
  n = n.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return n;
}

/** The live-token families of a snapshot: mcap and TVL above zero, grouped by family key. */
export function liveFamilies(snapshot: Snapshot): Family[] {
  const byKey = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = familyKey(p.name);
    const group = byKey.get(key);
    if (group === undefined) byKey.set(key, [p]);
    else group.push(p);
  }
  const families: Family[] = [];
  for (const [key, group] of byKey) {
    // The family's category is the largest member's, so a stray variant cannot rename it.
    const biggest = group.reduce((a, b) => (b.tvl_usd > a.tvl_usd ? b : a));
    families.push({
      key,
      category: biggest.category,
      tvl: group.reduce((n, p) => n + p.tvl_usd, 0),
      mcap: group.reduce((n, p) => n + (p.mcap_usd ?? 0), 0),
    });
  }
  return families;
}

/** The comps fit: global log-median, EB-shrunk sector log-multiples, size-curve OLS. */
export interface CompsFit {
  families: Family[];
  globalLog: number;
  globalMultiple: number;
  sectorLog: Record<string, number>;
  sectorN: Record<string, number>;
  sizeIntercept: number;
  sizeSlope: number;
}

export function fitComps(families: Family[], ebK: number): CompsFit {
  const logs = families.map((f) => Math.log(f.mcap / f.tvl));
  const globalLog = median(logs);
  const byCategory = new Map<string, number[]>();
  for (const f of families) {
    const cat = f.category ?? 'Uncategorised';
    const list = byCategory.get(cat);
    if (list === undefined) byCategory.set(cat, [Math.log(f.mcap / f.tvl)]);
    else list.push(Math.log(f.mcap / f.tvl));
  }
  const sectorLog: Record<string, number> = {};
  const sectorN: Record<string, number> = {};
  for (const [cat, values] of byCategory) {
    // Empirical-Bayes shrink in log space: thin categories are pulled to the prior.
    sectorLog[cat] = (values.length * median(values) + ebK * globalLog) / (values.length + ebK);
    sectorN[cat] = values.length;
  }
  // OLS of log(mcap) on log(TVL): a slope below 1 means bigger protocols trade cheaper per TVL dollar.
  const xs = families.map((f) => Math.log(f.tvl));
  const ys = families.map((f) => Math.log(f.mcap));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = den === 0 ? 1 : num / den;
  const intercept = my - slope * mx;
  return { families, globalLog, globalMultiple: Math.exp(globalLog), sectorLog, sectorN, sizeIntercept: intercept, sizeSlope: slope };
}

/** The comps-core prediction of a market cap: sector and size only, no momentum or timing. */
function predictMcap(fit: CompsFit, tvl: number, category: string | null, sectorWeight: number): number {
  const sector = fit.sectorLog[category ?? 'Uncategorised'] ?? fit.globalLog;
  const size = fit.sizeIntercept + (fit.sizeSlope - 1) * Math.log(tvl);
  return Math.exp(sectorWeight * sector + (1 - sectorWeight) * size) * tvl;
}

/** Average ranks (ties share the mean of their positions), for Spearman correlation. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const mean = (i + j) / 2;
    for (let k = i; k <= j; k++) out[order[k]!.i] = mean;
    i = j + 1;
  }
  return out;
}

/** One LOO pass at one sector weight: median error factor, shares within 2x/3x, Spearman. */
function looPass(families: Family[], ebK: number, sectorWeight: number): { median_error_factor: number; within_2x: number; within_3x: number; spearman: number } {
  const errors: number[] = [];
  const preds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < families.length; i++) {
    const rest = families.filter((_f, j) => j !== i);
    const fit = fitComps(rest, ebK);
    const f = families[i]!;
    const pred = predictMcap(fit, f.tvl, f.category, sectorWeight);
    preds.push(pred);
    actuals.push(f.mcap);
    errors.push(Math.abs(Math.log(pred / f.mcap)));
  }
  const n = errors.length;
  const within2 = errors.filter((e) => e <= Math.log(2)).length / n;
  const within3 = errors.filter((e) => e <= Math.log(3)).length / n;
  const rp = ranks(preds);
  const ra = ranks(actuals);
  const mp = rp.reduce((a, b) => a + b, 0) / n;
  const ma = ra.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dp = 0;
  let da = 0;
  for (let i = 0; i < n; i++) {
    num += (rp[i]! - mp) * (ra[i]! - ma);
    dp += (rp[i]! - mp) * (rp[i]! - mp);
    da += (ra[i]! - ma) * (ra[i]! - ma);
  }
  const spearman = dp === 0 || da === 0 ? 0 : num / Math.sqrt(dp * da);
  return {
    median_error_factor: Math.exp(median(errors)),
    within_2x: within2,
    within_3x: within3,
    spearman,
  };
}

/** The full validation: the chosen blend, its baselines, and the blend grid that chose it. */
export function validateComps(families: Family[], model: ModelConstants, fit: CompsFit): Validation {
  const chosen = looPass(families, model.eb_k, model.sector_weight);
  const sizeOnly = looPass(families, model.eb_k, 0);
  const grid = [0, 0.35, 0.5, 0.65, 1].map((w) => {
    const r = looPass(families, model.eb_k, w);
    return { sector_weight: w, median_error_factor: r.median_error_factor, within_2x: r.within_2x, within_3x: r.within_3x };
  });
  // The flat global-median baseline: every family predicted at the global multiple.
  const errors: number[] = [];
  for (let i = 0; i < families.length; i++) {
    const rest = families.filter((_f, j) => j !== i);
    const g = median(rest.map((f) => Math.log(f.mcap / f.tvl)));
    const f = families[i]!;
    errors.push(Math.abs(Math.log((Math.exp(g) * f.tvl) / f.mcap)));
  }
  const n = errors.length;
  return {
    families: families.length,
    global_multiple: fit.globalMultiple,
    size_intercept: fit.sizeIntercept,
    size_slope: fit.sizeSlope,
    median_error_factor: chosen.median_error_factor,
    within_2x: chosen.within_2x,
    within_3x: chosen.within_3x,
    spearman: chosen.spearman,
    baseline_size_only: { median_error_factor: sizeOnly.median_error_factor, within_2x: sizeOnly.within_2x, within_3x: sizeOnly.within_3x },
    baseline_global_median: {
      median_error_factor: Math.exp(median(errors)),
      within_2x: errors.filter((e) => e <= Math.log(2)).length / n,
      within_3x: errors.filter((e) => e <= Math.log(3)).length / n,
    },
    blend_grid: grid,
  };
}

// ---------------------------------------------------------------- implied value

/** The three multipliers and the implied value one protocol gets under the fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CompsFit,
  model: ModelConstants,
): {
  implied: number;
  sectorMultiple: number;
  sizeMultiple: number;
  blendedMultiple: number;
  growthPct: number;
  growthMult: number;
  timingMult: number;
  convictionMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const sectorLog = fit.sectorLog[protocol.category ?? 'Uncategorised'] ?? fit.globalLog;
  const sectorMultiple = Math.exp(sectorLog);
  const sizeMultiple = Math.exp(fit.sizeIntercept + (fit.sizeSlope - 1) * Math.log(protocol.tvl_usd));
  const blendedMultiple = Math.exp(
    model.sector_weight * Math.log(sectorMultiple) + (1 - model.sector_weight) * Math.log(sizeMultiple),
  );
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const timingMult = age === null ? 1 : model.timing_floor + (Math.min(Math.max(age, 0), model.timing_days) / model.timing_days) * model.timing_range;
  const convictionMult = 0.9 + 0.05 * (protocol.change_7d !== null ? 1 : 0) + 0.05 * (age !== null ? 1 : 0);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * blendedMultiple * growthMult * timingMult * convictionMult));
  return { implied, sectorMultiple, sizeMultiple, blendedMultiple, growthPct, growthMult, timingMult, convictionMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A rough USD gas cost for one simple interaction on a chain (an estimate, stated as one). */
export function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 6;
  if (c === 'solana') return 0.02;
  if (c === 'polygon') return 0.05;
  if (c === 'base') return 0.2;
  if (c === 'arbitrum' || c === 'optimism' || c === 'avalanche') return 0.3;
  if (c === 'binance' || c === 'ink' || c === 'mantle') return 0.2;
  return 1;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator')) return `Deposit $${capital} into a ${name} curator vault on ${chain} and keep the vault shares.`;
  if (c.includes('lending') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('cdp manager') || c.includes('cdp')) return `Lock $${capital} of collateral in ${name} on ${chain} and mint its stable asset against it.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('allocator') || c.includes('aggregator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('restak')) return `Restake $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('staking pool') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('stablecoin wrapper')) return `Wrap $${capital} of USDC into ${name} on ${chain} and hold the wrapped asset.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${name}'s governance vault on ${chain} and vote once.`;
  if (c.includes('payment')) return `Fund $${capital} into ${name} on ${chain} and make one payment through it each week.`;
  if (c.includes('otc')) return `Fund $${capital} and place one order through ${name} on ${chain}.`;
  if (c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and keep the position open.`;
  if (c.includes('chain')) return `Deposit $${capital} of the chain asset into ${name} on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Gas is a per-chain estimate; the dashboard says so.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): { steps: FarmStep[]; capital: number; gas: number } {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasUsd(chain);
  const gas8 = Math.round((gas + 8 * gas) * 100) / 100;
  const action = actionFor(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about $${gas} of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return { steps, capital, gas: gas8 };
}

// ---------------------------------------------------------------- board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitComps(liveFamilies(snapshot), model.eb_k);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Off-watchlist: every other rankable pre-token protocol, above or below the floor.
  // The house left some out for a parent protocol the snapshot does not carry; they are
  // flagged on_watchlist: false in the row and in the dashboard, never hidden.
  const off = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of off) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, model);
    const farm = farmSteps(p, v.age);
    return { p, v, farm };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      sector_multiple: round4(s.v.sectorMultiple),
      size_multiple: round4(s.v.sizeMultiple),
      blended_multiple: round4(s.v.blendedMultiple),
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      timing_multiplier: round4(s.v.timingMult),
      conviction_multiplier: round4(s.v.convictionMult),
      age_days: s.v.age,
    },
    farm_capital_usd: s.farm.capital,
    farm_gas_usd: s.farm.gas,
    farm_steps: s.farm.steps.map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.tvl_usd > 0 && p.mcap_usd !== null ? Math.round((p.mcap_usd / p.tvl_usd) * 1e4) / 1e4 : null,
    }));
}

/** Protocols whose record names a token but carries no market cap for it, by TVL. */
export function recordedRows(snapshot: Snapshot): RecordedRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, RECORDED_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    sector_multiple: row.model.sector_multiple,
    size_multiple: row.model.size_multiple,
    blended_multiple: row.model.blended_multiple,
    growth_multiplier: row.model.growth_multiplier,
    timing_multiplier: row.model.timing_multiplier,
    conviction_multiplier: row.model.conviction_multiplier,
    farm_capital_usd: row.farm_capital_usd,
    farm_gas_usd: row.farm_gas_usd,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const families = liveFamilies(snapshot);
  const fit = fitComps(families, model.eb_k);
  const validation = validateComps(families, model, fit);
  const live = liveRows(snapshot);
  const recorded = recordedRows(snapshot);
  const off = board.filter((r) => !r.on_watchlist).length;
  const sectors: SectorRow[] = Object.keys(fit.sectorLog)
    .sort((a, b) => (fit.sectorN[b] ?? 0) - (fit.sectorN[a] ?? 0) || (a < b ? -1 : 1))
    .map((category) => ({
      category,
      protocols: fit.sectorN[category] ?? 0,
      multiple: round4(Math.exp(fit.sectorLog[category]!)),
    }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: {
      ...model,
      global_multiple: round4(fit.globalMultiple),
      size_intercept: round4(fit.sizeIntercept),
      size_slope: round4(fit.sizeSlope),
      families: families.length,
    },
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    off_watchlist_size: off,
    live_size: live.length,
    recorded_size: recorded.length,
    validation,
    sectors,
    rows: board.map(radarRow),
    live,
    recorded,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
