# Marionette Light

Who **deploys / admins / signs** your contracts — not money flow. Runs **locally** on your machine.

**Tutorial:** [bottegatecnologica.github.io/Marionette_Light](https://bottegatecnologica.github.io/Marionette_Light/)  
**Download:** [ZIP](https://github.com/Bottegatecnologica/Marionette_Light/archive/refs/heads/main.zip) · [GitHub](https://github.com/Bottegatecnologica/Marionette_Light)

## Quick start

```bash
git clone https://github.com/Bottegatecnologica/Marionette_Light.git
cd Marionette_Light
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:8766 — paste contracts + your [Etherscan API key](https://etherscan.io/apis).

## Methodology

Marionette Light builds a **control graph**, not a money-flow graph. Every edge comes from the local resolver (`resolve.py`) via [Etherscan API v2](https://docs.etherscan.io/) — `eth_call`, storage slots, logs, contract creation, and tx lists. The UI does not invent relationships.

### How a seed becomes a graph

1. **Expand control tree** on pasted contracts (home chain):
   - **Deployer** from `getcontractcreation`
   - **Owner** from live `owner()` (`0x8da5cb5b`)
   - **Proxy admin / implementation** from EIP-1967 and ZeppelinOS storage slots
   - **DEFAULT_ADMIN** from RoleGranted / RoleRevoked logs, then confirmed with live `hasRole`
   - **Safe signers** from `getOwners()` when the ABI matches
   - Optional **FUNDED**: first inbound ETH to an EOA controller (heuristic only)
2. **Expand** a hand: scan that address’s txs on its chain; keep deploys only if creation confirms the creator; keep admin/signer edges only if `prove_control` matches.
3. **Other chains**: for plotted EOAs, search sibling chains (optional testnets) for creates / control and resolve foreign contracts on those planes.
4. **SAME_AS**: same address bytes on another chain — identity link across planes.

### Edge trust

| Edge | Method | Trust |
|------|--------|--------|
| `DEPLOYED` | Etherscan creation (expand re-checks creator) | High |
| `ADMIN_OF` (owner / proxy) | Live `eth_call` / storage | High |
| `ADMIN_OF` (DEFAULT_ADMIN) | Logs **and** live `hasRole` | High |
| `SIGNER_OF` | Safe `getOwners()` | High if ABI matches |
| `IMPLEMENTATION_OF` | Proxy impl slot | High as *impl*, not control |
| `FUNDED` | First inbound ETH with value | Heuristic — not control |
| `SAME_AS` | Identical address on another chain | Exact |

Hands / empire counts use only `DEPLOYED`, `ADMIN_OF`, and `SIGNER_OF`.

### What we do *not* claim

- Missing edges can be rate limits, custom Ownable, Timelock-only admin, or non-Safe multisigs — **absence ≠ no control**.
- `FUNDED` is context (first payer), not proof of who controls the wallet.
- Implementation nodes are not “hands”.

Every edge carries an `evidence` string (selector, slot, or tx hash) so you can re-check on an explorer.

## Edges (summary)

| Edge | Meaning |
|------|---------|
| DEPLOYED / ADMIN_OF / SIGNER_OF | On-chain / Etherscan proofs |
| IMPLEMENTATION_OF | Proxy implementation |
| FUNDED | First ETH in (heuristic) |
| SAME_AS | Same address on another chain |

## Test

```bash
python -m unittest test_truth.py -v
```
