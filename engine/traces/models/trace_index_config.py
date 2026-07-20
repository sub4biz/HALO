from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict


class TraceIndexConfig(BaseModel):
    """Sidecar index settings. Index is build-once: existing files are reused as-is.

    ``index_dir`` optionally redirects where sidecar indexes are written:
    when set, each dataset file's index is a distinct file inside that one
    directory (named after the trace file), so a single ``index_dir``
    serves an entire multi-file dataset — and doubles as a stable cache
    location. When unset, each file's index derives next to it as
    ``<trace>.engine-index.jsonl``.
    """

    model_config = ConfigDict(extra="forbid")

    index_dir: Path | None = None
    schema_version: int = 2
