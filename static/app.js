const $ = (id) => document.getElementById(id);
const KEY_LS = "marionette_light_api_key";
const GRAPH_LS = "marionette_light_last_graph";
const API_LS = "marionette_light_api_base";

function apiBase() {
  const fromLs = (localStorage.getItem(API_LS) || "").trim().replace(/\/$/, "");
  if (fromLs) return fromLs;
  const fromWin = (window.MARIONETTE_API || "").trim().replace(/\/$/, "");
  if (fromWin) return fromWin;
  return "";
}

function apiUrl(path) {
  const base = apiBase();
  const p = path.startsWith("/") ? path : "/" + path;
  return base ? base + p : p;
}

const KIND_COLOR = {
  Seed: "#5b9fd4",
  Controller: "#e0b34a",
  Safe: "#a78bdb",
  Signer: "#5dcaa0",
  Funder: "#e07a96",
  Contract: "#6d7c78",
};
const KIND_SHAPE = {
  Seed: "diamond",
  Controller: "dot",
  Safe: "hexagon",
  Signer: "triangle",
  Funder: "square",
  Contract: "dot",
};
const REL_COLOR = {
  DEPLOYED: "#e08a3c",
  ADMIN_OF: "#e0b34a",
  SIGNER_OF: "#5dcaa0",
  FUNDED: "#e07a96",
  IMPLEMENTATION_OF: "#6b7380",
  SAME_AS: "#5b9fd4",
};
const REL_LABEL = {
  DEPLOYED: "deployed",
  ADMIN_OF: "admins",
  SIGNER_OF: "signs",
  FUNDED: "funded",
  IMPLEMENTATION_OF: "implements",
  SAME_AS: "same",
};
const CHAIN_NAME = {
  1: "Ethereum",
  56: "BNB",
  137: "Polygon",
  42161: "Arbitrum",
  8453: "Base",
  10: "Optimism",
  11155111: "Sepolia",
  97: "BNB Testnet",
  80002: "Amoy",
  421614: "Arb Sepolia",
  84532: "Base Sepolia",
  11155420: "OP Sepolia",
};
const STRATA = ["Funder", "Signer", "Controller", "Contract"];
const PANEL_LS = "marionette_light_panels";
const TESTNET_LS = "marionette_light_testnets";

function kindLabel(kind) {
  return kind === "Seed" ? "Contract" : kind || "Address";
}

let network = null;
let nodeSet = null;
let edgeSet = null;
let lastResult = null;
let selectedId = null;
let planeMeta = [];
let userPos = {};
let lastLayout = {};
let dragging = false;
let handsChainFilter = "all";
let lastEmpireRows = [];

function shortAddr(addr) {
  const hex = (addr || "").split("@")[0];
  if (!hex || hex.length < 12) return addr;
  return hex.slice(0, 6) + "…" + hex.slice(-4);
}
function visId(n) {
  return n.id || n.addr;
}
function nodeAddr(n) {
  return (n && (n.addr || String(n.id || "").split("@")[0])) || "";
}
function chainOf(n) {
  return Number(n.chain || (lastResult && lastResult.chainid) || $("chainid").value || 1);
}
function scanUrl(addr, chain) {
  const hosts = {
    1: "https://etherscan.io/address/",
    56: "https://bscscan.com/address/",
    137: "https://polygonscan.com/address/",
    42161: "https://arbiscan.io/address/",
    8453: "https://basescan.org/address/",
    10: "https://optimistic.etherscan.io/address/",
    11155111: "https://sepolia.etherscan.io/address/",
    97: "https://testnet.bscscan.com/address/",
    80002: "https://amoy.polygonscan.com/address/",
    421614: "https://sepolia.arbiscan.io/address/",
    84532: "https://sepolia.basescan.org/address/",
    11155420: "https://sepolia-optimism.etherscan.io/address/",
  };
  return (hosts[String(chain)] || hosts[1]) + addr;
}
function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + (cls || "idle");
}
let toastTimer = null;
function showToast(text) {
  const el = $("toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    toastTimer = null;
  }, 500);
}
function savePanelState() {
  localStorage.setItem(
    PANEL_LS,
    JSON.stringify({
      panel: document.body.classList.contains("panel-collapsed"),
      inspect: document.body.classList.contains("inspect-collapsed"),
    })
  );
}
function loadPanelState() {
  try {
    const raw = localStorage.getItem(PANEL_LS);
    if (!raw) return;
    const st = JSON.parse(raw);
    document.body.classList.toggle("panel-collapsed", !!st.panel);
    document.body.classList.toggle("inspect-collapsed", !!st.inspect);
  } catch (_) {}
  syncRailLabels();
}
function syncRailLabels() {
  const left = $("togglePanel");
  const right = $("toggleInspect");
  if (left) left.textContent = document.body.classList.contains("panel-collapsed") ? "▶" : "◀";
  if (right) right.textContent = document.body.classList.contains("inspect-collapsed") ? "◀" : "▶";
}
let panelResizeTimer = null;
let resizingNetwork = false;

function resizeNetwork(fit) {
  if (!network || resizingNetwork) return;
  const el = $("graph");
  if (!el) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (!w || !h) return;
  resizingNetwork = true;
  try {
    // Keep camera — fit() on panel toggle is what blanked the nodes
    const scale = network.getScale();
    const pos = network.getViewPosition();
    network.setSize(w + "px", h + "px");
    if (fit) {
      network.fit({ animation: false });
    } else if (pos && scale) {
      network.moveTo({ position: pos, scale, animation: false });
    }
    network.redraw();
  } catch (_) {
    try {
      network.setSize(w + "px", h + "px");
      network.redraw();
    } catch (__) {}
  } finally {
    resizingNetwork = false;
  }
}

let graphResizeObs = null;
function watchGraphSize() {
  const el = $("graph");
  if (!el || graphResizeObs) return;
  let t = null;
  graphResizeObs = new ResizeObserver(() => {
    if (t) clearTimeout(t);
    // Debounce past CSS grid transition (~180ms)
    t = setTimeout(() => resizeNetwork(false), 220);
  });
  graphResizeObs.observe(el);
  window.addEventListener("resize", () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => resizeNetwork(false), 220);
  });
}

function afterPanelToggle() {
  syncRailLabels();
  savePanelState();
  if (panelResizeTimer) clearTimeout(panelResizeTimer);
  panelResizeTimer = setTimeout(() => resizeNetwork(false), 220);
}
function saveKey() {
  localStorage.setItem(KEY_LS, $("apiKey").value.trim());
}
function loadKey() {
  const k = localStorage.getItem(KEY_LS) || "";
  if (k) $("apiKey").value = k;
}
function saveGraph(data) {
  try {
    localStorage.setItem(GRAPH_LS, JSON.stringify({ nodes: data.nodes, edges: data.edges, chainid: data.chainid }));
  } catch (_) {}
}
function graphPayload() {
  if (!lastResult) return null;
  return { nodes: lastResult.nodes, edges: lastResult.edges, chainid: lastResult.chainid };
}

function nodeBy(id) {
  const nodes = (lastResult && lastResult.nodes) || [];
  return nodes.find((n) => visId(n) === id) || nodes.find((n) => n.addr === id) || null;
}
function empireFor(id) {
  return ((lastResult && lastResult.empire) || []).find((r) => r.controller === id) || null;
}
function factsFor(id) {
  const edges = (lastResult && lastResult.edges) || [];
  return {
    out: edges.filter((e) => e.from === id),
    inn: edges.filter((e) => e.to === id),
  };
}
function focusForScan() {
  if (!selectedId || !lastResult) return "";
  const node = nodeBy(selectedId);
  if (!node) return String(selectedId).split("@")[0];
  const home = Number(lastResult.chainid || $("chainid").value || 1);
  if (chainOf(node) === home && node.kind !== "Contract") return nodeAddr(node);
  const inn = (lastResult.edges || []).filter(
    (e) => e.to === visId(node) && ["DEPLOYED", "ADMIN_OF", "SIGNER_OF"].includes(e.rel)
  );
  if (inn.length) {
    const src = nodeBy(inn[0].from);
    if (src) return nodeAddr(src);
  }
  return nodeAddr(node);
}
function pickExploreId(fromId, toId) {
  const home = Number((lastResult && lastResult.chainid) || $("chainid").value || 1);
  const fromN = nodeBy(fromId);
  const toN = nodeBy(toId);
  if (toN && chainOf(toN) !== home) return visId(toN);
  if (fromN && chainOf(fromN) !== home) return visId(fromN);
  return toId || fromId;
}

function canExpandSelection() {
  if (!selectedId || !lastResult) return false;
  const node = nodeBy(selectedId);
  if (!node) return false;
  if (node.kind === "Funder") return false;
  if (node.kind === "Contract" && !node.seed) return false;
  return true;
}

function canScanOtherChains() {
  if (!lastResult || !(lastResult.nodes || []).length) return false;
  return (lastResult.nodes || []).some((n) => n.kind !== "Contract" || n.seed);
}

function updateActionButtons(busy) {
  const on = !!busy;
  $("run").disabled = on;
  $("expand").disabled = on || !canExpandSelection();
  $("scanChains").disabled = on || !canScanOtherChains();
  $("copyAddr").disabled = on || !selectedId;
  const scan = $("openScan");
  if (!selectedId) {
    scan.href = "#";
    scan.classList.add("disabled");
  } else {
    scan.classList.remove("disabled");
  }
}

function edgePlain(e, other, outward) {
  const otherLabel = other
    ? `${shortAddr(nodeAddr(other))} · ${kindLabel(other.kind)} on ${CHAIN_NAME[chainOf(other)] || chainOf(other)}`
    : outward
      ? e.to
      : e.from;
  const role = (e.role || "").toLowerCase();
  if (e.rel === "SAME_AS") {
    return `Same address as ${otherLabel}`;
  }
  if (e.rel === "DEPLOYED") {
    return outward ? `Deployed contract ${otherLabel}` : `Contract was deployed by ${otherLabel}`;
  }
  if (e.rel === "ADMIN_OF") {
    if (role.includes("proxy")) {
      return outward ? `Proxy admin of ${otherLabel}` : `Proxy-adminned by ${otherLabel}`;
    }
    if (role.includes("default")) {
      return outward ? `Holds DEFAULT_ADMIN on ${otherLabel}` : `DEFAULT_ADMIN held by ${otherLabel}`;
    }
    return outward ? `Owner / admin of ${otherLabel}` : `Owned / adminned by ${otherLabel}`;
  }
  if (e.rel === "SIGNER_OF") {
    return outward ? `Safe signer on ${otherLabel}` : `Safe signed by ${otherLabel}`;
  }
  if (e.rel === "FUNDED") {
    return outward
      ? `First funded ${otherLabel} (heuristic)`
      : `First funded by ${otherLabel} (heuristic · not control)`;
  }
  if (e.rel === "IMPLEMENTATION_OF") {
    return outward ? `Implementation behind ${otherLabel}` : `Uses implementation ${otherLabel}`;
  }
  return `${REL_LABEL[e.rel] || e.rel}: ${otherLabel}`;
}

function edgeDir(e, outward) {
  if (e.rel === "SAME_AS") return outward ? "identity →" : "← identity";
  if (e.rel === "DEPLOYED") return outward ? "deployed →" : "← deployer";
  if (e.rel === "ADMIN_OF") return outward ? "admins →" : "← admin";
  if (e.rel === "SIGNER_OF") return outward ? "signs →" : "← signer";
  if (e.rel === "FUNDED") return outward ? "funded →" : "← funder";
  if (e.rel === "IMPLEMENTATION_OF") return outward ? "implements →" : "← impl";
  return outward ? `${REL_LABEL[e.rel] || e.rel} →` : `← ${REL_LABEL[e.rel] || e.rel}`;
}

function setInspector(id) {
  selectedId = id;
  const box = $("inspector");
  const list = $("edgeList");
  const scan = $("openScan");
  if (!id) {
    box.className = "inspector idle";
    box.textContent = "Click a node.";
    scan.href = "#";
    list.innerHTML = '<p class="muted">Nothing selected.</p>';
    updateActionButtons(false);
    highlightSelection(null);
    return;
  }
  const node = nodeBy(id);
  const emp = empireFor(id);
  const hex = nodeAddr(node) || String(id).split("@")[0];
  const chain = node ? chainOf(node) : Number($("chainid").value || 1);
  const chainLabel = CHAIN_NAME[chain] || "chain " + chain;
  const twins = ((lastResult && lastResult.nodes) || []).filter((t) => nodeAddr(t) === hex && visId(t) !== id);
  const twinLine = twins.length
    ? `<div>same addr · ${twins.map((t) => `${kindLabel(t.kind)} on ${CHAIN_NAME[chainOf(t)] || chainOf(t)}`).join(" · ")}</div>`
    : "";
  const byChain = (emp && emp.byChain) || {};
  const chainBits = Object.keys(byChain)
    .sort((a, b) => Number(a) - Number(b))
    .map((c) => `${CHAIN_NAME[c] || c}: ${byChain[c]}`)
    .join(" · ");
  box.className = "inspector active";
  box.innerHTML = `
    <div class="addr">${hex}</div>
    <div>${kindLabel(node && node.kind)} · ${chainLabel}</div>
    ${twinLine}
    <div>controls <strong>${emp ? emp.count : 0}</strong>${chainBits ? ` · ${chainBits}` : ""}</div>`;
  scan.href = scanUrl(hex, chain);
  updateActionButtons(false);
  const facts = factsFor(id);
  const rows = [];
  facts.out.forEach((e) => {
    const dst = nodeBy(e.to);
    rows.push(
      `<div class="fact" data-id="${e.to}"><div class="dir">${edgeDir(e, true)}</div><div class="plain">${edgePlain(e, dst, true)}</div><div class="muted">${e.evidence || ""}</div></div>`
    );
  });
  facts.inn.forEach((e) => {
    const src = nodeBy(e.from);
    rows.push(
      `<div class="fact" data-id="${e.from}"><div class="dir">${edgeDir(e, false)}</div><div class="plain">${edgePlain(e, src, false)}</div><div class="muted">${e.evidence || ""}</div></div>`
    );
  });
  list.innerHTML = rows.length ? rows.join("") : '<p class="muted">No edges on this node.</p>';
  if (!dragging) highlightSelection(id);
}

function stratumOf(n) {
  if (n.kind === "Funder") return 0;
  if (n.kind === "Signer") return 1;
  if (n.kind === "Safe" || n.kind === "Controller") return 2;
  return 3;
}

function controlNeighbors(edges) {
  const links = {};
  const add = (a, b) => {
    if (!a || !b || a === b) return;
    if (!links[a]) links[a] = new Set();
    if (!links[b]) links[b] = new Set();
    links[a].add(b);
    links[b].add(a);
  };
  (edges || []).forEach((e) => {
    if (e.rel === "SAME_AS") return;
    add(e.from, e.to);
  });
  return links;
}

function barySort(bucket, refOrder, links) {
  if (bucket.length < 2) return bucket.slice();
  const index = {};
  refOrder.forEach((n, i) => {
    index[visId(n)] = i;
  });
  return bucket
    .slice()
    .sort((a, b) => {
      const avg = (n) => {
        const nbrs = links[visId(n)];
        if (!nbrs || !nbrs.size) return index[visId(n)] != null ? index[visId(n)] : 0;
        let sum = 0;
        let hit = 0;
        nbrs.forEach((id) => {
          if (index[id] == null) return;
          sum += index[id];
          hit += 1;
        });
        return hit ? sum / hit : bucket.indexOf(n);
      };
      const da = avg(a) - avg(b);
      if (Math.abs(da) > 1e-9) return da;
      return (a.addr || "").localeCompare(b.addr || "");
    });
}

function orderBuckets(buckets, edges) {
  const links = controlNeighbors(edges);
  const out = buckets.map((b) =>
    b.slice().sort((a, c) => (a.addr || "").localeCompare(c.addr || ""))
  );
  // Bottom-up then top-down barycenter: fewer crossings on funded/admin edges
  for (let pass = 0; pass < 3; pass++) {
    for (let si = out.length - 2; si >= 0; si--) {
      out[si] = barySort(out[si], out[si + 1], links);
    }
    for (let si = 1; si < out.length; si++) {
      out[si] = barySort(out[si], out[si - 1], links);
    }
  }
  return out;
}

function computePlanes(nodes) {
  const edges = (lastResult && lastResult.edges) || [];
  const chains = [...new Set(nodes.map(chainOf))].sort((a, b) => {
    const home = Number((lastResult && lastResult.chainid) || $("chainid").value || 1);
    if (a === home) return -1;
    if (b === home) return 1;
    return a - b;
  });
  if (!chains.length) chains.push(1);
  const NODE_GAP = 120;
  const ROW = 168;
  const PAD_X = 48;
  const PAD_TOP = 110;
  const PAD_BOT = 72;
  const GAP = 56;
  const pos = {};
  planeMeta = [];
  let xCursor = 0;
  chains.forEach((chain) => {
    const members = nodes.filter((n) => chainOf(n) === chain);
    if (!members.length) return;
    const raw = [[], [], [], []];
    members.forEach((n) => raw[stratumOf(n)].push(n));
    const buckets = orderBuckets(raw, edges);
    const cols = Math.max(1, ...buckets.map((b) => b.length));
    const w = Math.max(220, PAD_X * 2 + cols * NODE_GAP);
    const h = PAD_TOP + 4 * ROW + PAD_BOT;
    planeMeta.push({
      chain,
      label: CHAIN_NAME[chain] || "chain " + chain,
      x0: xCursor,
      y0: 0,
      w,
      h,
    });
    // Marionette: Funder/Signer at top (low y), Seed/Contract at bottom (high y)
    buckets.forEach((bucket, si) => {
      const span = Math.max(bucket.length - 1, 0) * NODE_GAP;
      const startX = xCursor + (w - span) / 2;
      bucket.forEach((n, ri) => {
        pos[visId(n)] = {
          x: startX + ri * NODE_GAP,
          y: PAD_TOP + si * ROW,
        };
      });
    });
    xCursor += w + GAP;
  });
  lastLayout = pos;
  return pos;
}

function nodeVis(n, pos) {
  const color = KIND_COLOR[n.kind] || "#888";
  const placed = userPos[visId(n)] || pos || {};
  const home = Number((lastResult && lastResult.chainid) || $("chainid").value || 1);
  const chain = chainOf(n);
  const chainBit = chain !== home ? " · " + (CHAIN_NAME[chain] || chain) : "";
  return {
    id: visId(n),
    label: shortAddr(nodeAddr(n)) + "\n" + kindLabel(n.kind) + chainBit,
    title: `${nodeAddr(n)}\n${kindLabel(n.kind)} · ${CHAIN_NAME[chain] || chain}`,
    shape: KIND_SHAPE[n.kind] || "dot",
    x: placed.x,
    y: placed.y,
    physics: false,
    color: {
      background: color,
      border: n.wasKnown || n.kind === "Seed" ? "#1c2028" : "#e08a3c",
      highlight: { background: color, border: "#f2efe6" },
      hover: { background: color, border: "#f2efe6" },
    },
    borderWidth: n.wasKnown || n.kind === "Seed" ? 2 : 3,
    font: { color: "#e8edf5", size: 11, face: "Segoe UI", strokeWidth: 4, strokeColor: "#0a0b0e" },
    size: n.seed ? 22 : n.kind === "Controller" ? 18 : 14,
  };
}

function nodeX(id) {
  if (userPos[id] && userPos[id].x != null) return userPos[id].x;
  if (lastLayout[id] && lastLayout[id].x != null) return lastLayout[id].x;
  return 0;
}

function edgeVis(e, i) {
  const col = REL_COLOR[e.rel] || "#6b7380";
  const same = e.rel === "SAME_AS";
  const fromN = nodeBy(e.from);
  const toN = nodeBy(e.to);
  const tip = same
    ? fromN && toN
      ? `Same address\n${CHAIN_NAME[chainOf(fromN)]} (${kindLabel(fromN.kind)}) ↔ ${CHAIN_NAME[chainOf(toN)]} (${kindLabel(toN.kind)})`
      : "Same address across chains"
    : edgePlain(e, toN, true) + (e.evidence ? `\n${e.evidence}` : "");
  // SAME_AS at same Y would be a straight line through nodes — arc UP (screen y decreases)
  let smooth;
  if (same) {
    const leftToRight = nodeX(e.from) <= nodeX(e.to);
    smooth = {
      enabled: true,
      type: leftToRight ? "curvedCW" : "curvedCCW",
      roundness: 0.72,
    };
  } else {
    smooth = { type: "cubicBezier", forceDirection: "vertical", roundness: 0.35 };
  }
  return {
    id: "e" + i,
    from: e.from,
    to: e.to,
    arrows: { to: { enabled: !same, scaleFactor: 0.65 } },
    label: same ? "same" : REL_LABEL[e.rel] || e.rel,
    title: tip,
    font: {
      color: same ? "#5b9fd4" : "#8b93a7",
      size: same ? 10 : 9,
      strokeWidth: 3,
      strokeColor: "#0a0b0e",
      align: same ? "top" : "horizontal",
    },
    color: { color: same ? "#5b9fd4" : col, highlight: "#f2efe6", hover: same ? "#7eb6e0" : col, opacity: 1 },
    width: same ? 1.5 : e.rel === "ADMIN_OF" || e.rel === "DEPLOYED" ? 2.2 : 1.4,
    dashes: same ? [6, 4] : e.rel === "IMPLEMENTATION_OF" || e.rel === "FUNDED",
    smooth,
  };
}

function drawPlanes(ctx) {
  if (!planeMeta.length) return;
  const ROW = 168;
  const PAD_TOP = 110;
  planeMeta.forEach((p) => {
    ctx.save();
    ctx.fillStyle = "rgba(91, 159, 212, 0.05)";
    ctx.strokeStyle = "rgba(232, 237, 245, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(p.x0, p.y0, p.w, p.h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#8b93a7";
    ctx.font = "12px Segoe UI";
    ctx.fillText(p.label.toUpperCase(), p.x0 + 16, p.y0 + 22);
    STRATA.forEach((name, i) => {
      ctx.fillStyle = "rgba(139, 147, 167, 0.55)";
      ctx.font = "10px Segoe UI";
      ctx.fillText(name, p.x0 + 10, p.y0 + PAD_TOP + i * ROW - 18);
    });
    ctx.restore();
  });
}

function graphOptions() {
  return {
    physics: { enabled: false },
    layout: { improvedLayout: false, randomSeed: 7 },
    interaction: {
      hover: true,
      tooltipDelay: 80,
      dragNodes: true,
      dragView: true,
      zoomView: true,
      hideEdgesOnDrag: false,
      hideEdgesOnZoom: false,
      hideNodesOnDrag: false,
      selectable: true,
      multiselect: false,
    },
    nodes: { chosen: true },
    edges: { chosen: true, selectionWidth: 1.5 },
  };
}

function bindNetwork() {
  network.on("dragStart", () => {
    dragging = true;
  });
  network.on("dragging", () => network.redraw());
  network.on("dragEnd", (params) => {
    dragging = false;
    (params.nodes || []).forEach((id) => {
      const p = network.getPositions([id])[id];
      if (!p) return;
      userPos[id] = { x: p.x, y: p.y };
      nodeSet.update({ id, x: p.x, y: p.y, physics: false });
    });
  });
  network.on("click", (params) => {
    if (dragging) return;
    const nid = params.nodes && params.nodes[0];
    if (nid) {
      setInspector(nid);
      return;
    }
    const eid = params.edges && params.edges[0];
    if (eid && edgeSet) {
      const e = edgeSet.get(eid);
      if (e) {
        setInspector(pickExploreId(e.from, e.to));
        return;
      }
    }
    setInspector(null);
  });
  network.on("doubleClick", (params) => {
    const nid = params.nodes && params.nodes[0];
    if (nid) {
      setInspector(nid);
      expand();
      return;
    }
    const eid = params.edges && params.edges[0];
    if (eid && edgeSet) {
      const e = edgeSet.get(eid);
      if (!e) return;
      setInspector(pickExploreId(e.from, e.to));
      expand();
    }
  });
  network.on("afterDrawing", (ctx) => drawPlanes(ctx));
}

function syncData(data) {
  const layout = computePlanes(data.nodes);
  const visNodes = data.nodes.map((n) => nodeVis(n, layout[visId(n)]));
  const visEdges = data.edges.map(edgeVis);
  const ids = new Set(visNodes.map((n) => n.id));
  const eids = new Set(visEdges.map((e) => e.id));
  if (!nodeSet) {
    nodeSet = new vis.DataSet(visNodes);
    edgeSet = new vis.DataSet(visEdges);
    return;
  }
  nodeSet.getIds().forEach((id) => {
    if (!ids.has(id)) {
      nodeSet.remove(id);
      delete userPos[id];
    }
  });
  visNodes.forEach((n) => {
    const prev = nodeSet.get(n.id);
    if (prev && userPos[n.id]) {
      nodeSet.update({ ...n, x: userPos[n.id].x, y: userPos[n.id].y, physics: false });
    } else if (prev) nodeSet.update(n);
    else nodeSet.add(n);
  });
  edgeSet.getIds().forEach((id) => {
    if (!eids.has(id)) edgeSet.remove(id);
  });
  visEdges.forEach((e) => {
    if (edgeSet.get(e.id)) edgeSet.update(e);
    else edgeSet.add(e);
  });
}

function renderGraph(data) {
  const empty = $("empty");
  if (!data || !data.nodes || !data.nodes.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  if (typeof vis === "undefined") {
    empty.classList.remove("hidden");
    empty.innerHTML = "<strong>Graph engine missing</strong>";
    return;
  }
  const first = !network;
  syncData(data);
  if (first) {
    network = new vis.Network($("graph"), { nodes: nodeSet, edges: edgeSet }, graphOptions());
    bindNetwork();
    watchGraphSize();
  } else {
    network.redraw();
  }
  requestAnimationFrame(() => resizeNetwork(!!first));
}

const TWIN_BORDER = "#7dd3fc";
const TWIN_GLOW = "#38bdf8";
const EDGE_ACTIVE = "#f0c674";

function highlightSelection(id) {
  if (!network || !nodeSet || !edgeSet || !lastResult) return;
  const nodes = lastResult.nodes || [];
  const edges = lastResult.edges || [];

  const resetNode = (n) => {
    const base = nodeVis(n, lastLayout[visId(n)] || userPos[visId(n)]);
    nodeSet.update({
      id: base.id,
      opacity: 1,
      color: base.color,
      borderWidth: base.borderWidth,
      size: base.size,
    });
  };
  const resetEdge = (e, i) => {
    const base = edgeVis(e, i);
    edgeSet.update({
      id: base.id,
      color: base.color,
      width: base.width,
      font: base.font,
    });
  };

  if (!id) {
    nodes.forEach(resetNode);
    edges.forEach(resetEdge);
    network.unselectAll();
    return;
  }

  const sel = nodeBy(id);
  const hex = nodeAddr(sel);
  const twins = new Set();
  nodes.forEach((n) => {
    if (hex && nodeAddr(n) === hex && visId(n) !== id) twins.add(visId(n));
  });

  const neighbor = new Set([id, ...twins]);
  const activeEdges = new Set();
  const twinEdges = new Set();
  edges.forEach((e, i) => {
    const eid = "e" + i;
    const touchSel = e.from === id || e.to === id;
    const touchTwin =
      twins.has(e.from) || twins.has(e.to) || (twins.has(e.from) && twins.has(e.to));
    const sameBridge =
      e.rel === "SAME_AS" &&
      ((e.from === id && twins.has(e.to)) ||
        (e.to === id && twins.has(e.from)) ||
        (twins.has(e.from) && twins.has(e.to)));
    if (touchSel) {
      neighbor.add(e.from);
      neighbor.add(e.to);
      activeEdges.add(eid);
    }
    if (sameBridge || (e.rel === "SAME_AS" && touchTwin && (e.from === id || e.to === id || (twins.has(e.from) && twins.has(e.to))))) {
      twinEdges.add(eid);
      neighbor.add(e.from);
      neighbor.add(e.to);
    }
  });

  nodes.forEach((n) => {
    const nid = visId(n);
    const base = nodeVis(n, lastLayout[nid] || userPos[nid]);
    if (nid === id) {
      nodeSet.update({
        id: nid,
        opacity: 1,
        borderWidth: Math.max(base.borderWidth, 4),
        color: {
          ...base.color,
          border: "#f2efe6",
          highlight: { background: base.color.background, border: "#f2efe6" },
        },
        size: (base.size || 14) + 2,
      });
      return;
    }
    if (twins.has(nid)) {
      nodeSet.update({
        id: nid,
        opacity: 1,
        borderWidth: 4,
        color: {
          background: base.color.background,
          border: TWIN_BORDER,
          highlight: { background: base.color.background, border: TWIN_GLOW },
          hover: { background: base.color.background, border: TWIN_GLOW },
        },
        size: (base.size || 14) + 1,
      });
      return;
    }
    nodeSet.update({
      id: nid,
      opacity: neighbor.has(nid) ? 1 : 0.28,
      color: base.color,
      borderWidth: base.borderWidth,
      size: base.size,
    });
  });

  edges.forEach((e, i) => {
    const eid = "e" + i;
    const base = edgeVis(e, i);
    if (activeEdges.has(eid)) {
      edgeSet.update({
        id: eid,
        width: (base.width || 1.4) + 1.4,
        color: {
          color: EDGE_ACTIVE,
          highlight: "#f2efe6",
          hover: EDGE_ACTIVE,
          opacity: 1,
        },
        font: { ...base.font, color: EDGE_ACTIVE },
      });
      return;
    }
    if (twinEdges.has(eid)) {
      edgeSet.update({
        id: eid,
        width: (base.width || 1.4) + 1,
        color: {
          color: TWIN_GLOW,
          highlight: TWIN_BORDER,
          hover: TWIN_GLOW,
          opacity: 1,
        },
        font: { ...base.font, color: TWIN_BORDER },
      });
      return;
    }
    edgeSet.update({
      id: eid,
      width: base.width,
      color: {
        color: base.color.color,
        highlight: base.color.highlight,
        hover: base.color.hover,
        opacity: 0.18,
      },
      font: base.font,
    });
  });

  network.selectNodes([id], false);
  network.selectEdges([...activeEdges, ...twinEdges]);
}

function plottedChains() {
  const set = new Set();
  ((lastResult && lastResult.nodes) || []).forEach((n) => set.add(String(chainOf(n))));
  (lastEmpireRows || []).forEach((r) => {
    Object.keys(r.byChain || {}).forEach((c) => set.add(String(c)));
  });
  return [...set].sort((a, b) => Number(a) - Number(b));
}

function syncHandsChainFilters() {
  const box = $("handsChainFilters");
  if (!box) return;
  const chains = plottedChains();
  if (!chains.length) {
    box.innerHTML = "";
    handsChainFilter = "all";
    return;
  }
  if (handsChainFilter !== "all" && !chains.includes(String(handsChainFilter))) {
    handsChainFilter = "all";
  }
  const chips = [
    `<button type="button" class="chip${handsChainFilter === "all" ? " on" : ""}" data-chain="all">All</button>`,
  ];
  chains.forEach((c) => {
    const on = String(handsChainFilter) === String(c) ? " on" : "";
    chips.push(
      `<button type="button" class="chip${on}" data-chain="${c}">${CHAIN_NAME[c] || c}</button>`
    );
  });
  box.innerHTML = chips.join("");
}

function renderHands(rows) {
  lastEmpireRows = rows || [];
  syncHandsChainFilters();
  const body = $("handsRows");
  if (!rows || !rows.length) {
    body.innerHTML = '<tr><td colspan="3" class="empty">Expand control tree first.</td></tr>';
    return;
  }
  const filter = handsChainFilter;
  const chainKey = filter === "all" ? null : String(filter);
  let filtered = rows.slice();
  if (chainKey) {
    filtered = filtered.filter((r) => (r.byChain || {})[chainKey]);
    filtered.sort(
      (a, b) =>
        ((b.byChain || {})[chainKey] || 0) - ((a.byChain || {})[chainKey] || 0) ||
        a.controller.localeCompare(b.controller)
    );
  }
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="3" class="empty">No hands on this chain.</td></tr>';
    return;
  }
  body.innerHTML = filtered
    .map((r) => {
      const badge = r.wasKnown ? "" : '<span class="badge">new</span>';
      const by = r.byChain || {};
      let bits;
      let countShow = r.count;
      if (chainKey) {
        countShow = by[chainKey] || 0;
        bits = `${CHAIN_NAME[chainKey] || chainKey} ${countShow}`;
      } else {
        bits = Object.keys(by)
          .sort((a, b) => Number(a) - Number(b))
          .map((c) => `${CHAIN_NAME[c] || c} ${by[c]}`)
          .join(" · ");
      }
      return `<tr data-id="${r.controller}">
        <td class="addr" title="${r.controller}">${shortAddr(r.controller)}</td>
        <td class="bychain" title="contracts controlled per chain">${bits || countShow}</td>
        <td>${badge}</td>
      </tr>`;
    })
    .join("");
}

function empireFromEdges(data) {
  const byCtrl = {};
  const nodeMap = {};
  (data.nodes || []).forEach((n) => {
    nodeMap[visId(n)] = n;
  });
  (data.edges || []).forEach((e) => {
    if (!["DEPLOYED", "ADMIN_OF", "SIGNER_OF"].includes(e.rel)) return;
    if (!byCtrl[e.from]) byCtrl[e.from] = {};
    const dst = nodeMap[e.to];
    const chain = dst ? chainOf(dst) : Number(data.chainid || 1);
    if (!byCtrl[e.from][chain]) byCtrl[e.from][chain] = new Set();
    byCtrl[e.from][chain].add(e.to);
  });
  return Object.keys(byCtrl)
    .map((controller) => {
      const byChain = {};
      let count = 0;
      Object.keys(byCtrl[controller]).forEach((c) => {
        byChain[c] = byCtrl[controller][c].size;
        count += byChain[c];
      });
      const node = nodeMap[controller] || {};
      return {
        controller,
        count,
        byChain,
        wasKnown: !!node.wasKnown || !!node.seed,
      };
    })
    .sort((a, b) => b.count - a.count || a.controller.localeCompare(b.controller));
}

function normalizeSameAsEdges(data) {
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const byAddr = {};
  nodes.forEach((n) => {
    const a = nodeAddr(n);
    if (!a) return;
    if (!byAddr[a]) byAddr[a] = [];
    byAddr[a].push(n);
  });
  const home = Number(data.chainid || (lastResult && lastResult.chainid) || $("chainid").value || 1);
  const drop = new Set();
  const add = [];
  Object.keys(byAddr).forEach((addr) => {
    const twins = byAddr[addr];
    if (twins.length < 2) return;
    const ids = new Set(twins.map(visId));
    edges.forEach((e, i) => {
      if (e.rel !== "SAME_AS") return;
      if (ids.has(e.from) && ids.has(e.to)) drop.add(i);
    });
    twins.sort((a, b) => {
      const ca = chainOf(a);
      const cb = chainOf(b);
      const ha = ca === home ? 0 : 1;
      const hb = cb === home ? 0 : 1;
      if (ha !== hb) return ha - hb;
      return ca - cb;
    });
    for (let i = 0; i < twins.length - 1; i++) {
      const a = twins[i];
      const b = twins[i + 1];
      add.push({
        from: visId(a),
        to: visId(b),
        rel: "SAME_AS",
        role: "same",
        evidence: `same address on ${CHAIN_NAME[chainOf(a)] || chainOf(a)} and ${CHAIN_NAME[chainOf(b)] || chainOf(b)}`,
      });
    }
  });
  data.edges = edges.filter((_, i) => !drop.has(i)).concat(add);
  return data;
}

function applyResult(evt) {
  lastResult = normalizeSameAsEdges(evt);
  lastResult.empire = empireFromEdges(lastResult);
  saveGraph(lastResult);
  userPos = {};
  renderGraph(lastResult);
  renderHands(lastResult.empire || []);
  $("exportJson").disabled = false;
  updateActionButtons(false);
  if (selectedId) setInspector(selectedId);
}

async function readSSE(res, onDone) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() || "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const evt = JSON.parse(line.slice(6));
      if (evt.type === "progress") {
        const pct = evt.total ? Math.round((evt.current / evt.total) * 100) : 0;
        $("bar").value = pct;
        setStatus(evt.message, "busy");
      } else if (evt.type === "error") {
        setStatus(evt.message, "err");
        return;
      } else if (evt.type === "done") {
        $("bar").value = 100;
        applyResult(evt);
        onDone(evt);
      }
    }
  }
}

function setBusy(on) {
  updateActionButtons(on);
}

async function run() {
  saveKey();
  const apiKey = $("apiKey").value.trim();
  const contracts = $("contracts").value;
  if (!apiKey) {
    setStatus("Paste your Etherscan API key.", "err");
    return;
  }
  if (!contracts.trim()) {
    setStatus("Paste at least one contract address.", "err");
    return;
  }
  setBusy(true);
  $("bar").value = 0;
  setStatus("Expanding control tree…", "busy");
  const res = await fetch(apiUrl("/api/run"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ apiKey, seeds: contracts, chainid: $("chainid").value }),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    setStatus(err.error || "Expand control tree failed.", "err");
    setBusy(false);
    return;
  }
  await readSSE(res, (evt) => {
    setStatus(`${evt.nodes.length} nodes · ${evt.edges.length} edges`, "ok");
  });
  setBusy(false);
}

async function expand() {
  if (!selectedId) {
    setStatus("Select a hand first.", "err");
    return;
  }
  saveKey();
  const node = nodeBy(selectedId);
  const hex = nodeAddr(node) || String(selectedId).split("@")[0];
  const chainid = node ? chainOf(node) : $("chainid").value;
  setBusy(true);
  $("bar").value = 0;
  setStatus("Expanding " + shortAddr(hex) + "…", "busy");
  const res = await fetch(apiUrl("/api/expand"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      addr: hex,
      apiKey: $("apiKey").value.trim(),
      chainid,
      graph: graphPayload(),
    }),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    setStatus(err.error || "Expand failed.", "err");
    setBusy(false);
    return;
  }
  await readSSE(res, (evt) => {
    setStatus(`Expanded ${shortAddr(evt.expanded)} · +${evt.added || 0} edges`, "ok");
    setInspector(evt.expanded);
  });
  setBusy(false);
}

async function scanChains() {
  if (!lastResult) {
    setStatus("Expand control tree first.", "err");
    return;
  }
  saveKey();
  setBusy(true);
  $("bar").value = 0;
  setStatus("Other chains…", "busy");
  const includeTestnets = !!($("includeTestnets") && $("includeTestnets").checked);
  const res = await fetch(apiUrl("/api/scan-chains"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      apiKey: $("apiKey").value.trim(),
      addr: focusForScan(),
      graph: graphPayload(),
      includeTestnets,
    }),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    setStatus(err.error || "Other chains failed.", "err");
    setBusy(false);
    return;
  }
  await readSSE(res, (evt) => {
    const extra = (evt.nodes || []).filter((n) => Number(n.chain) !== Number(evt.chainid || $("chainid").value)).length;
    setStatus(`Other chains · ${extra} foreign · +${evt.added || 0} edges`, "ok");
    if (network) network.fit({ animation: { duration: 280, easingFunction: "easeInOutQuad" } });
  });
  setBusy(false);
}

$("run").addEventListener("click", () => run().catch((e) => { setStatus(String(e), "err"); setBusy(false); }));
$("expand").addEventListener("click", () => expand().catch((e) => { setStatus(String(e), "err"); setBusy(false); }));
$("scanChains").addEventListener("click", () => scanChains().catch((e) => { setStatus(String(e), "err"); setBusy(false); }));
$("apiKey").addEventListener("change", saveKey);

$("sideTabs").addEventListener("click", (ev) => {
  const tab = ev.target.closest(".minitab");
  if (!tab) return;
  $("sideTabs").querySelectorAll(".minitab").forEach((b) => b.classList.toggle("on", b === tab));
  document.querySelectorAll(".tabpane").forEach((p) => p.classList.toggle("on", p.id === "pane-" + tab.dataset.pane));
});
$("handsChainFilters").addEventListener("click", (ev) => {
  const chip = ev.target.closest(".chip[data-chain]");
  if (!chip) return;
  handsChainFilter = chip.dataset.chain || "all";
  renderHands(lastEmpireRows);
});
$("copyAddr").addEventListener("click", async () => {
  if (!selectedId) return;
  const hex = nodeAddr(nodeBy(selectedId)) || String(selectedId).split("@")[0];
  try {
    await navigator.clipboard.writeText(hex);
    showToast("Copied " + shortAddr(hex));
  } catch {
    showToast(shortAddr(hex));
  }
});
$("togglePanel").addEventListener("click", () => {
  document.body.classList.toggle("panel-collapsed");
  afterPanelToggle();
});
$("toggleInspect").addEventListener("click", () => {
  document.body.classList.toggle("inspect-collapsed");
  afterPanelToggle();
});
$("includeTestnets").addEventListener("change", () => {
  localStorage.setItem(TESTNET_LS, $("includeTestnets").checked ? "1" : "0");
});
$("exportJson").addEventListener("click", () => {
  if (!lastResult) return;
  const blob = new Blob([JSON.stringify(graphPayload(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "marionette-light.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("importJson").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files && $("importFile").files[0];
  $("importFile").value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const nodes = data.nodes || (data.graph && data.graph.nodes) || [];
    const edges = data.edges || (data.graph && data.graph.edges) || [];
    if (!nodes.length) {
      setStatus("JSON has no nodes.", "err");
      return;
    }
    if (data.chainid) $("chainid").value = String(data.chainid);
    applyResult({
      nodes,
      edges,
      empire: data.empire || [],
      controllers: data.controllers || [],
      puppeteers: data.puppeteers || [],
      chainid: Number(data.chainid || $("chainid").value || 1),
      warnings: data.warnings || [],
    });
    setStatus(`Imported ${nodes.length} nodes · ${edges.length} edges`, "ok");
  } catch (err) {
    setStatus("Import failed: " + err, "err");
  }
});
$("search").addEventListener("input", () => {
  const q = $("search").value.trim().toLowerCase();
  if (!lastResult || !network) return;
  if (!q) {
    setInspector(selectedId);
    return;
  }
  const hit = lastResult.nodes.find(
    (n) =>
      (n.addr || "").includes(q) ||
      visId(n).includes(q) ||
      kindLabel(n.kind).toLowerCase().includes(q)
  );
  if (hit) {
    setInspector(visId(hit));
    if (network) {
      network.focus(visId(hit), { scale: 1.15, animation: { duration: 280, easingFunction: "easeInOutQuad" } });
    }
  }
});
$("inspect").addEventListener("click", (ev) => {
  const fact = ev.target.closest(".fact[data-id]");
  if (fact) {
    setInspector(fact.dataset.id);
    return;
  }
  const row = ev.target.closest("tr[data-id]");
  if (row) setInspector(row.dataset.id);
});
$("inspect").addEventListener("dblclick", (ev) => {
  const fact = ev.target.closest(".fact[data-id]");
  if (!fact) return;
  setInspector(fact.dataset.id);
  expand().catch((e) => setStatus(String(e), "err"));
});

loadKey();
loadPanelState();
if (localStorage.getItem(TESTNET_LS) === "1") $("includeTestnets").checked = true;
updateActionButtons(false);

const apiBaseEl = $("apiBaseInput");
if (apiBaseEl) {
  apiBaseEl.value = apiBase();
  apiBaseEl.addEventListener("change", () => {
    const v = apiBaseEl.value.trim().replace(/\/$/, "");
    if (v) localStorage.setItem(API_LS, v);
    else localStorage.removeItem(API_LS);
    probeApi();
  });
}

async function probeApi() {
  const banner = $("apiBanner");
  if (!banner) return;
  const base = apiBase();
  if (!base && location.protocol === "https:") {
    banner.className = "api-banner err";
    banner.innerHTML =
      'API offline. <a href="https://render.com/deploy?repo=https://github.com/Bottegatecnologica/Marionette_Light" target="_blank" rel="noreferrer">Deploy API on Render</a>, then paste the URL below.';
    return;
  }
  try {
    const res = await fetch(apiUrl("/api/health"), { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    banner.className = "api-banner ok";
    banner.textContent = base ? "API connected · " + base.replace(/^https?:\/\//, "") : "API connected (local)";
  } catch (_) {
    banner.className = "api-banner err";
    banner.innerHTML = base
      ? 'API unreachable at ' +
        base.replace(/^https?:\/\//, "") +
        '. Cold start can take ~1 min, or <a href="https://render.com/deploy?repo=https://github.com/Bottegatecnologica/Marionette_Light" target="_blank" rel="noreferrer">redeploy</a>.'
      : "API unreachable.";
  }
}
probeApi();

(async () => {
  try {
    const cached = localStorage.getItem(GRAPH_LS);
    if (cached) {
      const data = JSON.parse(cached);
      if (data.nodes && data.nodes.length) {
        applyResult(data);
        setStatus("Restored last graph from this browser.", "ok");
        return;
      }
    }
  } catch (_) {}
  try {
    const res = await fetch(apiUrl("/api/last"));
    if (res.ok) {
      const data = await res.json();
      if (data.nodes && data.nodes.length) {
        applyResult(data);
        setStatus("Last graph restored.", "ok");
      }
    }
  } catch (_) {}
})();
