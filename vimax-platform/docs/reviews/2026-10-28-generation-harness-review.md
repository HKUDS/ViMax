# ViMax 生成链路与 harness 审查

审查日期：2026-10-28。范围：当前工作区的 Web/TypeScript 决策与编排、Python Agent 桥接、队列、事件回填、画布依赖、资产清理与现有测试；包含审查时已有的未提交修改。未修改业务代码，未运行真实供应商生成或部署测试。

**结论：链路具备主要功能模块，但执行边界和验证闭环尚不完整，不能据此认定生产环境健壮。最直接的阻断是 Python/TS 的 Agent 结果契约不一致；主要可靠性风险是生成任务与队列生命周期脱节、事件无持久确认、结果提交不原子，以及缺少运行版本隔离。**

下列 P1 为应优先修复的生成正确性/可靠性问题，P2 为功能完整性问题；“静态确认”表示已沿调用链检查，尚未通过完整基础设施故障注入复现。

## 具体发现（按修复优先级）

### F01 · P1 · 9 类 Agent 结果在跨语言契约处丢失【探针复现】

位置：[pipeline_handler.py:35](../../workers/image/vimax_image_worker/pipeline_handler.py#L35)、[schemas.ts:281](../../packages/contracts/src/schemas.ts#L281)、[job-event.service.ts:111](../../apps/api/src/domain/job/job-event.service.ts#L111)。

`_json_output()` 用 `**result` 将 `characters`、`story/scripts`、`portraits` 等放在 output 顶层；TS 的 `JobEventSchema` 仅声明 `output.result`，解析后会过滤这些顶层字段。完成处理器因此不进入 `applyAgentResult()`，又因 `storage_key` 为空而不生成资产，最终仍将 job 标记为 succeeded。

影响：idea2script、角色抽取、三视图、剧本规划/增强、小说改编、选参考、选最佳图、机位树共 9 类 job 的成功返回不能正常回填；两个返回 `cells` 的分镜类型走另一条分支。

验证：用 mock 替代模型调用、执行真实 `handle_pipeline_job(script2characters)`，输出包含顶层 `characters`；将该形状送入真实 TS schema 后，`characters` 消失，`output.result` 为 undefined。

建议：明确二进制产物、cells、Agent result 三种完成协议；Python 为 Agent 统一发送 `result`，TS 按 job type 验证结果语义，并对全部 11 种 pipeline job 做跨语言契约回归。

### F02 · P1 · BullMQ 只保证转发，不能恢复实际生成；完成事件也可能丢失【静态确认】

位置：[bullmq.ts:70](../../apps/api/src/infrastructure/queue/bullmq.ts#L70)、[main.py:58](../../workers/image/vimax_image_worker/main.py#L58)、[reporter.py:22](../../workers/image/vimax_image_worker/reporter.py#L22)、[consumer.ts:16](../../apps/api/src/infrastructure/pubsub/consumer.ts#L16)。

bridge 在 LPUSH 成功后即返回，BullMQ 将 job 视为 completed。Python BRPOP 后若进程退出，该任务没有 processing lease/ACK 或重新领取机制；API 在 completed 发布时重启/断线，Pub/Sub 事件也没有回放。两者都会留下 DB 中永久 queued/running 的任务，BullMQ 的 attempts/DLQ 无法补救实际执行。

图片 worker 已有部分异常重试，视频也有容量类 fallback，但这些不覆盖进程崩溃、消息丢失或 API 重启。不能把它们等同于端到端交付保证。

建议：保留一个有 ACK、租约和超时回收的执行通道；完成结果先持久化再通知，消费成功后确认。任务入库与入队之间也需要 outbox 或可重放调度记录，避免 DB 插入成功而 Redis 入队失败留下僵尸任务。

### F03 · P1 · 结果回填失败仍提交成功，且破坏性更新不在同一事务【静态确认】

位置：[job-event.service.ts:86](../../apps/api/src/domain/job/job-event.service.ts#L86)、[job-event.service.ts:118](../../apps/api/src/domain/job/job-event.service.ts#L118)、[job-event.service.ts:172](../../apps/api/src/domain/job/job-event.service.ts#L172)、[storyboard-spawn.ts:85](../../apps/api/src/domain/canvas/storyboard-spawn.ts#L85)。

分镜回填先删旧链，再分别插节点和边；任一步失败仅记录日志，随后 job 仍变成 succeeded。Agent 回填也吞掉异常；二进制分支甚至先写 job succeeded，再更新节点及依赖。编排器只轮询 jobs.status，因此可能在节点未落库或仍 running 时推进下一阶段。

建议：验证结果、节点/边/资产写入和 job 终态作为一次提交；回填失败保留可重试状态，提交成功后再广播。删除旧链也必须与新链替换原子化。

### F04 · P1 · 缺少事件幂等与运行版本校验，重复/迟到结果会覆盖新状态【静态确认】

位置：[job-event.service.ts:39](../../apps/api/src/domain/job/job-event.service.ts#L39)、[job-event.service.ts:47](../../apps/api/src/domain/job/job-event.service.ts#L47)、[job-event.service.ts:86](../../apps/api/src/domain/job/job-event.service.ts#L86)、[canvas.service.ts:422](../../apps/api/src/domain/canvas/canvas.service.ts#L422)。

每次收到事件都会再次执行副作用，没有 eventId 去重、终态条件更新或节点当前 job/version 校验。重放分镜 completed 会再次清掉已生成的下游并重新建链；旧 job 在新一轮生成后完成，也可以把节点 output/status 覆盖回旧结果。迟到 started 还可把 succeeded 的任务改回 running。

建议：引入 eventId、attempt 和节点 generation/version；仅当前版本可提交输出，重复事件无副作用，终态不被旧事件逆转。仅按 jobId 去重不能解决同一节点的新旧 job 覆盖问题。

### F05 · P1 · 管线异常不保证终态，取消后仍能执行结构修改【静态确认】

位置：[pipeline-orchestrator.ts:36](../../apps/api/src/domain/canvas/pipeline-orchestrator.ts#L36)、[pipeline-orchestrator.ts:394](../../apps/api/src/domain/canvas/pipeline-orchestrator.ts#L394)、[pipeline-orchestrator.ts:652](../../apps/api/src/domain/canvas/pipeline-orchestrator.ts#L652)、[pipeline-orchestrator.ts:697](../../apps/api/src/domain/canvas/pipeline-orchestrator.ts#L697)。

普通异常（如分镜失败、等待超时、数据库错误）在外层仅 throw，再由 startAutoPipeline 打日志，没有 pipeline.finished；前端可能一直 running。取消在图片/视频阶段又被 runOne 捕获为普通失败，之后流程仍可能发出正常 finished；正在执行的分镜转 shot 不接收 signal，取消期间返回后仍插入节点，并继续 ensureProductionChain。activeRuns 只在进程内，重启后无法查询、恢复或取消原 run。

建议：持久化 run/stage 状态，所有出口提交一次终态；明确取消语义，取消后停止新调度和图变更，并阻止晚到结果触发级联。运行中的供应商任务是否能中断，应由各适配器声明；不能只中断轮询。

### F06 · P1 · “在途去重”是先查后写，并发调用仍会重复付费【静态确认】

位置：[node-executor.service.ts:81](../../apps/api/src/domain/canvas/node-executor.service.ts#L81)、[node-executor.service.ts:147](../../apps/api/src/domain/canvas/node-executor.service.ts#L147)、[node-executor.service.ts:1590](../../apps/api/src/domain/canvas/node-executor.service.ts#L1590)。

assertNoInFlightNodeJob 查询与 jobs INSERT 不原子。两个并发请求均可读到无在途 job，然后各自生成不同 jobId 入队；BullMQ 的 jobId 去重无法合并它们。若第二个请求恰好被 guard 拒绝，runNode 的 catch 又会把第一个仍在运行的节点标成 failed。45 分钟后忽略旧任务也不能代替确认旧执行已失效。

建议：以数据库原子 claim/条件更新或唯一执行记录控制节点执行权；拒绝重复请求时返回当前 job，并保持其节点状态。超时回收需要租约和版本隔离。

### F07 · P1 · 自动运行越过所选 script 的图边界，再生成会删除输入参考节点【静态确认】

位置：[pipeline-orchestrator.ts:125](../../apps/api/src/domain/canvas/pipeline-orchestrator.ts#L125)、[pipeline-orchestrator.ts:486](../../apps/api/src/domain/canvas/pipeline-orchestrator.ts#L486)、[pipeline-orchestrator.ts:555](../../apps/api/src/domain/canvas/pipeline-orchestrator.ts#L555)、[pipeline-orchestrator.ts:607](../../apps/api/src/domain/canvas/pipeline-orchestrator.ts#L607)。

输入虽有 script_node_id，后续却读取整个 canvas 的 cells、shots、images、videos、concat；同画布的其他剧本或手工链会一起扩展/执行。regenerate 更会删除所有非 script 节点，包括用户参考 image 和其他工作链；这会移除 copy-driven 模式所需输入容器。参考资产本身未必被删，但原引用和工作图会丢失。

建议：每个 run 明确根节点、受管子图和节点来源；只替换本次生成的节点，保留上传输入及其他脚本的子图。不要依赖画布全量节点顺序推断执行归属。

### F08 · P1 · 角色三视图未进入自动首帧生成路径【静态确认】

位置：[pipeline-orchestrator.ts:553](../../apps/api/src/domain/canvas/pipeline-orchestrator.ts#L553)、[pipeline-orchestrator.ts:361](../../apps/api/src/domain/canvas/pipeline-orchestrator.ts#L361)、[pipeline-orchestrator.ts:607](../../apps/api/src/domain/canvas/pipeline-orchestrator.ts#L607)、[node-executor.service.ts:1298](../../apps/api/src/domain/canvas/node-executor.service.ts#L1298)、[node-executor.service.ts:872](../../apps/api/src/domain/canvas/node-executor.service.ts#L872)。

即使先修 F01，首次运行时 ensureCharacters 在新 shot 创建前给“已有 shot”写 visibleCharIds，新 shot 不会得到该字段；后续自动生成又只运行 image，不运行读取角色三视图的 runShotNode。image 仅合并 upstream output 和自身 referenceAssetIds，而未运行的 shot 没有 output，因此角色参考仍未进入 image job。

建议：shot 创建后确定可见角色，并在实际执行的首帧路径中组装三视图 reference；用记录型假供应商断言最终 job 的 reference_storage_keys，不能只测角色节点存在。

### F09 · P1 · copy-driven 有参考图时反而丢失每个镜头文案【静态确认】

位置：[node-executor.service.ts:1467](../../apps/api/src/domain/canvas/node-executor.service.ts#L1467)、[node-executor.service.ts:1469](../../apps/api/src/domain/canvas/node-executor.service.ts#L1469)、[node-executor.service.ts:1534](../../apps/api/src/domain/canvas/node-executor.service.ts#L1534)。

读取 shot.ffDesc 被放在“没有 firstFrameId”条件里。自动 copy-driven 链恰好连接了 reference image → video，firstFrameId 有值，于是 shotDesc 始终为空；同一参考图、同一视频配置的多个镜头得到相同 prompt/cache key，可能生成或复用同一个片段。

建议：独立解析镜头文案与参考帧；无论参考帧是否存在，都保留本镜头文本及其缓存输入。断言两个不同 shot 文案产生不同视频 prompt 和 cache key。

### F10 · P1 · 合成允许漏镜头，片段顺序也没有显式保证【纯函数探针复现＋静态确认】

位置：[canvas-graph.ts:101](../../apps/api/src/domain/canvas/canvas-graph.ts#L101)、[node-executor.service.ts:476](../../apps/api/src/domain/canvas/node-executor.service.ts#L476)、[node-executor.service.ts:1685](../../apps/api/src/domain/canvas/node-executor.service.ts#L1685)。

resolveUpstreamInputs 会跳过没有 output 的上游，runConcatNode 只要求剩下至少两个资产。因此 3 个视频中有 1 个失败时，另外两个仍可合成为 done；若重跑失败节点保留旧 output，还可能拼入旧片段。当前收边查询没有 orderBy 或显式片段序号，后续“保留 upstream 顺序”不能保证剧本顺序。

探针结果：expectedVideoInputs=3、resolvedInputs=2、passesConcatCountGuard=true，缺失 v2。

建议：以有序 clip manifest 明确预期片段、版本、状态和时长；缺失则阻止完整成片提交。如产品允许部分成片，必须明确标记 partial 和缺失镜头，不能与完整成片共用成功语义。

### F11 · P1 · offload 依赖检查遗漏 data 引用和排队任务【静态确认】

位置：[asset-offload.ts:39](../../apps/api/src/domain/asset/asset-offload.ts#L39)、[asset-offload.ts:68](../../apps/api/src/domain/asset/asset-offload.ts#L68)、[asset-offload.ts:157](../../apps/api/src/domain/asset/asset-offload.ts#L157)。

依赖保护只找 outputAssetId 对应的生产节点和显式出边；referenceAssetIds、角色 side/backAssetId、voiceoverAssetId、job input snapshot 中的引用都没有完整纳入。例如已有生成图作为新图片的 data.referenceAssetIds、但没有图连线时，预览 offload 可以在消费者读取前删除输入。TTL 又只避让直接下游 running，queued job、隐式消费与校验/删除之间的竞争没有资产租约保护。

建议：任务 claim 时登记输入资产租约，最终确认/取消后释放；offload/sweep 以统一依赖索引和租约为准。浏览器恢复通路可以改善手动重跑，但不覆盖服务端自动编排和并发清理。

### F12 · P1 · 缓存命中不检查产物可用性，也不驱动依赖恢复【静态确认】

位置：[cache.service.ts:59](../../apps/api/src/domain/image/cache.service.ts#L59)、[node-executor.service.ts:106](../../apps/api/src/domain/canvas/node-executor.service.ts#L106)、[node-executor.service.ts:1566](../../apps/api/src/domain/canvas/node-executor.service.ts#L1566)。

缓存只查 succeeded job，命中时把旧 outputAssetId 直接标为 done，不确认其二进制是否已 offload 或仍存在。本地存在副本的用户可能还能预览，但服务端后续 video/concat 无法直接消费；自动编排没有调用浏览器恢复路径。applyCacheHit 也不执行普通 completed 分支的 dirty/级联逻辑，导致缓存与真实生成有不同的依赖语义。

建议：区分“元数据匹配”与“可消费产物命中”；输出不可用时明确触发恢复或缓存失效。缓存和真实生成统一走完成提交逻辑。

### F13 · P2 · 标准 video→concat 图无法收集 shot 字幕，TTS 未进入成片消费路径【静态确认】

位置：[node-executor.service.ts:1655](../../apps/api/src/domain/canvas/node-executor.service.ts#L1655)、[node-executor.service.ts:1671](../../apps/api/src/domain/canvas/node-executor.service.ts#L1671)、[node-executor.service.ts:1760](../../apps/api/src/domain/canvas/node-executor.service.ts#L1760)、[concat_handler.py:25](../../workers/image/vimax_image_worker/concat_handler.py#L25)。

collectUpstreamSubtitles 只查询 concat 的直接上游，并仅接受 shot；标准图的直接上游是 video，故打开 burnSubtitles 后仍返回 undefined。TTS 虽回填 voiceoverAssetId，但标准 video/concat payload 与 worker 没有消费该音轨的混音步骤；自动编排也没有 TTS 阶段。另有 transition 进入缓存键但未传给 concat worker，实际始终执行 concat demuxer。

建议：在有序 clip manifest 中携带 shotId、字幕和音轨；明确旁白混音、转场的实际支持范围，并在最终视频上验证字幕存在、音轨存在和时长对齐。FFmpeg 的 `-c copy` 还要求输入流参数兼容，备用模型混合输出需要单独验证/标准化。

## Harness 完整性判断

已有基础值得保留：共享 Zod 合约、部分 Python Pydantic 输入、Agent 步数/Token/重复失败上限、图片异常退避、视频容量 fallback、内容缓存、图就绪判断、上传资产保护、local-first 恢复入口和 trace。它们目前主要保护单个函数或局部操作，尚未形成跨服务的执行闭环。

关键缺口是以下不变量尚未被统一执行和测试：

1. 一个已接受的任务必须可追踪到成功、失败或取消；进程退出后仍能恢复。
2. job 成功必须意味着结果语义合法、产物可消费、画布提交完成。
3. 同一节点同一版本只有一个执行者；旧版本和重复事件不产生副作用。
4. 执行和清理都依据同一份资产依赖及租约信息。
5. 完整成片必须具有预期的有序片段、字幕/音轨和可下载二进制。
6. 任何 run 都不能越过授权的脚本子图和资源预算。

建议沿现有 TS 编排权补齐这些边界，不必再增加一个决策 Agent 或另建一套编排框架。

## 安全与 SOLID 评价

- 资源权限目前主要是“已登录”：tRPC protectedProcedure 验证身份，但 canvas create/list 走默认 tenant，WS room/chat.stop/pipeline.cancel 没有资源成员校验。若部署定位始终是可信单团队共享空间，应将此作为明确约束；若开放不同用户/租户，必须增加服务端资源授权与租户传播。当前不能认定已具备多租户隔离。
- `timeout_ms` 在 image/video payload 中声明，但 worker 未以该字段包住整个执行；concat 的 subprocess.run 也没有 timeout。编排层轮询超时不会停止供应商调用/FFmpeg，资源预算尚未闭环。Agent 的 Token 预算也不能限制已入队媒体任务的实际费用。
- 工具输入存在模型声明和局部归一化，但不能用 TypeScript 强制转换或 LLM tool schema 代替服务端执行时校验；建议对可修改图、引用资源、启用供应商的入口统一做 schema 和权限检查。
- SOLID 方面，实际问题是同一“完成”语义散布于事件、缓存、Agent 回填和编排器，各自处理节点状态/级联，已经出现 F03/F12 的行为差异；node-executor.service.ts 也同时承担模型解析、缓存、调度和图变更。优先抽出小而明确的 claim、完成提交、依赖清单接口，避免仅为拆文件增加抽象层。

## 验证结果与证据边界

执行目录及命令：

- `vimax-platform/apps/api`：`pnpm test`，**263/263 通过**。
- `vimax-platform/apps/web`：`pnpm test`，**41/41 通过**。
- `vimax-platform`：`pnpm typecheck`，**contracts、ui、api、web 通过**。
- `vimax-platform/workers/image`：`python -m pytest tests -q`，初始 **41 通过、4 失败**；其中 3 项由未配置 VIMAX_ROOT 导致 interfaces 模块不可见。
- 同目录配置 `VIMAX_ROOT=E:\teams\ViMax-main` 后重跑：**44 通过、1 失败**；剩余 `test_text_renderer.py::ResolveFontTest::test_env_var_takes_priority` 对不存在的 `C:/fonts/custom.ttf` 的预期与实现检查路径存在的行为不一致。不能把这一项直接归因为真实字体渲染故障。
- 无模型调用的 Python handler mock＋真实 TS schema 探针：**复现 F01**。
- 真实 resolveUpstreamInputs 的三路视频输入探针：**复现 F10 的缺失输入仍通过数量门槛**。

现有测试多数覆盖纯函数、调度表和局部协议；未发现专门针对 pipeline-orchestrator、job-event.service、bridge 实际执行生命周期的集成测试。`apps/api/e2e-pipeline.mts` 能检查普通场景的 concat 节点/资产行，但本次未执行；脚本当前只凭 DB 的 done/asset 行不能证明二进制可下载、片段齐全、画面顺序或字幕音轨正确。未据此声称真实生成 E2E 已通过。

## 最小修复顺序与必须补的验收场景

**第一批：先让结果正确进入系统。** 修复 F01 的跨语言 envelope，为各 job type 加语义校验；完成回填与终态原子提交；新增“重复 completed”“apply 失败”“空 cells/缺少 portraits”等回归。验收标准：成功任务必有对应的有效画布结果，错误结果不被标成成功。

**第二批：建立执行所有权与恢复。** 加节点原子 claim、attempt/version、持久化 run 状态、输入租约和可确认的执行/结果交付。验收覆盖 BRPOP 后 kill worker、API 收结果时重启、Redis 临时断线、DB 提交失败、双请求并发、晚到旧结果、超时与取消；要求没有永久僵尸和重复提交，供应商重复调用需要显式幂等策略。

**第三批：保证成片语义。** 限定 script 子图，固定有序 clip manifest，打通角色参考、copy-driven 文案、字幕和音轨。用记录型假供应商验证实际 payload，再用本地产生的不同颜色/编号视频跑真实 FFmpeg，检查顺序、时长、字幕和音轨；另测一个失败镜头、旧 output、单镜头、不同模型参数及部分成片策略。

**第四批：覆盖资产与交互边界。** 在输入排队/运行期间执行 offload/sweep；测试 data-only 引用、已 offload 缓存、无本地副本、IndexedDB 配额失败、页面刷新/WS 重连、同画布双 run、同会话并发 chat.send，以及多脚本 regenerate。若开放多租户，再加入越权读写/取消和租户间缓存隔离测试。

以上是整改建议与验收设计，尚未实施；本次新增交付仅为此审查报告。
