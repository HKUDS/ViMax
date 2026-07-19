import re


def safe_path_component(name) -> str:
    """Sanitize an LLM-derived identifier for use as a filesystem path component.

    Identifiers come from model output over user-supplied story text, so they may
    contain separators or traversal sequences; keep word characters (including
    CJK), dashes, dots and spaces, replace everything else, and strip leading
    dots so the result can never escape or hide within the working directory.
    """
    cleaned = re.sub(r"[^\w\-. ]", "_", str(name))
    cleaned = cleaned.strip().lstrip(".")
    return cleaned or "unnamed"


def _iter_score_chunk_files(chunks_dir: str):
    """Yield (path, score) for chunk_*-score_*.txt files in a resume cache dir."""
    import os
    for chunk_fname in os.listdir(chunks_dir):
        if "-score_" not in chunk_fname or not chunk_fname.endswith(".txt"):
            continue
        score = float(chunk_fname.split("-score_")[1].split(".txt")[0])
        yield os.path.join(chunks_dir, chunk_fname), score
