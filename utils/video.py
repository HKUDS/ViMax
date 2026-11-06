import logging
import requests
from moviepy import VideoFileClip, concatenate_videoclips
from utils.retry import download_retry


@download_retry
def download_video(url, save_path):
    try:
        logging.info(f"Downloading video from {url} to {save_path}")

        response = requests.get(url, stream=True, timeout=(10, 300))
        response.raise_for_status()  # 检查请求是否成功
    
        with open(save_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        logging.info(f"Video downloaded successfully to {save_path}")
    
    except Exception as e:
        logging.error(f"Error downloading video: {e}")
        raise e


def concatenate_video_files(video_paths, output_path, codec="libx264", preset="medium"):
    """Concatenate video files, releasing every ffmpeg reader even on failure.

    Each VideoFileClip keeps an ffmpeg subprocess and file handle open until
    closed; leaking them exhausts file descriptors on long multi-scene runs.
    """
    clips = []
    final = None
    try:
        for path in video_paths:
            clips.append(VideoFileClip(path))
        final = concatenate_videoclips(clips)
        final.write_videofile(output_path, codec=codec, preset=preset)
    finally:
        if final is not None:
            final.close()
        for clip in clips:
            clip.close()
    return output_path
