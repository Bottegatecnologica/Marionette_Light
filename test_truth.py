"""Truth gates for Marionette Light — no live API required."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from resolve import (
    Graph,
    attach_local_control,
    expand_on_chain,
    graph_to_result,
)


class TruthGates(unittest.TestCase):
    def test_default_admin_requires_has_role(self) -> None:
        graph = Graph()
        graph.chainid = 1
        es = MagicMock()
        es.chainid = 1
        es.contract_creation.return_value = {}
        es.eth_call.return_value = None
        es.storage_at.return_value = None
        es.eth_code.return_value = "0x60016001"
        es.logs.side_effect = [
            [
                {
                    "topics": [
                        "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d",
                        "0x" + ("00" * 32),
                        "0x" + ("00" * 12) + "1111111111111111111111111111111111111111",
                    ],
                    "blockNumber": "10",
                    "logIndex": "1",
                    "transactionHash": "0xabc",
                }
            ],
            [],
        ]
        es.has_admin_role.return_value = False

        attach_local_control(graph, es, "0x2222222222222222222222222222222222222222", 1)

        admin_edges = [e for e in graph.edges.values() if e.rel == "ADMIN_OF" and e.role == "DEFAULT_ADMIN"]
        self.assertEqual(admin_edges, [])
        es.has_admin_role.assert_called()

    def test_default_admin_kept_when_has_role(self) -> None:
        graph = Graph()
        graph.chainid = 1
        seed = "0x2222222222222222222222222222222222222222"
        account = "0x1111111111111111111111111111111111111111"
        es = MagicMock()
        es.chainid = 1
        es.contract_creation.return_value = {}
        es.eth_call.return_value = None
        es.storage_at.return_value = None
        es.eth_code.return_value = "0x60016001"
        es.logs.side_effect = [
            [
                {
                    "topics": [
                        "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d",
                        "0x" + ("00" * 32),
                        "0x" + ("00" * 12) + account[2:],
                    ],
                    "blockNumber": "10",
                    "logIndex": "1",
                    "transactionHash": "0xabc",
                }
            ],
            [],
        ]
        es.has_admin_role.return_value = True

        attach_local_control(graph, es, seed, 1)

        admin_edges = [e for e in graph.edges.values() if e.rel == "ADMIN_OF" and e.role == "DEFAULT_ADMIN"]
        self.assertEqual(len(admin_edges), 1)
        self.assertIn("hasRole", admin_edges[0].evidence)

    def test_expand_deployed_requires_creator_match(self) -> None:
        graph = Graph()
        graph.chainid = 1
        admin = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        child = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        es = MagicMock()
        es.chainid = 1
        es.tx_page.side_effect = [
            [{"contractAddress": child, "hash": "0x1", "from": admin, "to": ""}],
            [],
        ]
        # internal pages
        es.tx_page.side_effect = None

        def tx_page(address, page, *, internal=False):
            if internal:
                return []
            if page == 1:
                return [{"contractAddress": child, "hash": "0x1", "from": admin, "to": ""}]
            return []

        es.tx_page.side_effect = tx_page
        es.eth_code.return_value = "0x60016001"
        es.contract_creation.return_value = {
            child: {"contractCreator": "0xcccccccccccccccccccccccccccccccccccccccc", "txHash": "0x1"}
        }
        es.eth_call.return_value = None
        es.storage_at.return_value = None
        es.has_admin_role.return_value = False

        expand_on_chain(graph, es, admin, 1, pages=1, creates_only=True, max_verify=5)
        deployed = [e for e in graph.edges.values() if e.rel == "DEPLOYED"]
        self.assertEqual(deployed, [])

    def test_expand_deployed_when_creator_is_admin(self) -> None:
        graph = Graph()
        graph.chainid = 1
        admin = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        child = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        es = MagicMock()
        es.chainid = 1

        def tx_page(address, page, *, internal=False):
            if internal:
                return []
            if page == 1:
                return [{"contractAddress": child, "hash": "0x1", "from": admin, "to": ""}]
            return []

        es.tx_page.side_effect = tx_page
        es.eth_code.return_value = "0x60016001"
        es.contract_creation.return_value = {
            child: {"contractCreator": admin, "txHash": "0xdead"}
        }
        es.eth_call.return_value = None
        es.storage_at.return_value = None
        es.has_admin_role.return_value = False

        expand_on_chain(graph, es, admin, 1, pages=1, creates_only=True, max_verify=5)
        deployed = [e for e in graph.edges.values() if e.rel == "DEPLOYED"]
        self.assertEqual(len(deployed), 1)
        self.assertIn("getcontractcreation", deployed[0].evidence)

    def test_implementation_is_contract_kind(self) -> None:
        graph = Graph()
        graph.chainid = 1
        seed = "0x2222222222222222222222222222222222222222"
        impl = "0x3333333333333333333333333333333333333333"
        es = MagicMock()
        es.chainid = 1
        es.contract_creation.return_value = {}
        es.eth_call.return_value = None
        # admin slots empty, impl slot hits on second call path via storage_at sequence
        es.storage_at.side_effect = [None, None, "0x" + ("00" * 12) + impl[2:], None]
        es.eth_code.return_value = "0x60016001"
        es.logs.return_value = []
        es.has_admin_role.return_value = False

        attach_local_control(graph, es, seed, 1)
        impl_nodes = [n for n in graph.nodes.values() if n.addr == impl]
        self.assertTrue(impl_nodes)
        self.assertEqual(impl_nodes[0].kind, "Contract")
        result = graph_to_result(graph)
        self.assertTrue(any(e["rel"] == "IMPLEMENTATION_OF" for e in result.edges))


if __name__ == "__main__":
    unittest.main()
