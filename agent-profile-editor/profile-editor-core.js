(function profileEditorCoreFactory(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProfileEditorCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProfileEditorCore() {
  'use strict';

  const TOOL_MODES = ['All', 'AllowList', 'DenyList'];
  const PROMPT_MODES = ['inherit', 'replace', 'compose'];
  const MAX_TURN_MODES = ['abort', 'fuse_stop'];
  const HOOK_PHASES = ['PreToolUse', 'PostToolUse', 'PostResponse'];
  const REGISTERED_HOOKS = [
    'websearch_accumulate_round',
    'websearch_join_accumulator',
  ];

  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function deepMerge(base, incoming) {
    if (!isPlainObject(incoming)) return incoming === undefined ? deepClone(base) : deepClone(incoming);
    const result = isPlainObject(base) ? deepClone(base) : {};
    Object.entries(incoming).forEach(([key, value]) => {
      if (value === undefined) return;
      result[key] = isPlainObject(value) && isPlainObject(result[key])
        ? deepMerge(result[key], value)
        : deepClone(value);
    });
    return result;
  }

  function createEmptyProfile() {
    return {
      name: '',
      description: '',
      model: null,
      system_prompt: null,
      initial_reminder: null,
      tools: {
        mode: 'All',
        names: [],
        strict: false,
        schema: {},
      },
      limits: {
        timeout_secs: 1800,
        max_turns: null,
        max_output_chars: null,
        allow_spawn_children: false,
        on_max_turns: 'abort',
        on_max_turns_message: null,
        extend_deadline_on_activity: true,
        immediate_join_on_max_turns: false,
        remaining_search_turns: null,
      },
      thought: {
        enable: false,
        prefix_content: '<thought>',
      },
      prompt: {
        mode: 'inherit',
        context_files: [],
      },
      skills: {
        mode: 'All',
        names: [],
      },
      fork: {
        include_parent_history: false,
        prior_turns: 'ua',
        current_turn: 'uat',
        exclude_triggering_tool: false,
        out_of_scope_tool_instruction: '',
      },
      hooks: {
        accumulator_key: null,
        PreToolUse: [],
        PostToolUse: [],
        PostResponse: [],
      },
    };
  }

  function createWebSearchProfile() {
    return normalizeProfile({
      name: 'websearch',
      description: '联网检索事实、新闻、政策和任何需要网页来源的问题。主 Agent 规划第一轮查询，子 Agent 负责继续检索并汇总证据。',
      model: 'deepseek-ai/DeepSeek-V4-Flash-0731',
      system_prompt: [
        '## 任务',
        '',
        '你是检索规划与证据收集代理，只决定继续搜索或停止，不直接回答用户。',
        '你还剩下 {remaining_search_turns} 轮搜索次数预算；够用即停。',
        '',
        '继续搜索时输出 <search_target>...</search_target> 并调用一次 WebSearch；',
        '停止时只输出 <search_target>STOP</search_target>。',
      ].join('\n'),
      initial_reminder: [
        '[运行时上下文]',
        '当前时间：{datetime}',
        '设备信息：{device_info}',
        '时区：{timezone}',
      ].join('\n'),
      tools: {
        mode: 'AllowList',
        names: ['WebSearch'],
        strict: true,
        schema: {
          WebSearch: {
            description: '使用网上权威来源核实事实、补全时效或精度缺口。单次构造 1～3 条互不重复的查询。',
            parameters: {
              type: 'object',
              required: ['queries'],
              properties: {
                queries: {
                  type: 'array',
                  description: '并行执行的搜索词列表，默认 1～3 条。',
                  items: { type: 'string', description: '实体密集的关键词组合。' },
                },
              },
            },
          },
        },
      },
      limits: {
        timeout_secs: 900,
        max_turns: 4,
        max_output_chars: null,
        allow_spawn_children: false,
        on_max_turns: 'fuse_stop',
        on_max_turns_message: '已达检索轮次上限，不再执行本次 WebSearch。',
        extend_deadline_on_activity: false,
        immediate_join_on_max_turns: true,
        remaining_search_turns: 3,
      },
      thought: { enable: true, prefix_content: '<search_target>' },
      prompt: { mode: 'compose', context_files: ['USER.md', 'MEMORY.md'] },
      skills: { mode: 'DenyList', names: ['*'] },
      fork: {
        include_parent_history: true,
        prior_turns: 'ua',
        current_turn: 'uat',
        exclude_triggering_tool: false,
        out_of_scope_tool_instruction: '[外部主 Agent 工具结果]：以下结果仅作为已知上下文；该工具不属于当前子 Agent 的可用工具，禁止调用。',
      },
      hooks: {
        accumulator_key: 'websearch_rounds',
        PreToolUse: [],
        PostToolUse: [{
          matcher: 'WebSearch',
          match_mode: 'exact',
          hook_id: 'websearch_accumulate_round',
          on_match: 'continue',
        }],
        PostResponse: [{
          matcher: 'STOP',
          match_mode: 'exact',
          hook_id: 'websearch_join_accumulator',
          on_match: 'end',
        }],
      },
    });
  }

  function normalizeHook(entry) {
    return {
      matcher: String(entry?.matcher ?? ''),
      match_mode: entry?.match_mode === 'contains' ? 'contains' : 'exact',
      hook_id: String(entry?.hook_id ?? ''),
      on_match: entry?.on_match === 'end' ? 'end' : 'continue',
    };
  }

  function normalizeProfile(input) {
    const profile = deepMerge(createEmptyProfile(), isPlainObject(input) ? input : {});
    profile.name = String(profile.name ?? '');
    profile.description = String(profile.description ?? '');
    ['model', 'system_prompt', 'initial_reminder'].forEach((field) => {
      profile[field] = profile[field] == null || String(profile[field]).trim() === ''
        ? null
        : String(profile[field]);
    });
    profile.tools.names = Array.isArray(profile.tools.names) ? profile.tools.names.map(String) : [];
    profile.tools.schema = isPlainObject(profile.tools.schema) ? profile.tools.schema : {};
    profile.prompt.context_files = Array.isArray(profile.prompt.context_files)
      ? profile.prompt.context_files.map(String)
      : [];
    profile.skills.names = Array.isArray(profile.skills.names) ? profile.skills.names.map(String) : [];
    HOOK_PHASES.forEach((phase) => {
      profile.hooks[phase] = Array.isArray(profile.hooks[phase])
        ? profile.hooks[phase].map(normalizeHook)
        : [];
    });
    return profile;
  }

  function validateProfile(input) {
    const profile = normalizeProfile(input);
    const errors = [];
    const warnings = [];
    const error = (path, message) => errors.push({ path, message });
    const warning = (path, message) => warnings.push({ path, message });

    if (!profile.name.trim()) error('name', 'Profile 名称不能为空。');
    if (!TOOL_MODES.includes(profile.tools.mode)) error('tools.mode', '工具模式不受支持。');
    if (!TOOL_MODES.includes(profile.skills.mode)) error('skills.mode', '技能模式不受支持。');
    if (!PROMPT_MODES.includes(profile.prompt.mode)) error('prompt.mode', 'Prompt 组合模式不受支持。');
    if (!MAX_TURN_MODES.includes(profile.limits.on_max_turns)) error('limits.on_max_turns', '最大轮次策略不受支持。');

    ['timeout_secs', 'max_turns', 'max_output_chars', 'remaining_search_turns'].forEach((field) => {
      const value = profile.limits[field];
      if (value !== null && (!Number.isInteger(value) || value < 0)) {
        error(`limits.${field}`, `${field} 必须是非负整数或留空。`);
      }
    });
    if (
      profile.limits.max_turns !== null
      && profile.limits.remaining_search_turns !== null
      && profile.limits.remaining_search_turns > profile.limits.max_turns
    ) {
      error('limits.remaining_search_turns', 'remaining_search_turns 不能大于 max_turns。');
    }

    Object.entries(profile.tools.schema).forEach(([toolName, schema]) => {
      if (!toolName.trim()) error('tools.schema', '工具 Schema 名称不能为空。');
      if (!String(schema?.description ?? '').trim()) {
        error(`tools.schema.${toolName}.description`, '工具 Schema 覆盖必须提供 description。');
      }
      if (!isPlainObject(schema?.parameters)) {
        error(`tools.schema.${toolName}.parameters`, 'parameters 必须是 JSON Schema 对象。');
      }
    });

    if (profile.thought.enable && !profile.thought.prefix_content.trim()) {
      error('thought.prefix_content', '启用 Thought 前缀时 prefix_content 不能为空。');
    }
    if (profile.prompt.mode === 'compose' && !profile.system_prompt) {
      warning('system_prompt', 'Compose 模式没有配置子 Agent System Prompt。');
    }
    if (profile.tools.mode === 'AllowList' && profile.tools.names.length === 0) {
      warning('tools.names', '空工具白名单会让子 Agent 无工具可用。');
    }
    if (profile.skills.mode === 'AllowList' && profile.skills.names.length === 0) {
      warning('skills.names', '空技能白名单会让子 Agent 无技能可用。');
    }

    HOOK_PHASES.forEach((phase) => {
      profile.hooks[phase].forEach((entry, index) => {
        const base = `hooks.${phase}.${index}`;
        if (!entry.hook_id.trim()) error(`${base}.hook_id`, '每条 Hook 都必须配置 hook_id。');
        if (!entry.matcher.trim()) warning(`${base}.matcher`, '空 matcher 不会匹配任何内容。');
        if (!REGISTERED_HOOKS.includes(entry.hook_id) && entry.hook_id.trim()) {
          warning(`${base}.hook_id`, `当前前端未登记 Hook：${entry.hook_id}，运行时可能忽略。`);
        }
      });
    });

    return { valid: errors.length === 0, errors, warnings, profile };
  }

  function tomlKey(value) {
    return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
  }

  function tomlString(value) {
    const text = String(value);
    if (!text.includes('\n')) return JSON.stringify(text);
    return `"""\n${text.replace(/\\/g, '\\\\').replace(/"""/g, '\\"""')}\n"""`;
  }

  function tomlValue(value) {
    if (typeof value === 'string') return tomlString(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
    if (isPlainObject(value) && Object.keys(value).length === 0) return '{}';
    return tomlString(JSON.stringify(value));
  }

  function pushTable(lines, path, object) {
    const scalars = [];
    const nested = [];
    Object.entries(object).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      if (isPlainObject(value) && Object.keys(value).length > 0) nested.push([key, value]);
      else scalars.push([key, value]);
    });
    lines.push('', `[${path.map(tomlKey).join('.')}]`);
    scalars.forEach(([key, value]) => lines.push(`${tomlKey(key)} = ${tomlValue(value)}`));
    nested.forEach(([key, value]) => pushTable(lines, [...path, key], value));
  }

  function profileToToml(input) {
    const profile = normalizeProfile(input);
    const lines = [`name = ${tomlString(profile.name)}`];
    if (profile.description) lines.push(`description = ${tomlString(profile.description)}`);
    if (profile.model) lines.push(`model = ${tomlString(profile.model)}`);
    if (profile.system_prompt) lines.push(`system_prompt = ${tomlString(profile.system_prompt)}`);
    if (profile.initial_reminder) lines.push(`initial_reminder = ${tomlString(profile.initial_reminder)}`);

    pushTable(lines, ['tools'], {
      mode: profile.tools.mode,
      names: profile.tools.names,
      strict: profile.tools.strict,
    });
    Object.entries(profile.tools.schema).forEach(([toolName, schema]) => {
      pushTable(lines, ['tools', 'schema', toolName], {
        description: schema.description || '',
        parameters: isPlainObject(schema.parameters) ? schema.parameters : {},
      });
    });
    pushTable(lines, ['limits'], profile.limits);
    pushTable(lines, ['thought'], profile.thought);
    pushTable(lines, ['prompt'], profile.prompt);
    pushTable(lines, ['skills'], profile.skills);
    pushTable(lines, ['fork'], profile.fork);

    lines.push('', '[hooks]');
    if (profile.hooks.accumulator_key) {
      lines.push(`accumulator_key = ${tomlString(profile.hooks.accumulator_key)}`);
    }
    HOOK_PHASES.forEach((phase) => {
      profile.hooks[phase].forEach((entry) => {
        lines.push('', `[[hooks.${phase}]]`);
        lines.push(`matcher = ${tomlString(entry.matcher)}`);
        lines.push(`match_mode = ${tomlString(entry.match_mode)}`);
        lines.push(`hook_id = ${tomlString(entry.hook_id)}`);
        lines.push(`on_match = ${tomlString(entry.on_match)}`);
      });
    });
    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
  }

  return {
    HOOK_PHASES,
    MAX_TURN_MODES,
    PROMPT_MODES,
    REGISTERED_HOOKS,
    TOOL_MODES,
    createEmptyProfile,
    createWebSearchProfile,
    normalizeProfile,
    profileToToml,
    validateProfile,
  };
});
