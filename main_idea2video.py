import asyncio
import argparse
import yaml
from pathlib import Path
from pipelines.idea2video_pipeline import Idea2VideoPipeline


def load_from_file(file_path: str) -> dict:
    """Load idea, user_requirement, and style from a YAML file."""
    with open(file_path, 'r') as f:
        data = yaml.safe_load(f)

    required_fields = ['idea', 'user_requirement', 'style']
    for field in required_fields:
        if field not in data:
            raise ValueError(
                f"Missing required field '{field}' in {file_path}")

    return data


def parse_args():
    parser = argparse.ArgumentParser(
        description='Generate video from an idea using AI',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Using command-line arguments:
  python main_idea2video.py -i "A woman exercising" -u "3 scenes max" -s "Realistic"

  # Using a YAML file:
  python main_idea2video.py -f idea-example.yaml -c configs/myidea2video.yaml

  # YAML file format:
  idea: |
    Your idea here
    Can span multiple lines
  user_requirement: |
    Your requirements here
  style: Realistic, warm feel
        """
    )

    parser.add_argument('-f', '--file', type=str,
                        help='Path to YAML file containing idea, user_requirement, and style')
    parser.add_argument('-i', '--idea', type=str,
                        help='The main idea for the video')
    parser.add_argument('-u', '--user-requirement', type=str,
                        help='User requirements (e.g., number of scenes, shots)')
    parser.add_argument('-s', '--style', type=str,
                        help='Video style (e.g., "Realistic, warm feel")')
    parser.add_argument('-c', '--config', type=str, default='configs/idea2video.yaml',
                        help='Path to pipeline configuration file (default: configs/idea2video.yaml)')

    args = parser.parse_args()

    # Validate arguments
    if args.file:
        if any([args.idea, args.user_requirement, args.style]):
            parser.error(
                "Cannot use --file with --idea, --user-requirement, or --style")
        return args
    else:
        if not all([args.idea, args.user_requirement, args.style]):
            parser.error(
                "Must provide either --file or all of: --idea, --user-requirement, --style")
        return args


async def main():
    args = parse_args()

    # Load parameters from file or command-line arguments
    if args.file:
        data = load_from_file(args.file)
        idea = data['idea']
        user_requirement = data['user_requirement']
        style = data['style']
    else:
        idea = args.idea
        user_requirement = args.user_requirement
        style = args.style

    pipeline = Idea2VideoPipeline.init_from_config(config_path=args.config)
    await pipeline(idea=idea, user_requirement=user_requirement, style=style)


if __name__ == "__main__":
    asyncio.run(main())
