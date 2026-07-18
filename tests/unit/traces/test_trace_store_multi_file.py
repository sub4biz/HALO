"""Multi-file dataset coverage: several JSONL files queried as one dataset.

``TraceStore.load_many`` unions independently-indexed files; trace ids
must be unique across them. Every query surface (view/search/filters/
overview) must treat the union as one dataset with no file boundaries
visible to callers.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio

from engine.traces.models.trace_index_config import TraceIndexConfig
from engine.traces.models.trace_query_models import TraceFilters
from engine.traces.trace_index_builder import TraceIndexBuilder
from engine.traces.trace_store import TraceStore


async def _source(tmp_path: Path, fixtures_dir: Path, fixture: str, name: str) -> tuple[Path, Path]:
    trace_path = tmp_path / name
    trace_path.write_bytes((fixtures_dir / fixture).read_bytes())
    index_path = await TraceIndexBuilder.ensure_index_exists(
        trace_path=trace_path, config=TraceIndexConfig()
    )
    return trace_path, index_path


@pytest_asyncio.fixture
async def multi_store(tmp_path: Path, fixtures_dir: Path) -> TraceStore:
    first = await _source(tmp_path, fixtures_dir, "tiny_traces.jsonl", "traces.jsonl")
    second = await _source(tmp_path, fixtures_dir, "tiny_traces_second_file.jsonl", "second.jsonl")
    return TraceStore.load_many([first, second])


@pytest.mark.asyncio
async def test_load_many_unions_trace_counts(multi_store: TraceStore) -> None:
    assert multi_store.trace_count == 5
    assert len(multi_store.trace_paths) == 2


@pytest.mark.asyncio
async def test_view_trace_reads_from_the_owning_file(multi_store: TraceStore) -> None:
    from_first = multi_store.view_trace("t-bbbb")
    assert [s.span_id for s in from_first.spans] == ["s-bbbb-1", "s-bbbb-2"]
    from_second = multi_store.view_trace("x-1111")
    assert [s.span_id for s in from_second.spans] == ["sx-1111-1"]
    assert from_second.spans[0].attributes["verdict.target_trace_id"] == "t-aaaa"


@pytest.mark.asyncio
async def test_search_trace_scans_second_file(multi_store: TraceStore) -> None:
    result = multi_store.search_trace("x-1111", "verdict.alpha")
    assert result.match_count == 1
    assert result.matches[0].span_id == "sx-1111-1"


@pytest.mark.asyncio
async def test_overview_and_filters_span_both_files(multi_store: TraceStore) -> None:
    overview = multi_store.get_overview(TraceFilters())
    assert overview.total_traces == 5
    assert "verdict-service" in overview.service_names

    only_second = multi_store.query_traces(TraceFilters(service_names=["verdict-service"]))
    assert sorted(t.trace_id for t in only_second.traces) == ["x-1111", "x-2222"]

    # The scan-heavy regex filter opens each file once and unions matches.
    regex_hit = multi_store.query_traces(TraceFilters(regex_pattern="verdict\\.beta"))
    assert [t.trace_id for t in regex_hit.traces] == ["x-2222"]


@pytest.mark.asyncio
async def test_load_many_rejects_duplicate_trace_ids(tmp_path: Path, fixtures_dir: Path) -> None:
    first = await _source(tmp_path, fixtures_dir, "tiny_traces.jsonl", "traces.jsonl")
    duplicate = await _source(tmp_path, fixtures_dir, "tiny_traces.jsonl", "dupe.jsonl")
    with pytest.raises(ValueError, match="appears in more than one dataset file"):
        TraceStore.load_many([first, duplicate])


@pytest.mark.asyncio
async def test_load_many_requires_a_source() -> None:
    with pytest.raises(ValueError, match="at least one"):
        TraceStore.load_many([])


@pytest.mark.asyncio
async def test_single_file_load_unchanged(tmp_path: Path, fixtures_dir: Path) -> None:
    trace_path, index_path = await _source(
        tmp_path, fixtures_dir, "tiny_traces.jsonl", "traces.jsonl"
    )
    store = TraceStore.load(trace_path=trace_path, index_path=index_path)
    assert store.trace_count == 3
    assert store.trace_path == trace_path
    assert store.index_path == index_path
    assert store.trace_paths == [trace_path]
