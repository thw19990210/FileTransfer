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

test('websearch preset exposes every configurable profile section', () => {
  const profile = createWebSearchProfile();

  assert.equal(profile.name, 'websearch');
  assert.equal(profile.tools.mode, 'AllowList');
  assert.deepEqual(profile.tools.names, ['WebSearch']);
  assert.equal(profile.tools.schema.WebSearch.parameters.type, 'object');
  assert.equal(profile.limits.max_turns, 4);
  assert.equal(profile.thought.prefix_content, '<search_target>');
  assert.deepEqual(profile.prompt.context_files, ['USER.md', 'MEMORY.md']);
  assert.deepEqual(profile.skills.names, ['*']);
  assert.equal(profile.fork.prior_turns, 'ua');
  assert.equal(profile.hooks.PostToolUse[0].hook_id, 'websearch_accumulate_round');
  assert.equal(profile.hooks.PostResponse[0].on_match, 'end');
});

test('normalization fills omitted optional sections without sharing mutable defaults', () => {
  const first = normalizeProfile({ name: 'alpha' });
  const second = normalizeProfile({ name: 'beta' });

  first.tools.names.push('WebSearch');
  first.hooks.PostResponse.push({
    matcher: 'STOP',
    match_mode: 'exact',
    hook_id: 'websearch_join_accumulator',
    on_match: 'end',
  });

  assert.deepEqual(second.tools.names, []);
  assert.deepEqual(second.hooks.PostResponse, []);
  assert.equal(first.limits.extend_deadline_on_activity, true);
  assert.equal(second.prompt.mode, 'inherit');
});

test('validation reports structural and cross-field errors', () => {
  const profile = createWebSearchProfile();
  profile.name = '';
  profile.limits.remaining_search_turns = 5;
  profile.limits.max_turns = 4;
  profile.tools.schema.WebSearch.parameters = [];
  profile.hooks.PostResponse[0].hook_id = '';

  const result = validateProfile(profile);
  const messages = result.errors.map((item) => item.message).join('\n');

  assert.equal(result.valid, false);
  assert.match(messages, /Profile 名称/);
  assert.match(messages, /不能大于 max_turns/);
  assert.match(messages, /JSON Schema 对象/);
  assert.match(messages, /hook_id/);
});

test('TOML export includes schemas, limits, fork and repeated hook tables', () => {
  const toml = profileToToml(createWebSearchProfile());

  assert.match(toml, /^name = "websearch"/m);
  assert.match(toml, /\[tools\.schema\.WebSearch\]/);
  assert.match(toml, /\[tools\.schema\.WebSearch\.parameters\.properties\.queries\]/);
  assert.match(toml, /max_turns = 4/);
  assert.match(toml, /\[fork\]/);
  assert.match(toml, /\[\[hooks\.PostToolUse\]\]/);
  assert.match(toml, /hook_id = "websearch_accumulate_round"/);
  assert.match(toml, /\[\[hooks\.PostResponse\]\]/);
  assert.match(toml, /on_match = "end"/);
});

test('TOML export omits nullable optional scalar values', () => {
  const profile = normalizeProfile({
    name: 'minimal',
    description: '',
    model: null,
    system_prompt: null,
    initial_reminder: null,
  });

  const toml = profileToToml(profile);

  assert.doesNotMatch(toml, /^model\s*=/m);
  assert.doesNotMatch(toml, /^system_prompt\s*=/m);
  assert.doesNotMatch(toml, /^initial_reminder\s*=/m);
});
