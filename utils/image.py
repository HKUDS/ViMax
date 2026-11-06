import logging
import requests
import base64
import mimetypes
from io import BytesIO
import cv2

from utils.retry import download_retry


@download_retry
def download_image(url, save_path):
    try:
        # Providers may inline the result as a data URL instead of hosting it.
        if url.startswith("data:"):
            _, _, b64_data = url.partition(",")
            with open(save_path, 'wb') as file:
                file.write(base64.b64decode(b64_data))
            logging.info(f"Decoded data-URL image to {save_path}")
            return

        logging.info(f"Downloading image from {url} to {save_path}")

        response = requests.get(url, stream=True, timeout=(10, 300))
        response.raise_for_status() # Check for HTTP errors

        with open(save_path, 'wb') as file:
            for chunk in response.iter_content(chunk_size=1024):
                file.write(chunk)
        logging.info(f"Image downloaded successfully to {save_path}")

    except Exception as e:
        logging.error(f"Error downloading image: {e}")
        raise e


def image_path_to_b64(image_path, mime: bool = True) -> str:
    with open(image_path, 'rb') as image_file:
        b64 = base64.b64encode(image_file.read()).decode('utf-8')

    if mime:
        mime_type, _ = mimetypes.guess_type(image_path)
        if mime_type is None:
            mime_type = 'application/octet-stream'
        return f"data:{mime_type};base64,{b64}"

    return b64


def pil_to_b64(image, mime: bool = True) -> str:
    buffered = BytesIO()
    image.save(buffered, format="PNG")
    b64 = base64.b64encode(buffered.getvalue()).decode('utf-8')

    if mime:
        return f"data:image/png;base64,{b64}"

    return b64


def save_base64_image(b64_string, save_path):
    # If the base64 string has a data URL prefix, remove it
    if ',' in b64_string:
        b64_string = b64_string.split(',')[1]

    with open(save_path, 'wb') as image_file:
        image_file.write(base64.b64decode(b64_string))

