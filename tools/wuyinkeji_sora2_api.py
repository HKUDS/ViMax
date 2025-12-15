import logging
import asyncio
import json
from typing import List, Optional
from PIL import Image
from io import BytesIO
import requests
from tenacity import retry, stop_after_attempt
import aiohttp
from interfaces.video_output import VideoOutput
from utils.retry import after_func
from utils.image import image_path_to_b64  # 如果您需要将本地图片转base64
from utils.rate_limiter import RateLimiter

# 配置logging - 在模块级别设置
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    handlers=[
        logging.StreamHandler(),  # 输出到终端
    ]
)
class VideoGeneratorSora2API:
    """
    使用 wuyinkeji.com 提供的 Sora2 模型生成视频的异步类。
    流程：创建任务 -> 轮询状态 -> 返回视频URL。
    """

    def __init__(
            self,
            api_key: str,
            base_url: str = "https://api.wuyinkeji.com/api/sora2",
            poll_interval: int = 5,
            max_poll_attempts: int = 120,  # 视频生成通常需要更长时间
            rate_limiter: Optional[RateLimiter] = None,
    ):
        """
        初始化视频生成器。

        Args:
            api_key: API密钥
            base_url: API基础URL
            poll_interval: 轮询间隔（秒）
            max_poll_attempts: 最大轮询次数
        """
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.poll_interval = poll_interval
        self.max_poll_attempts = max_poll_attempts

        # 设置默认headers
        self.headers = {
            "Authorization": api_key,
            "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
        }

        logging.info(f"初始化 Sora2 API，基础URL: {self.base_url}")

    @retry(stop=stop_after_attempt(1), after=after_func)
    async def generate_single_video(
            self,
            prompt: str = "",
            reference_image_paths: List[Image.Image] = [],
            aspect_ratio: str = "9:16",
            duration: str = "10",
            size: str = "small",
            remix_target_id: Optional[str] = None,
            **kwargs,
    ) -> VideoOutput:
        """
        异步生成单个视频的核心方法。
        """
        logging.info(f"调用 Sora2 API 生成视频，提示词: {prompt[:50]}...")

        # 保存原始参数，用于可能的重新生成
        original_params = {
            "prompt": prompt,
            "reference_images": reference_image_paths,
            "aspect_ratio": aspect_ratio,
            "duration": duration,
            "size": size,
            "remix_target_id": remix_target_id
        }

        # 1. 创建视频生成任务
        task_id = await self._create_video_task(
            prompt=prompt,
            reference_images=reference_image_paths,
            aspect_ratio=aspect_ratio,
            duration=duration,
            size=size,
            remix_target_id=remix_target_id
        )

        # 2. 轮询任务状态直到完成（传递原始参数以备重试）
        video_url = await self._poll_task_status(
            task_id,
            original_prompt=prompt,
            original_params=original_params
        )

        # 3. 返回视频输出
        return VideoOutput(fmt="url", ext="mp4", data=video_url)

    async def _create_video_task(
            self,
            prompt: str,
            reference_images: List[Image.Image],
            aspect_ratio: str = "9:16",
            duration: str = "10",
            size: str = "small",
            remix_target_id: Optional[str] = None,
    ) -> str:
        """
        创建视频生成任务。

        注意：Sora2 API目前只支持通过URL传递参考图片，不支持直接上传图片。
        如果需要使用本地图片作为参考，需要先上传到图床获取URL。
        """
        url = f"{self.base_url}/submit"

        # 构建请求数据
        data = {
            "prompt": prompt,
            "aspectRatio": aspect_ratio,
            "duration": duration,
            "size": size
        }

        # 处理参考图片（如果有）
        if reference_images and len(reference_images) > 0:
            # 这里需要将PIL Image转换为可用的URL
            # 由于Sora2 API需要图片URL，这里需要您自己实现图片上传到图床的逻辑
            # 以下是一个示例，假设您有一个upload_image_to_cdn函数
            try:
                image_url = await self._upload_image_to_cdn(reference_images[0])
                data["url"] = image_url
                logging.info(f"使用参考图片URL: {image_url}")
            except Exception as e:
                logging.warning(f"无法上传参考图片，将不使用参考图片: {e}")

        # 添加续作PID（如果有）
        if remix_target_id:
            data["remixTargetId"] = remix_target_id

        logging.info(f"创建视频任务，参数: {json.dumps(data, ensure_ascii=False)}")

        # 发送请求
        try:
            # 使用aiohttp进行异步HTTP请求
            async with aiohttp.ClientSession(headers=self.headers) as session:
                async with session.post(url, data=data) as response:
                    response_text = await response.text()
                    logging.debug(f"创建任务响应: {response_text}")

                    if response.status != 200:
                        raise ValueError(f"API请求失败，状态码: {response.status}")

                    result = json.loads(response_text)

                    if result.get("code") == 0 or result.get("code") == 200:
                        task_id = result["data"]["id"]
                        logging.info(f"视频生成任务创建成功，任务ID: {task_id}")
                        return task_id
                    else:
                        error_msg = result.get("msg", "未知错误")
                        logging.error(f"任务创建失败: {error_msg}")
                        raise ValueError(f"任务创建失败: {error_msg}")

        except aiohttp.ClientError as e:
            logging.error(f"网络请求错误: {e}")
            raise
        except json.JSONDecodeError as e:
            logging.error(f"JSON解析错误: {e}")
            raise ValueError("API响应格式错误")
        except Exception as e:
            logging.error(f"创建任务时发生未知错误: {e}")
            raise

    async def _upload_image_to_cdn(self, image: Image.Image) -> str:
        """
        将PIL Image上传到图床并返回URL。
        这是一个示例函数，您需要根据实际的图床API来实现。

        您可以选择：
        1. 使用现有的图床服务（如imgbb、sm.ms等）
        2. 自建图床服务
        3. 使用云存储服务（如阿里云OSS、腾讯云COS等）

        这里我们提供一个示例，假设您有一个上传到sm.ms的函数
        """
        # 将PIL Image转换为bytes
        img_byte_arr = BytesIO()
        image.save(img_byte_arr, format='PNG')
        img_byte_arr = img_byte_arr.getvalue()

        # 示例：上传到sm.ms（需要安装smms库）
        try:
            import smms
            # 这里仅为示例，实际使用时需要配置您的sm.ms API token
            result = await smms.upload_image(img_byte_arr)
            return result.url
        except ImportError:
            logging.warning("smms库未安装，无法上传图片")
            raise NotImplementedError("图片上传功能需要实现")

        # 或者使用其他图床API
        # 例如使用requests上传到imgbb：
        # import requests
        # import base64
        # img_str = base64.b64encode(img_byte_arr).decode()
        # response = requests.post(f"https://api.imgbb.com/1/upload?key=YOUR_API_KEY", data={"image": img_str})
        # return response.json()["data"]["url"]

    async def _poll_task_status(self, task_id: str, original_prompt: str = None,
                                original_params: dict = None) -> str:
        """
        轮询任务状态，直到视频生成完成或失败。
        增加对特定安全错误的重试逻辑。

        Args:
            task_id: 任务ID
            original_prompt: 原始提示词（用于重试优化）
            original_params: 原始参数（用于重试）
        """
        url = f"{self.base_url}/detail"
        params = {"id": task_id}

        logging.info(f"开始轮询任务状态，任务ID: {task_id}")

        for attempt in range(self.max_poll_attempts):
            logging.info(f"第 {attempt + 1} 次查询任务状态...")

            try:
                async with aiohttp.ClientSession(headers=self.headers) as session:
                    async with session.get(url, params=params) as response:
                        if response.status != 200:
                            logging.warning(f"查询失败，状态码: {response.status}，等待后重试...")
                            await asyncio.sleep(self.poll_interval)
                            continue

                        result = await response.json()
                        logging.debug(f"状态查询响应: {json.dumps(result, ensure_ascii=False)}")

                        if result.get("code") == 200:
                            data = result.get("data", {})
                            status = data.get("status")
                            video_url = data.get("remote_url")
                            fail_reason = data.get("fail_reason")

                            logging.info(f"任务状态: {status}, 视频URL: {video_url}")

                            if status == 1:  # 成功
                                if video_url:
                                    logging.info(f"视频生成成功! URL: {video_url}")
                                    return video_url
                                else:
                                    logging.warning("视频生成成功但URL为空，继续等待...")
                            elif status == 0:  # 排队中
                                logging.info("视频排队中...")
                            elif status == 3:  # 生成中
                                logging.info("视频生成中...")
                            elif status == 2:  # 失败
                                error_msg = fail_reason or "未知原因"

                                # 检查是否包含特定的安全违规关键词
                                safety_keywords = ["violate", "guardrails", "nudity", "sexuality", "erotic"]
                                if any(keyword.lower() in error_msg.lower() for keyword in safety_keywords):
                                    logging.warning(f"⚠️ 检测到内容安全违规: {error_msg}")

                                    # 只有存在原始提示词和参数时才进行重试
                                    if original_prompt and original_params:
                                        logging.info("🔄 尝试优化提示词并重新生成...")
                                        try:
                                            # 调用重试方法
                                            return await self._retry_with_safe_prompt(
                                                original_prompt,
                                                error_msg,
                                                original_params
                                            )
                                        except Exception as retry_e:
                                            logging.error(f"重试失败: {retry_e}")
                                            # 重试失败，抛出原始错误
                                            raise ValueError(f"视频生成失败: {error_msg} (重试失败)")
                                    else:
                                        # 缺少重试所需信息，抛出原始错误
                                        raise ValueError(f"视频生成失败: {error_msg}")
                                else:
                                    # 非安全违规错误，直接抛出
                                    raise ValueError(f"视频生成失败: {error_msg}")
                            else:
                                logging.warning(f"未知状态: {status}")
                        else:
                            error_msg = result.get("msg", "查询失败")
                            logging.warning(f"状态查询API返回错误: {error_msg}")

            except aiohttp.ClientError as e:
                logging.warning(f"网络请求错误: {e}，等待后重试...")
            except json.JSONDecodeError as e:
                logging.warning(f"JSON解析错误: {e}，等待后重试...")

            # 等待下一次查询
            await asyncio.sleep(self.poll_interval)

        # 轮询超时
        error_msg = f"在 {self.max_poll_attempts * self.poll_interval} 秒后仍未获取到视频"
        logging.error(error_msg)
        raise TimeoutError(error_msg)

    async def _retry_with_safe_prompt(self, original_prompt: str, error_msg: str,
                                      original_params: dict) -> str:
        """
        当检测到内容安全违规时，优化提示词并重新创建任务。

        Args:
            original_prompt: 原始提示词
            error_msg: 错误信息
            original_params: 原始参数（aspect_ratio, duration, size等）

        Returns:
            str: 新任务的视频URL
        """
        logging.info("🔧 开始优化安全违规提示词...")

        # 1. 分析和优化提示词（这里是一个简单示例，您可以根据需求扩展）
        safe_prompt = self._sanitize_prompt(original_prompt, error_msg)

        logging.info(f"优化前: {original_prompt[:100]}...")
        logging.info(f"优化后: {safe_prompt[:100]}...")

        # 2. 使用优化后的提示词重新创建任务
        try:
            # 准备新的任务参数（使用优化后的提示词）
            new_params = original_params.copy()
            new_params["prompt"] = safe_prompt

            # 重新调用创建任务的方法
            # 注意：这里需要您的_create_video_task方法支持从参数字典创建任务
            new_task_id = await self._create_video_task_from_params(new_params)

            # 3. 轮询新任务的状态（不再传递原始参数，避免无限循环）
            return await self._poll_task_status(new_task_id)

        except Exception as e:
            logging.error(f"重试创建任务失败: {e}")
            raise

    def _sanitize_prompt(self, prompt: str, error_msg: str) -> str:
        """
        净化提示词，移除或替换可能触发安全策略的敏感词汇。

        Args:
            prompt: 原始提示词
            error_msg: 错误信息

        Returns:
            str: 净化后的安全提示词
        """
        # 简单替换策略（您可以根据需要扩展这个列表）
        sensitive_replacements = {
            r'\b(nudity|naked|nude)\b': 'clothed figure',
            r'\b(sexy|sexuality|erotic)\b': 'artistic',
            r'\b(provocative|seductive)\b': 'elegant',
            r'\b(sexual|intimate)\b': 'emotional',
        }

        import re
        sanitized = prompt

        # 应用替换规则
        for pattern, replacement in sensitive_replacements.items():
            sanitized = re.sub(pattern, replacement, sanitized, flags=re.IGNORECASE)

        # 如果进行了替换，添加安全修饰词
        if sanitized != prompt:
            safety_modifiers = [
                "family-friendly content",
                "professional cinematography",
                "artistic interpretation",
                "safe for all audiences",
                "modest portrayal"
            ]
            import random
            modifier = random.choice(safety_modifiers)
            sanitized = f"{sanitized}, {modifier}"

        return sanitized

    # 新增辅助方法：从参数字典创建任务
    async def _create_video_task_from_params(self, params: dict) -> str:
        """
        从参数字典创建视频生成任务。
        这是对_create_video_task方法的封装，使其接受字典参数。
        """
        return await self._create_video_task(
            prompt=params.get("prompt", ""),
            reference_images=params.get("reference_images", []),
            aspect_ratio=params.get("aspect_ratio", "9:16"),
            duration=params.get("duration", "10"),
            size=params.get("size", "small"),
            remix_target_id=params.get("remix_target_id")
        )