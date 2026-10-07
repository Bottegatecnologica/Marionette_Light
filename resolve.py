"""Marionette resolver: on-chain controllers of pasted infrastructure."""

from __future__ import annotations

import json
import os
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import requests
from dotenv import load_dotenv

ETHERSCAN_V2 = "https://api.etherscan.io/v2/api"

ZERO = "0x0000000000000000000000000000000000000000"
DEAD = "0x000000000000000000000000000000000000dead"

OWNER_SEL = "0x8da5cb5b"
GET_OWNERS_SEL = "0xa0e67e2b"

EIP1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"
EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
# FiatToken / ZeppelinOS unstructured proxy (USDC and cousins)
ZOS_ADMIN_SLOT = "0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b"
ZOS_IMPL_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc379834f44c5a82b31a95d06371bfb0c2ce"

ROLE_GRANTED = "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d"
ROLE_REVOKED = "0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b"
DEFAULT_ADMIN_ROLE = "0x" + ("00" * 32)

ADDR_RE = re.compile(r"^0x[a-fA-F0-9]{40}$")

ProgressFn = Callable[[str, int, int], None]

# Public CEX, bridges, factories. A shared hub is not a discovery.
HUBS = {
    ZERO,
    DEAD,
    # Binance
    "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be",
    "0xd551234ae421e3bcba99a0da6d736074f22192ff",
    "0x564286362092d8e7936f0549571b271b397a9e7",
    "0x0681d8db095565fe8a346fa0277bffde9c0edbbf",
    "0xfe9e8709d3215310075d67e3ed32a380ccf451c8",
    "0x4e9ce36e442e55ecd9025b9a6e0d88485d628a67",
    "0xbe0eb53f46cd790cd13851d5eff43d12404d33e8",
    "0xf977814e90da44bfa03b6295a0616a897441acec",
    "0x28c6c06298d514db089934071355e5743bf21d60",
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549",
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d",
    "0x56eddb7aa87536c09ccc2793473599fd21a8b59f",
    "0x9696f59e4d72e237be84ffd425dcad154bf96976",
    "0x4976a4a02f38326660d17bf34b431dc6e2eb2327",
    "0x5a52e96bacdabb82fd05763e25335261b270efcb",
    "0x8894e0a0c962cb723c1976a4421c95949be2d4e3",
    # Coinbase
    "0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
    "0x503828976d22510aad0201ac7ec88293211d23da",
    "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740",
    "0x3cd751e6b0078be393132286c442345e5dc49699",
    "0xb5d85cbf7cb3ee0d56b3bb207d5fc4b82f43f511",
    "0xeb2629a2734e272bcc07bda959863f316f4bd4cf",
    "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43",
    "0x77696bb39917c91a0c3908d577d5e322095425ca",
    # Kraken
    "0x2910543af39aba0cd09dbb2d50200b3e800a63d2",
    "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13",
    "0xe853c56864a2ebe4576a807d26fdc4a0ade67412",
    "0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0",
    "0xfa52274dd61e1643d2205169732f29139335198a",
    # Other CEX
    "0x267be1c1d684f78cb4f6a176c491e4ffdc0",
    "0x2b5634c42055806a59e9107ed44d43c426e58258",  # KuCoin
    "0x689c56aef374b1b9b72aa967f6b9fc93d5c340c2",
    "0xf89d7b9c864f589bbf53a82105107622b35eaa40",  # Bybit
    "0x1ab4973a48dc892cd9971ece8e01dac0d0f5e765",
    "0x0d0707963952f2fba59dd06f2b425ace40b492fe",  # Gate
    "0x1c4b70da9643b2e3b0fbe82d98f64bc2c09f9347",  # OKX
    "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b",
    "0x32be343b94f860124dc4fee278fdcbd38c102d88",  # Poloniex
    "0x876eabf441b2ee5b5b0554fd502a8e0600950cfa",  # Bitfinex
    "0x742d35cc6634c0532925a3b844bc454e4438f44e",
    "0x1151314c646ce4e0efd76d1af4760ae66a9fe30f",
    "0xd24400ae8bfebb18ca49be86258a3c749cf46853",  # Gemini
    "0x40b387656573a31bd344d8defd9799ad98e9d275",  # Robinhood
    "0x6262998ced04146fa42253a5c0af90ca02dfd2a3",  # Crypto.com
    # Factories
    "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f",  # Uniswap V2
    "0x1f98431c8ad98523631ae4a59f267346ea31f984",  # Uniswap V3
    "0x4e59b44847b379578588920ca78fbf26c0b4956c",  # Create2
    "0xce0042b868300000d44a59004da54a005ffdcf9f",
    "0x0000000000ffe8b47b3e2130213b802212439497",
    "0xa6b71e26c5e0845f74c812282bff2ed5b4a5b0f6",  # Safe
    "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67",
    "0x12302ae32b8baf45d7b8577a0abf4d85103145c4",
    "0x76e2cfc1f5fa8f6a5b3fc4c8f4788f0116861f9b",
    "0xc22834581ebc8527d974f8a1c97e1bea4ef27877",
    "0xa238cbeb142c10ef7ad8442c6d1f9e89e07e7761",
    "0x914d7fec6aac8cd542e72bca78b30650d45643d7",  # Safe singleton
    "0x0000000000000068f116a894984e2db1123eb395",  # CreateX
    # Bridges / canonical
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",  # WETH
    "0x3ee18b2214aff97000d974cf647e7c347e8fa585",  # Wormhole
    "0x98f3c9e6e3face36baad05fe09d375ef1464288b",
    "0x3154cf16ccdb4c6d922629664174b904d80f2c76",  # Base bridge
    "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1",  # Optimism
    "0xa3a7b6f88361f48403514059f1f16c8e78d60eec",  # Arbitrum
    "0x40ec5b73d18c6a4e50ecd009247660d332a69721",  # Polygon
    "0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a",
}

HUBS = {a.lower() for a in HUBS if ADDR_RE.match(a)}

KIND_RANK = {
    "Seed": 0,
    "Safe": 1,
    "Controller": 2,
    "Signer": 3,
    "Funder": 4,
    "Contract": 5,
}

HAS_ROLE_SEL = "0x91d14854"
EXPAND_TX_PAGES = 10
EXPAND_PAGE_SIZE = 100
EXPAND_MAX_VERIFY = 80
CROSS_CHAIN_IDS = (1, 56, 137, 42161, 8453, 10)
CROSS_TX_PAGES = 2
CROSS_MAX_PER_CHAIN = 20
EXPLORE_RESOLVE_MAX = 40
EXPLORE_EXPAND_MAX = 16
EXPLORE_EXPAND_PAGES = 6
EXPLORE_ROUNDS = 2
CHAIN_NAME = {
    1: "Ethereum",
    56: "BNB",
    137: "Polygon",
    42161: "Arbitrum",
    8453: "Base",
    10: "Optimism",
}

CONTROL_RELS = frozenset({"DEPLOYED", "ADMIN_OF", "FUNDED", "SIGNER_OF"})


def _has_code(code: str | None) -> bool:
    if not isinstance(code, str):
        return False
    blob = code.strip().lower()
    return len(blob) > 4 and blob not in {"0x", "0x0"}


def normalize_addr(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip().lower()
    if not text.startswith("0x"):
        text = "0x" + text
    if not ADDR_RE.match(text):
        return None
    if text in {ZERO, DEAD}:
        return None
    return text


def parse_seeds(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        addr = normalize_addr(line)
        if addr and addr not in seen:
            seen.add(addr)
            out.append(addr)
    return out


def _word_to_addr(word: str) -> str | None:
    if not word:
        return None
    hexpart = word.lower().removeprefix("0x")
    if len(hexpart) == 64 and hexpart[:-40] != "0" * 24:
        return None
    if len(hexpart) < 40:
        return None
    return normalize_addr("0x" + hexpart[-40:])


def _cypher_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _intish(value: str | int | None) -> int:
    if value is None:
        return 0
    if isinstance(value, int):
        return value
    text = str(value).strip()
    if not text:
        return 0
    if text.startswith("0x"):
        return int(text, 16)
    return int(text)


@dataclass
class Node:
    addr: str
    seed: bool = False
    kind: str = "Controller"
    chain: int = 1


@dataclass
class Edge:
    src: str
    dst: str
    rel: str
    role: str
    evidence: str


@dataclass
class Graph:
    nodes: dict[str, Node] = field(default_factory=dict)
    edges: dict[tuple[str, str, str, str], Edge] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    chainid: int = 1

    def key_for(self, addr: str, chain: int | None = None) -> str:
        raw = (addr or "").strip().lower()
        if "@" in raw:
            return raw
        ch = int(self.chainid if chain is None else chain)
        if ch == int(self.chainid):
            return raw
        return f"{raw}@{ch}"

    def add_node(self, addr: str, *, seed: bool = False, kind: str = "Controller", chain: int | None = None) -> Node:
        ch = int(self.chainid if chain is None else chain)
        hexaddr = addr.split("@", 1)[0].lower() if addr else addr
        key = self.key_for(hexaddr, ch)
        existing = self.nodes.get(key)
        if existing is None:
            node = Node(addr=hexaddr, seed=seed, kind="Seed" if seed else kind, chain=ch)
            self.nodes[key] = node
            self._link_identity(hexaddr)
            return node
        if seed:
            existing.seed = True
            existing.kind = "Seed"
            return existing
        if existing.kind != "Seed":
            if KIND_RANK.get(kind, 9) < KIND_RANK.get(existing.kind, 9):
                existing.kind = kind
        self._link_identity(hexaddr)
        return existing

    def add_edge(
        self,
        src: str,
        dst: str,
        rel: str,
        role: str,
        evidence: str,
        *,
        src_chain: int | None = None,
        dst_chain: int | None = None,
    ) -> None:
        src_key = self.key_for(src, src_chain)
        dst_key = self.key_for(dst, dst_chain)
        if not src_key or not dst_key or src_key == dst_key:
            return
        key = (src_key, dst_key, rel, role)
        existing = self.edges.get(key)
        if existing is None:
            self.edges[key] = Edge(src=src_key, dst=dst_key, rel=rel, role=role, evidence=evidence)
            return
        parts = [p for p in existing.evidence.split(" | ") if p]
        if evidence not in parts:
            parts.append(evidence)
            existing.evidence = " | ".join(sorted(parts))

    def _link_identity(self, hexaddr: str) -> None:
        hexaddr = (hexaddr or "").split("@", 1)[0].lower()
        twins = [(key, node) for key, node in self.nodes.items() if node.addr == hexaddr]
        if len(twins) < 2:
            return
        home = int(self.chainid or 1)
        twins.sort(key=lambda item: (0 if int(item[1].chain) == home else 1, int(item[1].chain)))
        _, hub = twins[0]
        for _, node in twins[1:]:
            src_name = CHAIN_NAME.get(int(hub.chain), str(hub.chain))
            dst_name = CHAIN_NAME.get(int(node.chain), str(node.chain))
            self.add_edge(
                hexaddr,
                hexaddr,
                "SAME_AS",
                "same",
                f"same address on {src_name} and {dst_name}",
                src_chain=int(hub.chain),
                dst_chain=int(node.chain),
            )

    def warn(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)

    def prune_idle_foreign(self) -> None:
        """Drop other-chain nodes that have no local control — no empty planes."""
        home = int(self.chainid or 1)
        live: set[str] = set()
        for edge in self.edges.values():
            if edge.rel == "SAME_AS":
                continue
            live.add(edge.src)
            live.add(edge.dst)
        drop = [
            key
            for key, node in self.nodes.items()
            if int(node.chain or home) != home and not node.seed and key not in live
        ]
        for key in drop:
            del self.nodes[key]
        if drop:
            self.edges = {
                k: edge
                for k, edge in self.edges.items()
                if edge.src in self.nodes and edge.dst in self.nodes
            }


@dataclass
class ResolveResult:
    nodes: list[dict]
    edges: list[dict]
    controllers: list[dict]
    puppeteers: list[dict]
    empire: list[dict]
    cypher: str
    warnings: list[str]
    expanded: str | None = None
    added: int = 0
    chainid: int = 1


class Etherscan:
    def __init__(self, api_key: str, chainid: int = 1, on_progress: ProgressFn | None = None):
        self.api_key = api_key.strip()
        self.chainid = int(chainid)
        self.on_progress = on_progress
        self.session = requests.Session()
        self._last = 0.0
        self.calls = 0

    def _pace(self) -> None:
        wait = 0.22 - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)

    def get(self, params: dict, *, rpc: bool = False) -> dict | str | list | None:
        query = {"chainid": self.chainid, "apikey": self.api_key, **params}
        last_err = None
        for attempt in range(5):
            self._pace()
            self._last = time.monotonic()
            self.calls += 1
            try:
                resp = self.session.get(ETHERSCAN_V2, params=query, timeout=40)
            except requests.RequestException as exc:
                last_err = str(exc)
                time.sleep(min(2**attempt, 8))
                continue
            if resp.status_code == 429:
                time.sleep(min(2**attempt, 8))
                continue
            try:
                payload = resp.json()
            except ValueError:
                last_err = "non-json response"
                time.sleep(min(2**attempt, 8))
                continue
            blob = json.dumps(payload).lower()
            if "max rate limit" in blob or "rate limit reached" in blob:
                time.sleep(min(2**attempt, 8))
                continue
            if rpc:
                if "error" in payload and payload["error"]:
                    return None
                return payload.get("result")
            status = str(payload.get("status", ""))
            message = str(payload.get("message", ""))
            result = payload.get("result")
            if status == "1":
                return result
            if isinstance(result, str) and result.lower().startswith("0x"):
                return result
            if "no transactions found" in message.lower() or "no records found" in str(result).lower():
                return [] if not rpc else None
            if status == "0" and isinstance(result, str) and "rate limit" in result.lower():
                time.sleep(min(2**attempt, 8))
                continue
            if result is None or result == "Error!":
                return None
            return result
        if last_err:
            return None
        return None

    def contract_creation(self, addresses: list[str]) -> dict[str, dict]:
        found: dict[str, dict] = {}
        for i in range(0, len(addresses), 5):
            chunk = addresses[i : i + 5]
            result = self.get(
                {
                    "module": "contract",
                    "action": "getcontractcreation",
                    "contractaddresses": ",".join(chunk),
                }
            )
            if not isinstance(result, list):
                continue
            for row in result:
                addr = normalize_addr(row.get("contractAddress"))
                if not addr:
                    continue
                found[addr] = row
        return found

    def eth_call(self, to: str, data: str) -> str | None:
        result = self.get(
            {
                "module": "proxy",
                "action": "eth_call",
                "to": to,
                "data": data,
                "tag": "latest",
            },
            rpc=True,
        )
        if not isinstance(result, str) or not result.startswith("0x"):
            return None
        if result in {"0x", "0x0"}:
            return None
        return result

    def storage_at(self, address: str, slot: str) -> str | None:
        result = self.get(
            {
                "module": "proxy",
                "action": "eth_getStorageAt",
                "address": address,
                "position": slot,
                "tag": "latest",
            },
            rpc=True,
        )
        if not isinstance(result, str) or not result.startswith("0x"):
            return None
        return result

    def eth_code(self, address: str) -> str:
        result = self.get(
            {
                "module": "proxy",
                "action": "eth_getCode",
                "address": address,
                "tag": "latest",
            },
            rpc=True,
        )
        return result if isinstance(result, str) else "0x"

    def logs(
        self,
        address: str,
        topic0: str,
        topic1: str,
        from_block: int,
    ) -> list[dict]:
        rows: list[dict] = []
        page = 1
        while page <= 20:
            result = self.get(
                {
                    "module": "logs",
                    "action": "getLogs",
                    "fromBlock": max(from_block, 1),
                    "toBlock": "latest",
                    "address": address,
                    "topic0": topic0,
                    "topic1": topic1,
                    "topic0_1_opr": "and",
                    "page": page,
                    "offset": 1000,
                }
            )
            if isinstance(result, str):
                break
            if not isinstance(result, list) or not result:
                break
            rows.extend(result)
            if len(result) < 1000:
                break
            page += 1
        return rows

    def first_inbound(self, address: str) -> tuple[str, str] | None:
        result = self.get(
            {
                "module": "account",
                "action": "txlist",
                "address": address,
                "startblock": 0,
                "endblock": 99999999,
                "page": 1,
                "offset": 100,
                "sort": "asc",
            }
        )
        if not isinstance(result, list):
            return None
        for tx in result:
            to_addr = (tx.get("to") or "").lower()
            from_addr = normalize_addr(tx.get("from"))
            value = str(tx.get("value") or "0")
            txhash = tx.get("hash") or ""
            if not from_addr or from_addr == address:
                continue
            if to_addr != address:
                continue
            if value == "0":
                continue
            return from_addr, txhash
        return None

    def tx_page(self, address: str, page: int, *, internal: bool = False) -> list[dict]:
        result = self.get(
            {
                "module": "account",
                "action": "txlistinternal" if internal else "txlist",
                "address": address,
                "startblock": 0,
                "endblock": 99999999,
                "page": page,
                "offset": EXPAND_PAGE_SIZE,
                "sort": "desc",
            }
        )
        return result if isinstance(result, list) else []

    def has_admin_role(self, contract: str, account: str) -> bool:
        data = HAS_ROLE_SEL + ("00" * 32) + ("00" * 12) + account[2:]
        raw = self.eth_call(contract, data)
        if not raw:
            return False
        try:
            return int(raw, 16) == 1
        except ValueError:
            return False


def _decode_address_return(data: str | None) -> str | None:
    if not data:
        return None
    return _word_to_addr(data)


def _first_slot(es: Etherscan, address: str, slots: list[tuple[str, str]]) -> tuple[str | None, str]:
    for label, slot in slots:
        found = _decode_address_return(es.storage_at(address, slot))
        if found:
            return found, f"eth_getStorageAt {label} {slot}"
    return None, ""


def _decode_address_array(data: str | None) -> list[str]:
    if not data or not data.startswith("0x"):
        return []
    hexpart = data[2:]
    if len(hexpart) < 128:
        return []
    try:
        offset = int(hexpart[0:64], 16)
        length_start = offset * 2
        length = int(hexpart[length_start : length_start + 64], 16)
    except ValueError:
        return []
    if offset != 32 or length < 1 or length > 32:
        return []
    out: list[str] = []
    cursor = length_start + 64
    for _ in range(length):
        word = hexpart[cursor : cursor + 64]
        cursor += 64
        addr = _word_to_addr(word)
        if addr:
            out.append(addr)
    return out


def _topic_addr(topic: str) -> str | None:
    return _word_to_addr(topic)


def _net_role_admins(granted: list[dict], revoked: list[dict]) -> dict[str, str]:
    events: list[tuple[int, int, str, str, str]] = []
    for row in granted:
        topics = row.get("topics") or []
        if len(topics) < 3:
            continue
        addr = _topic_addr(topics[2])
        if not addr:
            continue
        events.append(
            (
                _intish(row.get("blockNumber")),
                _intish(row.get("logIndex")),
                "grant",
                addr,
                row.get("transactionHash") or "",
            )
        )
    for row in revoked:
        topics = row.get("topics") or []
        if len(topics) < 3:
            continue
        addr = _topic_addr(topics[2])
        if not addr:
            continue
        events.append(
            (
                _intish(row.get("blockNumber")),
                _intish(row.get("logIndex")),
                "revoke",
                addr,
                row.get("transactionHash") or "",
            )
        )
    events.sort()
    current: dict[str, str] = {}
    for _, _, kind, addr, txhash in events:
        if kind == "grant":
            current[addr] = txhash
        else:
            current.pop(addr, None)
    return current


def controllers_table(graph: Graph) -> list[dict]:
    grouped: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for edge in graph.edges.values():
        if edge.rel not in {"DEPLOYED", "ADMIN_OF"}:
            continue
        dst = graph.nodes.get(edge.dst)
        if not dst or not dst.seed:
            continue
        grouped[(edge.src, edge.rel, edge.role)].append(edge.dst)
    rows = []
    for (ctrl, via, role), seeds in grouped.items():
        node = graph.nodes.get(ctrl)
        if node is None:
            continue
        rows.append(
            {
                "controller": ctrl,
                "via": via,
                "role": role,
                "controls": sorted(set(seeds)),
                "wasKnown": node.seed,
            }
        )
    rows.sort(key=lambda r: (r["wasKnown"], -len(r["controls"]), r["controller"], r["via"], r["role"]))
    return rows


def puppeteers_table(graph: Graph) -> list[dict]:
    outgoing: dict[str, list[str]] = defaultdict(list)
    for edge in graph.edges.values():
        if edge.rel not in CONTROL_RELS:
            continue
        outgoing[edge.src].append(edge.dst)
    seed_set = {key for key, node in graph.nodes.items() if node.seed}
    rows = []
    for start in sorted(graph.nodes):
        reached: set[str] = set()
        queue = [(start, 0)]
        visited = {(start, 0)}
        while queue:
            node, depth = queue.pop(0)
            if depth >= 2:
                continue
            for nxt in outgoing.get(node, []):
                nd = depth + 1
                if nxt in seed_set:
                    reached.add(nxt)
                if nd < 2 and (nxt, nd) not in visited:
                    visited.add((nxt, nd))
                    queue.append((nxt, nd))
        if len(reached) > 1:
            rows.append({"puppeteer": start, "seeds": sorted(reached)})
    rows.sort(key=lambda r: (-len(r["seeds"]), r["puppeteer"]))
    return rows


def empire_table(graph: Graph) -> list[dict]:
    grouped: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for edge in graph.edges.values():
        if edge.rel not in {"DEPLOYED", "ADMIN_OF", "SIGNER_OF"}:
            continue
        grouped[edge.src][f"{edge.rel}:{edge.role}"].add(edge.dst)
    rows = []
    for ctrl in grouped:
        by_via = grouped[ctrl]
        contracts: set[str] = set()
        for addrs in by_via.values():
            contracts |= addrs
        node = graph.nodes.get(ctrl)
        if node is None:
            continue
        rows.append(
            {
                "controller": ctrl,
                "count": len(contracts),
                "via": {k: sorted(v) for k, v in sorted(by_via.items())},
                "contracts": sorted(contracts),
                "wasKnown": node.seed,
                "kind": node.kind,
            }
        )
    rows.sort(key=lambda r: (-r["count"], r["controller"]))
    return rows


def graph_to_result(graph: Graph, *, expanded: str | None = None, added: int = 0) -> ResolveResult:
    graph.prune_idle_foreign()
    nodes = []
    for key in sorted(graph.nodes):
        node = graph.nodes[key]
        nodes.append(
            {
                "id": key,
                "addr": node.addr,
                "seed": node.seed,
                "kind": node.kind,
                "wasKnown": node.seed,
                "chain": int(node.chain or graph.chainid or 1),
            }
        )
    edges = []
    for edge in sorted(graph.edges.values(), key=lambda e: (e.src, e.dst, e.rel, e.role)):
        edges.append(
            {
                "from": edge.src,
                "to": edge.dst,
                "rel": edge.rel,
                "role": edge.role,
                "evidence": edge.evidence,
            }
        )
    return ResolveResult(
        nodes=nodes,
        edges=edges,
        controllers=controllers_table(graph),
        puppeteers=puppeteers_table(graph),
        empire=empire_table(graph),
        cypher=to_cypher(graph),
        warnings=list(graph.warnings),
        expanded=expanded,
        added=added,
        chainid=int(graph.chainid or 1),
    )


def graph_from_payload(payload: dict) -> Graph:
    graph = Graph()
    graph.chainid = int(payload.get("chainid") or 1)
    for node in payload.get("nodes") or []:
        graph.add_node(
            node.get("addr") or node["id"],
            seed=bool(node.get("seed")),
            kind=node.get("kind") or "Controller",
            chain=int(node.get("chain") or graph.chainid),
        )
    for edge in payload.get("edges") or []:
        graph.add_edge(edge["from"], edge["to"], edge["rel"], edge.get("role") or "", edge.get("evidence") or "")
    for warning in payload.get("warnings") or []:
        graph.warn(str(warning))
    return graph


def prove_control(es: Etherscan, admin: str, contract: str) -> list[tuple[str, str, str]]:
    proofs: list[tuple[str, str, str]] = []
    owner = _decode_address_return(es.eth_call(contract, OWNER_SEL))
    if owner == admin:
        proofs.append(("ADMIN_OF", "owner", "eth_call owner() 0x8da5cb5b"))
    slot_admin, slot_ev = _first_slot(
        es,
        contract,
        [
            ("eip1967.admin", EIP1967_ADMIN_SLOT),
            ("zos.admin", ZOS_ADMIN_SLOT),
        ],
    )
    if slot_admin == admin:
        proofs.append(("ADMIN_OF", "proxyAdmin", slot_ev))
    if es.has_admin_role(contract, admin):
        proofs.append(("ADMIN_OF", "DEFAULT_ADMIN", "eth_call hasRole(DEFAULT_ADMIN_ROLE)"))
    signers = _decode_address_array(es.eth_call(contract, GET_OWNERS_SEL))
    if admin in signers:
        proofs.append(("SIGNER_OF", "signer", "eth_call getOwners() 0xa0e67e2b"))
    return proofs


def collect_expand_candidates(
    es: Etherscan,
    admin: str,
    on_progress: ProgressFn | None,
    *,
    pages: int | None = None,
    creates_only: bool = False,
) -> dict[str, str]:
    found: dict[str, str] = {}
    n_pages = pages if pages is not None else EXPAND_TX_PAGES

    def note(addr: str | None, evidence: str) -> None:
        if not addr or addr == admin or addr in HUBS:
            return
        found.setdefault(addr, evidence)

    for page in range(1, n_pages + 1):
        if on_progress and not creates_only:
            on_progress(f"Scanning txs of {_short(admin)} p{page}…", page, n_pages + 4)
        txs = es.tx_page(admin, page, internal=False)
        for tx in txs:
            created = normalize_addr(tx.get("contractAddress"))
            txhash = tx.get("hash") or ""
            if created:
                note(created, f"txlist create tx={txhash}")
            if not creates_only and normalize_addr(tx.get("from")) == admin:
                note(normalize_addr(tx.get("to")), f"txlist to tx={txhash}")
        if len(txs) < EXPAND_PAGE_SIZE:
            break

    internal_pages = 2 if creates_only else min(4, n_pages)
    for page in range(1, internal_pages + 1):
        if on_progress and not creates_only:
            on_progress(f"Scanning internal creates p{page}…", n_pages + page, n_pages + 4)
        txs = es.tx_page(admin, page, internal=True)
        for tx in txs:
            created = normalize_addr(tx.get("contractAddress"))
            txhash = tx.get("hash") or ""
            if created:
                note(created, f"txlistinternal create tx={txhash}")
            if str(tx.get("type") or "").lower() == "create":
                note(normalize_addr(tx.get("to")) or created, f"txlistinternal create tx={txhash}")
        if len(txs) < EXPAND_PAGE_SIZE:
            break
    return found


def place_actor(graph: Graph, es: Etherscan, addr: str, kind: str, scan_chain: int) -> int:
    """Place the actor on this chain with the role it has here. Twins link via SAME_AS."""
    scan_chain = int(scan_chain)
    if not addr or addr in HUBS:
        return scan_chain
    if _has_code(es.eth_code(addr)):
        placed_kind = kind if kind in {"Safe", "Contract", "Seed"} else "Controller"
        graph.add_node(addr, kind=placed_kind, chain=scan_chain)
        return scan_chain
    graph.add_node(addr, kind=kind if kind != "Contract" else "Controller", chain=scan_chain)
    return scan_chain


def expand_on_chain(
    graph: Graph,
    es: Etherscan,
    admin: str,
    scan_chain: int,
    on_progress: ProgressFn | None = None,
    *,
    pages: int | None = None,
    creates_only: bool = False,
    max_verify: int | None = None,
) -> int:
    """Scan `admin` on `scan_chain`. Control stays on that plane; identity links to other-chain selves."""
    admin = normalize_addr(admin) or ""
    if not admin or admin in HUBS:
        return 0
    scan_chain = int(scan_chain)
    es.chainid = scan_chain
    admin_chain = scan_chain
    placed = False
    before = len(graph.edges)
    candidates = collect_expand_candidates(
        es,
        admin,
        on_progress,
        pages=pages,
        creates_only=creates_only,
    )
    created = [a for a, ev in candidates.items() if "create" in ev]
    others = [a for a in candidates if a not in created]
    cap = EXPAND_MAX_VERIFY if max_verify is None else max_verify
    ordered = (sorted(created) + sorted(others))[:cap]
    total = max(len(ordered), 1)
    name = CHAIN_NAME.get(scan_chain, str(scan_chain))

    def ensure_admin() -> None:
        nonlocal admin_chain, placed
        if placed:
            return
        admin_chain = place_actor(graph, es, admin, "Controller", scan_chain)
        placed = True

    for i, contract in enumerate(ordered, start=1):
        if on_progress:
            on_progress(f"{name} · proving {_short(contract)} ({i}/{total})", i, total)
        evidence_hint = candidates[contract]
        is_contract = _has_code(es.eth_code(contract))
        prefix = f"{name}: " if scan_chain != int(graph.chainid or 1) else ""
        if "create" in evidence_hint:
            ensure_admin()
            graph.add_node(contract, kind="Contract", chain=scan_chain)
            graph.add_edge(
                admin,
                contract,
                "DEPLOYED",
                "deployer",
                prefix + evidence_hint,
                src_chain=admin_chain,
                dst_chain=scan_chain,
            )
        if not is_contract:
            continue
        proofs = prove_control(es, admin, contract)
        if proofs:
            ensure_admin()
            graph.add_node(contract, kind="Contract", chain=scan_chain)
            for rel, role, evidence in proofs:
                graph.add_edge(
                    admin,
                    contract,
                    rel,
                    role,
                    prefix + evidence,
                    src_chain=admin_chain,
                    dst_chain=scan_chain,
                )
    return len(graph.edges) - before


def attach_local_control(
    graph: Graph,
    es: Etherscan,
    addr: str,
    chain: int,
    *,
    resolved: set[tuple[str, int]] | None = None,
) -> list[tuple[str, int]]:
    """Owner / proxy / roles / Safe signers of a contract on `chain`. Returns new hands (addr, scan_chain)."""
    addr = normalize_addr(addr) or ""
    chain = int(chain)
    if not addr:
        return []
    key = (addr, chain)
    if resolved is not None:
        if key in resolved:
            return []
        resolved.add(key)
    es.chainid = chain
    name = CHAIN_NAME.get(chain, str(chain))
    graph.add_node(addr, kind="Contract", chain=chain)
    hands: list[tuple[str, int]] = []
    extra: list[str] = []

    def note_hand(actor: str | None, kind: str, rel: str, role: str, evidence: str) -> None:
        if not actor or actor == addr or actor in HUBS:
            return
        actor_chain = place_actor(graph, es, actor, kind, chain)
        graph.add_edge(
            actor,
            addr,
            rel,
            role,
            f"{name}: {evidence}",
            src_chain=actor_chain,
            dst_chain=chain,
        )
        node = graph.nodes.get(graph.key_for(actor, actor_chain))
        if node and node.kind == "Contract":
            extra.append(actor)
            return
        hands.append((actor, chain))

    creations = es.contract_creation([addr])
    from_block = 1
    row = creations.get(addr)
    if row:
        from_block = _intish(row.get("blockNumber")) or 1
        note_hand(
            normalize_addr(row.get("contractCreator")),
            "Controller",
            "DEPLOYED",
            "deployer",
            f"getcontractcreation tx={row.get('txHash') or ''}",
        )

    owner = _decode_address_return(es.eth_call(addr, OWNER_SEL))
    if owner:
        note_hand(owner, "Controller", "ADMIN_OF", "owner", "eth_call owner() 0x8da5cb5b")

    admin, admin_ev = _first_slot(
        es,
        addr,
        [("eip1967.admin", EIP1967_ADMIN_SLOT), ("zos.admin", ZOS_ADMIN_SLOT)],
    )
    if admin:
        note_hand(admin, "Controller", "ADMIN_OF", "proxyAdmin", admin_ev)

    impl, impl_ev = _first_slot(
        es,
        addr,
        [("eip1967.impl", EIP1967_IMPL_SLOT), ("zos.impl", ZOS_IMPL_SLOT)],
    )
    if impl:
        place_actor(graph, es, impl, "Controller", chain)
        graph.add_edge(
            impl,
            addr,
            "IMPLEMENTATION_OF",
            "implementation",
            f"{name}: {impl_ev}",
            src_chain=chain,
            dst_chain=chain,
        )

    try:
        granted = es.logs(addr, ROLE_GRANTED, DEFAULT_ADMIN_ROLE, from_block)
        revoked = es.logs(addr, ROLE_REVOKED, DEFAULT_ADMIN_ROLE, from_block)
        for account, txhash in sorted(_net_role_admins(granted, revoked).items()):
            note_hand(account, "Controller", "ADMIN_OF", "DEFAULT_ADMIN", f"RoleGranted tx={txhash}")
    except Exception:
        pass

    signers = _decode_address_array(es.eth_call(addr, GET_OWNERS_SEL))
    if signers:
        graph.add_node(addr, kind="Safe", chain=chain)
        for signer in signers:
            note_hand(signer, "Signer", "SIGNER_OF", "signer", "eth_call getOwners() 0xa0e67e2b")

    seen_hop: set[str] = set()
    for hop in extra:
        if hop in seen_hop:
            continue
        seen_hop.add(hop)
        if not _has_code(es.eth_code(hop)):
            continue
        hop_owner = _decode_address_return(es.eth_call(hop, OWNER_SEL))
        if hop_owner:
            actor_chain = place_actor(graph, es, hop_owner, "Controller", chain)
            graph.add_edge(
                hop_owner,
                hop,
                "ADMIN_OF",
                "owner",
                f"{name}: eth_call owner() 0x8da5cb5b",
                src_chain=actor_chain,
                dst_chain=chain,
            )
            hands.append((hop_owner, chain))
        hop_signers = _decode_address_array(es.eth_call(hop, GET_OWNERS_SEL))
        if hop_signers:
            graph.add_node(hop, kind="Safe", chain=chain)
            for signer in hop_signers:
                actor_chain = place_actor(graph, es, signer, "Signer", chain)
                graph.add_edge(
                    signer,
                    hop,
                    "SIGNER_OF",
                    "signer",
                    f"{name}: eth_call getOwners() 0xa0e67e2b",
                    src_chain=actor_chain,
                    dst_chain=chain,
                )
                hands.append((signer, chain))
    return hands


def expand_controller(
    graph: Graph,
    admin: str,
    api_key: str,
    chainid: int = 1,
    on_progress: ProgressFn | None = None,
) -> ResolveResult:
    raw = (admin or "").strip().lower()
    if "@" in raw:
        hexpart, _, chainpart = raw.partition("@")
        admin = normalize_addr(hexpart) or ""
        try:
            chainid = int(chainpart)
        except ValueError:
            pass
    else:
        admin = normalize_addr(admin) or ""
    if not admin:
        raise ValueError("Not a valid address.")
    if admin in HUBS:
        raise ValueError("That address is a public hub — expanding it is not a discovery.")
    target_chain = int(chainid)
    before = len(graph.edges)
    es = Etherscan(api_key, chainid=target_chain, on_progress=on_progress)
    expand_on_chain(graph, es, admin, target_chain, on_progress)
    added = len(graph.edges) - before
    if on_progress:
        on_progress(f"Expanded {_short(admin)}: +{added} edges", 1, 1)
    admin_key = graph.key_for(admin, target_chain)
    if admin_key not in graph.nodes:
        admin_key = graph.key_for(admin, graph.chainid)
    return graph_to_result(graph, expanded=admin_key, added=added)


def _home_eoa_addrs(graph: Graph, es: Etherscan) -> list[str]:
    home = int(graph.chainid or 1)
    deployed_into = {edge.dst for edge in graph.edges.values() if edge.rel in {"DEPLOYED", "IMPLEMENTATION_OF"}}
    out: list[str] = []
    seen: set[str] = set()
    for key, node in graph.nodes.items():
        if int(node.chain or home) != home:
            continue
        if node.kind in {"Contract", "Safe"}:
            continue
        addr = node.addr
        if not addr or addr in seen or addr in HUBS:
            continue
        if key in deployed_into:
            continue
        seen.add(addr)
        if _has_code(es.eth_code(addr)):
            continue
        out.append(addr)
    return sorted(out)


def scan_other_chains(
    graph: Graph,
    api_key: str,
    on_progress: ProgressFn | None = None,
    *,
    eoas: list[str] | None = None,
) -> ResolveResult:
    if not api_key or not api_key.strip():
        raise ValueError("Etherscan API key is missing.")
    home = int(graph.chainid or 1)
    es = Etherscan(api_key, chainid=home, on_progress=on_progress)
    if eoas is None:
        eoas = _home_eoa_addrs(graph, es)
    else:
        eoas = [a for a in (normalize_addr(x) or "" for x in eoas) if a and a not in HUBS]
    other = [cid for cid in CROSS_CHAIN_IDS if int(cid) != home]
    if not eoas or not other:
        if on_progress:
            on_progress("No EOAs to scan on other chains.", 1, 1)
        return graph_to_result(graph, added=0)
    before = len(graph.edges)
    total = max(len(eoas) * len(other), 1)
    step = 0
    for chain in other:
        es.chainid = int(chain)
        name = CHAIN_NAME.get(chain, str(chain))
        for addr in eoas:
            step += 1
            if on_progress:
                on_progress(f"{name} · {_short(addr)}", step, total)
            expand_on_chain(
                graph,
                es,
                addr,
                chain,
                None,
                pages=CROSS_TX_PAGES,
                creates_only=True,
                max_verify=CROSS_MAX_PER_CHAIN,
            )
    added = len(graph.edges) - before
    if on_progress:
        on_progress(f"Other chains: +{added} edges", total, total)
    return graph_to_result(graph, added=added)


def _foreign_contracts(graph: Graph) -> list[tuple[str, int]]:
    home = int(graph.chainid or 1)
    out: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()
    for node in graph.nodes.values():
        chain = int(node.chain or home)
        if chain == home:
            continue
        if node.kind not in {"Contract", "Safe", "Seed"}:
            continue
        key = (node.addr, chain)
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
    return sorted(out)


def _puppeteer_jobs(graph: Graph, focus: str | None = None) -> list[tuple[str, int]]:
    home = int(graph.chainid or 1)
    jobs: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()
    for edge in graph.edges.values():
        if edge.rel not in {"DEPLOYED", "ADMIN_OF", "SIGNER_OF"}:
            continue
        src = graph.nodes.get(edge.src)
        dst = graph.nodes.get(edge.dst)
        if not src or not dst:
            continue
        scan_chain = int(dst.chain or home)
        if scan_chain == home:
            continue
        if src.kind == "Contract":
            continue
        job = (src.addr, scan_chain)
        if job in seen or src.addr in HUBS:
            continue
        seen.add(job)
        jobs.append(job)
    if focus:
        focus_n = normalize_addr(focus) or focus.split("@", 1)[0]
        jobs.sort(key=lambda j: 0 if j[0] == focus_n else 1)
    return jobs


def explore_other_chains(
    graph: Graph,
    api_key: str,
    on_progress: ProgressFn | None = None,
    focus: str | None = None,
) -> ResolveResult:
    """Discover foreign contracts, resolve them on that chain, expand their puppeteers there."""
    if not api_key or not api_key.strip():
        raise ValueError("Etherscan API key is missing.")
    home = int(graph.chainid or 1)
    es = Etherscan(api_key, chainid=home, on_progress=on_progress)
    before = len(graph.edges)
    known_eoas = set(_home_eoa_addrs(graph, es))
    if focus:
        focus_n = normalize_addr(focus)
        scan_list = [focus_n] if focus_n and focus_n in known_eoas else sorted(known_eoas)
        if focus_n and focus_n in scan_list:
            scan_list = [focus_n] + [a for a in scan_list if a != focus_n]
    else:
        scan_list = sorted(known_eoas)
    scan_other_chains(graph, api_key, on_progress, eoas=scan_list)

    resolved: set[tuple[str, int]] = set()
    expanded: set[tuple[str, int]] = set()

    def tick(msg: str, i: int, n: int) -> None:
        if on_progress:
            on_progress(msg, i, max(n, 1))

    for round_i in range(EXPLORE_ROUNDS):
        foreign = _foreign_contracts(graph)[:EXPLORE_RESOLVE_MAX]
        new_hands: list[tuple[str, int]] = []
        for i, (addr, chain) in enumerate(foreign, start=1):
            tick(f"{CHAIN_NAME.get(chain, chain)} · resolve {_short(addr)}", i, len(foreign))
            new_hands.extend(attach_local_control(graph, es, addr, chain, resolved=resolved))

        jobs = _puppeteer_jobs(graph, focus=focus)
        for hand, chain in new_hands:
            job = (hand, chain)
            if job not in jobs:
                jobs.append(job)
        jobs = [j for j in jobs if j not in expanded][:EXPLORE_EXPAND_MAX]
        if not jobs and round_i > 0:
            break
        for i, (addr, chain) in enumerate(jobs, start=1):
            if (addr, chain) in expanded:
                continue
            expanded.add((addr, chain))
            tick(f"{CHAIN_NAME.get(chain, chain)} · expand {_short(addr)}", i, len(jobs))
            es.chainid = int(chain)
            if addr in HUBS:
                continue
            expand_on_chain(
                graph,
                es,
                addr,
                chain,
                None,
                pages=EXPLORE_EXPAND_PAGES,
                creates_only=False,
                max_verify=CROSS_MAX_PER_CHAIN,
            )

        es.chainid = home
        fresh = [a for a in _home_eoa_addrs(graph, es) if a not in known_eoas]
        if fresh:
            known_eoas.update(fresh)
            tick("New hands · other chains", round_i + 1, EXPLORE_ROUNDS)
            scan_other_chains(graph, api_key, None, eoas=fresh)

    added = len(graph.edges) - before
    if on_progress:
        on_progress(f"Explored other chains: +{added} edges", 1, 1)
    return graph_to_result(graph, added=added)


def to_cypher(graph: Graph) -> str:
    lines = [
        "// Marionette control graph — every edge is one on-chain fact",
        "CREATE CONSTRAINT address_id IF NOT EXISTS FOR (a:Address) REQUIRE a.id IS UNIQUE;",
        "",
    ]
    for key in sorted(graph.nodes):
        node = graph.nodes[key]
        seed = "true" if node.seed else "false"
        chain = int(node.chain or graph.chainid or 1)
        lines.append(
            f"MERGE (a:Address {{id: '{_cypher_escape(key)}'}}) "
            f"SET a.addr = '{_cypher_escape(node.addr)}', a.chain = {chain}, "
            f"a.seed = {seed}, a.kind = '{_cypher_escape(node.kind)}';"
        )
    lines.append("")
    edge_list = sorted(graph.edges.values(), key=lambda e: (e.src, e.dst, e.rel, e.role, e.evidence))
    for edge in edge_list:
        rel = edge.rel
        lines.append(
            f"MATCH (s:Address {{id: '{_cypher_escape(edge.src)}'}}), "
            f"(d:Address {{id: '{_cypher_escape(edge.dst)}'}}) "
            f"MERGE (s)-[r:{rel}]->(d) "
            f"SET r.role = '{_cypher_escape(edge.role)}', r.evidence = '{_cypher_escape(edge.evidence)}';"
        )
    lines.append("")
    return "\n".join(lines) + "\n"


def _short(addr: str) -> str:
    hexpart = (addr or "").split("@", 1)[0]
    if len(hexpart) < 12:
        return addr
    return hexpart[:6] + "…" + hexpart[-4:]


def resolve(
    seeds_text: str,
    api_key: str,
    chainid: int = 1,
    on_progress: ProgressFn | None = None,
) -> ResolveResult:
    seeds = parse_seeds(seeds_text)
    if not seeds:
        raise ValueError("No valid addresses in the seed list.")
    if not api_key or not api_key.strip():
        raise ValueError("Etherscan API key is missing.")

    es = Etherscan(api_key, chainid=chainid, on_progress=on_progress)
    graph = Graph()
    graph.chainid = int(chainid)
    for addr in seeds:
        graph.add_node(addr, seed=True, kind="Seed")

    def tick(msg: str, i: int, n: int) -> None:
        if on_progress:
            on_progress(msg, i, n)

    n_seeds = len(seeds)
    # Rough total: creation batches + ~7 calls/seed + hops + funders
    total = n_seeds * 8 + 8
    step = 0

    def bump(msg: str) -> None:
        nonlocal step
        step += 1
        tick(msg, min(step, total), total)

    bump("Fetching contract creation…")
    creations = es.contract_creation(seeds)
    is_contract: dict[str, bool] = {}
    creation_block: dict[str, int] = {}
    for addr, row in creations.items():
        is_contract[addr] = True
        creator = normalize_addr(row.get("contractCreator"))
        txhash = row.get("txHash") or ""
        creation_block[addr] = _intish(row.get("blockNumber"))
        if creator:
            graph.add_node(creator, kind="Controller")
            graph.add_edge(
                creator,
                addr,
                "DEPLOYED",
                "deployer",
                f"getcontractcreation tx={txhash}",
            )

    code_cache: dict[str, bool] = dict(is_contract)

    def contract_like(addr: str) -> bool:
        if addr in code_cache:
            return code_cache[addr]
        code = es.eth_code(addr)
        flag = _has_code(code)
        code_cache[addr] = flag
        return flag

    extra_contracts: list[str] = []

    for idx, seed in enumerate(seeds, start=1):
        bump(f"Resolving {_short(seed)} ({idx}/{n_seeds}) owner…")
        owner = _decode_address_return(es.eth_call(seed, OWNER_SEL))
        if owner:
            graph.add_node(owner, kind="Controller")
            graph.add_edge(owner, seed, "ADMIN_OF", "owner", "eth_call owner() 0x8da5cb5b")
            extra_contracts.append(owner)

        bump(f"Resolving {_short(seed)} proxy slots…")
        admin, admin_ev = _first_slot(
            es,
            seed,
            [
                ("eip1967.admin", EIP1967_ADMIN_SLOT),
                ("zos.admin", ZOS_ADMIN_SLOT),
            ],
        )
        if admin:
            graph.add_node(admin, kind="Controller")
            graph.add_edge(admin, seed, "ADMIN_OF", "proxyAdmin", admin_ev)
            extra_contracts.append(admin)

        impl, impl_ev = _first_slot(
            es,
            seed,
            [
                ("eip1967.impl", EIP1967_IMPL_SLOT),
                ("zos.impl", ZOS_IMPL_SLOT),
            ],
        )
        if impl:
            graph.add_node(impl, kind="Controller")
            graph.add_edge(impl, seed, "IMPLEMENTATION_OF", "implementation", impl_ev)

        bump(f"Resolving {_short(seed)} AccessControl…")
        from_block = creation_block.get(seed, 1)
        try:
            granted = es.logs(seed, ROLE_GRANTED, DEFAULT_ADMIN_ROLE, from_block)
            revoked = es.logs(seed, ROLE_REVOKED, DEFAULT_ADMIN_ROLE, from_block)
            admins = _net_role_admins(granted, revoked)
            for account, txhash in sorted(admins.items()):
                graph.add_node(account, kind="Controller")
                graph.add_edge(
                    account,
                    seed,
                    "ADMIN_OF",
                    "DEFAULT_ADMIN",
                    f"RoleGranted tx={txhash}",
                )
        except Exception as exc:  # noqa: BLE001
            graph.warn(f"AccessControl skipped for {seed}: {exc}")

        bump(f"Resolving {_short(seed)} Safe owners…")
        signers = _decode_address_array(es.eth_call(seed, GET_OWNERS_SEL))
        if signers:
            graph.add_node(seed, kind="Safe")
            for signer in signers:
                graph.add_node(signer, kind="Signer")
                graph.add_edge(signer, seed, "SIGNER_OF", "signer", "eth_call getOwners() 0xa0e67e2b")

    # One extra hop: ProxyAdmin owner(), and Safe owners of owner/admin contracts.
    seen_hop: set[str] = set()
    hop_targets = []
    for addr in extra_contracts:
        if addr not in seen_hop:
            seen_hop.add(addr)
            hop_targets.append(addr)

    for addr in hop_targets:
        bump(f"Extra hop on {_short(addr)}…")
        if not contract_like(addr):
            continue
        hop_owner = _decode_address_return(es.eth_call(addr, OWNER_SEL))
        if hop_owner:
            graph.add_node(hop_owner, kind="Controller")
            graph.add_edge(hop_owner, addr, "ADMIN_OF", "owner", "eth_call owner() 0x8da5cb5b")
        hop_signers = _decode_address_array(es.eth_call(addr, GET_OWNERS_SEL))
        if hop_signers:
            graph.add_node(addr, kind="Safe")
            for signer in hop_signers:
                graph.add_node(signer, kind="Signer")
                graph.add_edge(signer, addr, "SIGNER_OF", "signer", "eth_call getOwners() 0xa0e67e2b")

    eoa_controllers = []
    for edge in graph.edges.values():
        if edge.rel not in {"DEPLOYED", "ADMIN_OF", "SIGNER_OF"}:
            continue
        src = edge.src
        if src in seeds:
            continue
        eoa_controllers.append(src)
    eoa_controllers = sorted(set(eoa_controllers))

    for addr in eoa_controllers:
        bump(f"First inbound ETH for {_short(addr)}…")
        if contract_like(addr):
            continue
        funded = es.first_inbound(addr)
        if not funded:
            continue
        funder, txhash = funded
        if funder in HUBS:
            continue
        graph.add_node(funder, kind="Funder")
        graph.add_edge(funder, addr, "FUNDED", "paymaster", f"txlist first inbound tx={txhash}")

    tick("Building graph…", total, total)
    return graph_to_result(graph)


def result_to_dict(result: ResolveResult) -> dict:
    return {
        "nodes": result.nodes,
        "edges": result.edges,
        "controllers": result.controllers,
        "puppeteers": result.puppeteers,
        "empire": result.empire,
        "cypher": result.cypher,
        "warnings": result.warnings,
        "expanded": result.expanded,
        "added": result.added,
        "chainid": result.chainid,
    }


def env_path() -> Path:
    return Path(__file__).resolve().parent / ".env"


def read_env_key() -> str:
    load_dotenv(env_path(), override=True)
    return os.environ.get("ETHERSCAN_API_KEY", "").strip()


def write_env(updates: dict[str, str]) -> None:
    path = env_path()
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    keys = {k: v.strip() for k, v in updates.items()}
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        matched = False
        for key, value in keys.items():
            if line.startswith(f"{key}="):
                out.append(f"{key}={value}")
                seen.add(key)
                matched = True
                break
        if not matched:
            out.append(line)
    for key, value in keys.items():
        if key not in seen:
            if out and out[-1].strip():
                out.append("")
            out.append(f"{key}={value}")
        os.environ[key] = value
    path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")


def write_env_key(api_key: str) -> None:
    write_env({"ETHERSCAN_API_KEY": api_key})


def main() -> None:
    load_dotenv(env_path())
    root = Path(__file__).resolve().parent
    seeds_file = root / "seeds.txt"
    if not seeds_file.exists():
        raise SystemExit("Put addresses in seeds.txt (one per line), then re-run.")
    key = os.environ.get("ETHERSCAN_API_KEY", "").strip()
    result = resolve(seeds_file.read_text(encoding="utf-8"), key)
    out = root / "out.cypher"
    out.write_text(result.cypher, encoding="utf-8")
    print(f"Wrote {out} — {len(result.nodes)} nodes, {len(result.edges)} edges, {result.warnings and 'warnings: ' + str(result.warnings) or 'no warnings'}")


if __name__ == "__main__":
    main()
