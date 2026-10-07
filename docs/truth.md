# Truth model

Marionette Light only draws edges produced by the local resolver (`resolve.py`) from **Etherscan API v2** (`eth_call`, storage, logs, creation, txlist). The UI does not invent relationships.

## Verified on-chain

- **Deployer** — `getcontractcreation`. On Expand, a CREATE candidate is kept as `DEPLOYED` only if creation confirms `contractCreator ==` the scanned hand.
- **Ownable owner** — `owner()` (`0x8da5cb5b`) at latest block.
- **Proxy admin** — EIP-1967 / ZeppelinOS admin slots.
- **DEFAULT_ADMIN** — AccessControl RoleGranted − RoleRevoked **net**, then **live** `hasRole(DEFAULT_ADMIN_ROLE)`. Stale grant-only accounts are dropped.
- **Safe signers** — `getOwners()` with a strict ABI array decode.
- **Implementation** — EIP-1967 / ZOS implementation slots. Node kind is `Contract` (not a “hand”).
- **SAME_AS** — identical address bytes on another chain. For *n* twins, *n−1* edges form a path ordered by chain proximity (no triangle clique).

Expand’s `prove_control` path also requires the selected hand to match owner / slot / hasRole / signer before adding admin or signer edges.

## Heuristic (not control)

- **FUNDED** — first inbound ETH transfer with `value > 0` to an EOA controller. Useful context only; labeled heuristic in the UI. Funders cannot be Expanded. Not counted in Hands / empire totals. Known CEX / factory hubs are filtered when listed.

## False negatives

Silent API failures, rate limits, custom Ownable, Timelock-only admin, non-DEFAULT roles, or non-Safe multisigs can omit real controllers. Absence of an edge is not proof of absence of control.

## Evidence strings

Every edge carries an `evidence` field (selector, slot, tx hash, or `heuristic · …`) so you can re-check on a block explorer.
