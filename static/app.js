const $ = (id) => document.getElementById(id);
const KEY_LS = "marionette_light_api_key";
const GRAPH_LS = "marionette_light_last_graph";

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
  SAME_AS: "#8b9cc4",
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
};
const STRATA = ["Funder", "Signer", "Controller", "Seed / contract"];

let network = null;
let nodeSet = null;
let edgeSet = null;
let lastResult = null;
let selectedId = null;
let planeMeta = [];
let userPos = {};
let dragging = false;

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
  };
  return (hosts[String(chain)] || hosts[1]) + addr;
}
function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = "status " + (cls || "idle");
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

function setInspector(id) {
  selectedId = id;
  const has = !!id && !!lastResult;
  $("expand").disabled = !has;
  $("scanChains").disabled = !lastResult;
  $("copyAddr").disabled = !id;
  const box = $("inspector");
  const list = $("edgeList");
  const scan = $("openScan");
  if (!id) {
    box.className = "inspector idle";
    box.textContent = "Click a node.";
    scan.href = "#";
    list.innerHTML = '<p class="muted">Nothing selected.</p>';
    highlightSelection(null);
    return;
  }
  const node = nodeBy(id);
  const emp = empireFor(id);
  const n = emp ? emp.count : 0;
  const hex = nodeAddr(node) || String(id).split("@")[0];
  const chain = node ? chainOf(node) : Number($("chainid").value || 1);
  const chainLabel = CHAIN_NAME[chain] || "chain " + chain;
  const twins = ((lastResult && lastResult.nodes) || []).filter((t) => nodeAddr(t) === hex && visId(t) !== id);
  const twinLine = twins.length
    ? `<div>same · ${twins.map((t) => `${t.kind} on ${CHAIN_NAME[chainOf(t)] || chainOf(t)}`).join(" · ")}</div>`
    : "";
  box.className = "inspector active";
  box.innerHTML = `
    <div class="addr">${hex}</div>
    <div>${(node && node.kind) || "Address"} · ${chainLabel}</div>
    ${twinLine}
    <div>controls <strong>${n}</strong> on this chain</div>`;
  scan.href = scanUrl(hex, chain);
  const facts = factsFor(id);
  const rows = [];
  facts.out.forEach((e) => {
    const dst = nodeBy(e.to);
    const dir = e.rel === "SAME_AS" ? "same →" : `${REL_LABEL[e.rel] || e.rel} →`;
    const label =
      e.rel === "SAME_AS" && dst
        ? `${dst.kind} · ${CHAIN_NAME[chainOf(dst)] || chainOf(dst)}`
        : dst
          ? `${shortAddr(nodeAddr(dst))} · ${CHAIN_NAME[chainOf(dst)] || chainOf(dst)}`
          : e.to;
    rows.push(`<div class="fact" data-id="${e.to}"><div class="dir">${dir}</div><div class="addr">${label}</div><div class="muted">${e.evidence}</div></div>`);
  });
  facts.inn.forEach((e) => {
    const src = nodeBy(e.from);
    const dir = e.rel === "SAME_AS" ? "← same" : `← ${REL_LABEL[e.rel] || e.rel}`;
    const label =
      e.rel === "SAME_AS" && src
        ? `${src.kind} · ${CHAIN_NAME[chainOf(src)] || chainOf(src)}`
        : src
          ? `${shortAddr(nodeAddr(src))} · ${CHAIN_NAME[chainOf(src)] || chainOf(src)}`
          : e.from;
    rows.push(`<div class="fact" data-id="${e.from}"><div class="dir">${dir}</div><div class="addr">${label}</div><div class="muted">${e.evidence}</div></div>`);
  });
  list.innerHTML = rows.length ? rows.join("") : '<p class="muted">No edges.</p>';
  if (!dragging) highlightSelection(id);
}

function stratumOf(n) {
  if (n.kind === "Funder") return 0;
  if (n.kind === "Signer") return 1;
  if (n.kind === "Safe" || n.kind === "Controller") return 2;
  return 3;
}

function computePlanes(nodes) {
  const chains = [...new Set(nodes.map(chainOf))].sort((a, b) => a - b);
  if (!chains.length) chains.push(1);
  const COL = 240;
  const ROW = 90;
  const pos = {};
  planeMeta = [];
  let yCursor = 0;
  chains.forEach((chain) => {
    const members = nodes.filter((n) => chainOf(n) === chain);
    if (!members.length) return;
    const buckets = [[], [], [], []];
    members.forEach((n) => buckets[stratumOf(n)].push(n));
    buckets.forEach((b) => b.sort((a, c) => (a.addr || "").localeCompare(c.addr || "")));
    const rows = Math.max(1, ...buckets.map((b) => b.length));
    const h = rows * ROW + 80;
    planeMeta.push({
      chain,
      label: CHAIN_NAME[chain] || "chain " + chain,
      x0: 0,
      y0: yCursor,
      w: 4 * COL + 60,
      h,
    });
    buckets.forEach((bucket, si) => {
      bucket.forEach((n, ri) => {
        pos[visId(n)] = { x: 80 + si * COL, y: yCursor + 56 + ri * ROW };
      });
    });
    yCursor += h + 48;
  });
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
    label: shortAddr(nodeAddr(n)) + "\n" + n.kind + chainBit,
    title: `${nodeAddr(n)}\n${n.kind} · ${CHAIN_NAME[chain] || chain}`,
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

function edgeVis(e, i) {
  const col = REL_COLOR[e.rel] || "#6b7380";
  const same = e.rel === "SAME_AS";
  const fromN = nodeBy(e.from);
  const toN = nodeBy(e.to);
  return {
    id: "e" + i,
    from: e.from,
    to: e.to,
    arrows: { to: { enabled: !same, scaleFactor: 0.65 } },
    label: same && fromN && toN ? `${fromN.kind} → ${toN.kind}` : e.role || REL_LABEL[e.rel] || e.rel,
    title: same
      ? fromN && toN
        ? `${nodeAddr(fromN)} · ${CHAIN_NAME[chainOf(fromN)]} (${fromN.kind}) ↔ ${CHAIN_NAME[chainOf(toN)]} (${toN.kind})`
        : "same address"
      : `${e.rel} · ${e.role}\n${e.evidence}`,
    font: { color: "#8b93a7", size: 9, strokeWidth: 3, strokeColor: "#0a0b0e" },
    color: { color: col, highlight: "#f2efe6", hover: col, opacity: same ? 0.75 : 1 },
    width: same ? 1.2 : e.rel === "ADMIN_OF" || e.rel === "DEPLOYED" ? 2.2 : 1.4,
    dashes: same || e.rel === "IMPLEMENTATION_OF" || e.rel === "FUNDED",
    smooth: same
      ? { type: "cubicBezier", forceDirection: "vertical", roundness: 0.25 }
      : { type: "cubicBezier", forceDirection: "horizontal", roundness: 0.35 },
  };
}

function drawPlanes(ctx) {
  if (!planeMeta.length) return;
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
      ctx.fillStyle = "rgba(139, 147, 167, 0.75)";
      ctx.font = "10px Segoe UI";
      ctx.fillText(name, p.x0 + 60 + i * 240, p.y0 + 40);
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
      if (e) setInspector(pickExploreId(e.from, e.to));
    }
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
    requestAnimationFrame(() => network && network.fit({ animation: false }));
  } else {
    network.redraw();
  }
}

function highlightSelection(id) {
  if (!network || !nodeSet) return;
  const all = nodeSet.getIds();
  if (!id) {
    all.forEach((x) => nodeSet.update({ id: x, opacity: 1 }));
    network.unselectAll();
    return;
  }
  const keep = new Set([id]);
  ((lastResult && lastResult.edges) || []).forEach((e) => {
    if (e.from === id) keep.add(e.to);
    if (e.to === id) keep.add(e.from);
  });
  all.forEach((x) => nodeSet.update({ id: x, opacity: keep.has(x) ? 1 : 0.55 }));
  network.selectNodes([id], false);
}

function renderHands(rows) {
  const body = $("handsRows");
  if (!rows || !rows.length) {
    body.innerHTML = '<tr><td colspan="3" class="empty">Trace first.</td></tr>';
    return;
  }
  body.innerHTML = rows
    .map((r) => {
      const badge = r.wasKnown ? "" : '<span class="badge">new</span>';
      return `<tr data-id="${r.controller}">
        <td class="addr" title="${r.controller}">${shortAddr(r.controller)}</td>
        <td>${r.count}</td>
        <td>${badge}</td>
      </tr>`;
    })
    .join("");
}

function applyResult(evt) {
  lastResult = evt;
  saveGraph(evt);
  userPos = {};
  renderGraph(evt);
  renderHands(evt.empire || []);
  $("exportJson").disabled = false;
  $("scanChains").disabled = false;
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
  $("run").disabled = on;
  $("expand").disabled = on || !selectedId;
  $("scanChains").disabled = on || !lastResult;
}

async function run() {
  saveKey();
  const apiKey = $("apiKey").value.trim();
  const seeds = $("seeds").value;
  if (!apiKey) {
    setStatus("Paste your Etherscan API key.", "err");
    return;
  }
  if (!seeds.trim()) {
    setStatus("Paste at least one seed.", "err");
    return;
  }
  setBusy(true);
  $("bar").value = 0;
  setStatus("Tracing…", "busy");
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ apiKey, seeds, chainid: $("chainid").value }),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    setStatus(err.error || "Trace failed.", "err");
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
  const res = await fetch("/api/expand", {
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
    setStatus("Trace first.", "err");
    return;
  }
  saveKey();
  setBusy(true);
  $("bar").value = 0;
  setStatus("Other chains…", "busy");
  const res = await fetch("/api/scan-chains", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      apiKey: $("apiKey").value.trim(),
      addr: focusForScan(),
      graph: graphPayload(),
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
$("fit").addEventListener("click", () => network && network.fit({ animation: { duration: 280, easingFunction: "easeInOutQuad" } }));
$("apiKey").addEventListener("change", saveKey);
$("copyAddr").addEventListener("click", async () => {
  if (!selectedId) return;
  const hex = nodeAddr(nodeBy(selectedId)) || String(selectedId).split("@")[0];
  try {
    await navigator.clipboard.writeText(hex);
    setStatus("Copied " + hex, "ok");
  } catch {
    setStatus(hex, "ok");
  }
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
$("search").addEventListener("input", () => {
  const q = $("search").value.trim().toLowerCase();
  if (!lastResult || !network) return;
  if (!q) {
    setInspector(selectedId);
    return;
  }
  const hit = lastResult.nodes.find((n) => (n.addr || "").includes(q) || visId(n).includes(q));
  if (hit) setInspector(visId(hit));
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
    const res = await fetch("/api/last");
    if (res.ok) {
      const data = await res.json();
      if (data.nodes && data.nodes.length) {
        applyResult(data);
        setStatus("Last graph restored.", "ok");
      }
    }
  } catch (_) {}
})();
