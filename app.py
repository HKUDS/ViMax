import os
import json
import asyncio
import threading
import queue
import uuid
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_from_directory, Response, stream_with_context
from pathlib import Path
import sys

# 导入您的视频生成管道
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipelines.idea2video_pipeline import Idea2VideoPipeline

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB 最大文件上传
from utils.log_handler import setup_logging

# 全局变量
current_task = None
task_queue = queue.Queue()
log_queue = queue.Queue()
# 在创建应用后设置日志
setup_logging(log_queue)
working_dir = None
task_running = False

# 存储所有工作目录的状态
work_dirs = {}


# 日志捕获类
class LogCapture:
    def __init__(self, queue):
        self.queue = queue

    def write(self, text):
        if text.strip():  # 只记录非空行
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            log_entry = f"[{timestamp}] {text}"
            self.queue.put(log_entry)
        # 仍然输出到控制台
        sys.__stdout__.write(text)

    def flush(self):
        sys.__stdout__.flush()


# 重定向标准输出
sys.stdout = LogCapture(log_queue)


def run_async_task(idea, user_requirement, style, work_dir, config_path="configs/idea2video_deepseek.yaml"):
    """在后台线程中运行异步任务"""
    global current_task, task_running, working_dir

    try:
        async def async_main():
            global current_task, working_dir
            working_dir = work_dir

            # 确保工作目录存在
            os.makedirs(work_dir, exist_ok=True)

            # 更新工作目录状态
            work_dirs[work_dir] = {
                'status': 'running',
                'start_time': datetime.now().isoformat(),
                'idea': idea,
                'user_requirement': user_requirement,
                'style': style
            }

            pipeline = Idea2VideoPipeline.init_from_config(
                config_path=config_path,
                working_dir=work_dir
            )
            await pipeline(idea=idea, user_requirement=user_requirement, style=style)

            # 更新完成状态
            work_dirs[work_dir]['status'] = 'completed'
            work_dirs[work_dir]['end_time'] = datetime.now().isoformat()
            work_dirs[work_dir]['final_video'] = os.path.join(work_dir, 'final_video.mp4')

            log_queue.put(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ✅ 视频生成完成！")

        # 在新的事件循环中运行
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(async_main())

    except Exception as e:
        error_msg = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] ❌ 生成过程中出现错误: {str(e)}"
        log_queue.put(error_msg)
        if work_dir in work_dirs:
            work_dirs[work_dir]['status'] = 'failed'
            work_dirs[work_dir]['error'] = str(e)
    finally:
        task_running = False


@app.route('/')
def index():
    """主页面"""
    return render_template('index.html')


@app.route('/api/generate', methods=['POST'])
def generate_video():
    """开始生成视频"""
    global current_task, task_running

    if task_running:
        return jsonify({'status': 'error', 'message': '已有任务正在运行'}), 400

    data = request.json
    idea = data.get('idea', '')
    user_requirement = data.get('user_requirement', '')
    style = data.get('style', '')
    work_dir = data.get('work_dir', '')

    if not idea:
        return jsonify({'status': 'error', 'message': '请输入创意描述'}), 400

    # 处理工作目录
    if work_dir:
        # 如果指定了工作目录，使用该目录
        if not work_dir.startswith('working_dir_idea2video'):
            work_dir = os.path.join('working_dir_idea2video', work_dir)
    else:
        # 否则生成新的UUID目录
        work_dir = os.path.join('working_dir_idea2video', str(uuid.uuid4()))

    # 确保工作目录存在
    os.makedirs(work_dir, exist_ok=True)

    # 清空日志队列
    while not log_queue.empty():
        log_queue.get()

    # 在后台线程中运行任务
    task_running = True
    thread = threading.Thread(
        target=run_async_task,
        args=(idea, user_requirement, style, work_dir)
    )
    thread.daemon = True
    thread.start()

    return jsonify({
        'status': 'success',
        'message': '开始生成视频...',
        'work_dir': work_dir
    })


@app.route('/api/logs')
def get_logs():
    """SSE流式传输日志"""

    def generate():
        while True:
            try:
                if not log_queue.empty():
                    log = log_queue.get(timeout=1)
                    yield f"data: {json.dumps({'log': log})}\n\n"
                else:
                    yield f"data: {json.dumps({'log': ''})}\n\n"
            except queue.Empty:
                yield f"data: {json.dumps({'log': ''})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
    )


@app.route('/api/task_status')
def task_status():
    """获取任务状态"""
    return jsonify({
        'running': task_running,
        'working_dir': working_dir
    })


@app.route('/api/files')
def list_files():
    """列出生成的文件"""
    work_dir = request.args.get('work_dir', '')

    if not work_dir or not os.path.exists(work_dir):
        return jsonify({'files': [], 'directories': []})

    base_path = Path(work_dir)
    files = []
    directories = []

    # 列出根目录文件
    for item in base_path.iterdir():
        if item.is_file():
            files.append({
                'name': item.name,
                'path': str(item.relative_to(base_path)),
                'size': item.stat().st_size,
                'type': 'file'
            })
        elif item.is_dir():
            directories.append({
                'name': item.name,
                'path': str(item.relative_to(base_path)),
                'type': 'directory'
            })

    # 递归获取所有文件
    all_files = []
    for root, dirs, files_in_dir in os.walk(work_dir):
        for file in files_in_dir:
            file_path = os.path.join(root, file)
            rel_path = os.path.relpath(file_path, work_dir)
            all_files.append({
                'name': file,
                'path': rel_path,
                'size': os.path.getsize(file_path),
                'type': 'file'
            })

    return jsonify({
        'work_dir': work_dir,
        'root_files': files,
        'directories': directories,
        'all_files': all_files
    })


@app.route('/api/work_dirs')
def list_work_dirs():
    """列出所有工作目录"""
    base_dir = 'working_dir_idea2video'
    dirs = []

    if os.path.exists(base_dir):
        for item in os.listdir(base_dir):
            dir_path = os.path.join(base_dir, item)
            if os.path.isdir(dir_path):
                # 检查是否有final_video.mp4
                final_video = os.path.join(dir_path, 'final_video.mp4')
                has_video = os.path.exists(final_video)

                dirs.append({
                    'name': item,
                    'path': dir_path,
                    'has_video': has_video,
                    'created': datetime.fromtimestamp(os.path.getctime(dir_path)).isoformat() if os.path.exists(
                        dir_path) else None
                })

    # 按创建时间倒序排列
    dirs.sort(key=lambda x: x['created'] or '', reverse=True)

    return jsonify({'work_dirs': dirs})


@app.route('/api/file/<path:filepath>')
def get_file(filepath):
    """获取文件内容"""
    work_dir = request.args.get('work_dir', '')

    if not work_dir:
        return jsonify({'error': '工作目录不存在'}), 404

    file_path = os.path.join(work_dir, filepath)

    if not os.path.exists(file_path):
        return jsonify({'error': '文件不存在'}), 404

    # 如果是文本文件，读取内容
    if filepath.endswith(('.txt', '.json', '.yaml', '.yml', '.py', '.js', '.css', '.html')):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return jsonify({'content': content, 'type': 'text'})
        except:
            return jsonify({'type': 'binary'})
    else:
        return jsonify({'type': 'binary'})


@app.route('/download/<path:filepath>')
def download_file(filepath):
    """下载文件"""
    work_dir = request.args.get('work_dir', '')

    if not work_dir:
        return "工作目录不存在", 404

    file_path = os.path.join(work_dir, filepath)
    directory = os.path.dirname(file_path)
    filename = os.path.basename(file_path)

    if not os.path.exists(file_path):
        return "文件不存在", 404

    return send_from_directory(directory, filename, as_attachment=True)


@app.route('/api/preview/<path:filepath>')
def preview_file(filepath):
    """预览文件（图片/视频）"""
    work_dir = request.args.get('work_dir', '')

    if not work_dir:
        return "工作目录不存在", 404

    file_path = os.path.join(work_dir, filepath)

    if not os.path.exists(file_path):
        return "文件不存在", 404

    # 根据文件类型返回不同响应
    if filepath.endswith(('.png', '.jpg', '.jpeg', '.gif')):
        return send_from_directory(os.path.dirname(file_path), os.path.basename(file_path))
    elif filepath.endswith('.mp4'):
        # 视频预览 - 返回HTML页面
        return f'''
        <!DOCTYPE html>
        <html>
        <head>
            <title>视频预览</title>
            <style>
                body {{ margin: 0; padding: 20px; background: #f5f5f5; }}
                .video-container {{ max-width: 800px; margin: 0 auto; }}
                video {{ width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }}
            </style>
        </head>
        <body>
            <div class="video-container">
                <video controls autoplay>
                    <source src="/download/{filepath}?work_dir={work_dir}" type="video/mp4">
                    您的浏览器不支持视频标签。
                </video>
            </div>
        </body>
        </html>
        '''
    else:
        return "不支持的文件类型", 400


@app.route('/api/stats')
def get_stats():
    """获取生成统计信息"""
    work_dir = request.args.get('work_dir', '')

    if not work_dir or not os.path.exists(work_dir):
        return jsonify({'total_files': 0, 'total_size': 0})

    total_files = 0
    total_size = 0

    for root, dirs, files in os.walk(work_dir):
        total_files += len(files)
        for file in files:
            file_path = os.path.join(root, file)
            total_size += os.path.getsize(file_path)

    # 获取主要文件信息
    main_files = {}
    for file in ['story.txt', 'characters.json', 'script.json', 'final_video.mp4']:
        file_path = os.path.join(work_dir, file)
        if os.path.exists(file_path):
            main_files[file] = {
                'size': os.path.getsize(file_path),
                'modified': datetime.fromtimestamp(os.path.getmtime(file_path)).strftime('%Y-%m-%d %H:%M:%S')
            }

    return jsonify({
        'total_files': total_files,
        'total_size': total_size,
        'main_files': main_files
    })


if __name__ == '__main__':
    # 确保工作目录存在
    os.makedirs("working_dir_idea2video", exist_ok=True)
    app.run(debug=True, port=5000, threaded=True)