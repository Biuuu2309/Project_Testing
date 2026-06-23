from datetime import datetime, timezone


def to_iso_utc(dt: datetime | None) -> str | None:
    """Serialize naive UTC datetimes from DB with Z suffix for correct client parsing."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") + "Z"
