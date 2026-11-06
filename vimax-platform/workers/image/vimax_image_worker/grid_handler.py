"""Grid split handler — splits an image into N×N sub-images using Pillow."""
import os
import json
import hashlib
import asyncio
import logging
from PIL import Image

from vimax_image_worker.reporter import JobReporter
from vimax_image_worker.asset_downloader import download_from_s3
from vimax_image_worker.asset_uploader import upload_to_s3

log = logging.getLogger("grid-handler")

async def handle_grid_split(payload: dict, reporter: JobReporter):
    """Split an image into a grid and upload each cell."""
    await reporter.started()

    try:
        input_data = payload["input"]
        source_key = input_data["source_storage_key"]
        grid_size = input_data["grid_size"]
        n = 3 if grid_size == "3x3" else 5

        callback = payload["callback"]
        bucket = callback["upload_bucket"]
        prefix = callback["upload_prefix"]

        # Download source image
        local_path = download_from_s3(source_key, f"/tmp/grid_src_{payload['job_id']}.png")

        img = Image.open(local_path)
        w, h = img.size
        cell_w = w // n
        cell_h = h // n

        results = []
        for row in range(n):
            for col in range(n):
                left = col * cell_w
                top = row * cell_h
                right = left + cell_w
                bottom = top + cell_h
                cell = img.crop((left, top, right, bottom))

                cell_path = f"/tmp/grid_{payload['job_id']}_{row}_{col}.png"
                cell.save(cell_path, "PNG")

                # Upload cell
                storage_key = f"{prefix}_r{row}_c{col}.png"
                upload_result = upload_to_s3(cell_path, bucket, storage_key)

                # Compute SHA256
                with open(cell_path, "rb") as f:
                    sha = hashlib.sha256(f.read()).hexdigest()

                results.append({
                    "storage_key": storage_key,
                    "width": cell_w,
                    "height": cell_h,
                    "sha256": sha,
                    "mime_type": "image/png",
                    "size_bytes": os.path.getsize(cell_path),
                    "grid_row": row,
                    "grid_col": col,
                })

                # Cleanup
                os.unlink(cell_path)

        os.unlink(local_path)

        # Report completion with the first cell as primary output
        # The full list is in the result
        await reporter.completed(results[0] if results else {})

        # Publish additional cells as progress events
        for i, cell_result in enumerate(results[1:], 1):
            await reporter.progress(
                percent=int(100 * (i + 1) / len(results)),
                message=json.dumps(cell_result),
            )

    except Exception as e:
        log.exception("Grid split failed")
        await reporter.failed(error_code="worker.internal", error_message=str(e), retryable=False)
