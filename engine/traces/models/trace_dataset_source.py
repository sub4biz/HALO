from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict, TypeAdapter


class TraceDatasetSource(BaseModel):
    """One dataset file: its JSONL trace path and sidecar index path.

    The single typed representation of a ``TraceStore.load_many`` source,
    used everywhere a (trace, index) pair travels: the store's loaded
    sources, ``run_python``'s dataset argument, and the sandbox
    ``bootstrap`` RPC. The host builds a list of these and the in-Pyodide
    ``halo_bootstrap`` validates the same shape back out, so the multi-file
    boundary is typed on both ends rather than a loose JSON array of dicts.
    Paths serialize to strings over the JSON-RPC boundary and parse back to
    ``Path`` via pydantic.
    """

    model_config = ConfigDict(extra="forbid")

    trace_path: Path
    index_path: Path


# Validates the ``bootstrap`` payload (a JSON array of sources) in one call.
# Module-level so the adapter is built once.
TRACE_DATASET_SOURCES_ADAPTER = TypeAdapter(list[TraceDatasetSource])
