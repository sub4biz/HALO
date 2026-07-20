from __future__ import annotations

from pathlib import Path

from engine.traces.models.trace_index_config import TraceIndexConfig


def test_defaults() -> None:
    cfg = TraceIndexConfig()
    assert cfg.index_dir is None
    assert cfg.schema_version == 2


def test_explicit_index_dir(tmp_path: Path) -> None:
    cfg = TraceIndexConfig(index_dir=tmp_path / "indexes", schema_version=1)
    assert cfg.index_dir == tmp_path / "indexes"
    assert cfg.schema_version == 1
