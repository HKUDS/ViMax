$(document).ready(function() {
    // 变量声明
    let eventSource = null;
    let logsPaused = false;
    let currentFileUrl = null;
    let currentWorkDir = null;
    let fileTreeData = {};
    let logEntries = [];
    let currentVideo = null;
    let taskTimer = null;
    let startTime = null;

    // 初始化应用
    initApp();

    function initApp() {
        // 加载工作目录列表
        loadWorkDirs();

        // 绑定事件监听器
        bindEvents();

        // 检查现有任务状态
        checkTaskStatus();

        // 更新系统时间
        updateSystemTime();

        // 模拟系统信息更新
        updateSystemInfo();

        // 启动实时更新
        setInterval(updateSystemTime, 1000);
        setInterval(updateSystemInfo, 5000);
    }

    function bindEvents() {
        // 标签页切换
        $('.tab-btn').click(function() {
            const tabId = $(this).data('tab') || $(this).find('span').text().toLowerCase();
            switchTab(tabId);
        });

        // 生成按钮
        $('#generateBtn').click(generateVideo);

        // 清空按钮
        $('#clearBtn').click(function() {
            if (confirm('确定要清空所有输入内容吗？')) {
                $('#idea').val('');
                $('#user_requirement').val('');
                $('#style').val('');
                updateCharCount();
            }
        });

        // 字符计数
        $('#idea').on('input', updateCharCount);

        // 风格预设按钮
        $('.preset-btn').click(function() {
            const style = $(this).data('style');
            $('#style').val(style);
        });

        // 视频时长滑块
        $('#durationSlider').on('input', function() {
            const value = $(this).val();
            $('#durationValue').text(value + '秒');
        });

        // 日志控制按钮
        $('#clearLogsBtn').click(function() {
            $('#logContainer').empty();
            logEntries = [];
            updateLogStats();
        });

        $('#pauseLogsBtn').click(function() {
            logsPaused = !logsPaused;
            const icon = logsPaused ? 'fa-play' : 'fa-pause';
            const text = logsPaused ? '继续' : '暂停';
            $(this).find('i').attr('class', `fas ${icon}`);
            $(this).find('span').text(text);
        });

        $('#exportLogsBtn').click(exportLogs);
        $('#copyLogsBtn').click(copyLogs);

        $('#logFilter').change(function() {
            filterLogs($(this).val());
        });

        // 工作目录相关
        $('#refreshDirsBtn').click(loadWorkDirs);
        $('#newDirBtn').click(function() {
            const dirName = prompt('请输入新目录名称（留空使用UUID）：');
            if (dirName !== null) {
                const cleanName = dirName.trim().replace(/[^\w\-]/g, '_');
                const finalName = cleanName || generateUUID();
                $('#workDir').val(`working_dir_idea2video/${finalName}`);
            }
        });

        $('#refreshFilesBtn').click(function() {
            if (currentWorkDir) {
                loadFileTree(currentWorkDir);
            }
        });

        // 预览控制
        $('#refreshPreviewBtn').click(loadPreview);
        $('#fullscreenBtn').click(toggleFullscreen);

        // 快速操作按钮
        $('#openFolderBtn').click(function() {
            if (currentWorkDir) {
                // 在实际应用中，这里可以打开文件浏览器
                alert(`目录路径：${currentWorkDir}\n在实际应用中，这里会打开文件浏览器`);
            } else {
                alert('请先选择工作目录');
            }
        });

        $('#exportProjectBtn').click(function() {
            if (currentWorkDir) {
                // 导出项目功能
                alert('导出项目功能 - 这里可以实现项目打包下载');
            } else {
                alert('请先选择工作目录');
            }
        });

        $('#shareBtn').click(function() {
            if (currentWorkDir) {
                // 分享功能
                alert('分享功能 - 这里可以生成分享链接');
            } else {
                alert('请先选择工作目录');
            }
        });

        // 视频播放控制
        $('#playBtn').click(function() {
            if (currentVideo) {
                if (currentVideo.paused) {
                    currentVideo.play();
                    $(this).find('i').attr('class', 'fas fa-pause');
                } else {
                    currentVideo.pause();
                    $(this).find('i').attr('class', 'fas fa-play');
                }
            }
        });

        // 进度条点击控制
        $(document).on('click', '.player-controls .progress-bar', function(e) {
            if (currentVideo) {
                const progressBar = $(this);
                const clickPosition = e.pageX - progressBar.offset().left;
                const progressBarWidth = progressBar.width();
                const percentage = clickPosition / progressBarWidth;

                currentVideo.currentTime = percentage * currentVideo.duration;
                $('.player-controls .progress-fill').css('width', (percentage * 100) + '%');
            }
        });

        // 模态框关闭
        $('.close-btn').click(function() {
            $('#fileModal').removeClass('active');
        });

        $('#downloadFileBtn').click(function() {
            if (currentFileUrl && currentWorkDir) {
                window.open(`/download/${currentFileUrl}?work_dir=${encodeURIComponent(currentWorkDir)}`, '_blank');
            }
        });
    }

    function switchTab(tabName) {
        // 更新标签按钮状态
        $('.tab-btn').removeClass('active');
        $(`.tab-btn[data-tab="${tabName}"]`).addClass('active');

        // 显示对应的标签页
        $('.tab-pane').removeClass('active');
        $(`#${tabName}-tab`).addClass('active');

        // 如果是日志标签页，滚动到底部
        if (tabName === 'logs') {
            setTimeout(() => {
                const container = $('#logContainer');
                if (container[0]) {
                    container.scrollTop(container[0].scrollHeight);
                }
            }, 100);
        }
    }

    function updateCharCount() {
        const text = $('#idea').val();
        const count = text.length;
        $('#ideaCount').text(`${count}/2000`);
    }

    // 工作目录管理
    function loadWorkDirs() {
        $.get('/api/work_dirs', function(data) {
            const container = $('#workDirsContainer');
            container.empty();

            if (data.work_dirs.length === 0) {
                container.html(`
                    <div class="empty-state">
                        <i class="fas fa-inbox"></i>
                        <p>暂无历史项目</p>
                        <small>开始创建第一个项目</small>
                    </div>
                `);
                return;
            }

            data.work_dirs.forEach(dir => {
                const name = dir.name || dir.path.split('/').pop();
                const hasVideo = dir.has_video;
                const created = dir.created ? new Date(dir.created).toLocaleDateString() : '';

                const projectItem = $(`
                    <div class="project-item" data-path="${dir.path}">
                        <div class="project-icon">
                            <i class="fas fa-folder${hasVideo ? '-open' : ''}"></i>
                        </div>
                        <div class="project-info">
                            <div class="project-name text-truncate" title="${name}">${name}</div>
                            <div class="project-details">
                                <span class="text-muted">${created}</span>
                                <span class="project-status ${hasVideo ? 'completed' : ''}">
                                    ${hasVideo ? '已完成' : '进行中'}
                                </span>
                            </div>
                        </div>
                    </div>
                `);

                projectItem.click(function(e) {
                    e.stopPropagation();
                    $('.project-item').removeClass('active');
                    $(this).addClass('active');

                    // 将路径自动填入输入框
                    const dirPath = dir.path;
                    $('#workDir').val(dirPath);

                    // 选择工作目录
                    selectWorkDir(dirPath);
                });

                container.append(projectItem);
            });
        }).fail(function(error) {
            console.error('加载工作目录失败:', error);
            $('#workDirsContainer').html(`
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>加载失败</p>
                    <small>请检查网络连接</small>
                </div>
            `);
        });
    }

    function selectWorkDir(dirPath) {
        currentWorkDir = dirPath;
        updateStatus('idle', `已选择目录: ${dirPath}`);

        // 更新当前项目信息
        updateProjectInfo(dirPath);

        // 加载文件树
        loadFileTree(dirPath);

        // 加载统计信息
        loadStats(dirPath);

        // 加载预览
        loadPreview();
    }

    function updateProjectInfo(dirPath) {
        const projectName = dirPath.split('/').pop();
        $('#currentProjectId').text(projectName);
        $('#currentProjectPath').text(dirPath);

        // 检查是否有视频文件
        $.get(`/api/files?work_dir=${encodeURIComponent(dirPath)}`, function(data) {
            const hasVideo = data.all_files.some(f => f.name.endsWith('.mp4'));
            $('#projectStatus').text(hasVideo ? '已完成' : '准备中');
            $('#projectStatus')
                .removeClass('idle running completed error')
                .addClass(hasVideo ? 'completed' : 'idle');
        }).fail(function() {
            $('#projectStatus').text('未知');
        });
    }

    // 文件树管理
    function loadFileTree(workDir) {
        $.get(`/api/files?work_dir=${encodeURIComponent(workDir)}`, function(data) {
            const container = $('#fileTree');
            container.empty();

            if (data.all_files.length === 0) {
                container.html(`
                    <div class="empty-state">
                        <i class="fas fa-folder-open"></i>
                        <p>目录为空</p>
                        <small>开始生成视频后，文件将在这里显示</small>
                    </div>
                `);
                return;
            }

            // 保存文件树数据
            fileTreeData = data;

            // 构建并渲染文件树
            const treeRoot = buildFileTree(data.all_files);
            renderFileTree(container, treeRoot);
        }).fail(function(error) {
            console.error('加载文件树失败:', error);
            container.html(`
                <div class="empty-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>加载失败</p>
                    <small>无法读取目录内容</small>
                </div>
            `);
        });
    }

    function buildFileTree(files) {
        const root = { name: '', children: [], isDir: true };

        files.forEach(file => {
            const parts = file.path.split('/');
            let currentNode = root;

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const isLast = i === parts.length - 1;

                let childNode = currentNode.children.find(c => c.name === part);

                if (!childNode) {
                    childNode = {
                        name: part,
                        children: [],
                        isDir: !isLast,
                        path: parts.slice(0, i + 1).join('/'),
                        size: isLast ? file.size : null
                    };
                    currentNode.children.push(childNode);
                }

                currentNode = childNode;
            }
        });

        // 按目录在前，文件在后，字母顺序排序
        function sortChildren(node) {
            node.children.sort((a, b) => {
                if (a.isDir && !b.isDir) return -1;
                if (!a.isDir && b.isDir) return 1;
                return a.name.localeCompare(b.name);
            });

            node.children.forEach(child => {
                if (child.isDir) {
                    sortChildren(child);
                }
            });
        }

        sortChildren(root);
        return root;
    }

    function renderFileTree(container, node, level = 0) {
        node.children.forEach(child => {
            if (child.isDir) {
                const dirItem = $(`
                    <div class="directory">
                        <div class="directory-header file-item">
                            <div class="file-icon">
                                <i class="fas fa-folder"></i>
                            </div>
                            <div class="file-name">${child.name}/</div>
                        </div>
                        <div class="directory-children"></div>
                    </div>
                `);

                const header = dirItem.find('.directory-header');
                const childrenContainer = dirItem.find('.directory-children');

                header.click(function(e) {
                    e.stopPropagation();
                    const dir = dirItem;
                    const icon = header.find('i');

                    if (dir.hasClass('expanded')) {
                        dir.removeClass('expanded');
                        icon.attr('class', 'fas fa-folder');
                        childrenContainer.slideUp();
                    } else {
                        dir.addClass('expanded');
                        icon.attr('class', 'fas fa-folder-open');
                        childrenContainer.slideDown();
                    }
                });

                container.append(dirItem);
                renderFileTree(childrenContainer, child, level + 1);
            } else {
                const fileItem = $(`
                    <div class="file-item" data-path="${child.path}">
                        <div class="file-icon">
                            <i class="${getFileIcon(child.name)}"></i>
                        </div>
                        <div class="file-name text-truncate" title="${child.name}">${child.name}</div>
                        <div class="file-size">${formatFileSize(child.size)}</div>
                    </div>
                `);

                fileItem.click(function() {
                    viewFile(child.path);
                });

                container.append(fileItem);
            }
        });
    }

    function getFileIcon(filename) {
        if (filename.endsWith('.mp4') || filename.endsWith('.avi') || filename.endsWith('.mov')) {
            return 'fas fa-file-video';
        } else if (filename.match(/\.(png|jpg|jpeg|gif|webp)$/)) {
            return 'fas fa-file-image';
        } else if (filename.endsWith('.json')) {
            return 'fas fa-file-code';
        } else if (filename.endsWith('.txt') || filename.endsWith('.md')) {
            return 'fas fa-file-alt';
        } else {
            return 'fas fa-file';
        }
    }

    function viewFile(filepath) {
        if (!currentWorkDir) {
            alert('请先选择工作目录');
            return;
        }

        $.get(`/api/file/${encodeURIComponent(filepath)}?work_dir=${encodeURIComponent(currentWorkDir)}`, function(data) {
            if (data.type === 'text') {
                showFileModal(filepath, data.content);
            } else if (filepath.endsWith('.mp4')) {
                playVideo(filepath);
                switchTab('preview');
            } else if (filepath.match(/\.(png|jpg|jpeg|gif|webp)$/)) {
                showImageModal(filepath);
            } else {
                alert('不支持的文件类型');
            }
        }).fail(function(error) {
            console.error('读取文件失败:', error);
            alert('无法读取文件');
        });
    }

    function showFileModal(filename, content) {
        $('#fileName').text(filename.split('/').pop());
        $('#fileSize').text(formatFileSize(new Blob([content]).size));
        $('#fileContent').text(content);
        currentFileUrl = filename;
        $('#fileModal').addClass('active');
    }

    function showImageModal(filepath) {
        const imageUrl = `/api/preview/${encodeURIComponent(filepath)}?work_dir=${encodeURIComponent(currentWorkDir)}`;
        $('#fileName').text(filepath.split('/').pop());
        $('#fileContent').html(`<img src="${imageUrl}" style="max-width:100%; border-radius:8px;">`);
        currentFileUrl = filepath;
        $('#fileModal').addClass('active');
    }

    // 视频功能
    function playVideo(filepath) {
        const videoUrl = `/download/${encodeURIComponent(filepath)}?work_dir=${encodeURIComponent(currentWorkDir)}`;

        $('#previewPlayer .video-player-wrapper').html(`
            <video id="videoPlayer" class="video-element" controls>
                <source src="${videoUrl}" type="video/mp4">
                您的浏览器不支持视频播放
            </video>
        `);

        currentVideo = document.getElementById('videoPlayer');
        if (currentVideo) {
            setupVideoControls(currentVideo);
        }
    }

    function setupVideoControls(video) {
        const playBtn = $('#playBtn');
        const progressFill = $('.player-controls .progress-fill');
        const timeDisplay = $('.time-display');

        video.addEventListener('play', function() {
            playBtn.find('i').attr('class', 'fas fa-pause');
        });

        video.addEventListener('pause', function() {
            playBtn.find('i').attr('class', 'fas fa-play');
        });

        video.addEventListener('timeupdate', function() {
            if (video.duration) {
                const percent = (video.currentTime / video.duration) * 100;
                progressFill.css('width', percent + '%');

                const currentTime = formatTime(video.currentTime);
                const duration = formatTime(video.duration);
                timeDisplay.text(`${currentTime} / ${duration}`);
            }
        });

        video.addEventListener('loadedmetadata', function() {
            const duration = formatTime(video.duration);
            timeDisplay.text(`00:00 / ${duration}`);
            playBtn.prop('disabled', false);
        });

        playBtn.prop('disabled', false);
    }

    function loadPreview() {
        if (!currentWorkDir) {
            $('#previewPlayer .video-player-wrapper').html(`
                <div class="player-placeholder">
                    <div class="placeholder-icon">
                        <i class="fas fa-video"></i>
                    </div>
                    <h4>请选择工作目录</h4>
                    <p>选择项目后可以预览生成的视频</p>
                </div>
            `);
            return;
        }

        $.get(`/api/files?work_dir=${encodeURIComponent(currentWorkDir)}`, function(data) {
            const videoFiles = data.all_files.filter(f => f.name.endsWith('.mp4'));

            if (videoFiles.length > 0) {
                // 优先使用final_video.mp4
                const finalVideo = videoFiles.find(f => f.name === 'final_video.mp4') || videoFiles[0];
                playVideo(finalVideo.path);
            } else {
                $('#previewPlayer .video-player-wrapper').html(`
                    <div class="player-placeholder">
                        <div class="placeholder-icon">
                            <i class="fas fa-video-slash"></i>
                        </div>
                        <h4>暂无视频文件</h4>
                        <p>生成视频后将在这里显示</p>
                    </div>
                `);
            }
        }).fail(function(error) {
            console.error('加载预览失败:', error);
            $('#previewPlayer .video-player-wrapper').html(`
                <div class="player-placeholder">
                    <div class="placeholder-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <h4>加载失败</h4>
                    <p>无法获取视频信息</p>
                </div>
            `);
        });
    }

    function toggleFullscreen() {
        const video = document.getElementById('videoPlayer');
        if (!video) return;

        if (!document.fullscreenElement) {
            if (video.requestFullscreen) {
                video.requestFullscreen();
            } else if (video.mozRequestFullScreen) {
                video.mozRequestFullScreen();
            } else if (video.webkitRequestFullscreen) {
                video.webkitRequestFullscreen();
            } else if (video.msRequestFullscreen) {
                video.msRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    }

    // 生成视频功能
    function generateVideo() {
        const idea = $('#idea').val().trim();
        const userRequirement = $('#user_requirement').val().trim();
        const style = $('#style').val().trim();
        const workDir = $('#workDir').val().trim();

        if (!idea) {
            alert('请输入创意描述');
            return;
        }

        // 禁用按钮
        const generateBtn = $('#generateBtn');
        generateBtn.prop('disabled', true);
        generateBtn.html('<i class="fas fa-spinner fa-spin"></i> 生成中...');

        // 更新状态
        updateStatus('running', '正在生成视频...');
        startTaskTimer();

        // 清空日志
        $('#logContainer').empty();
        logEntries = [];
        updateLogStats();

        // 切换到日志标签页
        switchTab('logs');

        // 发送请求
        $.ajax({
            url: '/api/generate',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                idea: idea,
                user_requirement: userRequirement,
                style: style,
                work_dir: workDir
            }),
            success: function(response) {
                // 更新当前工作目录
                currentWorkDir = response.work_dir;
                $('#workDir').val(response.work_dir);
                updateProjectInfo(response.work_dir);

                // 开始接收日志
                startLogStream();

                // 开始轮询状态
                pollTaskStatus();
            },
            error: function(xhr) {
                console.error('生成失败:', xhr);
                const errorMsg = xhr.responseJSON?.message || '未知错误';
                alert('启动失败: ' + errorMsg);
                resetGenerateButton();
                updateStatus('error', '启动失败');
                stopTaskTimer();
            }
        });
    }

    function startTaskTimer() {
        startTime = new Date();
        if (taskTimer) clearInterval(taskTimer);

        taskTimer = setInterval(function() {
            if (!startTime) return;

            const elapsed = Math.floor((new Date() - startTime) / 1000);
            $('#taskElapsedTime').text(`已用时：${elapsed}s`);

            // 更新进度条（模拟）
            const progress = Math.min(elapsed * 2, 95); // 模拟进度
            $('#taskProgressFill').css('width', progress + '%');
        }, 1000);
    }

    function stopTaskTimer() {
        if (taskTimer) {
            clearInterval(taskTimer);
            taskTimer = null;
        }
    }

    function pollTaskStatus() {
        const interval = setInterval(function() {
            $.get('/api/task_status', function(data) {
                if (!data.running) {
                    clearInterval(interval);
                    resetGenerateButton();

                    if (data.working_dir) {
                        currentWorkDir = data.working_dir;
                        updateStatus('idle', '生成完成');

                        // 更新进度条
                        $('#taskProgressFill').css('width', '100%');
                        stopTaskTimer();

                        // 刷新数据
                        setTimeout(() => {
                            loadWorkDirs();
                            loadFileTree(currentWorkDir);
                            loadStats(currentWorkDir);
                            switchTab('preview');
                            loadPreview();
                        }, 1000);
                    }
                }
            }).fail(function(error) {
                console.error('状态查询失败:', error);
                clearInterval(interval);
                resetGenerateButton();
                updateStatus('error', '状态查询失败');
                stopTaskTimer();
            });
        }, 2000);
    }

    function resetGenerateButton() {
        $('#generateBtn').prop('disabled', false);
        $('#generateBtn').html('<i class="fas fa-play"></i> 开始生成');
    }

    // 日志功能
    function startLogStream() {
        if (eventSource) {
            eventSource.close();
        }

        eventSource = new EventSource('/api/logs');

        eventSource.onmessage = function(event) {
            if (logsPaused) return;

            const data = JSON.parse(event.data);
            if (data.log) {
                addLogEntry(data.log);
            }
        };

        eventSource.onerror = function() {
            console.error('日志连接错误，尝试重连...');
            setTimeout(startLogStream, 3000);
        };
    }

    function addLogEntry(log) {
        const container = $('#logContainer');
        const logClass = getLogClass(log);
        const timestamp = new Date().toLocaleTimeString();

        const entry = $(`
            <div class="log-entry ${logClass}">
                [${timestamp}] ${log}
            </div>
        `);

        container.append(entry);
        logEntries.push({ log: log, type: logClass, timestamp: timestamp });

        // 更新统计
        updateLogStats();

        // 更新日志计数
        $('#logCount').text(logEntries.length);

        // 自动滚动
        if ($('#autoScroll').prop('checked')) {
            container.scrollTop(container[0].scrollHeight);
        }
    }

    function getLogClass(log) {
        const logStr = log.toLowerCase();
        if (log.includes('✅') || log.includes('✓') || logStr.includes('完成') || logStr.includes('成功')) {
            return 'success';
        } else if (log.includes('❌') || logStr.includes('错误') || logStr.includes('失败')) {
            return 'error';
        } else if (log.includes('⚠️') || logStr.includes('警告')) {
            return 'warning';
        } else {
            return 'info';
        }
    }

    function filterLogs(filter) {
        const container = $('#logContainer');
        container.empty();

        let filteredEntries = logEntries;
        if (filter !== 'all') {
            filteredEntries = logEntries.filter(entry => entry.type === filter);
        }

        filteredEntries.forEach(entry => {
            const logEntry = $(`
                <div class="log-entry ${entry.type}">
                    [${entry.timestamp}] ${entry.log}
                </div>
            `);
            container.append(logEntry);
        });

        updateLogStats();
    }

    function updateLogStats() {
        const total = logEntries.length;
        const infoCount = logEntries.filter(e => e.type === 'info').length;
        const successCount = logEntries.filter(e => e.type === 'success').length;
        const warningCount = logEntries.filter(e => e.type === 'warning').length;
        const errorCount = logEntries.filter(e => e.type === 'error').length;

        const statsText = `总共 ${total} 条日志 (信息: ${infoCount}, 成功: ${successCount}, 警告: ${warningCount}, 错误: ${errorCount})`;
        $('#logStats').text(statsText);
        $('#logUpdateTime').text(`最后更新：${new Date().toLocaleTimeString()}`);
    }

    function exportLogs() {
        const logText = logEntries.map(e => `[${e.timestamp}] ${e.log}`).join('\n');
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs_${new Date().toISOString().slice(0, 10)}_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function copyLogs() {
        const logText = logEntries.map(e => `[${e.timestamp}] ${e.log}`).join('\n');
        if (navigator.clipboard) {
            navigator.clipboard.writeText(logText).then(function() {
                alert('日志已复制到剪贴板');
            }, function() {
                alert('复制失败');
            });
        } else {
            // 兼容旧浏览器
            const textarea = document.createElement('textarea');
            textarea.value = logText;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            alert('日志已复制到剪贴板');
        }
    }

    // 统计功能
    function loadStats(workDir) {
        if (!workDir) return;

        $.get(`/api/stats?work_dir=${encodeURIComponent(workDir)}`, function(data) {
            $('#fileCount').text(data.total_files);
            $('#totalSize').text(formatFileSize(data.total_size));

            // 更新统计时间
            $('#statsUpdateTime').text(new Date().toLocaleTimeString());

            // 如果有主要文件信息，可以进一步处理
            if (data.main_files) {
                // 这里可以添加更多的统计信息显示
            }
        }).fail(function(error) {
            console.error('加载统计信息失败:', error);
        });
    }

    // 系统功能
    function updateSystemTime() {
        const now = new Date();
        $('#currentTime').text(now.toLocaleTimeString());
    }

    function updateSystemInfo() {
        // 模拟系统信息
        $('#cpuUsage').text(Math.floor(Math.random() * 30 + 10) + '%');
        $('#memoryUsage').text(Math.floor(Math.random() * 40 + 20) + '%');
        $('#diskUsage').text(Math.floor(Math.random() * 50 + 30) + '%');
    }

    function updateStatus(state, message) {
        const dot = $('#statusDot');
        const text = $('#statusText');
        const progressText = $('#taskProgressText');

        dot.removeClass('idle running error').addClass(state);
        text.text(message);
        progressText.text(message);
    }

    function checkTaskStatus() {
        $.get('/api/task_status', function(data) {
            if (data.running) {
                updateStatus('running', '检测到运行中的任务...');
                currentWorkDir = data.working_dir;
                if (currentWorkDir) {
                    $('#workDir').val(currentWorkDir);
                    updateProjectInfo(currentWorkDir);
                    startLogStream();
                    pollTaskStatus();
                    startTaskTimer();
                }
            }
        }).fail(function(error) {
            console.error('检查任务状态失败:', error);
        });
    }

    // 工具函数
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // 初始化字符计数
    updateCharCount();

    // 页面卸载清理
    $(window).on('beforeunload', function() {
        if (eventSource) {
            eventSource.close();
        }
        stopTaskTimer();
    });
});