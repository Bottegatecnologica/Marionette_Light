# Marionette Light

Who **deploys / admins / signs** your contracts — not money flow.

**Use in browser:** [bottegatecnologica.github.io/Marionette_Light](https://bottegatecnologica.github.io/Marionette_Light/)  
(Needs the API online — one-click [Deploy to Render](https://render.com/deploy?repo=https://github.com/Bottegatecnologica/Marionette_Light), then set that URL in the app if it isn’t already.)

## Local

```bash
pip install -r requirements.txt
python app.py
```

→ http://127.0.0.1:8766 — paste contracts + your Etherscan key.

## Edges (short)

| Edge | Meaning |
|------|---------|
| DEPLOYED / ADMIN_OF / SIGNER_OF | Live chain / Etherscan proofs |
| IMPLEMENTATION_OF | Proxy implementation (not a “hand”) |
| FUNDED | First ETH in — heuristic only |
| SAME_AS | Same address on another chain |

## Test

```bash
python -m unittest test_truth.py -v
```
