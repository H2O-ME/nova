/*
 * W1b 第三对象：Codex 式工作台的静态布局（纯结构、零数据、零交互逻辑）。
 * 唯一目的是给「完整工作台 UI 的渲染成本」一个可测的形态——不是产品实现：
 * 无状态管理、无数据绑定、无图标依赖，密度与分区按 Nova 的方向示意。
 */
import './bench.css'

type TaskStatus = 'running' | 'waiting' | 'done' | 'failed'

function StatusDot({ status }: { status: TaskStatus }) {
  return <span className={`dot dot-${status}`} aria-hidden />
}

function TaskList() {
  const tasks: Array<{ title: string; status: TaskStatus; meta: string }> = [
    { title: '修复项目构建问题', status: 'running', meta: '运行中 · 2m' },
    { title: '研究 Windows API', status: 'waiting', meta: '等待审批' },
    { title: '整理项目文档', status: 'done', meta: '完成 · 12 分钟前' },
    { title: '重构会话存储层', status: 'done', meta: '完成 · 1 小时前' },
    { title: '爬取依赖更新日志', status: 'failed', meta: '失败 · 3 小时前' },
    { title: '周报草稿', status: 'done', meta: '完成 · 昨天' },
  ]
  return (
    <aside className="nav">
      <button className="newTask">＋ 新建任务</button>
      <div className="navSection">当前工作区</div>
      <div className="workspaceRow">D:\web\agent</div>
      <div className="navSection">任务</div>
      <ul className="taskList">
        {tasks.map((t) => (
          <li key={t.title} className={`taskRow ${t.status === 'running' ? 'taskRow-active' : ''}`}>
            <StatusDot status={t.status} />
            <div className="taskText">
              <div className="taskTitle">{t.title}</div>
              <div className="taskMeta">{t.meta}</div>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function Timeline() {
  return (
    <main className="stage">
      <div className="stageHeader">
        <span className="stageTitle">修复项目构建问题</span>
        <span className="stageBadge">Agent 正在执行</span>
      </div>
      <div className="timeline">
        <div className="turnUser">先检查项目结构和构建日志，定位错误来源。</div>
        <div className="agentText">我会先检查项目结构和构建日志，定位错误来源。</div>
        <div className="toolRow">
          <span className="toolIcon">▸</span>
          <span className="toolName">读取 package.json</span>
          <span className="toolMeta">0.2s</span>
        </div>
        <div className="toolRow toolRow-open">
          <span className="toolIcon">▾</span>
          <span className="toolName">执行 pnpm build</span>
          <span className="toolMeta">4.8s</span>
          <div className="toolBody">
            <div className="termLine">✓ Build completed with 1 warning</div>
          </div>
        </div>
        <div className="agentText">发现一个 TypeScript 类型错误，正在检查相关模块。</div>
        <div className="toolRow">
          <span className="toolIcon">▸</span>
          <span className="toolName">修改 src/services/runtime.ts</span>
          <span className="toolMeta">进行中</span>
        </div>
        <div className="approvalCard">
          <div className="approvalTitle">等待审批 · bash</div>
          <div className="approvalCmd">pnpm test --filter nova-web-ui</div>
          <div className="approvalActions">
            <button className="btn btn-primary">允许一次</button>
            <button className="btn">总是允许</button>
            <button className="btn btn-danger">拒绝</button>
          </div>
        </div>
      </div>
      <div className="composer">
        <div className="composerBox">向 Nova 发送指令…</div>
        <div className="composerBar">
          <span className="chip">Auto</span>
          <span className="chip">claude-opus-4-6</span>
          <button className="send">↑</button>
        </div>
      </div>
    </main>
  )
}

function Inspector() {
  const changes = [
    { path: 'src/services/runtime.ts', add: 24, del: 8 },
    { path: 'packages/web/src/protocol.ts', add: 6, del: 2 },
    { path: 'docs/NOVA-WINDOWS.md', add: 119, del: 0 },
  ]
  return (
    <aside className="inspector">
      <div className="inspectorTabs">
        <span className="inspectorTab inspectorTab-active">Changes</span>
        <span className="inspectorTab">Run</span>
        <span className="inspectorTab">Git</span>
      </div>
      <ul className="changeList">
        {changes.map((c) => (
          <li key={c.path} className="changeRow">
            <span className="changePath">{c.path}</span>
            <span className="changeStat">
              <em className="add">+{c.add}</em> <em className="del">−{c.del}</em>
            </span>
          </li>
        ))}
      </ul>
      <div className="diffBox">
        <div className="diffLine diff-add">+ const seat = resolveSeat(model)</div>
        <div className="diffLine diff-del">- const seat = model.seat</div>
        <div className="diffLine">+ applySeat(kernel, seat)</div>
      </div>
    </aside>
  )
}

export default function App() {
  return (
    <div className="workbench">
      <TaskList />
      <Timeline />
      <Inspector />
    </div>
  )
}
