# Custom Assets Configuration

This feature allows you to provide custom sample images and videos that will be used as reference materials during the video generation process.

## Configuration

Custom assets are configured in your `configs/idea2video.yaml` file under the `assets` section:

```yaml
assets:
  sample_images:
    - path: /path/to/your/sample_image1.png
      description: "A detailed description of what this image contains"
    - path: /path/to/your/sample_image2.jpg
      description: "Description for background reference - sunny park scene"

  sample_videos:
    - path: /path/to/your/sample_video.mp4
      description: "Description of the video content"
```

## How It Works

### Sample Images

When you add sample images to the configuration:

1. The images are loaded at pipeline initialization
2. They become available as reference materials for the `ReferenceImageSelector` agent
3. The AI can choose to use these images when generating frames for scenes
4. Your custom images are added alongside character portraits and generated scene images

**Use cases for sample images:**
- Specific art styles you want to reference
- Background scenes or environments
- Object references (vehicles, buildings, props)
- Color palette references
- Composition examples

### Sample Videos

Sample videos are currently loaded but not yet fully integrated into the generation pipeline. Future updates may enable using video frames as additional reference materials.

## Example Configuration

Here's a practical example for a cartoon-style children's video:

```yaml
assets:
  sample_images:
    - path: ./assets/references/forest_background.png
      description: "Cartoon-style forest with tall trees, vibrant green colors, suitable for children's content"

    - path: ./assets/references/park_scene.png
      description: "Sunny park with playground equipment, cartoon style, bright and cheerful"

    - path: ./assets/references/house_interior.png
      description: "Cozy living room interior, cartoon style, warm lighting"

  sample_videos: []
```

## Important Notes

1. **File Paths**: Use absolute paths or paths relative to where you run the script from
2. **File Existence**: The pipeline will warn you if a referenced asset file doesn't exist
3. **Descriptions**: Write clear, detailed descriptions - the AI uses these to decide when to use each asset
4. **Optional**: The assets section is completely optional. If omitted, the pipeline works as before
5. **Performance**: Adding many large images may increase processing time slightly

## Tips for Best Results

1. **Match Your Style**: Choose reference images that match the style parameter you're using (e.g., "Cartoon", "Realistic", etc.)
2. **High Quality**: Use high-resolution images (the pipeline works with 1600x900 frames)
3. **Relevant Descriptions**: Be specific in descriptions - mention colors, mood, composition, and key elements
4. **Variety**: Include different types of references (environments, objects, compositions) for more flexibility

## Troubleshooting

**Asset not being used:**
- Check that the file path is correct and the file exists
- Ensure the description is relevant to your scenes
- The AI selects references based on relevance - not all assets will be used in every video

**Warning messages about missing files:**
- Verify the file path is correct (check for typos)
- Use absolute paths if relative paths aren't working
- Ensure you have read permissions for the files

## Example Usage

```python
from pipelines.idea2video_pipeline import Idea2VideoPipeline

# Initialize with config that includes custom assets
pipeline = Idea2VideoPipeline.init_from_config(
    config_path="configs/idea2video.yaml"
)

# The custom assets are automatically loaded and available
await pipeline(
    idea="A cat and dog go on an adventure",
    user_requirement="For children, 3 scenes maximum",
    style="Cartoon"
)
```

Your custom assets will now be available as reference materials throughout the generation process!
