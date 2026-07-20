from __future__ import annotations

from pydantic import BaseModel, ConfigDict, TypeAdapter


class TraceDatasetSource(BaseModel):
    """One dataset file: its JSONL trace path and sidecar index path.

    The serializable form of a single ``TraceStore.load_many`` source. It
    is the typed wire contract for the sandbox ``bootstrap`` RPC: the host
    builds a list of these (one per mounted file) and the in-Pyodide
    ``halo_bootstrap`` validates the same shape back out before rebuilding
    the ``TraceStore``, so the multi-file boundary is typed on both ends
    rather than a loose JSON array of dicts. Paths are strings because
    they cross the JSON-RPC boundary as text.
    """

    model_config = ConfigDict(extra="forbid")

    trace_path: str
    index_path: str


# Validates the ``bootstrap`` payload (a JSON array of sources) in one call.
# Module-level so the adapter is built once.
TRACE_DATASET_SOURCES_ADAPTER = TypeAdapter(list[TraceDatasetSource])
