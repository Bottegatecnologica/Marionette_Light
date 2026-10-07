# Marionette Light

**Control graph for EVM contracts** — who deploys, admins, and signs. Not money flow.

Paste seed contracts, expand the control tree, then follow hands across chains. You bring your own [Etherscan](https://etherscan.io/apis) API key (stored in the browser only; never committed).

**Site:** [bottegatecnologica.github.io/Marionette_Light](https://bottegatecnologica.github.io/Marionette_Light/)  
**Source:** [github.com/Bottegatecnologica/Marionette_Light](https://github.com/Bottegatecnologica/Marionette_Light)

## Quick start

```bash
git clone https://github.com/Bottegatecnologica/Marionette_Light.git
cd Marionette_Light
pip install -r requirements.txt
python app.py
```

Open [http://127.0.0.1:8766](http://127.0.0.1:8766).

Optional: copy `.env.example` → `.env` if you want a default key for CLI/server-side helpers. The UI key field is enough for normal use.

## How to use

1. Paste one or more **contract addresses** and pick the home **chain**.
2. Paste your **Etherscan API key**.
3. Click **Expand control tree** — builds the marionette layout (hands above, seeds at the bottom; chains side by side).
4. Select a hand → **Expand** (or double-click) to grow its deployments / control on that plane.
5. **Look for plotted addresses on other chains** — scans siblings (mainnets; enable **Include testnets** to add Sepolia / Amoy / etc.).
6. **Hands** tab: filter **by chain** with the chips for chains present in the graph.
7. Import / Export JSON to save or share a graph (no secrets inside).

Left and right panels are collapsible. Search finds plotted addresses on the canvas.

## What edges mean (truth)

| Relation | Source | Trust |
|----------|--------|--------|
| `DEPLOYED` | Etherscan `getcontractcreation` (expand confirms creator) | High |
| `ADMIN_OF` (owner / proxy admin) | Live `eth_call` / EIP-1967 · ZOS slots | High |
| `ADMIN_OF` (DEFAULT_ADMIN) | RoleGranted/Revoked **and** live `hasRole` | High |
| `SIGNER_OF` | Safe `getOwners()` | High (if ABI matches) |
| `IMPLEMENTATION_OF` | Proxy implementation slot | High as *impl*, not control |
| `FUNDED` | First inbound ETH with value | **Heuristic** — not control |
| `SAME_AS` | Same address on another chain | Exact; linked as nearest-neighbor path A—B—C |

Empire / Hands counts use only `DEPLOYED`, `ADMIN_OF`, and `SIGNER_OF`.

More detail: [docs/truth.md](docs/truth.md) · [docs/how-it-works.md](docs/how-it-works.md)

## Tests

```bash
python -m unittest test_truth.py -v
```

Offline unit tests for DEFAULT_ADMIN gating, expand deploy verification, and implementation kind.

## Vs Marionette (full)

| | Light | Full |
|--|-------|------|
| Graph store | In-memory + browser / `last.json` | Neo4j |
| Cypher export | No | Yes |
| Layout | Fixed marionette planes | Force + planes |
| Auth / multi-user | Single visitor + own API key | Heavier stack |

Same resolve / expand / other-chains core ideas; Light is the portable, less-is-more UI.

## License / key safety

- Do not commit `.env`, API keys, or private seeds.
- Rate limits and missing ABI surfaces can cause **false negatives** (missing edges), not invented control.
