"""Marionette Light — Trace / Expand / Other chains. Visitor brings their API key."""

from __future__ import annotations

import json
import queue
import threading
import time
import webbrowser
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

from resolve import (
    expand_controller,
    explore_other_chains,
    graph_from_payload,
    graph_to_result,
    read_env_key,
    resolve,
    result_to_dict,
)

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
PORT = 8766

app = Flask(__name__, static_folder=str(STATIC), static_url_path="/static")
_run_lock = threading.Lock()
_last_graph = None
_last_chainid = 1


def _restore_last() -> None:
    global _last_graph
    path = ROOT / "last.json"
    if not path.exists():
        return
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        _last_graph = graph_from_payload(payload)
    except (OSError, ValueError, KeyError):
        pass


_restore_last()


def _save_result(result) -> dict:
    global _last_graph
    payload = result_to_dict(result)
    _last_graph = graph_from_payload(payload)
    (ROOT / "last.json").write_text(json.dumps(payload), encoding="utf-8")
    return payload


def _graph_from_body(body: dict):
    """Prefer client graph (stateless); fall back to last local graph."""
    global _last_graph
    if body.get("graph") and (body["graph"].get("nodes") or body["graph"].get("edges")):
        return graph_from_payload(body["graph"])
    if _last_graph is not None:
        return _last_graph
    return None


def _api_key(body: dict) -> str:
    return str(body.get("apiKey") or "").strip() or read_env_key()


@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "name": "Marionette Light"})


@app.post("/api/run")
def run():
    if not _run_lock.acquire(blocking=False):
        return jsonify({"error": "A run is already in progress."}), 409
    body = request.get_json(force=True, silent=True) or {}
    seeds = str(body.get("seeds") or "")
    api_key = _api_key(body)
    try:
        chainid = int(body.get("chainid") or 1)
    except (TypeError, ValueError):
        chainid = 1
    global _last_chainid
    _last_chainid = chainid
    events: queue.Queue = queue.Queue()

    def worker():
        try:

            def on_progress(msg: str, current: int, total: int) -> None:
                events.put({"type": "progress", "message": msg, "current": current, "total": total})

            result = resolve(seeds, api_key, chainid=chainid, on_progress=on_progress)
            payload = _save_result(result)
            events.put({"type": "done", **payload})
        except Exception as exc:  # noqa: BLE001
            events.put({"type": "error", "message": str(exc)})
        finally:
            _run_lock.release()

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        while True:
            item = events.get()
            yield f"data: {json.dumps(item)}\n\n"
            if item.get("type") in {"done", "error"}:
                break

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/expand")
def expand():
    if not _run_lock.acquire(blocking=False):
        return jsonify({"error": "A run is already in progress."}), 409
    body = request.get_json(force=True, silent=True) or {}
    addr = str(body.get("addr") or "").strip()
    api_key = _api_key(body)
    chainid = int(body.get("chainid") or _last_chainid or 1)
    events: queue.Queue = queue.Queue()

    def worker():
        global _last_graph
        try:
            graph = _graph_from_body(body)
            if graph is None:
                raise ValueError("Trace first, then expand a hand.")

            def on_progress(msg: str, current: int, total: int) -> None:
                events.put({"type": "progress", "message": msg, "current": current, "total": total})

            result = expand_controller(graph, addr, api_key, chainid=chainid, on_progress=on_progress)
            payload = _save_result(result)
            events.put({"type": "done", **payload})
        except Exception as exc:  # noqa: BLE001
            events.put({"type": "error", "message": str(exc)})
        finally:
            _run_lock.release()

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        while True:
            item = events.get()
            yield f"data: {json.dumps(item)}\n\n"
            if item.get("type") in {"done", "error"}:
                break

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/scan-chains")
def scan_chains():
    if not _run_lock.acquire(blocking=False):
        return jsonify({"error": "A run is already in progress."}), 409
    body = request.get_json(force=True, silent=True) or {}
    api_key = _api_key(body)
    focus = str(body.get("addr") or body.get("focus") or "").strip() or None
    include_testnets = bool(body.get("includeTestnets") or body.get("include_testnets"))
    events: queue.Queue = queue.Queue()

    def worker():
        global _last_graph
        try:
            graph = _graph_from_body(body)
            if graph is None:
                raise ValueError("Trace first, then scan other chains.")

            def on_progress(msg: str, current: int, total: int) -> None:
                events.put({"type": "progress", "message": msg, "current": current, "total": total})

            result = explore_other_chains(
                graph,
                api_key,
                on_progress=on_progress,
                focus=focus,
                include_testnets=include_testnets,
            )
            payload = _save_result(result)
            events.put({"type": "done", **payload})
        except Exception as exc:  # noqa: BLE001
            events.put({"type": "error", "message": str(exc)})
        finally:
            _run_lock.release()

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        while True:
            item = events.get()
            yield f"data: {json.dumps(item)}\n\n"
            if item.get("type") in {"done", "error"}:
                break

    return Response(
        stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/last")
def last_graph():
    if _last_graph is not None:
        return jsonify(result_to_dict(graph_to_result(_last_graph)))
    path = ROOT / "last.json"
    if path.exists():
        return Response(path.read_text(encoding="utf-8"), mimetype="application/json")
    return jsonify({"error": "No graph yet."}), 404


def _wait_ready(timeout: float = 12.0) -> bool:
    import urllib.request

    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{PORT}/"
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=0.5)
            return True
        except Exception:
            time.sleep(0.1)
    return False


def main() -> None:
    def serve() -> None:
        app.run(host="127.0.0.1", port=PORT, threaded=True, use_reloader=False)

    threading.Thread(target=serve, daemon=True).start()
    if not _wait_ready():
        raise SystemExit("Could not start Marionette Light.")
    url = f"http://127.0.0.1:{PORT}/"
    try:
        import webview

        webview.create_window("Marionette Light", url, width=1280, height=860, min_size=(900, 640))
        webview.start()
    except Exception:
        webbrowser.open(url)
        print(f"Marionette Light at {url} — leave this terminal running.")
        threading.Event().wait()


if __name__ == "__main__":
    main()
