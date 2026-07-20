from __future__ import annotations

import pytest
from pydantic import ValidationError

from engine.traces.models.trace_dataset_source import (
    TRACE_DATASET_SOURCES_ADAPTER,
    TraceDatasetSource,
)


def test_adapter_round_trips_the_bootstrap_payload() -> None:
    """The host serializes a list of sources; the adapter validates the same shape back."""
    sources = [
        TraceDatasetSource(trace_path="/input/traces_0.jsonl", index_path="/input/index_0.jsonl"),
        TraceDatasetSource(trace_path="/input/traces_1.jsonl", index_path="/input/index_1.jsonl"),
    ]
    payload = TRACE_DATASET_SOURCES_ADAPTER.dump_json(sources)

    assert TRACE_DATASET_SOURCES_ADAPTER.validate_json(payload) == sources


def test_validate_json_parses_the_wire_dict_shape() -> None:
    """The wire is a JSON array of ``{trace_path, index_path}`` objects."""
    payload = '[{"trace_path": "/input/traces_0.jsonl", "index_path": "/input/index_0.jsonl"}]'

    assert TRACE_DATASET_SOURCES_ADAPTER.validate_json(payload) == [
        TraceDatasetSource(trace_path="/input/traces_0.jsonl", index_path="/input/index_0.jsonl")
    ]


def test_rejects_unknown_keys() -> None:
    """``extra="forbid"`` catches a drifted wire shape instead of silently ignoring it."""
    with pytest.raises(ValidationError):
        TraceDatasetSource.model_validate({"trace_path": "/a", "index_path": "/b", "unexpected": 1})
