from __future__ import annotations

from engine.traces.models.trace_index_config import TraceIndexConfig


def test_defaults() -> None:
    cfg = TraceIndexConfig()
    assert cfg.schema_version == 2


def test_explicit_schema_version() -> None:
    cfg = TraceIndexConfig(schema_version=1)
    assert cfg.schema_version == 1
