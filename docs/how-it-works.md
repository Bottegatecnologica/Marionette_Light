# How it works

## Marionette layout

Each chain is a **vertical column**. Inside a column, strata hang like a puppet:

1. **Funder** (top)
2. **Signer**
3. **Controller / Safe**
4. **Contract / Seed** (bottom)

Home chain is leftmost; other chains sit beside it. Identity links (`SAME_AS`) arc above as blue dashed paths between nearest neighbors.

Node order inside a row uses a barycenter pass on control edges so funded / admin arrows cross less often.

## Workflow

```text
Seeds ──► Expand control tree ──► Select hand ──► Expand
                │
                └──► Look for plotted addresses on other chains
                         (± testnets)
```

- **Expand control tree** — resolve owners, proxy admins, roles, Safe signers, deployers, and optional first-fund heuristics for EOAs.
- **Expand** — scan the selected hand’s txs on its chain; prove control / confirm deploys.
- **Other chains** — for plotted EOAs, search sibling chains for CREATE/control and resolve foreign contracts on those planes.

## Hands panel

Hands list controllers by how many contracts they control (`DEPLOYED` / `ADMIN_OF` / `SIGNER_OF`). Chips filter to chains that actually appear in the graph.

## Import / Export

JSON is `{ nodes, edges, chainid }`. Re-import rebuilds the canvas and re-normalizes `SAME_AS` to a nearest-neighbor path.

## Stack

- **Backend:** Flask + `resolve.py` (Python), port `8766`
- **Frontend:** static HTML/CSS/JS + vis-network
- **No Neo4j** in Light
