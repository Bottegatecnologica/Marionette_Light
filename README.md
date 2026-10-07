# Marionette Light

Who **deploys / admins / signs** your contracts — not money flow. Runs **locally** on your machine.

**Tutorial (IT):** [bottegatecnologica.github.io/Marionette_Light](https://bottegatecnologica.github.io/Marionette_Light/)  
**Download:** [ZIP](https://github.com/Bottegatecnologica/Marionette_Light/archive/refs/heads/main.zip) · [GitHub](https://github.com/Bottegatecnologica/Marionette_Light)

## Quick start

```bash
git clone https://github.com/Bottegatecnologica/Marionette_Light.git
cd Marionette_Light
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:8766 — paste contracts + your [Etherscan API key](https://etherscan.io/apis).

## Edges

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
