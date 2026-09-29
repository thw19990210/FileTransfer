# Subagent Profile Studio

这是一个面向 Skill 开发者的 Subagent Profile 管理界面原型。第一阶段只解决 Profile 的创建、配置、发布和使用，不承担 Workflow 编排。

## 核心定位

> 平台统一管理 Profile；每个 Profile 通过可见范围决定哪些 Skills 能够发现并选择。Skill 具体在第几步调用 Profile，仍由 `SKILL.md` 描述。

Profile 定义 Subagent 稳定的运行方式，包括模型、运行策略和上下文与契约。运行策略统一管理工具权限、执行限制和 Skill 装载；上下文与契约统一管理 Prompt 定制、对话历史继承和输入输出 Schema。一次定义后，可以在多个位置复用。

## 可见范围

所有 Profile 使用同一套配置结构，仅通过 `visibility.scope` 控制发现范围：

| 可见范围 | 配置值 | 可发现对象 | 附加参数 |
| --- | --- | --- | --- |
| 系统范围可见 | `system` | 所有 Skills | 无 |
| 特定 Skills 可见 | `skills` | `visibility.skills[]` 中的 Skills | 可见 Skills 和生命周期 |

选择“特定 Skills 可见”后，页面才展开 `visibility.skills[]` 和生命周期参数。未进入可见列表的 Skill 不应在 Profile 候选列表中看到该 Profile。

### 限定可见 Profile 生命周期

特定 Skills 可见的 Profile 可以设置独立的激活生命周期：

- `lifecycle.max_active_turns`：从任一可见 Skill 激活 Profile 后开始计数，限制本次最多生效多少个父会话轮次；留空表示不设置轮数上限。
- `lifecycle.invalidate_on_other_skill_load`：加载其他 Skill 后是否立即结束当前 Profile 的生效状态。

生命周期到期或因其他 Skill 加载而失效后，再次加载可见列表中的 Skill 可以重新激活。生命周期属于平台元数据，只用于 Profile 的选择和状态管理，不写入 Subagent 运行时 TOML。

## 当前如何在 Step3 使用

第一阶段不提供 Workflow/Step 编辑器。Skill 开发者在 `SKILL.md` 的相应步骤中明确调用 `run_subagent`：

```markdown
### Step 3：调用子 Agent

调用 `run_subagent`，设置：
`subagent_profile_id: risk-reviewer`

将上一步得到的文件和用户要求传给 Subagent。
等待 Subagent 完成后，继续执行下一步。
```

同一个 Profile 可以被同一 Skill 的多个步骤重复使用。平台不理解 Step 的业务含义，也不推断调用时机。

## 第一期范围

当前界面覆盖：

- 系统范围或特定 Skills 可见范围选择
- 可见 Skills 列表、版本和发布状态
- `SKILL.md` 调用示例生成
- Profile 全量运行参数编辑
- 基础 System Prompt 和五个 Markdown 槽位的独立定制
- Skill 可用范围和启动时预加载
- Profile 输入与输出 JSON Schema 契约
- TOML/JSON 实时预览、校验、复制和导出
- 本地草稿自动保存

当前明确不包含：

- Workflow/Step 编辑器
- Step 输入输出映射
- 失败策略编排
- 完整调用链 Trace
- 自动化调试与评测

## Prompt 定制

Prompt 不再使用一个整体的 `inherit/replace/compose` 开关，而是分别配置基础 System Prompt 和五个标准 Markdown 槽位：

- `SOUL.md`
- `AGENTS.md`
- `TOOLS.md`
- `USER.md`
- `MEMORY.md`

每个槽位独立支持三种模式：

- `inherit`：沿用父 Agent 中对应的 Prompt 内容
- `empty`：明确不向 Subagent 注入该槽位
- `custom`：使用 Profile 中填写的完整自定义内容

```toml
[prompt.files."AGENTS.md"]
mode = "custom"
content = """
# 工作规则
只处理当前委派任务。
"""

[prompt.files."MEMORY.md"]
mode = "empty"
content = ""
```

`thought` 前缀属于特定模型协议，不作为通用 Profile 参数暴露。按槽位合并 Prompt 的能力需要运行时配套解析；当前页面负责生成目标配置结构。

## 上下文 Fork

`fork.include_parent_history` 是父会话上下文继承总开关。关闭后，Subagent 只接收本次显式输入；其余 Fork 参数保留但不生效。开启后可独立配置：

- `max_prior_turns`：最多继承多少个已完成历史轮次；留空表示全部，`0` 表示不继承已完成轮次。
- `max_history_chars`：历史消息的最大字符预算；超出时从最早历史开始裁剪，留空表示不限制。
- `prior_turns`：已完成历史轮次的消息类型，使用 `ua` 或 `uat`。
- `out_of_scope_tool_instruction`：为子 Agent 不可调用工具的结果追加说明。

其中 `ua` 表示保留 User 与 Assistant 文本，`uat` 还会保留完整的工具调用和工具结果。历史继承应先选取最近轮次，再按消息类型过滤，并在最后应用字符预算。

## 输入与输出

每个 Profile 使用两个 JSON Schema 定义父 Agent 与 Subagent 之间的稳定数据契约：

- `input_schema`：父 Agent 调用 Subagent 时必须提供的数据。
- `output_schema`：Subagent 完成任务后必须返回的数据。

两个 Schema 的根节点都必须是 `object` 并定义 `properties`。如果配置 `required`，其中每个字段都必须在 `properties` 中存在。示例：

```json
{
  "type": "object",
  "required": ["task"],
  "additionalProperties": false,
  "properties": {
    "task": {
      "type": "string",
      "description": "需要 Subagent 完成的具体任务。"
    }
  }
}
```

Schema 定义的是 Profile 级调用边界，不是 Step 输入输出映射。Skill 中每个 Step 如何组装输入、如何消费输出，仍由 `SKILL.md` 描述。已发布 Profile 的 Schema 发生不兼容修改时，应发布新的 Profile 版本，避免影响已有 Skill。

## Skill 装载策略

Skill 白名单和黑名单同时生效，不再使用互斥的过滤模式：

- `skills.allow`：保证这些 Skill 出现在 Subagent 的可选列表中。
- `skills.deny`：从父 Agent 继承的 Skill 列表中过滤匹配项，支持 `*`。
- `skills.preload`：在第一次模型调用前确定性加载，且必须同时出现在白名单中。

运行时合并顺序为：`有效列表 = 父 Agent Skills − 黑名单 + 白名单`。因此可以使用 `deny = ["*"]` 过滤全部继承项，再通过白名单逐个加入允许使用的 Skill。

```toml
[skills]
allow = ["document-reader", "contract-review"]
deny = ["legacy-skill"]
preload = ["contract-review"]
```

白名单和预加载项必须使用明确的 Skill 名称。任一预加载 Skill 不存在或加载失败时，运行时应拒绝启动 Subagent。

白名单/黑名单合并及预加载需要运行时支持。前端生成配置本身不能保证运行时已经实现。预加载可以保证 Skill 内容进入上下文，但不能绝对保证模型遵循其中的每条指令。

## 元数据与运行时配置

可见范围、可见 Skills 列表、版本、发布状态和限定可见生命周期属于平台元数据。右侧 TOML/JSON 只展示传给运行时的 Profile 配置，不把平台元数据混入现有 Profile Schema。Profile 发生升级时，使用方应主动确认升级，避免影响多个 Skill。

## 使用方式

直接打开 `profile-editor.html` 即可使用，无需构建或安装依赖。页面使用同目录下的 CSS 和 JavaScript，因此通过 `file://` 打开也能正常加载样式和交互。

使用 Node.js 18 或更高版本运行测试：

```bash
node --test __tests__/profile-editor.test.js
```
