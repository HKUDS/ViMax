import asyncio
from tools.wuyinkeji_sora2_api import VideoGeneratorSora2API
# 使用示例和测试代码
async def sora2_api():
    """
    测试Sora2 API的使用
    """
    import logging

    # 设置日志
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    print("=" * 50)
    print("开始测试 Sora2 API")
    print("=" * 50)

    # 注意：请使用有效的API密钥
    API_KEY = "mdUGZToVEw8s2xt23bzFPKrMIC"  # 请替换为您的实际API密钥

    # 创建视频生成器实例
    video_generator = VideoGeneratorSora2API(
        api_key=API_KEY,
        poll_interval=10,  # 视频生成需要更长的轮询间隔
        max_poll_attempts=60,  # 最多尝试60次（10分钟）
    )

    try:
        # 测试1：纯文本生成视频
        print("\n测试1：纯文本生成视频")
        result = await video_generator.generate_single_video(
            prompt="In a pixel art scene, a couple in formal evening wear walk home holding an umbrella. Suddenly, heavy rain pours down; they huddle close, sheltering under the umbrella. The camera pushes in slowly, focusing on their silhouettes in the rain, capturing their gaze at each other and the reflection of city lights in the puddles around them.",
            aspect_ratio="9:16",
            duration="10",
            size="small"
        )
        print(f"✓ 视频生成成功! 视频URL: {result.data}")

        # 测试2：使用参考图片生成视频（需要先上传图片到图床）
        # print("\n测试2：使用参考图片生成视频")
        # from PIL import Image
        #
        # # 假设有一个本地图片
        # try:
        #     reference_image = Image.open("example.jpg")
        #     result = await video_generator.generate_single_video(
        #         prompt="基于这张图片生成一个动画视频",
        #         reference_image_paths=[reference_image],
        #         aspect_ratio="9:16",
        #         duration="5",
        #         size="small"
        #     )
        #     print(f"✓ 带参考图片的视频生成成功! 视频URL: {result.data}")
        # except FileNotFoundError:
        #     print("⚠ 未找到示例图片，跳过参考图片测试")

    except Exception as e:
        print(f"✗ 测试失败: {e}")
        import traceback
        traceback.print_exc()


# 如果模块被直接运行，执行测试
if __name__ == "__main__":
    asyncio.run(sora2_api())