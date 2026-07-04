const STORAGE_KEY = "dg-tracker-state-v1";
const USER_SNAPSHOTS_TABLE = "dg_tracker_user_snapshots";

const DEFAULT_STATE = {
  activeView: "dashboard",
  selectedDate: new Date().toISOString().slice(0, 10),
  settings: {
    accountA: "Conta A",
    accountB: "Conta B",
    accountOther: "Outra",
    supabaseUrl: "https://maenndpjseglihhmvils.supabase.co",
    supabaseAnonKey: "sb_publishable__RagIfBzfpKO04LLO10sAg_cW-Ufla1",
    supabaseTable: USER_SNAPSHOTS_TABLE,
    supabaseSyncId: "",
  },
  bets: [],
  balances: [],
};

let state = loadState();
let supabaseClient = null;
let currentUser = null;
let authReady = false;
let cloudSaveTimer = null;
let restoringFromCloud = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const moneyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const pctFmt = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function storageKeyForUser(userId) {
  return `${STORAGE_KEY}:${userId}`;
}

function currentStorageKey() {
  return currentUser ? storageKeyForUser(currentUser.id) : STORAGE_KEY;
}

function hasStoredState(key) {
  return Boolean(localStorage.getItem(key));
}

function hasTrackerData(candidate) {
  return Boolean(candidate?.bets?.length || candidate?.balances?.length);
}

function loadState(key = STORAGE_KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return normalizeState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return normalizeState();
  }
}

function loadStateForUser(user) {
  const userKey = storageKeyForUser(user.id);
  if (hasStoredState(userKey)) return loadState(userKey);
  const legacy = loadState(STORAGE_KEY);
  if (hasTrackerData(legacy)) return legacy;
  return normalizeState();
}

function normalizeState(input = {}) {
  const base = structuredClone(DEFAULT_STATE);
  const inputSettings = input.settings || {};
  const settings = {
    ...base.settings,
    ...inputSettings,
  };
  settings.supabaseUrl = normalizeSupabaseUrl(settings.supabaseUrl || base.settings.supabaseUrl);
  settings.supabaseAnonKey = settings.supabaseAnonKey || base.settings.supabaseAnonKey;
  settings.supabaseTable = USER_SNAPSHOTS_TABLE;
  settings.supabaseSyncId = "";
  return {
    ...base,
    ...input,
    settings,
    bets: Array.isArray(input.bets) ? input.bets : [],
    balances: Array.isArray(input.balances) ? input.balances : [],
  };
}

function normalizeSupabaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/+$/g, "");
}

function saveState(options = {}) {
  const { cloud = true } = options;
  localStorage.setItem(currentStorageKey(), JSON.stringify(state));
  if (cloud && currentUser && authReady && !restoringFromCloud) {
    queueCloudSave();
  }
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return moneyFmt.format(num(value));
}

function pct(value) {
  return pctFmt.format(num(value));
}

function dateBR(iso) {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function accounts() {
  return [state.settings.accountA, state.settings.accountB, state.settings.accountOther].filter(Boolean);
}

function computeBet(bet) {
  const oddOver = num(bet.oddOver);
  const oddUnder = num(bet.oddUnder);
  const stakeOver = num(bet.stakeOver);
  const stakeUnder = num(bet.stakeUnder);
  const liveCashoutOver = num(bet.liveCashoutOver);
  const liveCashoutUnder = num(bet.liveCashoutUnder);
  const stakeTotal = stakeOver + stakeUnder;
  const doubleProfit = stakeOver * (oddOver - 1) + stakeUnder * (oddUnder - 1);
  const onlyUnder = stakeUnder * (oddUnder - 1) - stakeOver;
  const onlyOver = stakeOver * (oddOver - 1) - stakeUnder;
  const worstLoss = Math.min(onlyUnder, onlyOver, 0);
  const minDoubleRate = doubleProfit + Math.abs(worstLoss) > 0
    ? Math.abs(worstLoss) / (doubleProfit + Math.abs(worstLoss))
    : 0;

  const overResult = bet.resultOver || "Aberta";
  const underResult = bet.resultUnder || "Aberta";
  const overReturn = {
    Ganhou: stakeOver * oddOver,
    Perdeu: 0,
    Cashout: num(bet.cashoutOver),
    Anulada: stakeOver,
    Aberta: 0,
  }[overResult] ?? 0;
  const underReturn = {
    Ganhou: stakeUnder * oddUnder,
    Perdeu: 0,
    Cashout: num(bet.cashoutUnder),
    Anulada: stakeUnder,
    Aberta: 0,
  }[underResult] ?? 0;

  const overOpen = overResult === "Aberta";
  const underOpen = underResult === "Aberta";
  const isOpen = overOpen || underOpen;
  const totalReturn = overReturn + underReturn;
  const profit = isOpen ? null : totalReturn - stakeTotal;
  const roi = profit === null || stakeTotal === 0 ? null : profit / stakeTotal;
  const openStake = (overOpen ? stakeOver : 0) + (underOpen ? stakeUnder : 0);
  const lockedReturn = (overOpen ? 0 : overReturn) + (underOpen ? 0 : underReturn);
  const hasLiveOver = !overOpen || liveCashoutOver > 0;
  const hasLiveUnder = !underOpen || liveCashoutUnder > 0;
  const liveCashoutTotal = hasLiveOver && hasLiveUnder
    ? lockedReturn + (overOpen ? liveCashoutOver : 0) + (underOpen ? liveCashoutUnder : 0)
    : null;
  const cashoutProfitNow = liveCashoutTotal === null ? null : liveCashoutTotal - stakeTotal;
  const cashoutRoiNow = cashoutProfitNow === null || stakeTotal === 0 ? null : cashoutProfitNow / stakeTotal;

  let status = "Aberta";
  if (!isOpen) {
    if (overResult === "Anulada" && underResult === "Anulada") status = "Anulada";
    else if (overResult === "Ganhou" && underResult === "Ganhou") status = "Duplo Green";
    else if (overResult === "Cashout" && underResult === "Ganhou") status = "Cashout + Under";
    else if (overResult === "Ganhou" && underResult === "Cashout") status = "Cashout + Over";
    else if (overResult === "Cashout") status = "Cashout";
    else if (underResult === "Cashout") status = "Cashout";
    else if (overResult === "Ganhou" && underResult === "Perdeu") status = "Só Over";
    else if (overResult === "Perdeu" && underResult === "Ganhou") status = "Só Under";
    else if (profit < 0) status = "Red";
    else if (profit > 0) status = "Lucro";
    else status = "Zero";
  }

  return {
    stakeTotal,
    doubleProfit,
    onlyUnder,
    onlyOver,
    minDoubleRate,
    overReturn,
    underReturn,
    liveCashoutTotal,
    cashoutProfitNow,
    cashoutRoiNow,
    openStake,
    lockedReturn,
    totalReturn,
    profit,
    roi,
    status,
    isOpen,
  };
}

function filteredBets() {
  const selected = state.selectedDate;
  if (!selected) return state.bets;
  return state.bets.filter((b) => b.date === selected);
}

function closedBets(bets = filteredBets()) {
  return bets.filter((b) => !computeBet(b).isOpen);
}

function totalsForDate(date) {
  const bets = state.bets.filter((b) => b.date === date);
  const closed = closedBets(bets);
  const openBets = bets.filter((b) => computeBet(b).isOpen);
  const openWithCashout = openBets.filter((b) => computeBet(b).cashoutProfitNow !== null);
  return {
    bets,
    closed,
    stake: closed.reduce((sum, b) => sum + computeBet(b).stakeTotal, 0),
    profit: closed.reduce((sum, b) => sum + (computeBet(b).profit || 0), 0),
    openStake: openBets.reduce((sum, b) => sum + computeBet(b).openStake, 0),
    liveCashout: openWithCashout.reduce((sum, b) => sum + (computeBet(b).liveCashoutTotal || 0), 0),
    liveCashoutProfit: openWithCashout.reduce((sum, b) => sum + (computeBet(b).cashoutProfitNow || 0), 0),
    openWithCashout: openWithCashout.length,
    entries: bets.length,
    doubleGreens: bets.filter((b) => computeBet(b).status === "Duplo Green").length,
    cashouts: bets.filter((b) => computeBet(b).status.includes("Cashout")).length,
    reds: closed.filter((b) => (computeBet(b).profit || 0) < 0).length,
  };
}

function classForStatus(status) {
  if (status === "Duplo Green" || status === "Lucro") return "green";
  if (status.includes("Cashout")) return "blue";
  if (status === "Red") return "red";
  if (status === "Aberta") return "amber";
  return "";
}

function activateView(view) {
  const safeView = ["dashboard", "bets", "balances", "config"].includes(view) ? view : "dashboard";
  $$(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === safeView));
  $$(".view").forEach((el) => el.classList.remove("active"));
  $(`#view-${safeView}`).classList.add("active");
  $("#pageTitle").textContent = {
    dashboard: "Dashboard",
    bets: "Apostas",
    balances: "Saldo do Dia",
    config: "Config",
  }[safeView];
}

function setView(view) {
  state.activeView = ["dashboard", "bets", "balances", "config"].includes(view) ? view : "dashboard";
  saveState();
  activateView(state.activeView);
  render();
}

function render() {
  $("#globalDate").value = state.selectedDate || "";
  renderDashboard();
  renderBets();
  renderBalances();
  renderConfig();
}

function renderDashboard() {
  const root = $("#view-dashboard");
  const bets = filteredBets();
  const closed = closedBets(bets);
  const stake = closed.reduce((sum, b) => sum + computeBet(b).stakeTotal, 0);
  const profit = closed.reduce((sum, b) => sum + (computeBet(b).profit || 0), 0);
  const roi = stake ? profit / stake : 0;
  const doubleGreens = bets.filter((b) => computeBet(b).status === "Duplo Green").length;
  const cashouts = bets.filter((b) => computeBet(b).status.includes("Cashout")).length;
  const reds = closed.filter((b) => (computeBet(b).profit || 0) < 0).length;
  const openBets = bets.filter((b) => computeBet(b).isOpen);
  const open = openBets.length;
  const openStake = openBets.reduce((sum, b) => sum + computeBet(b).openStake, 0);
  const cashoutKnown = openBets.filter((b) => computeBet(b).cashoutProfitNow !== null);
  const liveCashout = cashoutKnown.reduce((sum, b) => sum + (computeBet(b).liveCashoutTotal || 0), 0);
  const liveCashoutProfit = cashoutKnown.reduce((sum, b) => sum + (computeBet(b).cashoutProfitNow || 0), 0);
  const selectedBalance = state.balances.find((d) => d.date === state.selectedDate);

  root.innerHTML = `
    <div class="grid kpi-grid">
      ${kpi("Stake fechado", money(stake), `${closed.length} apostas fechadas`, "blue")}
      ${kpi("Lucro real", money(profit), "Somente entradas fechadas", profit < 0 ? "red" : "green")}
      ${kpi("Dinheiro em jogo", money(openStake), `${open} apostas abertas`, "amber")}
      ${kpi("P/L se cashar", cashoutKnown.length ? money(liveCashoutProfit) : "-", `${cashoutKnown.length}/${open} abertas com cashout`, liveCashoutProfit < 0 ? "red" : "green")}
      ${kpi("Cashout atual", cashoutKnown.length ? money(liveCashout) : "-", "Retorno se encerrar abertas", "blue")}
      ${kpi("ROI", pct(roi), "Lucro / stake fechado", "amber")}
      ${kpi("Entradas", bets.length, `${open} em aberto`, "")}
      ${kpi("Duplo Green", doubleGreens, "Over + under verdes", "green")}
      ${kpi("Cashouts", cashouts, "Cash ou cash + under", "blue")}
      ${kpi("Reds", reds, "Entradas negativas", "red")}
    </div>

    <div class="section-grid">
      <div class="card panel">
        <div class="panel-head">
          <div>
            <h2>Resultado por dia</h2>
            <p class="panel-subtitle">Evolução do lucro fechado por data.</p>
          </div>
        </div>
        <div class="dashboard-chart">${renderDailyChart()}</div>
      </div>

      <div class="card panel">
        <div class="panel-head">
          <div>
            <h2>Saldo do dia</h2>
            <p class="panel-subtitle">${state.selectedDate ? dateBR(state.selectedDate) : "Selecione uma data para conciliar banca."}</p>
          </div>
        </div>
        ${renderBalanceSummary(selectedBalance)}
      </div>
    </div>

    <div class="section-grid">
      <div class="card panel">
        <div class="panel-head">
          <div>
            <h2>Resultados</h2>
            <p class="panel-subtitle">Distribuição das operações no filtro atual.</p>
          </div>
        </div>
        ${renderResultBars(bets)}
      </div>

      <div class="card panel">
        <div class="panel-head">
          <div>
            <h2>Top jogadores</h2>
            <p class="panel-subtitle">Lucro fechado por jogador.</p>
          </div>
        </div>
        ${renderPlayerRanking(closed)}
      </div>
    </div>

    <div class="card panel" style="margin-top:16px">
      <div class="panel-head">
        <div>
          <h2>Contas</h2>
          <p class="panel-subtitle">Stake, lucro fechado e exposição aberta por conta.</p>
        </div>
      </div>
      ${renderAccountBreakdown(bets)}
    </div>

    <div class="card panel" style="margin-top:16px">
      <div class="panel-head">
        <div>
          <h2>Últimas operações</h2>
          <p class="panel-subtitle">Atalho para revisar as entradas mais recentes.</p>
        </div>
        <button class="ghost" data-action="go-bets">Ver apostas</button>
      </div>
      ${renderLatestBets()}
    </div>
  `;

  root.querySelector('[data-action="go-bets"]')?.addEventListener("click", () => setView("bets"));
}

function kpi(label, value, hint, tone) {
  return `
    <div class="card kpi ${tone || ""}">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="hint">${hint}</div>
    </div>
  `;
}

function renderBalanceSummary(balance) {
  if (!state.selectedDate) {
    return `<div class="empty-state"><div><strong>Visão geral ativa</strong><p>Escolha uma data para ver banca inicial, final e resultado do dia.</p></div></div>`;
  }
  if (!balance) {
    return `<div class="empty-state"><div><strong>Nenhum saldo lançado</strong><p>Vá em Saldo do Dia e cadastre a banca para ${dateBR(state.selectedDate)}.</p></div></div>`;
  }
  const initial = num(balance.initial);
  const deposits = num(balance.deposits);
  const withdrawals = num(balance.withdrawals);
  const finalBank = num(balance.final);
  const resultDay = finalBank + withdrawals - initial - deposits;
  const roi = initial + deposits ? resultDay / (initial + deposits) : 0;
  const dayTotals = totalsForDate(balance.date);
  const betsResult = dayTotals.profit;
  return `
    <div class="mini-grid">
      ${mini("Banca inicial", money(initial))}
      ${mini("Banca final", money(finalBank))}
      ${mini("Resultado dia", `<span class="${resultDay >= 0 ? "good" : "bad"}">${money(resultDay)}</span>`)}
      ${mini("ROI dia", pct(roi))}
      ${mini("Lucro apostas", money(betsResult))}
      ${mini("Diferença banca x apostas", money(resultDay - betsResult))}
      ${mini("Em aberto", money(dayTotals.openStake))}
      ${mini("Cashout atual", dayTotals.openWithCashout ? money(dayTotals.liveCashout) : "-")}
    </div>
  `;
}

function mini(label, value) {
  return `<div class="mini"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderDailyChart() {
  const days = [...new Set([...state.bets.map((b) => b.date), ...state.balances.map((b) => b.date)])]
    .filter(Boolean)
    .sort()
    .slice(-14);
  if (!days.length) return `<div class="chart-empty">Sem dados ainda. Adicione apostas para ver o gráfico.</div>`;
  const data = days.map((date) => ({ date, profit: totalsForDate(date).profit }));
  const width = 760;
  const height = 260;
  const pad = 34;
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.profit)));
  const zeroY = height / 2;
  const band = (width - pad * 2) / data.length;
  const bars = data.map((d, i) => {
    const x = pad + i * band + band * 0.2;
    const barW = band * 0.6;
    const barH = Math.abs(d.profit) / maxAbs * (height / 2 - 30);
    const y = d.profit >= 0 ? zeroY - barH : zeroY;
    const fill = d.profit >= 0 ? "#10B981" : "#EF4444";
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="5" fill="${fill}"></rect>
      <text x="${x + barW / 2}" y="${height - 10}" text-anchor="middle" font-size="10" fill="#667085">${d.date.slice(5)}</text>
    `;
  }).join("");
  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Lucro por dia">
      <line x1="${pad}" y1="${zeroY}" x2="${width - pad}" y2="${zeroY}" stroke="#CBD5E1" stroke-width="1"></line>
      ${bars}
      <text x="${pad}" y="18" font-size="11" fill="#667085">Lucro</text>
    </svg>
  `;
}

function renderResultBars(bets) {
  const labels = ["Duplo Green", "Cashout + Under", "Cashout + Over", "Cashout", "Só Under", "Só Over", "Red", "Aberta"];
  const counts = labels.map((label) => ({
    label,
    count: bets.filter((b) => computeBet(b).status === label).length,
  }));
  const max = Math.max(1, ...counts.map((d) => d.count));
  return `
    <div class="bars">
      ${counts.map((d) => `
        <div class="bar-row">
          <span>${d.label}</span>
          <div class="bar-track">
            <div class="bar-fill ${classForStatus(d.label)}" style="width:${(d.count / max) * 100}%"></div>
          </div>
          <strong>${d.count}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderPlayerRanking(closed) {
  const map = new Map();
  closed.forEach((b) => {
    const current = map.get(b.player) || { player: b.player, profit: 0, count: 0 };
    current.profit += computeBet(b).profit || 0;
    current.count += 1;
    map.set(b.player, current);
  });
  const rows = [...map.values()].sort((a, b) => b.profit - a.profit).slice(0, 8);
  if (!rows.length) return `<div class="chart-empty">Sem apostas fechadas ainda.</div>`;
  return `
    <table class="table-lite">
      <thead><tr><th>Jogador</th><th>Entradas</th><th>Lucro</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr><td>${r.player}</td><td>${r.count}</td><td class="${r.profit >= 0 ? "good" : "bad"}">${money(r.profit)}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderAccountBreakdown(bets) {
  const map = new Map(accounts().map((name) => [name, {
    name,
    closedStake: 0,
    closedReturn: 0,
    openStake: 0,
    liveCashout: 0,
    liveCount: 0,
  }]));

  function addSide(account, stake, result, returnValue, liveCashout) {
    if (!account) return;
    const row = map.get(account) || {
      name: account,
      closedStake: 0,
      closedReturn: 0,
      openStake: 0,
      liveCashout: 0,
      liveCount: 0,
    };
    if (result === "Aberta") {
      row.openStake += stake;
      if (liveCashout > 0) {
        row.liveCashout += liveCashout;
        row.liveCount += 1;
      }
    } else {
      row.closedStake += stake;
      row.closedReturn += returnValue;
    }
    map.set(account, row);
  }

  bets.forEach((b) => {
    const c = computeBet(b);
    addSide(b.accountOver, num(b.stakeOver), b.resultOver || "Aberta", c.overReturn, num(b.liveCashoutOver));
    addSide(b.accountUnder, num(b.stakeUnder), b.resultUnder || "Aberta", c.underReturn, num(b.liveCashoutUnder));
  });

  const rows = [...map.values()].filter((r) => r.closedStake || r.closedReturn || r.openStake || r.liveCashout);
  if (!rows.length) return `<div class="chart-empty">Sem movimentação nas contas ainda.</div>`;

  return `
    <table class="table-lite">
      <thead><tr><th>Conta</th><th>Stake fechado</th><th>Retorno fechado</th><th>Lucro fechado</th><th>Em aberto</th><th>Cashout atual</th></tr></thead>
      <tbody>
        ${rows.map((r) => {
          const profit = r.closedReturn - r.closedStake;
          return `
            <tr>
              <td>${r.name}</td>
              <td>${money(r.closedStake)}</td>
              <td>${money(r.closedReturn)}</td>
              <td class="${profit >= 0 ? "good" : "bad"}">${money(profit)}</td>
              <td>${money(r.openStake)}</td>
              <td>${r.liveCount ? money(r.liveCashout) : "-"}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderLatestBets() {
  const latest = [...state.bets].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 5);
  if (!latest.length) return `<div class="empty-state"><div><strong>Nenhuma aposta cadastrada</strong><p>Clique em Nova aposta para registrar a primeira operação.</p></div></div>`;
  return `
    <table class="table-lite">
      <thead><tr><th>Data</th><th>Jogo</th><th>Jogador</th><th>Linha</th><th>Status</th><th>Lucro</th></tr></thead>
      <tbody>
        ${latest.map((b) => {
          const c = computeBet(b);
          return `<tr><td>${dateBR(b.date)}</td><td>${b.game}</td><td>${b.player}</td><td>${b.line}</td><td><span class="pill ${classForStatus(c.status)}">${c.status}</span></td><td>${c.profit === null ? "-" : money(c.profit)}</td></tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderBets() {
  const root = $("#view-bets");
  const bets = filteredBets();
  root.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <label>Buscar<input id="betSearch" placeholder="Jogador, jogo, time..." /></label>
        <label>Status
          <select id="statusFilter">
            <option value="">Todos</option>
            <option>Aberta</option>
            <option>Duplo Green</option>
            <option>Cashout + Under</option>
            <option>Cashout + Over</option>
            <option>Cashout</option>
            <option>Red</option>
            <option>Só Under</option>
            <option>Só Over</option>
          </select>
        </label>
      </div>
      <button class="primary" id="addBetFromList">Nova aposta</button>
    </div>
    <div id="betsList"></div>
  `;
  $("#addBetFromList").addEventListener("click", () => openBetDrawer());
  $("#betSearch").addEventListener("input", renderBetsList);
  $("#statusFilter").addEventListener("change", renderBetsList);
  renderBetsList(bets);
}

function renderBetsList() {
  const root = $("#betsList");
  if (!root) return;
  const query = ($("#betSearch")?.value || "").toLowerCase();
  const statusFilter = $("#statusFilter")?.value || "";
  let bets = filteredBets();
  if (query) {
    bets = bets.filter((b) => [b.player, b.game, b.team, b.substitute, b.notes].join(" ").toLowerCase().includes(query));
  }
  if (statusFilter) {
    bets = bets.filter((b) => computeBet(b).status === statusFilter);
  }
  bets = bets.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (!bets.length) {
    root.innerHTML = `<div class="empty-state"><div><strong>Nenhuma aposta no filtro</strong><p>Adicione uma operação ou mude os filtros.</p></div></div>`;
    return;
  }
  root.innerHTML = `
    <div class="bets-grid">
      ${bets.map(renderBetCard).join("")}
    </div>
  `;
  root.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openBetDrawer(btn.dataset.edit));
  });
}

function renderBetCard(b) {
  const c = computeBet(b);
  return `
    <article class="card bet-card">
      <div class="bet-top">
        <div>
          <div class="bet-player">${b.player || "-"}</div>
          <div class="meta">${dateBR(b.date)} · ${b.game || "-"}</div>
        </div>
        <span class="pill ${classForStatus(c.status)}">${c.status}</span>
      </div>
      <div class="mini-grid">
        ${mini("Linha", `${b.market || "Chutes"} ${b.line || "-"}`)}
        ${mini("Tipo", b.type || "-")}
        ${mini("Stake", money(c.stakeTotal))}
        ${mini("Lucro Real", c.profit === null ? "-" : `<span class="${c.profit >= 0 ? "good" : "bad"}">${money(c.profit)}</span>`)}
        ${mini("Em aberto", money(c.openStake))}
        ${mini("Cash agora", c.liveCashoutTotal === null ? "-" : money(c.liveCashoutTotal))}
        ${mini("P/L cash", c.cashoutProfitNow === null ? "-" : `<span class="${c.cashoutProfitNow >= 0 ? "good" : "bad"}">${money(c.cashoutProfitNow)}</span>`)}
        ${mini("DG Potencial", money(c.doubleProfit))}
        ${mini("Prob. Min.", pct(c.minDoubleRate))}
      </div>
      <div class="meta">Over ${b.oddOver || "-"} / Under ${b.oddUnder || "-"} · ${b.resultOver || "Aberta"} / ${b.resultUnder || "Aberta"}</div>
      <div class="bet-actions">
        <button class="ghost" data-edit="${b.id}">Editar</button>
      </div>
    </article>
  `;
}

function renderBalances() {
  const root = $("#view-balances");
  const rows = [...state.balances].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  root.innerHTML = `
    <div class="card panel">
      <div class="panel-head">
        <div>
          <h2>Lançar saldo</h2>
          <p class="panel-subtitle">Use uma linha por dia para conciliar banca inicial e final.</p>
        </div>
      </div>
      <form class="balance-form" id="balanceForm">
        <input type="hidden" id="balanceId" />
        <label>Data<input type="date" id="balanceDate" required /></label>
        <label>Banca inicial<input type="number" step="0.01" id="balanceInitial" required /></label>
        <label>Depósitos<input type="number" step="0.01" id="balanceDeposits" /></label>
        <label>Saques<input type="number" step="0.01" id="balanceWithdrawals" /></label>
        <label>Banca final<input type="number" step="0.01" id="balanceFinal" required /></label>
        <label class="wide">Observações<input id="balanceNotes" placeholder="Resumo do dia, pendências, saques..." /></label>
        <button type="submit" class="primary">Salvar saldo</button>
        <button type="button" class="ghost" id="clearBalanceForm">Limpar</button>
      </form>
    </div>
    <div class="balance-list" style="margin-top:16px">
      ${rows.length ? rows.map(renderBalanceCard).join("") : `<div class="empty-state"><div><strong>Nenhum saldo cadastrado</strong><p>Cadastre a banca inicial e final de cada dia.</p></div></div>`}
    </div>
  `;
  $("#balanceForm").addEventListener("submit", saveBalanceFromForm);
  $("#clearBalanceForm").addEventListener("click", resetBalanceForm);
  root.querySelectorAll("[data-edit-balance]").forEach((btn) => btn.addEventListener("click", () => editBalance(btn.dataset.editBalance)));
  root.querySelectorAll("[data-delete-balance]").forEach((btn) => btn.addEventListener("click", () => deleteBalance(btn.dataset.deleteBalance)));
  resetBalanceForm(false);
}

function renderBalanceCard(b) {
  const initial = num(b.initial);
  const deposits = num(b.deposits);
  const withdrawals = num(b.withdrawals);
  const finalBank = num(b.final);
  const resultDay = finalBank + withdrawals - initial - deposits;
  const betsProfit = totalsForDate(b.date).profit;
  return `
    <article class="card balance-card">
      <div>
        <strong>${dateBR(b.date)}</strong>
        <div class="meta">${b.notes || "Sem observação"}</div>
      </div>
      ${mini("Inicial", money(initial))}
      ${mini("Final", money(finalBank))}
      ${mini("Resultado", `<span class="${resultDay >= 0 ? "good" : "bad"}">${money(resultDay)}</span>`)}
      ${mini("Apostas", money(betsProfit))}
      <div class="bet-actions">
        <button class="ghost" data-edit-balance="${b.id}">Editar</button>
        <button class="danger-soft" data-delete-balance="${b.id}">Excluir</button>
      </div>
    </article>
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function supabaseSchemaSql() {
  return `create table if not exists public.dg_tracker_user_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.dg_tracker_user_snapshots enable row level security;

drop policy if exists "dg_user_snapshots_select_own" on public.dg_tracker_user_snapshots;
drop policy if exists "dg_user_snapshots_insert_own" on public.dg_tracker_user_snapshots;
drop policy if exists "dg_user_snapshots_update_own" on public.dg_tracker_user_snapshots;
drop policy if exists "dg_user_snapshots_delete_own" on public.dg_tracker_user_snapshots;

create policy "dg_user_snapshots_select_own"
on public.dg_tracker_user_snapshots
for select
to authenticated
using (auth.uid() = user_id);

create policy "dg_user_snapshots_insert_own"
on public.dg_tracker_user_snapshots
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "dg_user_snapshots_update_own"
on public.dg_tracker_user_snapshots
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "dg_user_snapshots_delete_own"
on public.dg_tracker_user_snapshots
for delete
to authenticated
using (auth.uid() = user_id);

do $$
begin
  if to_regclass('public.dg_tracker_snapshots') is not null then
    execute 'drop policy if exists "dg_tracker_snapshots_anon_all" on public.dg_tracker_snapshots';
  end if;
end $$;

select pg_notify('pgrst', 'reload schema');`;
}

function renderConfig() {
  const root = $("#view-config");
  root.innerHTML = `
    <div class="config-grid">
      <div class="card config-card">
        <h2>Contas</h2>
        <p class="panel-subtitle">Nomes usados nos selects de over/under.</p>
        <form id="settingsForm">
          <label>Conta A<input id="accountA" value="${escapeHtml(state.settings.accountA || "")}" /></label>
          <label>Conta B<input id="accountB" value="${escapeHtml(state.settings.accountB || "")}" /></label>
          <label>Outra<input id="accountOther" value="${escapeHtml(state.settings.accountOther || "")}" /></label>
          <button class="primary">Salvar config</button>
        </form>
      </div>

      <div class="card config-card">
        <h2>Backup</h2>
        <p class="panel-subtitle">Exporta/importa tudo que está salvo no navegador.</p>
        <div class="grid" style="margin-top:14px">
          <button class="ghost" id="exportData">Exportar JSON</button>
          <label>Importar JSON<textarea id="importJson" rows="5" placeholder="Cole o JSON exportado aqui"></textarea></label>
          <button class="primary" id="importData">Importar dados</button>
          <button class="danger-soft" id="resetData">Apagar tudo</button>
        </div>
      </div>

      <div class="card config-card">
        <h2>Conta e nuvem</h2>
        <p class="panel-subtitle">${escapeHtml(currentUser?.email || "Nenhuma conta conectada.")}</p>
        <div class="grid" style="margin-top:14px">
          <button class="ghost" id="pushSupabase">Salvar agora na nuvem</button>
          <button class="ghost" id="pullSupabase">Carregar minha nuvem</button>
          <button class="danger-soft" id="logoutFromConfig">Sair da conta</button>
          <label>Tabela<input readonly value="${escapeHtml(USER_SNAPSHOTS_TABLE)}" /></label>
          <label>SQL de contas<textarea rows="18" readonly>${escapeHtml(supabaseSchemaSql())}</textarea></label>
          <div class="sync-status" id="supabaseStatus">Status: ${supabaseConfigured() ? "configurado" : "aguardando URL e chave"}</div>
        </div>
      </div>
    </div>
  `;
  $("#settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings.accountA = $("#accountA").value.trim() || "Conta A";
    state.settings.accountB = $("#accountB").value.trim() || "Conta B";
    state.settings.accountOther = $("#accountOther").value.trim() || "Outra";
    saveState();
    populateAccountSelects();
    render();
  });
  $("#exportData").addEventListener("click", exportData);
  $("#importData").addEventListener("click", importData);
  $("#resetData").addEventListener("click", resetData);
  $("#pushSupabase").addEventListener("click", pushSupabaseState);
  $("#pullSupabase").addEventListener("click", pullSupabaseState);
  $("#logoutFromConfig").addEventListener("click", signOut);
}

function supabaseConfigured() {
  return Boolean(
    state.settings.supabaseUrl &&
    state.settings.supabaseAnonKey
  );
}

function setSupabaseStatus(message, tone = "") {
  const el = $("#supabaseStatus");
  if (!el) return;
  el.textContent = `Status: ${message}`;
  el.className = `sync-status ${tone}`;
}

function getSupabaseClient() {
  if (!supabaseConfigured()) {
    throw new Error("Configure URL, anon key, tabela e Sync ID do Supabase primeiro.");
  }
  if (!window.supabase?.createClient) {
    throw new Error("Biblioteca do Supabase não carregou. Verifique a conexão e recarregue a página.");
  }
  if (
    !supabaseClient ||
    supabaseClient.__dgUrl !== state.settings.supabaseUrl ||
    supabaseClient.__dgKey !== state.settings.supabaseAnonKey
  ) {
    supabaseClient = window.supabase.createClient(state.settings.supabaseUrl, state.settings.supabaseAnonKey);
    supabaseClient.__dgUrl = state.settings.supabaseUrl;
    supabaseClient.__dgKey = state.settings.supabaseAnonKey;
  }
  return supabaseClient;
}

function queueCloudSave() {
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    pushSupabaseState({ silent: true });
  }, 900);
}

async function pushSupabaseState(options = {}) {
  const { silent = false } = options;
  try {
    if (!currentUser) throw new Error("Entre na sua conta primeiro.");
    if (!silent) setSupabaseStatus("salvando na nuvem...", "amber");
    const client = getSupabaseClient();
    const payload = normalizeState(state);
    const { error } = await client
      .from(USER_SNAPSHOTS_TABLE)
      .upsert({
        user_id: currentUser.id,
        payload,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
    if (error) throw error;
    if (!silent) setSupabaseStatus("dados salvos na nuvem", "green");
  } catch (error) {
    if (silent) console.warn("Falha no autosave Supabase:", error);
    else setSupabaseStatus(error.message || "erro ao salvar", "red");
  }
}

async function pullSupabaseState(options = {}) {
  const { confirmFirst = true, silent = false } = options;
  try {
    if (!currentUser) throw new Error("Entre na sua conta primeiro.");
    const ok = !confirmFirst || confirm("Carregar dados da nuvem e substituir os dados locais deste navegador?");
    if (!ok) return false;
    if (!silent) setSupabaseStatus("carregando dados...", "amber");
    const client = getSupabaseClient();
    const { data, error } = await client
      .from(USER_SNAPSHOTS_TABLE)
      .select("payload, updated_at")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (error) throw error;
    if (!data?.payload) {
      if (!silent) setSupabaseStatus("nenhum backup encontrado para esta conta", "amber");
      return false;
    }
    const currentSupabaseSettings = {
      supabaseUrl: state.settings.supabaseUrl,
      supabaseAnonKey: state.settings.supabaseAnonKey,
      supabaseTable: USER_SNAPSHOTS_TABLE,
      supabaseSyncId: "",
    };
    restoringFromCloud = true;
    state = normalizeState(data.payload);
    state.settings = {
      ...state.settings,
      ...currentSupabaseSettings,
    };
    saveState({ cloud: false });
    restoringFromCloud = false;
    activateView(state.activeView || "dashboard");
    render();
    if (!silent) setSupabaseStatus(`dados carregados (${new Date(data.updated_at).toLocaleString("pt-BR")})`, "green");
    return true;
  } catch (error) {
    restoringFromCloud = false;
    if (!silent) setSupabaseStatus(error.message || "erro ao carregar", "red");
    else console.warn("Falha ao carregar Supabase:", error);
    return false;
  }
}

function setAuthStatus(message, tone = "") {
  const el = $("#authStatus");
  if (!el) return;
  el.textContent = message;
  el.className = `sync-status ${tone}`;
}

function showAuthScreen(show) {
  $("#authScreen").hidden = !show;
  $("#appShell").hidden = show;
}

function renderUserBadge() {
  const email = currentUser?.email || "-";
  $("#userEmail").textContent = email;
}

async function enterAuthenticatedApp(user) {
  currentUser = user;
  authReady = true;
  state = loadStateForUser(user);
  showAuthScreen(false);
  renderUserBadge();
  const loadedFromCloud = await pullSupabaseState({ confirmFirst: false, silent: true });
  if (!loadedFromCloud) {
    saveState({ cloud: false });
    activateView(state.activeView || "dashboard");
    render();
    if (hasTrackerData(state)) {
      pushSupabaseState({ silent: true });
    }
  }
}

function leaveAuthenticatedApp() {
  currentUser = null;
  authReady = false;
  clearTimeout(cloudSaveTimer);
  state = normalizeState();
  showAuthScreen(true);
  setAuthStatus("Entre para continuar.");
}

async function signIn(event) {
  event.preventDefault();
  try {
    setAuthStatus("entrando...", "amber");
    const client = getSupabaseClient();
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data?.user && data.user.id !== currentUser?.id) {
      setAuthStatus("conta conectada", "green");
      await enterAuthenticatedApp(data.user);
    }
  } catch (error) {
    setAuthStatus(error.message || "erro ao entrar", "red");
  }
}

async function createAccount() {
  try {
    setAuthStatus("criando conta...", "amber");
    const client = getSupabaseClient();
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    if (!email || password.length < 6) {
      throw new Error("Preencha email e senha com pelo menos 6 caracteres.");
    }
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) throw error;
    if (data?.session?.user && data.session.user.id !== currentUser?.id) {
      setAuthStatus("conta criada", "green");
      await enterAuthenticatedApp(data.session.user);
    } else {
      setAuthStatus("conta criada. Confirme o email para entrar.", "amber");
    }
  } catch (error) {
    setAuthStatus(error.message || "erro ao criar conta", "red");
  }
}

async function resetPassword() {
  try {
    const email = $("#authEmail").value.trim();
    if (!email) throw new Error("Digite o email primeiro.");
    setAuthStatus("enviando recuperação...", "amber");
    const client = getSupabaseClient();
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
    setAuthStatus("email de recuperação enviado", "green");
  } catch (error) {
    setAuthStatus(error.message || "erro ao recuperar senha", "red");
  }
}

async function signOut() {
  const client = getSupabaseClient();
  await pushSupabaseState({ silent: true });
  await client.auth.signOut();
  leaveAuthenticatedApp();
}

function populateAccountSelects() {
  ["#betAccountOver", "#betAccountUnder"].forEach((selector) => {
    const current = $(selector).value;
    $(selector).innerHTML = accounts().map((acc) => `<option>${acc}</option>`).join("");
    if (current) $(selector).value = current;
  });
}

function openBetDrawer(id) {
  populateAccountSelects();
  const bet = id ? state.bets.find((b) => b.id === id) : null;
  $("#drawerTitle").textContent = bet ? "Editar aposta" : "Nova aposta";
  $("#betId").value = bet?.id || "";
  $("#betDate").value = bet?.date || state.selectedDate || new Date().toISOString().slice(0, 10);
  $("#betGame").value = bet?.game || "";
  $("#betPlayer").value = bet?.player || "";
  $("#betTeam").value = bet?.team || "";
  $("#betLine").value = bet?.line || "";
  $("#betMarket").value = bet?.market || "Chutes";
  $("#betType").value = bet?.type || "Normal";
  $("#betAccountOver").value = bet?.accountOver || state.settings.accountA;
  $("#betAccountUnder").value = bet?.accountUnder || state.settings.accountB;
  $("#betOddOver").value = bet?.oddOver || "";
  $("#betOddUnder").value = bet?.oddUnder || "";
  $("#betStakeOver").value = bet?.stakeOver || "";
  $("#betStakeUnder").value = bet?.stakeUnder || "";
  $("#betResultOver").value = bet?.resultOver || "Aberta";
  $("#betResultUnder").value = bet?.resultUnder || "Aberta";
  $("#betCashoutOver").value = bet?.cashoutOver || "";
  $("#betCashoutUnder").value = bet?.cashoutUnder || "";
  $("#betLiveCashoutOver").value = bet?.liveCashoutOver || "";
  $("#betLiveCashoutUnder").value = bet?.liveCashoutUnder || "";
  $("#betSubMinute").value = bet?.subMinute || "";
  $("#betStarterShots").value = bet?.starterShots || "";
  $("#betSubstitute").value = bet?.substitute || "";
  $("#betSubShots").value = bet?.subShots || "";
  $("#betNotes").value = bet?.notes || "";
  $("#deleteBet").style.visibility = bet ? "visible" : "hidden";
  updateBetPreview();
  $("#betDrawer").classList.add("open");
  $("#drawerBackdrop").classList.add("open");
  $("#betDrawer").setAttribute("aria-hidden", "false");
}

function closeBetDrawer() {
  $("#betDrawer").classList.remove("open");
  $("#drawerBackdrop").classList.remove("open");
  $("#betDrawer").setAttribute("aria-hidden", "true");
}

function betFromForm() {
  return {
    id: $("#betId").value || uid(),
    createdAt: $("#betId").value ? (state.bets.find((b) => b.id === $("#betId").value)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    date: $("#betDate").value,
    game: $("#betGame").value.trim(),
    player: $("#betPlayer").value.trim(),
    team: $("#betTeam").value.trim(),
    line: $("#betLine").value,
    market: $("#betMarket").value,
    type: $("#betType").value,
    accountOver: $("#betAccountOver").value,
    accountUnder: $("#betAccountUnder").value,
    oddOver: $("#betOddOver").value,
    oddUnder: $("#betOddUnder").value,
    stakeOver: $("#betStakeOver").value,
    stakeUnder: $("#betStakeUnder").value,
    resultOver: $("#betResultOver").value,
    resultUnder: $("#betResultUnder").value,
    cashoutOver: $("#betCashoutOver").value,
    cashoutUnder: $("#betCashoutUnder").value,
    liveCashoutOver: $("#betLiveCashoutOver").value,
    liveCashoutUnder: $("#betLiveCashoutUnder").value,
    subMinute: $("#betSubMinute").value,
    starterShots: $("#betStarterShots").value,
    substitute: $("#betSubstitute").value.trim(),
    subShots: $("#betSubShots").value,
    notes: $("#betNotes").value.trim(),
  };
}

function updateBetPreview() {
  const bet = betFromForm();
  const c = computeBet(bet);
  $("#betPreview").innerHTML = `
    <div class="mini-grid">
      ${mini("Stake total", money(c.stakeTotal))}
      ${mini("DG potencial", money(c.doubleProfit))}
      ${mini("Só under", money(c.onlyUnder))}
      ${mini("Só over", money(c.onlyOver))}
      ${mini("Em aberto", money(c.openStake))}
      ${mini("Cashout atual", c.liveCashoutTotal === null ? "Sem dados" : money(c.liveCashoutTotal))}
      ${mini("P/L cash agora", c.cashoutProfitNow === null ? "Sem dados" : `<span class="${c.cashoutProfitNow >= 0 ? "good" : "bad"}">${money(c.cashoutProfitNow)}</span>`)}
      ${mini("Prob. DG min.", pct(c.minDoubleRate))}
      ${mini("Lucro real", c.profit === null ? "Em aberto" : money(c.profit))}
    </div>
  `;
}

function saveBet(event) {
  event.preventDefault();
  const bet = betFromForm();
  const idx = state.bets.findIndex((b) => b.id === bet.id);
  if (idx >= 0) state.bets[idx] = bet;
  else state.bets.unshift(bet);
  state.selectedDate = bet.date || state.selectedDate;
  saveState();
  closeBetDrawer();
  render();
}

function deleteCurrentBet() {
  const id = $("#betId").value;
  if (!id) return;
  const ok = confirm("Excluir esta aposta?");
  if (!ok) return;
  state.bets = state.bets.filter((b) => b.id !== id);
  saveState();
  closeBetDrawer();
  render();
}

function resetBalanceForm(useSelected = true) {
  $("#balanceId").value = "";
  $("#balanceDate").value = useSelected ? (state.selectedDate || new Date().toISOString().slice(0, 10)) : "";
  $("#balanceInitial").value = "";
  $("#balanceDeposits").value = "";
  $("#balanceWithdrawals").value = "";
  $("#balanceFinal").value = "";
  $("#balanceNotes").value = "";
}

function saveBalanceFromForm(event) {
  event.preventDefault();
  const balance = {
    id: $("#balanceId").value || uid(),
    date: $("#balanceDate").value,
    initial: $("#balanceInitial").value,
    deposits: $("#balanceDeposits").value,
    withdrawals: $("#balanceWithdrawals").value,
    final: $("#balanceFinal").value,
    notes: $("#balanceNotes").value.trim(),
    updatedAt: new Date().toISOString(),
  };
  const idx = state.balances.findIndex((b) => b.id === balance.id || b.date === balance.date);
  if (idx >= 0) state.balances[idx] = { ...state.balances[idx], ...balance };
  else state.balances.push(balance);
  state.selectedDate = balance.date;
  saveState();
  render();
}

function editBalance(id) {
  const b = state.balances.find((item) => item.id === id);
  if (!b) return;
  $("#balanceId").value = b.id;
  $("#balanceDate").value = b.date;
  $("#balanceInitial").value = b.initial || "";
  $("#balanceDeposits").value = b.deposits || "";
  $("#balanceWithdrawals").value = b.withdrawals || "";
  $("#balanceFinal").value = b.final || "";
  $("#balanceNotes").value = b.notes || "";
}

function deleteBalance(id) {
  if (!confirm("Excluir este saldo do dia?")) return;
  state.balances = state.balances.filter((b) => b.id !== id);
  saveState();
  render();
}

function exportData() {
  const payload = JSON.stringify(state, null, 2);
  navigator.clipboard?.writeText(payload);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "duplo-green-tracker-backup.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importData() {
  try {
    const parsed = JSON.parse($("#importJson").value);
    state = normalizeState(parsed);
    saveState();
    render();
    alert("Dados importados.");
  } catch {
    alert("JSON inválido.");
  }
}

function resetData() {
  const ok = confirm("Apagar todas as apostas e saldos deste navegador?");
  if (!ok) return;
  state = normalizeState();
  saveState();
  render();
}

async function boot() {
  $("#globalDate").value = state.selectedDate || "";
  $("#globalDate").addEventListener("change", (event) => {
    state.selectedDate = event.target.value;
    saveState();
    render();
  });
  $("#clearDate").addEventListener("click", () => {
    state.selectedDate = "";
    saveState();
    render();
  });
  $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
  $("#quickAddBet").addEventListener("click", () => openBetDrawer());
  $("#closeDrawer").addEventListener("click", closeBetDrawer);
  $("#drawerBackdrop").addEventListener("click", closeBetDrawer);
  $("#betForm").addEventListener("submit", saveBet);
  $("#deleteBet").addEventListener("click", deleteCurrentBet);
  $("#authForm").addEventListener("submit", signIn);
  $("#createAccount").addEventListener("click", createAccount);
  $("#resetPassword").addEventListener("click", resetPassword);
  $("#logoutBtn").addEventListener("click", signOut);
  ["input", "change"].forEach((eventName) => {
    $("#betForm").addEventListener(eventName, updateBetPreview);
  });
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") leaveAuthenticatedApp();
      if (event === "SIGNED_IN" && session?.user && session.user.id !== currentUser?.id) {
        enterAuthenticatedApp(session.user);
      }
    });
    if (data?.session?.user) {
      await enterAuthenticatedApp(data.session.user);
    } else {
      leaveAuthenticatedApp();
    }
  } catch (error) {
    showAuthScreen(true);
    setAuthStatus(error.message || "erro ao iniciar login", "red");
  }
}

boot();
