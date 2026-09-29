const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createWebSearchProfile,
  normalizeProfile,
  profileToToml,
  validateProfile,
} = require('../profile-editor-core.js');

test('direct file entrypoint uses same-directory CSS and JavaScript assets', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../profile-editor.html'), 'utf8');

  assert.match(html, /href="\.\/profile-editor\.css"/);
  assert.match(html, /src="\.\/profile-editor-core\.js"/);
  assert.match(html, /src="\.\/profile-editor\.js"/);
  assert.match(html, /href="\.\/settings\.html"/);
  assert.doesNotMatch(html, /(?:href|src)="\/profile-editor/);
});

test('platform UI distinguishes system and skill profile scopes', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../profile-editor.html'), 'utf8');
  const script = fs.readFileSync(path.resolve(__dirname, '../profile-editor.js'), 'utf8');

  assert.match(html, /系统级 Profile/);
  assert.match(html, /Skill 级 Profile/);
  assert.match(html, /fieldOwnerSkill/);
  assert.match(html, /fieldConsumerSkills/);
  assert.match(html, /consumer_skills\[\]/);
  assert.match(html, /id="skillLifecycleCard"/);
  assert.match(html, /id="fieldMaxActiveTurns"/);
  assert.match(html, /id="fieldInvalidateOnOtherSkillLoad"/);
  assert.match(html, /lifecycle\.max_active_turns/);
  assert.match(html, /lifecycle\.invalidate_on_other_skill_load/);
  assert.match(html, /暂不包含 Workflow\/Step 编辑器/);
  assert.match(html, /控制单次 Subagent 运行的时间、对话轮数、输出规模和到限行为/);
  assert.match(html, /Prompt 定制/);
  assert.match(html, /白名单 <code>skills\.allow<\/code>/);
  assert.match(html, /黑名单 <code>skills\.deny<\/code>/);
  assert.match(html, /有效列表 = 父 Agent Skills − 黑名单 \+ 白名单/);
  assert.match(html, /id="section-io"/);
  assert.match(html, /id="fieldInputSchema"/);
  assert.match(html, /id="fieldOutputSchema"/);
  assert.ok(html.indexOf('id="section-io"') < html.indexOf('id="section-hooks"'));
  assert.match(html, /<select id="fieldPriorTurns"/);
  assert.doesNotMatch(html, /<input id="fieldPriorTurns"/);
  assert.match(html, /id="fieldMaxPriorTurns"/);
  assert.match(html, /id="fieldMaxHistoryChars"/);
  assert.doesNotMatch(html, /fieldIncludeCurrentTurn|include_current_turn|继承当前触发轮次/);
  assert.doesNotMatch(html, /fieldCurrentTurn|current_turn|fieldExcludeTrigger|exclude_triggering_tool|移除触发工具/);
  assert.match(script, /'SOUL\.md'/);
  assert.match(script, /'AGENTS\.md'/);
  assert.match(script, /'TOOLS\.md'/);
  assert.match(script, /'USER\.md'/);
  assert.match(script, /'MEMORY\.md'/);
  assert.doesNotMatch(html, /Thought 前缀/);
  assert.match(html, /Hooks 当前暂不开放/);
  assert.match(html, /开发并注册对应的 TaiChu 运行时代码/);
  assert.match(html, /Hooks 配置示意/);
  assert.match(html, /sample_pre_tool_hook/);
  assert.match(html, /sample_post_tool_hook/);
  assert.match(html, /sample_post_response_hook/);
  assert.doesNotMatch(html, /accumulator_key/);
  assert.doesNotMatch(html, /remaining_search_turns/);
  assert.doesNotMatch(html, /max_search_turns/);
  assert.doesNotMatch(html, /稳定引用|profile_ref|fieldProfileReference|copyReferenceButton/);
  assert.doesNotMatch(script, /profileReference|system:\/\/profiles|skill:\/\//);
  assert.match(script, /subagent_profile_id: \$\{profileId\}/);
  assert.match(script, /max_active_turns/);
  assert.match(script, /invalidate_on_other_skill_load/);
});

test('README records the phase-one product boundary and SKILL.md integration', () => {
  const readme = fs.readFileSync(path.resolve(__dirname, '../README.md'), 'utf8');

  assert.match(readme, /系统级和 Skill 级 Profile/);
  assert.match(readme, /Skill 具体在第几步调用 Profile，仍由 `SKILL\.md` 描述/);
  assert.match(readme, /不提供 Workflow\/Step 编辑器/);
  assert.match(readme, /run_subagent/);
  assert.match(readme, /subagent_profile_id: risk-reviewer/);
  assert.match(readme, /Skill Profile 生命周期/);
  assert.doesNotMatch(readme, /稳定引用|system:\/\/profiles|skill:\/\//);
});

test('websearch preset exposes every configurable profile section', () => {
  const profile = createWebSearchProfile();

  assert.equal(profile.name, 'websearch');
  assert.equal(profile.tools.mode, 'AllowList');
  assert.deepEqual(profile.tools.names, ['WebSearch']);
  assert.equal(profile.tools.schema.WebSearch.parameters.type, 'object');
  assert.equal(profile.limits.max_turns, 4);
  assert.equal(profile.thought, undefined);
  assert.equal(profile.prompt.system.mode, 'custom');
  assert.equal(profile.prompt.files['USER.md'].mode, 'inherit');
  assert.equal(profile.prompt.files['AGENTS.md'].mode, 'empty');
  assert.deepEqual(profile.skills.allow, []);
  assert.deepEqual(profile.skills.deny, ['*']);
  assert.deepEqual(profile.skills.preload, []);
  assert.equal(profile.fork.prior_turns, 'ua');
  assert.equal(profile.fork.current_turn, undefined);
  assert.equal(profile.fork.exclude_triggering_tool, undefined);
  assert.equal(profile.fork.max_prior_turns, null);
  assert.equal(profile.fork.max_history_chars, null);
  assert.equal(profile.fork.include_current_turn, undefined);
  assert.equal(profile.input_schema.type, 'object');
  assert.deepEqual(profile.input_schema.required, ['task']);
  assert.equal(profile.output_schema.type, 'object');
  assert.deepEqual(profile.output_schema.required, ['result']);
  assert.equal(profile.hooks, undefined);
});

test('normalization fills omitted optional sections without sharing mutable defaults', () => {
  const first = normalizeProfile({ name: 'alpha' });
  const second = normalizeProfile({ name: 'beta' });

  first.tools.names.push('WebSearch');
  first.prompt.files['AGENTS.md'].content = 'changed';

  assert.deepEqual(second.tools.names, []);
  assert.equal(second.prompt.files['AGENTS.md'].content, '');
  assert.equal(first.limits.extend_deadline_on_activity, undefined);
  assert.equal(second.prompt.system.mode, 'inherit');
  assert.equal(second.prompt.files['AGENTS.md'].mode, 'inherit');
});

test('prompt slots independently support inherit, empty and custom modes', () => {
  const profile = normalizeProfile({
    name: 'prompt-slots',
    thought: { enable: true, prefix_content: '<thought>' },
    prompt: {
      system: { mode: 'inherit', content: '' },
      files: {
        'AGENTS.md': { mode: 'custom', content: '# Rules\nOnly handle the delegated task.' },
        'MEMORY.md': { mode: 'empty', content: '' },
      },
    },
  });
  const toml = profileToToml(profile);

  assert.equal(profile.thought, undefined);
  assert.equal(profile.prompt.system.mode, 'inherit');
  assert.equal(profile.prompt.files['SOUL.md'].mode, 'inherit');
  assert.equal(profile.prompt.files['AGENTS.md'].mode, 'custom');
  assert.equal(profile.prompt.files['MEMORY.md'].mode, 'empty');
  assert.match(toml, /\[prompt\.system\]/);
  assert.match(toml, /\[prompt\.files\."AGENTS\.md"\]/);
  assert.doesNotMatch(toml, /\[thought\]/);
});

test('internal and search-specific controls are removed from profiles and exports', () => {
  const profile = normalizeProfile({
    name: 'legacy',
    limits: {
      allow_spawn_children: true,
      extend_deadline_on_activity: true,
      immediate_join_on_max_turns: true,
      remaining_search_turns: 3,
    },
    fork: {
      current_turn: 'uat',
      exclude_triggering_tool: true,
    },
  });
  const toml = profileToToml(profile);

  assert.equal(profile.limits.allow_spawn_children, undefined);
  assert.equal(profile.limits.extend_deadline_on_activity, undefined);
  assert.equal(profile.limits.immediate_join_on_max_turns, undefined);
  assert.equal(profile.limits.remaining_search_turns, undefined);
  assert.equal(profile.fork.current_turn, undefined);
  assert.equal(profile.fork.exclude_triggering_tool, undefined);
  assert.doesNotMatch(toml, /allow_spawn_children/);
  assert.doesNotMatch(toml, /extend_deadline_on_activity/);
  assert.doesNotMatch(toml, /immediate_join_on_max_turns/);
  assert.doesNotMatch(toml, /remaining_search_turns/);
  assert.doesNotMatch(toml, /current_turn/);
  assert.doesNotMatch(toml, /exclude_triggering_tool/);
});

test('validation reports structural and generic limit errors', () => {
  const profile = createWebSearchProfile();
  profile.name = '';
  profile.limits.max_turns = -1;
  profile.tools.schema.WebSearch.parameters = [];
  profile.prompt.files['AGENTS.md'] = { mode: 'custom', content: '' };

  const result = validateProfile(profile);
  const messages = result.errors.map((item) => item.message).join('\n');

  assert.equal(result.valid, false);
  assert.match(messages, /Profile 名称/);
  assert.match(messages, /max_turns 必须是非负整数/);
  assert.match(messages, /JSON Schema 对象/);
  assert.match(messages, /自定义时必须填写 Prompt 内容/);
});

test('input and output contracts must be valid object JSON Schemas', () => {
  const invalid = normalizeProfile({
    name: 'invalid-contracts',
    input_schema: '{',
    output_schema: {
      type: 'object',
      required: ['missing'],
      properties: {},
    },
  });
  const messages = validateProfile(invalid).errors.map((item) => item.message).join('\n');

  assert.match(messages, /输入 Schema 必须是有效的 JSON Schema 对象/);
  assert.match(messages, /输出 Schema 必填字段 missing 未在 properties 中定义/);
});

test('fork validates message modes and inheritance budgets', () => {
  const invalid = normalizeProfile({
    name: 'invalid-fork',
    fork: {
      include_parent_history: true,
      prior_turns: 'all',
      max_prior_turns: -1,
      max_history_chars: 1.5,
    },
  });
  const messages = validateProfile(invalid).errors.map((item) => item.message).join('\n');

  assert.match(messages, /历史轮次消息策略必须为 ua 或 uat/);
  assert.match(messages, /max_prior_turns 必须是非负整数或留空/);
  assert.match(messages, /max_history_chars 必须是非负整数或留空/);
});

test('skill preload must be explicit and allowed by the skill policy', () => {
  const wildcard = normalizeProfile({
    name: 'wildcard-preload',
    skills: { allow: ['*'], deny: [], preload: [] },
  });
  const missingAllow = normalizeProfile({
    name: 'missing-allow',
    skills: {
      allow: ['document-reader'],
      deny: ['legacy-skill'],
      preload: ['contract-review'],
    },
  });

  assert.match(validateProfile(wildcard).errors[0].message, /白名单.*不能使用通配符/);
  assert.match(validateProfile(missingAllow).errors[0].message, /必须同时加入白名单/);
});

test('legacy skill filter modes migrate to simultaneous allow and deny lists', () => {
  const allowOnly = normalizeProfile({
    name: 'legacy-allow',
    skills: { mode: 'AllowList', names: ['document-reader'], preload: [] },
  });
  const denyOnly = normalizeProfile({
    name: 'legacy-deny',
    skills: { mode: 'DenyList', names: ['legacy-skill'], preload: [] },
  });

  assert.deepEqual(allowOnly.skills.allow, ['document-reader']);
  assert.deepEqual(allowOnly.skills.deny, ['*']);
  assert.deepEqual(denyOnly.skills.allow, []);
  assert.deepEqual(denyOnly.skills.deny, ['legacy-skill']);
});

test('TOML export includes schemas, limits and fork but omits unavailable hooks', () => {
  const profile = createWebSearchProfile();
  profile.fork.max_prior_turns = 6;
  profile.fork.max_history_chars = 12000;
  const toml = profileToToml(profile);

  assert.match(toml, /^name = "websearch"/m);
  assert.match(toml, /\[tools\.schema\.WebSearch\]/);
  assert.match(toml, /\[tools\.schema\.WebSearch\.parameters\.properties\.queries\]/);
  assert.match(toml, /max_turns = 4/);
  assert.match(toml, /\[skills\]/);
  assert.match(toml, /^allow = \[\]$/m);
  assert.match(toml, /^deny = \["\*"\]$/m);
  assert.match(toml, /^preload = \[\]$/m);
  assert.match(toml, /\[fork\]/);
  assert.match(toml, /^include_parent_history = true$/m);
  assert.doesNotMatch(toml, /include_current_turn/);
  assert.match(toml, /^max_prior_turns = 6$/m);
  assert.match(toml, /^max_history_chars = 12000$/m);
  assert.match(toml, /^prior_turns = "ua"$/m);
  assert.doesNotMatch(toml, /^current_turn\s*=/m);
  assert.doesNotMatch(toml, /^exclude_triggering_tool\s*=/m);
  assert.match(toml, /\[input_schema\]/);
  assert.match(toml, /\[input_schema\.properties\.task\]/);
  assert.match(toml, /\[output_schema\]/);
  assert.match(toml, /\[output_schema\.properties\.result\]/);
  assert.doesNotMatch(toml, /\[hooks\]/);
});

test('TOML export omits nullable optional scalars and removed reminder', () => {
  const profile = normalizeProfile({
    name: 'minimal',
    description: '',
    model: null,
    system_prompt: null,
    initial_reminder: 'legacy runtime reminder',
  });

  const toml = profileToToml(profile);

  assert.doesNotMatch(toml, /^model\s*=/m);
  assert.doesNotMatch(toml, /^system_prompt\s*=/m);
  assert.doesNotMatch(toml, /^initial_reminder\s*=/m);
});
