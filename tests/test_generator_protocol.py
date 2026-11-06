"""Every video generator must satisfy the VideoGenerator protocol, which
declares **kwargs: pipelines pass progress= callbacks, and generators that
reject unknown kwargs crash mid-render (TypeError) on the transition path."""

import inspect
import unittest

from tools.video_generator_doubao_seedance_yunwu_api import VideoGeneratorDoubaoSeedanceYunwuAPI
from tools.video_generator_omni_yunwu_api import VideoGeneratorOmniYunwuAPI
from tools.video_generator_openrouter_api import VideoGeneratorOpenRouterAPI
from tools.video_generator_veo_google_api import VideoGeneratorVeoGoogleAPI
from tools.video_generator_veo_yunwu_api import VideoGeneratorVeoYunwuAPI


class TestVideoGeneratorProtocol(unittest.TestCase):
    GENERATORS = [
        VideoGeneratorDoubaoSeedanceYunwuAPI,
        VideoGeneratorOmniYunwuAPI,
        VideoGeneratorOpenRouterAPI,
        VideoGeneratorVeoGoogleAPI,
        VideoGeneratorVeoYunwuAPI,
    ]

    def test_generate_single_video_accepts_arbitrary_kwargs(self):
        for cls in self.GENERATORS:
            with self.subTest(cls=cls.__name__):
                params = inspect.signature(cls.generate_single_video).parameters
                accepts_var_kwargs = any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values())
                self.assertTrue(
                    accepts_var_kwargs,
                    f"{cls.__name__}.generate_single_video must accept **kwargs per tools.protocols.VideoGenerator "
                    "(pipelines pass progress=...)",
                )


if __name__ == "__main__":
    unittest.main()
