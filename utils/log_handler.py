import logging
import sys
from datetime import datetime


class WebLogHandler(logging.Handler):
    """Web日志处理器，用于捕获日志并发送到前端"""

    def __init__(self, queue):
        super().__init__()
        self.queue = queue
        self.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))

    def emit(self, record):
        try:
            log_entry = self.format(record)
            self.queue.put(log_entry)
        except Exception:
            pass


def setup_logging(log_queue):
    """设置日志配置"""
    # 创建Web日志处理器
    web_handler = WebLogHandler(log_queue)
    web_handler.setLevel(logging.INFO)

    # 创建控制台处理器
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s')
    console_handler.setFormatter(console_formatter)

    # 配置根日志记录器
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(web_handler)
    root_logger.addHandler(console_handler)

    # 禁止某些库的过多日志
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('httpcore').setLevel(logging.WARNING)
    logging.getLogger('urllib3').setLevel(logging.WARNING)

    return root_logger