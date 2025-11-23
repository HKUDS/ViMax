import asyncio
import argparse
import yaml
from pathlib import Path
from pipelines.script2video_pipeline import Script2VideoPipeline


def load_from_file(file_path: str) -> dict:
    """Load script, user_requirement, and style from a YAML file."""
    with open(file_path, 'r') as f:
        data = yaml.safe_load(f)

    required_fields = ['script', 'user_requirement', 'style']
    for field in required_fields:
        if field not in data:
            raise ValueError(
                f"Missing required field '{field}' in {file_path}")

    return data


def parse_args():
    parser = argparse.ArgumentParser(
        description='Generate video from a script using AI',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Using command-line arguments:
  python main_script2video.py -S "EXT. GYM - DAY..." -u "15 shots max" -s "Anime Style"

  # Using a YAML file:
  python main_script2video.py -f script-example.yaml

  # YAML file format:
  script: |
    EXT. GYM - DAY
    Your script here
    Can span multiple lines
  user_requirement: |
    Your requirements here
  style: Anime Style
        """
    )

    parser.add_argument('-f', '--file', type=str,
                        help='Path to YAML file containing script, user_requirement, and style')
    parser.add_argument('-S', '--script', type=str,
                        help='The script for the video')
    parser.add_argument('-u', '--user-requirement', type=str,
                        help='User requirements (e.g., number of shots, pacing)')
    parser.add_argument('-s', '--style', type=str,
                        help='Video style (e.g., "Anime Style")')
    parser.add_argument('-c', '--config', type=str, default='configs/script2video.yaml',
                        help='Path to pipeline configuration file (default: configs/script2video.yaml)')

    args = parser.parse_args()

    # Validate arguments
    if args.file:
        if any([args.script, args.user_requirement, args.style]):
            parser.error(
                "Cannot use --file with --script, --user-requirement, or --style")
        return args
    else:
        if not all([args.script, args.user_requirement, args.style]):
            parser.error(
                "Must provide either --file or all of: --script, --user-requirement, --style")
        return args


async def main():
    args = parse_args()

    # Load parameters from file or command-line arguments
    if args.file:
        data = load_from_file(args.file)
        script = data['script']
        user_requirement = data['user_requirement']
        style = data['style']
    else:
        script = args.script
        user_requirement = args.user_requirement
        style = args.style

    pipeline = Script2VideoPipeline.init_from_config(config_path=args.config)
    await pipeline(script=script, user_requirement=user_requirement, style=style)


if __name__ == "__main__":
    asyncio.run(main())
