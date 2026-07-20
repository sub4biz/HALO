from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class TraceIndexConfig(BaseModel):
    """Dataset-wide index config. Index is build-once: existing files are reused as-is.

    The per-file index *location* is not here — it belongs on each
    ``TraceDataset`` (a sidecar location is a per-file property, not a
    dataset-wide one), so this only carries settings that apply uniformly
    across every file.
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: int = 2
