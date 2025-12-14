import asyncio
from pipelines.idea2video_pipeline import Idea2VideoPipeline


# # SET YOUR OWN IDEA, USER REQUIREMENT, AND STYLE HERE
# idea = \
#     """
# A beaufitul fit woman with black hair, great butt and thigs is exercising in a
# gym surrounded by glass windows with a beautiful beach view on the outside.
# She is performing glute exercises that highlight her beautiful back and sexy outfit
# and showing the audience the proper form. Between the 1 different exercises she looks
# at the camera with a gorgeous look asking the viewer understood the proper form.
# """
# user_requirement = \
#     """
# For adults, do not exceed 1 scenes. Each scene should be no more than 1 shots.
# """
# style = "Realistic, warm feel"

# SET YOUR OWN IDEA, USER REQUIREMENT, AND STYLE HERE
idea = \
    """
胖橘（一只圆滚滚、性格憨厚的橘猫）和虎哥（一只勇敢机智的老虎玩偶/或小老虎）是一对好朋友。
他们正在一片充满未知的森林、或是一个布满灰尘的阁楼、亦或是微观的后花园中进行探险。
他们的目标可能是寻找传说中的“闪闪发光的宝藏”，或是护送一颗重要的橡果回家。
在探险途中，他们会遇到一些可爱的小麻烦（比如胖橘被藤蔓缠住，虎哥研究一张古老的地图），
但最终会通过合作与智慧克服困难。胖橘有时会看向镜头，露出“快跟上！”或“相信我！”的得意表情。
"""
user_requirement = \
    """
面向全年龄段，场景不超过1个。每个场景的镜头数不超过1个。
"""
style = "生动、温暖、充满童趣的探险风格"

async def main():
    pipeline = Idea2VideoPipeline.init_from_config(
        config_path="configs/idea2video_deepseek.yaml",working_dir="working_dir_idea2video/idea2video")
    await pipeline(idea=idea, user_requirement=user_requirement, style=style)

if __name__ == "__main__":
    asyncio.run(main())
