"""Post-processing: TTS narration, subtitles, background music."""
from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from typing import Optional

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]


class PostProcessor:
    def __init__(self, openai_api_key: str, openai_base_url: Optional[str] = None) -> None:
        self.client = AsyncOpenAI(
            api_key=openai_api_key,
            base_url=openai_base_url or "https://api.openai.com/v1",
        )

    async def generate_narration_text(
        self,
        idea_or_script: str,
        style: str,
        target_duration_seconds: float,
    ) -> str:
        """Use the LLM to write a narration script timed to target_duration_seconds."""
        words_target = int(target_duration_seconds * 2.5)  # ~150 wpm / 60 * duration
        prompt = (
            f"Write a spoken narration script for a video with the following concept:\n\n"
            f"{idea_or_script}\n\n"
            f"Style: {style}\n\n"
            f"The narration should be approximately {words_target} words "
            f"(about {int(target_duration_seconds)} seconds when spoken aloud). "
            f"Write ONLY the narration text — no scene directions, no character names, no stage directions. "
            f"Write in a cinematic, engaging tone."
        )
        response = await self.client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1000,
        )
        return response.choices[0].message.content.strip()

    async def text_to_speech(self, text: str, voice: str, output_path: str) -> None:
        """Convert text to speech and save as MP3."""
        response = await self.client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=text,
        )
        with open(output_path, "wb") as f:
            f.write(response.content)
        logger.info(f"TTS audio saved to {output_path}")

    async def transcribe_for_subtitles(self, audio_path: str) -> list[dict]:
        """Transcribe audio with word-level timestamps for subtitle generation."""
        with open(audio_path, "rb") as f:
            result = await self.client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["word"],
            )
        return result.words or []

    def write_srt(self, words: list[dict], output_path: str, chars_per_line: int = 60) -> None:
        """Write an SRT subtitle file from word-level timestamps."""
        if not words:
            return

        segments: list[tuple[float, float, str]] = []
        current_words: list[str] = []
        seg_start: float = words[0]["start"]
        char_count = 0

        for w in words:
            word = w["word"].strip()
            if char_count + len(word) + 1 > chars_per_line and current_words:
                segments.append((seg_start, w["start"], " ".join(current_words)))
                current_words = [word]
                seg_start = w["start"]
                char_count = len(word)
            else:
                current_words.append(word)
                char_count += len(word) + 1

        if current_words:
            segments.append((seg_start, words[-1]["end"], " ".join(current_words)))

        def fmt(t: float) -> str:
            h = int(t // 3600)
            m = int((t % 3600) // 60)
            s = int(t % 60)
            ms = int((t % 1) * 1000)
            return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

        with open(output_path, "w", encoding="utf-8") as f:
            for i, (start, end, text) in enumerate(segments, 1):
                f.write(f"{i}\n{fmt(start)} --> {fmt(end)}\n{text}\n\n")

        logger.info(f"SRT written with {len(segments)} segments to {output_path}")

    def burn_subtitles(self, video_path: str, srt_path: str, output_path: str) -> None:
        """Burn SRT subtitles into video using ffmpeg."""
        srt_escaped = srt_path.replace("\\", "/").replace(":", "\\:")
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", (
                f"subtitles='{srt_escaped}':force_style='"
                "FontName=Arial,FontSize=18,PrimaryColour=&HFFFFFF,"
                "OutlineColour=&H000000,Outline=1,Shadow=0,Alignment=2'"
            ),
            "-c:a", "copy",
            output_path,
        ]
        logger.info(f"Burning subtitles: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg subtitle burn failed:\n{result.stderr}")

    def mix_audio(
        self,
        video_path: str,
        narration_path: Optional[str],
        music_path: Optional[str],
        music_volume: float,
        output_path: str,
    ) -> None:
        """Mix narration and/or background music onto video using moviepy."""
        from moviepy import VideoFileClip, AudioFileClip, CompositeAudioClip

        clip = VideoFileClip(video_path)
        audio_tracks = []

        if narration_path and os.path.exists(narration_path):
            narration = AudioFileClip(narration_path).with_end(clip.duration)
            audio_tracks.append(narration)

        if music_path and os.path.exists(music_path):
            music = (
                AudioFileClip(music_path)
                .with_end(clip.duration)
                .with_volume_scaled(music_volume)
            )
            audio_tracks.append(music)

        if audio_tracks:
            mixed = CompositeAudioClip(audio_tracks)
            clip = clip.with_audio(mixed)

        clip.write_videofile(output_path, codec="libx264", audio_codec="aac", logger=None)
        logger.info(f"Mixed video written to {output_path}")

    async def process(
        self,
        video_path: str,
        idea_or_script: str,
        style: str,
        enable_narration: bool = False,
        voice: str = "alloy",
        enable_subtitles: bool = False,
        music_path: Optional[str] = None,
        music_volume: float = 0.3,
    ) -> str:
        """Run all enabled post-processing steps. Returns path to processed video."""
        if not enable_narration and not enable_subtitles and not music_path:
            logger.info("No post-processing requested, returning original video.")
            return video_path

        work_dir = Path(video_path).parent / "postprocess"
        work_dir.mkdir(exist_ok=True)

        current_video = video_path
        narration_audio: Optional[str] = None

        if enable_narration or enable_subtitles:
            from moviepy import VideoFileClip
            duration = VideoFileClip(video_path).duration

            logger.info("Generating narration text...")
            narration_text = await self.generate_narration_text(idea_or_script, style, duration)
            logger.info(f"Narration ({len(narration_text.split())} words): {narration_text[:80]}...")

            narration_audio = str(work_dir / "narration.mp3")
            logger.info("Generating TTS audio...")
            await self.text_to_speech(narration_text, voice, narration_audio)

        srt_path: Optional[str] = None
        if enable_subtitles and narration_audio:
            logger.info("Transcribing audio for subtitle timestamps...")
            words = await self.transcribe_for_subtitles(narration_audio)
            srt_path = str(work_dir / "subtitles.srt")
            self.write_srt(words, srt_path)

        if enable_narration or music_path:
            mixed_path = str(work_dir / "with_audio.mp4")
            logger.info("Mixing audio onto video...")
            self.mix_audio(
                current_video,
                narration_audio if enable_narration else None,
                music_path,
                music_volume,
                mixed_path,
            )
            current_video = mixed_path

        if enable_subtitles and srt_path:
            subtitled_path = str(work_dir / "with_subtitles.mp4")
            logger.info("Burning subtitles...")
            self.burn_subtitles(current_video, srt_path, subtitled_path)
            current_video = subtitled_path

        logger.info(f"Post-processing complete -> {current_video}")
        return current_video
