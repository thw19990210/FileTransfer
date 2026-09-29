(function profileEditorCoreFactory(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ProfileEditorCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProfileEditorCore() {
  'use strict';

  const TOOL_MODES = ['All', 'AllowList', 'DenyList'];
  const PROMPT_SLOT_MODES = ['inherit', 'empty', 'custom'];
  const PROMPT_FILES = ['SOUL.md', 'AGENTS.md', 'TOOLS.md', 'USER.md', 'MEMORY.md'];
  const MAX_TURN_MODES = ['abort', 'fuse_stop'];
  const FORK_MESSAGE_MODES = ['ua', 'uat'];

  function createDefaultInputSchema() {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      description: '父 Agent 启动 Subagent 时传入的结构化参数。',
      required: ['task'],
      additionalProperties: false,
      properties: {
        task: {
          type: 'string',
          description: '需要 Subagent 完成的具体任务。',
        },
        context: {
          type: 'object',
          description: '执行任务所需的可选结构化上下文。',
          additionalProperties: true,
        },
      },
    };
  }

  function createDefaultOutputSchema() {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      description: 'Subagent 完成任务后返回给父 Agent 的结构化结果。',
      required: ['result'],
      additionalProperties: false,
      properties: {
        result: {
          type: 'string',
          description: '可直接供父 Agent 使用的任务结果。',
        },
        artifacts: {
          type: 'array',
          description: 'Subagent 生成或修改的文件路径。',
          items: { type: 'string' },
        },
      },
    };
  }

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
      tools: {
        mode: 'All',
        names: [],
        strict: false,
      },
      limits: {
        timeout_secs: 1800,
        max_turns: null,
        max_output_chars: null,
        on_max_turns: 'abort',
        on_max_turns_message: null,
      },
      prompt: {
        system: { mode: 'inherit', content: '' },
        files: Object.fromEntries(PROMPT_FILES.map((fileName) => [
          fileName,
          { mode: 'inherit', content: '' },
        ])),
      },
      skills: {
        allow: [],
        deny: [],
        preload: [],
      },
      fork: {
        include_parent_history: false,
        max_prior_turns: null,
        max_history_chars: null,
        prior_turns: 'ua',
        out_of_scope_tool_instruction: '',
      },
      input_schema: createDefaultInputSchema(),
      output_schema: createDefaultOutputSchema(),
    };
  }

  function createWebSearchProfile() {
    return normalizeProfile({
      name: 'websearch',
      description: '联网检索事实、新闻、政策和任何需要网页来源的问题。主 Agent 规划第一轮查询，子 Agent 负责继续检索并汇总证据。',
      model: 'deepseek-ai/DeepSeek-V4-Flash-0731',
      tools: {
        mode: 'AllowList',
        names: ['WebSearch'],
        strict: true,
      },
      limits: {
        timeout_secs: 900,
        max_turns: 4,
        max_output_chars: null,
        on_max_turns: 'fuse_stop',
        on_max_turns_message: '已达检索轮次上限，不再执行本次 WebSearch。',
      },
      prompt: {
        system: {
          mode: 'custom',
          content: [
            '## 任务',
            '',
            '你是检索规划与证据收集代理，只决定继续搜索或停止，不直接回答用户。',
            '在允许的搜索轮数内补齐关键证据；信息够用即停。',
            '',
            '继续搜索时输出 <search_target>...</search_target> 并调用一次 WebSearch；',
            '停止时只输出 <search_target>STOP</search_target>。',
          ].join('\n'),
        },
        files: {
          'SOUL.md': { mode: 'empty', content: '' },
          'AGENTS.md': { mode: 'empty', content: '' },
          'TOOLS.md': { mode: 'empty', content: '' },
          'USER.md': { mode: 'inherit', content: '' },
          'MEMORY.md': { mode: 'inherit', content: '' },
        },
      },
      skills: {
        allow: [],
        deny: ['*'],
        preload: [],
      },
      fork: {
        include_parent_history: true,
        prior_turns: 'ua',
        out_of_scope_tool_instruction: '[外部主 Agent 工具结果]：以下结果仅作为已知上下文；该工具不属于当前子 Agent 的可用工具，禁止调用。',
      },
    });
  }

  function normalizePromptSlot(slot) {
    const mode = PROMPT_SLOT_MODES.includes(slot?.mode) ? slot.mode : 'inherit';
    return {
      mode,
      content: slot?.content == null ? '' : String(slot.content),
    };
  }

  function normalizeProfile(input) {
    const source = isPlainObject(input) ? deepClone(input) : {};
    const legacySystemPrompt = source.system_prompt;
    const legacyPromptMode = source.prompt?.mode;
    const legacyContextFiles = Array.isArray(source.prompt?.context_files)
      ? source.prompt.context_files.map(String)
      : null;
    const hasModernSystem = isPlainObject(source.prompt?.system);
    const hasModernFiles = isPlainObject(source.prompt?.files);
    const hasModernSkills = Array.isArray(source.skills?.allow) || Array.isArray(source.skills?.deny);
    const legacySkillsMode = source.skills?.mode;
    const legacySkillNames = Array.isArray(source.skills?.names) ? source.skills.names.map(String) : [];
    const profile = deepMerge(createEmptyProfile(), source);
    delete profile.limits.allow_spawn_children;
    delete profile.limits.extend_deadline_on_activity;
    delete profile.limits.immediate_join_on_max_turns;
    delete profile.limits.remaining_search_turns;
    delete profile.fork.include_current_turn;
    delete profile.fork.current_turn;
    delete profile.fork.exclude_triggering_tool;
    delete profile.system_prompt;
    delete profile.initial_reminder;
    delete profile.thought;
    delete profile.hooks;
    delete profile.prompt.mode;
    delete profile.prompt.context_files;
    delete profile.skills.mode;
    delete profile.skills.names;
    delete profile.tools.schema;
    if (!hasModernSystem && legacySystemPrompt != null && String(legacySystemPrompt).trim()) {
      profile.prompt.system = {
        mode: legacyPromptMode === 'inherit' ? 'inherit' : 'custom',
        content: String(legacySystemPrompt),
      };
    }
    if (!hasModernFiles && legacyContextFiles) {
      PROMPT_FILES.forEach((fileName) => {
        profile.prompt.files[fileName] = {
          mode: legacyContextFiles.includes(fileName) ? 'inherit' : 'empty',
          content: '',
        };
      });
    }
    if (!hasModernSkills) {
      if (legacySkillsMode === 'AllowList' && !legacySkillNames.includes('*')) {
        profile.skills.allow = legacySkillNames;
        profile.skills.deny = ['*'];
      } else if (legacySkillsMode === 'DenyList') {
        profile.skills.allow = [];
        profile.skills.deny = legacySkillNames;
      } else {
        profile.skills.allow = [];
        profile.skills.deny = [];
      }
    }
    profile.name = String(profile.name ?? '');
    profile.description = String(profile.description ?? '');
    ['model'].forEach((field) => {
      profile[field] = profile[field] == null || String(profile[field]).trim() === ''
        ? null
        : String(profile[field]);
    });
    profile.tools.names = Array.isArray(profile.tools.names) ? profile.tools.names.map(String) : [];
    profile.prompt.system = normalizePromptSlot(profile.prompt.system);
    profile.prompt.files = Object.fromEntries(PROMPT_FILES.map((fileName) => [
      fileName,
      normalizePromptSlot(profile.prompt.files?.[fileName]),
    ]));
    profile.skills.allow = Array.isArray(profile.skills.allow)
      ? [...new Set(profile.skills.allow.map(String).map((item) => item.trim()).filter(Boolean))]
      : [];
    profile.skills.deny = Array.isArray(profile.skills.deny)
      ? [...new Set(profile.skills.deny.map(String).map((item) => item.trim()).filter(Boolean))]
      : [];
    profile.skills.preload = Array.isArray(profile.skills.preload)
      ? [...new Set(profile.skills.preload.map(String).map((item) => item.trim()).filter(Boolean))]
      : [];
    return profile;
  }

  function validateContractSchema(schema, path, label, error) {
    if (!isPlainObject(schema)) {
      error(path, `${label} 必须是有效的 JSON Schema 对象。`);
      return;
    }
    if (schema.type !== 'object') {
      error(`${path}.type`, `${label} 根节点的 type 必须为 object。`);
    }
    if (!isPlainObject(schema.properties)) {
      error(`${path}.properties`, `${label} 必须定义 properties 对象。`);
    }
    if (schema.required !== undefined) {
      const validRequired = Array.isArray(schema.required)
        && schema.required.every((field) => typeof field === 'string' && field.trim());
      if (!validRequired) {
        error(`${path}.required`, `${label} 的 required 必须是字段名数组。`);
      } else if (isPlainObject(schema.properties)) {
        schema.required.forEach((field) => {
          if (!Object.prototype.hasOwnProperty.call(schema.properties, field)) {
            error(`${path}.required`, `${label} 必填字段 ${field} 未在 properties 中定义。`);
          }
        });
      }
    }
  }

  function validateProfile(input) {
    const profile = normalizeProfile(input);
    const errors = [];
    const warnings = [];
    const error = (path, message) => errors.push({ path, message });
    const warning = (path, message) => warnings.push({ path, message });

    if (!profile.name.trim()) error('name', 'Profile 名称不能为空。');
    if (!TOOL_MODES.includes(profile.tools.mode)) error('tools.mode', '工具模式不受支持。');
    if (!MAX_TURN_MODES.includes(profile.limits.on_max_turns)) error('limits.on_max_turns', '最大轮次策略不受支持。');
    if (!FORK_MESSAGE_MODES.includes(profile.fork.prior_turns)) {
      error('fork.prior_turns', '历史轮次消息策略必须为 ua 或 uat。');
    }
    ['timeout_secs', 'max_turns', 'max_output_chars'].forEach((field) => {
      const value = profile.limits[field];
      if (value !== null && (!Number.isInteger(value) || value < 0)) {
        error(`limits.${field}`, `${field} 必须是非负整数或留空。`);
      }
    });
    ['max_prior_turns', 'max_history_chars'].forEach((field) => {
      const value = profile.fork[field];
      if (value !== null && (!Number.isInteger(value) || value < 0)) {
        error(`fork.${field}`, `${field} 必须是非负整数或留空。`);
      }
    });
    const promptSlots = [['system', profile.prompt.system]];
    PROMPT_FILES.forEach((fileName) => promptSlots.push([`files.${fileName}`, profile.prompt.files[fileName]]));
    promptSlots.forEach(([path, slot]) => {
      if (!PROMPT_SLOT_MODES.includes(slot.mode)) {
        error(`prompt.${path}.mode`, 'Prompt 槽位模式不受支持。');
      }
      if (slot.mode === 'custom' && !slot.content.trim()) {
        error(`prompt.${path}.content`, '选择自定义时必须填写 Prompt 内容。');
      }
    });
    if (profile.tools.mode === 'AllowList' && profile.tools.names.length === 0) {
      warning('tools.names', '空工具白名单会让子 Agent 无工具可用。');
    }
    profile.skills.allow.forEach((skillName, index) => {
      if (skillName === '*') {
        error(`skills.allow.${index}`, 'Skill 白名单必须使用明确名称，不能使用通配符。');
      }
    });
    profile.skills.preload.forEach((skillName, index) => {
      const path = `skills.preload.${index}`;
      if (skillName === '*') {
        error(path, '预加载必须使用明确的 Skill 名称，不能使用通配符。');
      }
      if (!profile.skills.allow.includes(skillName)) {
        error(path, `预加载 Skill ${skillName} 必须同时加入白名单。`);
      }
    });
    validateContractSchema(profile.input_schema, 'input_schema', '输入 Schema', error);
    validateContractSchema(profile.output_schema, 'output_schema', '输出 Schema', error);

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

    pushTable(lines, ['tools'], {
      mode: profile.tools.mode,
      names: profile.tools.names,
      strict: profile.tools.strict,
    });
    pushTable(lines, ['limits'], profile.limits);
    pushTable(lines, ['prompt'], profile.prompt);
    pushTable(lines, ['skills'], profile.skills);
    pushTable(lines, ['fork'], profile.fork);
    if (isPlainObject(profile.input_schema)) pushTable(lines, ['input_schema'], profile.input_schema);
    if (isPlainObject(profile.output_schema)) pushTable(lines, ['output_schema'], profile.output_schema);

    return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
  }

  return {
    MAX_TURN_MODES,
    FORK_MESSAGE_MODES,
    PROMPT_FILES,
    PROMPT_SLOT_MODES,
    TOOL_MODES,
    createDefaultInputSchema,
    createDefaultOutputSchema,
    createEmptyProfile,
    createWebSearchProfile,
    normalizeProfile,
    profileToToml,
    validateProfile,
  };
});
