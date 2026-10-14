"""Cache local : mémoire + fichier SQLite.

Chaque donnée a une durée de fraîcheur (ttl). Quand elle est périmée, on la redemande
à la source ; si la source ne répond pas, on renvoie la dernière version connue
en la marquant « stale » plutôt que d'afficher une erreur.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable


class Cache:
    def __init__(self, path: Path, memory_items: int = 400):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db_lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, timeout=10)
        with self._db_lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, fetched_at REAL, payload TEXT)"
            )
            self._db.commit()
        self._mem: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._mem_lock = threading.Lock()
        self._memory_items = memory_items
        self._key_locks: dict[str, threading.Lock] = {}
        self._key_locks_guard = threading.Lock()

    # -- stockage -----------------------------------------------------------------

    def _read(self, key: str) -> tuple[float, Any] | None:
        with self._mem_lock:
            entry = self._mem.get(key)
            if entry is not None:
                self._mem.move_to_end(key)
                return entry
        with self._db_lock:
            row = self._db.execute("SELECT fetched_at, payload FROM cache WHERE key = ?", (key,)).fetchone()
        if row is None:
            return None
        try:
            entry = (row[0], json.loads(row[1]))
        except ValueError:
            return None
        self._remember(key, entry)
        return entry

    def _remember(self, key: str, entry: tuple[float, Any]) -> None:
        with self._mem_lock:
            self._mem[key] = entry
            self._mem.move_to_end(key)
            while len(self._mem) > self._memory_items:
                self._mem.popitem(last=False)

    def _write(self, key: str, data: Any, persist: bool) -> tuple[float, Any]:
        entry = (time.time(), data)
        self._remember(key, entry)
        if persist:
            payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
            with self._db_lock:
                self._db.execute(
                    "INSERT OR REPLACE INTO cache (key, fetched_at, payload) VALUES (?, ?, ?)",
                    (key, entry[0], payload),
                )
                self._db.commit()
        return entry

    def _lock_for(self, key: str) -> threading.Lock:
        with self._key_locks_guard:
            lock = self._key_locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._key_locks[key] = lock
            return lock

    # -- API ----------------------------------------------------------------------

    def peek(self, key: str) -> tuple[float, Any] | None:
        return self._read(key)

    def get(
        self,
        key: str,
        ttl: float | Callable[[Any], float],
        fetch: Callable[[], Any],
        persist: bool = True,
    ) -> tuple[Any, dict]:
        """Renvoie (données, méta). ttl peut dépendre des données en cache (ex. match en cours)."""

        def fresh_enough(entry: tuple[float, Any] | None) -> bool:
            if entry is None:
                return False
            limit = ttl(entry[1]) if callable(ttl) else ttl
            return (time.time() - entry[0]) < limit

        entry = self._read(key)
        if fresh_enough(entry):
            return entry[1], {"fetchedAt": entry[0], "stale": False}

        with self._lock_for(key):
            entry = self._read(key)
            if fresh_enough(entry):
                return entry[1], {"fetchedAt": entry[0], "stale": False}
            try:
                data = fetch()
            except Exception as exc:  # noqa: BLE001 - toute erreur de source est rattrapée ici
                if entry is not None:
                    return entry[1], {"fetchedAt": entry[0], "stale": True, "error": str(exc)}
                raise
            fetched_at, data = self._write(key, data, persist)
            return data, {"fetchedAt": fetched_at, "stale": False}

    def stats(self) -> dict:
        with self._db_lock:
            count, size = self._db.execute("SELECT COUNT(*), COALESCE(SUM(LENGTH(payload)), 0) FROM cache").fetchone()
        return {"entries": count, "bytes": size, "path": str(self.path)}

    def clear(self) -> None:
        with self._db_lock:
            self._db.execute("DELETE FROM cache")
            self._db.commit()
        with self._mem_lock:
            self._mem.clear()
