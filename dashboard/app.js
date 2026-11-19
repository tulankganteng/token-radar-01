// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a per-protocol detail view, the live-token comparison and the
// out-of-sample validation. No network: every byte it shows ships with the page.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('board');
  if (!DATA || !app) return;
  var state = { q: '', category: 'all', chain: 'all', min: 0, watch: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return d + 'd';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q') !== null) state.q = p.get('q');
    if (p.get('category') !== null) state.category = p.get('category');
    if (p.get('chain') !== null) state.chain = p.get('chain');
    if (p.get('min') !== null) state.min = parseInt(p.get('min'), 10) || 0;
    if (p.get('watch') !== null) state.watch = p.get('watch') === '1';
    if (p.get('tab') !== null) state.tab = p.get('tab');
    if (p.get('p') !== null) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.min) p.set('min', String(state.min));
    if (state.watch) p.set('watch', '1');
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.selected) p.set('p', state.selected);
    var s = p.toString();
    history.replaceState(null, '', s ? '#' + s : '#');
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (r.implied_value_usd < state.min) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
  }
  function sortedRows(rows) {
    var key = state.sort, dir = state.dir;
    var val = function (r) {
      if (key === 'implied') return r.implied_value_usd;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -9999 : r.change_7d;
      if (key === 'multiple') return r.blended_multiple;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'category') return (r.category || '').toLowerCase();
      if (key === 'chain') return r.chains.length ? r.chains[0] : '';
      if (key === 'name') return r.name.toLowerCase();
      return r.rank;
    };
    return rows.slice().sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.rank - b.rank;
    });
  }

  // The page recomputes a row from the stored components and checks the number board.json
  // carries, so the page's code and the board's data are visibly the same arithmetic.
  function recompute(r) {
    return Math.round(r.tvl_usd * r.blended_multiple * r.growth_multiplier * r.timing_multiplier * r.conviction_multiplier);
  }

  function renderDetail(r) {
    var box = el('section', { 'class': 'detail', id: 'detail' });
    box.appendChild(el('h2', { text: '#' + r.rank + ' ' + r.name }));
    var badges = el('p', {});
    badges.appendChild(el('span', { 'class': 'badge ' + (r.on_watchlist ? 'watch' : 'off'), text: r.on_watchlist ? 'ON HOUSE WATCHLIST' : 'OFF WATCHLIST' }));
    badges.appendChild(document.createTextNode('  ' + (r.category || 'Uncategorised') + '  ·  ' + (r.chains.join(', ') || 'no chain listed') + '  ·  listed ' + (r.listed_at || 'unknown') + '  ·  ' + fmtAge(r.age_days) + ' old'));
    box.appendChild(badges);
    if (!r.on_watchlist) {
      box.appendChild(el('p', { 'class': 'warn', text: 'Not on the house watchlist: DefiLlama may record a parent protocol for it, which this snapshot does not carry. Its implied value is the same model, but verify it stands alone before farming.' }));
    }
    var grid = el('div', { 'class': 'grid' });
    [['Implied token value', fmtUsd(r.implied_value_usd)], ['TVL', fmtUsd(r.tvl_usd)], ['7-day TVL change', fmtPct(r.change_7d)],
     ['Sector multiple', r.sector_multiple.toFixed(3) + 'x'], ['Size multiple', r.size_multiple.toFixed(3) + 'x'],
     ['Blended multiple', r.blended_multiple.toFixed(3) + 'x'], ['Momentum', r.growth_multiplier.toFixed(3) + 'x'],
     ['Timing', r.timing_multiplier.toFixed(3) + 'x'], ['Conviction', r.conviction_multiplier.toFixed(3) + 'x']]
      .forEach(function (kv) { grid.appendChild(el('div', { 'class': 'cell' }, el('b', { text: kv[1] }), el('span', { text: kv[0] }))); });
    box.appendChild(grid);
    var re = recompute(r);
    var diff = Math.abs(re - r.implied_value_usd) / r.implied_value_usd;
    box.appendChild(el('p', { 'class': 'note', text: 'Page recompute from the stored components: ' + fmtUsd(re) + ' vs board.json ' + fmtUsd(r.implied_value_usd) + ' (' + (diff < 0.01 ? 'matches within rounding' : 'differs by ' + (diff * 100).toFixed(1) + '%') + '). Implied value = TVL x blended multiple x momentum x timing x conviction. It is the entry\u2019s own claim, not a prediction that a token will launch.' }));
    box.appendChild(el('h3', { text: 'Costed farm plan' }));
    var ol = el('ol', {});
    r.farm_steps.forEach(function (s) { ol.appendChild(el('li', { text: s })); });
    box.appendChild(ol);
    box.appendChild(el('p', {}, el('span', { 'class': 'cost', text: 'Estimated outlay: $' + r.farm_capital_usd + ' of capital + about $' + r.farm_gas_usd + ' of gas (first transaction plus 8 weekly actions, per-chain estimate). ' }), document.createTextNode('Gas is an estimate, not a quote: check the chain before you transact. Never pay to claim; claim only from the protocol\u2019s own page.')));
    var close = el('button', { text: 'Close detail', onclick: function () { state.selected = null; writeHash(); render(); } });
    close.style.cssText = 'background:var(--chip);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:6px 12px;cursor:pointer';
    box.appendChild(close);
    return box;
  }

  function th(label, key, cls) {
    var attrs = { text: label + (state.sort === key ? (state.dir === -1 ? ' ▼' : ' ▲') : ''), 'class': 'sortable' + (cls ? ' ' + cls : '') };
    return el('th', Object.assign(attrs, { onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } }));
  }

  function renderBoard() {
    var wrap = el('div', {});
    var tabs = el('div', { 'class': 'tabs' });
    [['board', 'Pre-token board (' + DATA.board_size + ')'], ['live', 'Already trades (' + DATA.live_size + ')'], ['recorded', 'Token recorded, unpriced (' + DATA.recorded_size + ')']].forEach(function (t) {
      tabs.appendChild(el('button', { 'class': state.tab === t[0] ? 'on' : '', text: t[1], onclick: function () { state.tab = t[0]; state.selected = null; writeHash(); render(); } }));
    });
    wrap.appendChild(tabs);
    if (state.tab === 'live') return wrap.appendChild(renderLive()), wrap;
    if (state.tab === 'recorded') return wrap.appendChild(renderRecorded()), wrap;

    var cats = ['all'].concat(Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; })) ).sort());
    var chains = ['all'].concat(Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains); }, []))).sort());
    var f = el('div', { 'class': 'filters' });
    var q = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols' });
    q.addEventListener('input', function () { state.q = q.value; writeHash(); renderTable(); });
    f.appendChild(q);
    var cs = el('select', { 'aria-label': 'Filter by category' });
    cats.forEach(function (c) { cs.appendChild(el('option', { value: c, text: c === 'all' ? 'All categories' : c })); });
    cs.value = state.category;
    cs.addEventListener('change', function () { state.category = cs.value; writeHash(); render(); });
    f.appendChild(cs);
    var ch = el('select', { 'aria-label': 'Filter by chain' });
    chains.forEach(function (c) { ch.appendChild(el('option', { value: c, text: c === 'all' ? 'All chains' : c })); });
    ch.value = state.chain;
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    f.appendChild(ch);
    var ms = el('select', { 'aria-label': 'Minimum implied value' });
    [[0, 'Any value'], [10000000, 'Implied ≥ $10M'], [50000000, 'Implied ≥ $50M'], [100000000, 'Implied ≥ $100M']].forEach(function (o) { ms.appendChild(el('option', { value: String(o[0]), text: o[1] })); });
    ms.value = String(state.min);
    ms.addEventListener('change', function () { state.min = parseInt(ms.value, 10); writeHash(); render(); });
    f.appendChild(ms);
    var wl = el('label', {}, document.createTextNode('Watchlist only'), el('input', { type: 'checkbox', checked: state.watch ? true : null }));
    wl.querySelector('input').addEventListener('change', function (e) { state.watch = e.target.checked; writeHash(); render(); });
    f.appendChild(wl);
    wrap.appendChild(f);
    var tableHost = el('div', { id: 'table-host' });
    wrap.appendChild(tableHost);
    wrap.renderTable = function () { renderTableInto(tableHost); };
    renderTableInto(tableHost);
    return wrap;
  }

  function renderTableInto(host) {
    var rows = sortedRows(filteredRows());
    host.innerHTML = '';
    host.appendChild(el('p', { 'class': 'count', text: rows.length + ' of ' + DATA.board_size + ' protocols shown · sorted by ' + state.sort + ' · click a row for its detail view and farm plan' }));
    var table = el('table', {});
    var head = el('tr', {},
      el('th', { text: '#', 'class': 'num' }),
      th('Protocol', 'name'), th('Category', 'category'), th('Chains', 'chain'),
      th('TVL', 'tvl', 'num'), th('7d', 'growth', 'num'), th('Implied value', 'implied', 'num'), th('Multiple', 'multiple', 'num'));
    table.appendChild(el('thead', {}, head));
    var body = el('tbody', {});
    rows.forEach(function (r) {
      var tr = el('tr', { 'class': state.selected === r.slug ? 'sel' : '', onclick: function () { state.selected = r.slug; writeHash(); render(); } });
      tr.appendChild(el('td', { 'class': 'num', text: String(r.rank) }));
      var nameCell = el('td', {});
      nameCell.appendChild(document.createTextNode(r.name + ' '));
      nameCell.appendChild(el('span', { 'class': 'badge ' + (r.on_watchlist ? 'watch' : 'off'), text: r.on_watchlist ? 'WATCHLIST' : 'OFF-LIST' }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }));
      var g = el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) });
      tr.appendChild(g);
      tr.appendChild(el('td', { 'class': 'num', html: '<b>' + esc(fmtUsd(r.implied_value_usd)) + '</b>' }));
      tr.appendChild(el('td', { 'class': 'num', text: r.blended_multiple.toFixed(3) + 'x' }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    host.appendChild(table);
  }

  function renderTable() {
    var host = document.getElementById('table-host');
    if (host) renderTableInto(host);
  }

  function renderLive() {
    var d = el('div', {});
    d.appendChild(el('p', { text: 'These protocols already have a token that trades, so they are not ranked. They are the comps the model learned from: their market caps price a dollar of TVL. Shown by market cap, largest first.' }));
    var table = el('table', {});
    table.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'TVL', 'class': 'num' }), el('th', { text: 'Market cap', 'class': 'num' }), el('th', { text: 'Mcap / TVL', 'class': 'num' }), el('th', { text: '7d', 'class': 'num' }))));
    var body = el('tbody', {});
    DATA.live.forEach(function (r) {
      var tr = el('tr', {});
      tr.appendChild(el('td', { text: r.name }));
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(r.mcap_usd) }));
      tr.appendChild(el('td', { 'class': 'num', text: r.mcap_tvl === null ? 'n/a' : r.mcap_tvl.toFixed(3) + 'x' }));
      tr.appendChild(el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    d.appendChild(table);
    return d;
  }

  function renderRecorded() {
    var d = el('div', {});
    d.appendChild(el('p', { text: 'DefiLlama records a token for these protocols but no market cap, so the model cannot price them as comps and cannot rank them as pre-token. They are listed apart, by TVL, so the board never pretends a token does not exist.' }));
    var table = el('table', {});
    table.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Symbol' }), el('th', { text: 'Category' }), el('th', { text: 'TVL', 'class': 'num' }), el('th', { text: '7d', 'class': 'num' }))));
    var body = el('tbody', {});
    DATA.recorded.forEach(function (r) {
      var tr = el('tr', {});
      tr.appendChild(el('td', { text: r.name }));
      tr.appendChild(el('td', { text: r.symbol || '—' }));
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { 'class': 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    d.appendChild(table);
    return d;
  }

  function render() {
    app.setAttribute('aria-busy', 'true');
    app.innerHTML = '';
    var v = DATA.validation, m = DATA.model;
    var hero = el('header', { 'class': 'hero' });
    hero.appendChild(el('h1', { html: 'Token Radar <span>· fitted, not guessed</span>' }));
    hero.appendChild(el('p', { text: 'Every protocol DefiLlama tracks, ranked by what its token would be worth if it launched on today\u2019s record. The multiples are learned from the ' + v.families + ' live-token protocols in the same snapshot — no hardcoded price, no name ever special-cased.' }));
    hero.appendChild(el('p', { text: 'Snapshot: ' + DATA.as_of + ' · source: DefiLlama api.llama.fi/protocols · watchlist floor $50M TVL · model ' + DATA.model_version }));
    var stats = el('div', { 'class': 'stats' });
    [['Protocols ranked', String(DATA.board_size)], ['On the watchlist', String(DATA.watchlist_size)], ['Found off-list', String(DATA.off_watchlist_size)],
     ['Top implied value', fmtUsd(DATA.rows[0].implied_value_usd)], ['Global mcap / TVL', m.global_multiple.toFixed(3) + 'x'],
     ['Size-curve slope', String(m.size_slope)]].forEach(function (s) {
      stats.appendChild(el('div', { 'class': 'stat' }, el('b', { text: s[1] }), el('span', { text: s[0] })));
    });
    hero.appendChild(stats);
    app.appendChild(hero);

    var sel = state.selected ? DATA.rows.find(function (r) { return r.slug === state.selected; }) : null;
    if (sel) app.appendChild(renderDetail(sel));
    var boardSec = el('section', { 'class': 'panel' });
    boardSec.appendChild(el('h2', { text: 'The board' }));
    boardSec.appendChild(renderBoard());
    app.appendChild(boardSec);

    var val = el('section', { 'class': 'panel' });
    val.appendChild(el('h2', { text: 'Out-of-sample validation — leave-one-out cross-validation' }));
    val.appendChild(el('p', { html: 'Each of the ' + v.families + ' live families was held out in turn, the model refit without it, and its market cap predicted. <b>Median error x' + v.median_error_factor.toFixed(2) + '</b> · within 2x: <b>' + (v.within_2x * 100).toFixed(1) + '%</b> · within 3x: <b>' + (v.within_3x * 100).toFixed(1) + '%</b> · Spearman rank correlation <b>' + v.spearman.toFixed(3) + '</b>. Comps are a rough guide, not a price target — the board says so on every row.' }));
    var grid = el('table', {});
    grid.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Model' }), el('th', { text: 'Median error', 'class': 'num' }), el('th', { text: 'Within 2x', 'class': 'num' }), el('th', { text: 'Within 3x', 'class': 'num' }))));
    var gb = el('tbody', {});
    function grow(label, e, w2, w3, bold) {
      var tr = el('tr', {});
      tr.appendChild(el('td', { html: bold ? '<b>' + esc(label) + '</b>' : esc(label) }));
      tr.appendChild(el('td', { 'class': 'num', text: 'x' + e.toFixed(2) }));
      tr.appendChild(el('td', { 'class': 'num', text: (w2 * 100).toFixed(1) + '%' }));
      tr.appendChild(el('td', { 'class': 'num', text: (w3 * 100).toFixed(1) + '%' }));
      gb.appendChild(tr);
    }
    grow('Chosen blend (sector 0.35 + size 0.65)', v.median_error_factor, v.within_2x, v.within_3x, true);
    grow('Pure size curve (sector 0)', v.baseline_size_only.median_error_factor, v.baseline_size_only.within_2x, v.baseline_size_only.within_3x, false);
    grow('Flat global median (sector 1, no size)', v.baseline_global_median.median_error_factor, v.baseline_global_median.within_2x, v.baseline_global_median.within_3x, false);
    v.blend_grid.forEach(function (g) { grow('Blend grid: sector weight ' + g.sector_weight, g.median_error_factor, g.within_2x, g.within_3x, g.sector_weight === 0.35); });
    grid.appendChild(gb);
    val.appendChild(grid);
    val.appendChild(el('p', { 'class': 'note', text: 'The pure size curve wins narrowly on LOO (median x' + v.baseline_size_only.median_error_factor.toFixed(2) + ' vs x' + v.median_error_factor.toFixed(2) + '). The blend keeps a 0.35 sector weight because category pricing is a real market signal (Dexs price near 0.29x TVL, Liquid Staking near 0.04x) and the dashboard shows both components per protocol, so the reader can see what the sector added.' }));
    app.appendChild(val);

    var meth = el('section', { 'class': 'panel' });
    meth.appendChild(el('h2', { text: 'How the value is fitted' }));
    meth.appendChild(el('p', { 'class': 'mono', text:
      'sector multiple  = median mcap/TVL per category, EB-shrunk (K=6) to the global median ' + m.global_multiple.toFixed(3) + 'x\n' +
      'size multiple    = exp(' + m.size_intercept.toFixed(3) + ' + (' + m.size_slope.toFixed(3) + ' - 1) x ln TVL)   [log(mcap) = ' + m.size_intercept.toFixed(3) + ' + ' + m.size_slope.toFixed(3) + ' x log(TVL)]\n' +
      'blended multiple = exp(0.35 x ln sector + 0.65 x ln size)\n' +
      'implied value    = TVL x blended x momentum x timing x conviction\n' +
      'momentum = 1 + 0.5 x clamp(7d change, -30%, +60%) / 100\n' +
      'timing   = 0.90 + 0.20 x min(age, 1095d) / 1095d   (1.00 when age unknown)\n' +
      'conviction = 0.90 + 0.05 (7d known) + 0.05 (age known)' }));
    meth.appendChild(el('h3', { text: 'Sector multiples (fitted, top categories by protocol count)' }));
    var st = el('table', {});
    st.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Category' }), el('th', { text: 'Live protocols', 'class': 'num' }), el('th', { text: 'Multiple', 'class': 'num' }))));
    var sb = el('tbody', {});
    DATA.sectors.slice(0, 12).forEach(function (s) {
      var tr = el('tr', {});
      tr.appendChild(el('td', { text: s.category }));
      tr.appendChild(el('td', { 'class': 'num', text: String(s.protocols) }));
      tr.appendChild(el('td', { 'class': 'num', text: s.multiple.toFixed(3) + 'x' }));
      sb.appendChild(tr);
    });
    st.appendChild(sb);
    meth.appendChild(st);
    meth.appendChild(el('p', { 'class': 'note', text: 'A protocol records no token, never that it has none: DefiLlama\u2019s record is not proof. A board row is the entry\u2019s own claim about what a launch would be worth on the protocol\u2019s current record — not a prediction that a token will be issued, or when.' }));
    app.appendChild(meth);
    app.appendChild(el('footer', { text: 'Token Radar · model ' + DATA.model_version + ' · snapshot ' + DATA.as_of + ' · built from the sealed snapshot only, no network, no live data.' }));
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  window.addEventListener('hashchange', function () { readHash(); render(); });
  render();
})();
