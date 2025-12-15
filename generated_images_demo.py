import asyncio
from tools.wuyinkeji_nanoBanana_api import ImageGeneratorNanobananaWuYinAPI
async def main():
    # 1. 实例化生成器 (请替换为您自己的有效API密钥)
    api_key = "mdUGZToVEw8s2xt23bzFPKrMIC"  # 注意：您示例中的密钥可能无效，需替换
    image_generator = ImageGeneratorNanobananaWuYinAPI(
        api_key=api_key,
        poll_interval=10,  # 轮询间隔缩短为3秒
        max_poll_attempts=60,  # 最大尝试40次
    )

    # 2. 准备参数
    prompt_text = "一只在星空下看书的小猫，卡通风格"
    desired_aspect_ratio = "1:1"  # 正方形图片

    try:
        # 3. 调用异步方法生成图像
        print("开始生成图像...")
        result = await image_generator.generate_single_image(
            prompt=prompt_text,
            aspect_ratio=desired_aspect_ratio,
            # reference_image_paths 参数此API暂不支持，故留空
        )

        # 4. 获取结果
        pil_image = result.data  # 这是PIL.Image对象
        print(f"图像生成成功！尺寸: {pil_image.size}")

        # 你可以用它做进一步处理，例如：
        # pil_image.show()
        # pil_image.save("my_final_image.png")

    except TimeoutError as e:
        print(f"生成超时: {e}")
    except ValueError as e:
        print(f"生成失败: {e}")
    except Exception as e:
        print(f"发生未知错误: {e}")

# 运行异步主函数
if __name__ == "__main__":
    asyncio.run(main())