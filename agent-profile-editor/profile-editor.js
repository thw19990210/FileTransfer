(function initializeProfileEditor() {
  'use strict';

  const core = window.ProfileEditorCore;
  if (!core) throw new Error('ProfileEditorCore is required');

  const STORAGE_KEY = 'taichu_profile_editor_draft_v1';
  const $ = (id) => document.getElementById(id);
  const form = $('profileForm');
  const schemaList = $('schemaList');
  const hookGroups = $('hookGroups');
  let profile = loadDraft();
  let previewFormat = 'toml';
  let saveTimer = null;
  let toastTimer = null;

  function loadDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return core.normalizeProfile(JSON.parse(raw));
    } catch (error) {
      console.warn('profile editor draft ignored', error);
    }
    return core.createWebSearchProfile();
  }

  function splitList(value) {
    return [...new Set(String(value || '')
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean))];
  }

  function nullableText(value) {
    const text = String(value ?? '').trim();
    return text ? String(value) : null;
  }

  function nullableInteger(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const number = Number(text);
    return Number.isInteger(number) ? number : number;
  }

  function setValue(id, value) {
    const element = $(id);
    if (element) element.value = value == null ? '' : String(value);
  }

  function setChecked(id, value) {
    const element = $(id);
    if (element) element.checked = Boolean(value);
  }

  function writeStaticForm() {
    setValue('fieldName', profile.name);
    setValue('fieldModel', profile.model);
    setValue('fieldDescription', profile.description);
    setValue('fieldToolsMode', profile.tools.mode);
    setValue('fieldToolNames', profile.tools.names.join(', '));
    setChecked('fieldToolsStrict', profile.tools.strict);
    setValue('fieldTimeout', profile.limits.timeout_secs);
    setValue('fieldMaxTurns', profile.limits.max_turns);
    setValue('fieldMaxOutput', profile.limits.max_output_chars);
    setValue('fieldRemainingTurns', profile.limits.remaining_search_turns);
    setValue('fieldOnMaxTurns', profile.limits.on_max_turns);
    setValue('fieldOnMaxMessage', profile.limits.on_max_turns_message);
    setChecked('fieldAllowSpawn', profile.limits.allow_spawn_children);
    setChecked('fieldExtendDeadline', profile.limits.extend_deadline_on_activity);
    setChecked('fieldImmediateJoin', profile.limits.immediate_join_on_max_turns);
    setValue('fieldPromptMode', profile.prompt.mode);
    setValue('fieldContextFiles', profile.prompt.context_files.join(', '));
    setValue('fieldSystemPrompt', profile.system_prompt);
    setValue('fieldInitialReminder', profile.initial_reminder);
    setChecked('fieldThoughtEnable', profile.thought.enable);
    setValue('fieldThoughtPrefix', profile.thought.prefix_content);
    setValue('fieldSkillsMode', profile.skills.mode);
    setValue('fieldSkillNames', profile.skills.names.join(', '));
    setChecked('fieldIncludeHistory', profile.fork.include_parent_history);
    setValue('fieldPriorTurns', profile.fork.prior_turns);
    setValue('fieldCurrentTurn', profile.fork.current_turn);
    setChecked('fieldExcludeTrigger', profile.fork.exclude_triggering_tool);
    setValue('fieldOutOfScope', profile.fork.out_of_scope_tool_instruction);
    setValue('fieldAccumulatorKey', profile.hooks.accumulator_key);
  }

  function readStaticForm() {
    profile.name = $('fieldName').value;
    profile.model = nullableText($('fieldModel').value);
    profile.description = $('fieldDescription').value;
    profile.tools.mode = $('fieldToolsMode').value;
    profile.tools.names = splitList($('fieldToolNames').value);
    profile.tools.strict = $('fieldToolsStrict').checked;
    profile.limits.timeout_secs = nullableInteger($('fieldTimeout').value);
    profile.limits.max_turns = nullableInteger($('fieldMaxTurns').value);
    profile.limits.max_output_chars = nullableInteger($('fieldMaxOutput').value);
    profile.limits.remaining_search_turns = nullableInteger($('fieldRemainingTurns').value);
    profile.limits.on_max_turns = $('fieldOnMaxTurns').value;
    profile.limits.on_max_turns_message = nullableText($('fieldOnMaxMessage').value);
    profile.limits.allow_spawn_children = $('fieldAllowSpawn').checked;
    profile.limits.extend_deadline_on_activity = $('fieldExtendDeadline').checked;
    profile.limits.immediate_join_on_max_turns = $('fieldImmediateJoin').checked;
    profile.prompt.mode = $('fieldPromptMode').value;
    profile.prompt.context_files = splitList($('fieldContextFiles').value);
    profile.system_prompt = nullableText($('fieldSystemPrompt').value);
    profile.initial_reminder = nullableText($('fieldInitialReminder').value);
    profile.thought.enable = $('fieldThoughtEnable').checked;
    profile.thought.prefix_content = $('fieldThoughtPrefix').value;
    profile.skills.mode = $('fieldSkillsMode').value;
    profile.skills.names = splitList($('fieldSkillNames').value);
    profile.fork.include_parent_history = $('fieldIncludeHistory').checked;
    profile.fork.prior_turns = $('fieldPriorTurns').value;
    profile.fork.current_turn = $('fieldCurrentTurn').value;
    profile.fork.exclude_triggering_tool = $('fieldExcludeTrigger').checked;
    profile.fork.out_of_scope_tool_instruction = $('fieldOutOfScope').value;
    profile.hooks.accumulator_key = nullableText($('fieldAccumulatorKey').value);
  }

  function renderSchemas() {
    schemaList.replaceChildren();
    const entries = Object.entries(profile.tools.schema);
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'pe-empty-state';
      empty.textContent = '暂无 Schema 覆盖。工具将沿用父级定义。';
      schemaList.appendChild(empty);
      return;
    }
    const template = $('schemaTemplate');
    entries.forEach(([toolName, schema]) => {
      const fragment = template.content.cloneNode(true);
      const card = fragment.querySelector('[data-schema-card]');
      card.dataset.originalName = toolName;
      fragment.querySelector('[data-schema-title]').textContent = toolName || '未命名工具';
      fragment.querySelector('[data-schema-name]').value = toolName;
      fragment.querySelector('[data-schema-description]').value = schema?.description || '';
      fragment.querySelector('[data-schema-parameters]').value = JSON.stringify(
        schema?.parameters ?? {},
        null,
        2,
      );
      schemaList.appendChild(fragment);
    });
  }

  function syncSchemasFromDom() {
    const schemas = {};
    schemaList.querySelectorAll('[data-schema-card]').forEach((card, index) => {
      const nameInput = card.querySelector('[data-schema-name]');
      const descriptionInput = card.querySelector('[data-schema-description]');
      const parametersInput = card.querySelector('[data-schema-parameters]');
      const name = nameInput.value.trim() || `unnamed_tool_${index + 1}`;
      let parameters;
      try {
        parameters = JSON.parse(parametersInput.value || '{}');
        parametersInput.classList.toggle('invalid', !parameters || Array.isArray(parameters) || typeof parameters !== 'object');
      } catch (_) {
        parameters = parametersInput.value;
        parametersInput.classList.add('invalid');
      }
      schemas[name] = { description: descriptionInput.value, parameters };
      card.querySelector('[data-schema-title]').textContent = name;
    });
    profile.tools.schema = schemas;
  }

  const phaseDescriptions = {
    PreToolUse: '工具执行之前',
    PostToolUse: '工具返回结果之后',
    PostResponse: '模型生成响应之后',
  };

  function renderHooks() {
    hookGroups.replaceChildren();
    core.HOOK_PHASES.forEach((phase) => {
      const group = document.createElement('section');
      group.className = 'pe-hook-group';
      group.dataset.hookPhase = phase;
      group.innerHTML = `
        <div class="pe-hook-group-head">
          <div><span class="pe-hook-phase">${phase}</span><small>${phaseDescriptions[phase]}</small></div>
          <button class="pe-button small" type="button" data-add-hook="${phase}">＋ 添加 Hook</button>
        </div>
        <div class="pe-hook-list" data-hook-list></div>`;
      const list = group.querySelector('[data-hook-list]');
      const entries = profile.hooks[phase];
      if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'pe-hook-empty';
        empty.textContent = '此阶段没有 Hook';
        list.appendChild(empty);
      } else {
        entries.forEach((entry) => {
          const fragment = $('hookRowTemplate').content.cloneNode(true);
          fragment.querySelector('[data-hook-matcher]').value = entry.matcher;
          fragment.querySelector('[data-hook-match-mode]').value = entry.match_mode;
          fragment.querySelector('[data-hook-id]').value = entry.hook_id;
          fragment.querySelector('[data-hook-on-match]').value = entry.on_match;
          list.appendChild(fragment);
        });
      }
      hookGroups.appendChild(group);
    });
  }

  function syncHooksFromDom() {
    core.HOOK_PHASES.forEach((phase) => {
      const group = hookGroups.querySelector(`[data-hook-phase="${phase}"]`);
      if (!group) return;
      profile.hooks[phase] = [...group.querySelectorAll('[data-hook-row]')].map((row) => ({
        matcher: row.querySelector('[data-hook-matcher]').value,
        match_mode: row.querySelector('[data-hook-match-mode]').value,
        hook_id: row.querySelector('[data-hook-id]').value,
        on_match: row.querySelector('[data-hook-on-match]').value,
      }));
    });
  }

  function collectForm() {
    readStaticForm();
    syncSchemasFromDom();
    syncHooksFromDom();
  }

  function sectionForPath(path) {
    if (/^(name|description|model)/.test(path)) return 'basic';
    if (/^tools/.test(path)) return 'tools';
    if (/^limits/.test(path)) return 'limits';
    if (/^(prompt|thought|system_prompt|initial_reminder)/.test(path)) return 'prompt';
    if (/^skills/.test(path)) return 'skills';
    if (/^fork/.test(path)) return 'fork';
    if (/^hooks/.test(path)) return 'hooks';
    return 'basic';
  }

  function updateValidation(result) {
    const banner = $('validationBanner');
    const title = $('validationTitle');
    const text = $('validationText');
    const icon = banner.querySelector('.pe-validation-icon');
    banner.classList.remove('warning', 'error');
    if (result.errors.length) {
      banner.classList.add('error');
      icon.textContent = '!';
      title.textContent = `${result.errors.length} 个配置错误`;
      text.textContent = '修复错误后再导出，以免运行时拒绝加载。';
    } else if (result.warnings.length) {
      banner.classList.add('warning');
      icon.textContent = '!';
      title.textContent = `配置有效，存在 ${result.warnings.length} 条提示`;
      text.textContent = '这些提示不会阻止导出，但可能影响子 Agent 行为。';
    } else {
      icon.textContent = '✓';
      title.textContent = '配置有效';
      text.textContent = '所有必填参数与结构约束均已满足。';
    }

    const list = $('validationList');
    list.replaceChildren();
    [...result.errors, ...result.warnings].forEach((item) => {
      const row = document.createElement('p');
      const path = document.createElement('code');
      path.textContent = item.path;
      row.append(path, document.createTextNode(` — ${item.message}`));
      list.appendChild(row);
    });
    $('validationDetails').hidden = result.errors.length + result.warnings.length === 0;
    if ($('validationDetails').hidden) list.hidden = true;

    document.querySelectorAll('[data-section-count]').forEach((badge) => { badge.textContent = ''; });
    const counts = {};
    result.errors.forEach((item) => {
      const section = sectionForPath(item.path);
      counts[section] = (counts[section] || 0) + 1;
    });
    Object.entries(counts).forEach(([section, count]) => {
      const badge = document.querySelector(`[data-section-count="${section}"]`);
      if (badge) badge.textContent = String(count);
    });

    $('fieldName').classList.toggle('invalid', result.errors.some((item) => item.path === 'name'));
    $('fieldRemainingTurns').classList.toggle(
      'invalid',
      result.errors.some((item) => item.path === 'limits.remaining_search_turns'),
    );
    document.querySelector('.pe-status-dot').classList.toggle('invalid', !result.valid);
  }

  function currentOutput() {
    return previewFormat === 'json'
      ? `${JSON.stringify(profile, null, 2)}\n`
      : core.profileToToml(profile);
  }

  function byteSize(text) {
    if (window.TextEncoder) return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
  }

  function updatePreview(result) {
    const output = currentOutput();
    $('previewCode').textContent = output;
    $('previewLines').textContent = `${output.split('\n').length - 1} lines`;
    $('previewSize').textContent = `${byteSize(output).toLocaleString()} B`;
    $('previewFileName').textContent = `${safeFileName(profile.name || 'profile')}.${previewFormat}`;
    $('previewStatus').textContent = result.valid ? (result.warnings.length ? 'VALID · WARNINGS' : 'VALID') : 'INVALID';
    $('previewStatus').previousElementSibling.classList.toggle('error', !result.valid);
    $('tomlTab').classList.toggle('active', previewFormat === 'toml');
    $('jsonTab').classList.toggle('active', previewFormat === 'json');
  }

  function updateSummary() {
    const cleanName = profile.name.trim() || '未命名 Profile';
    const model = profile.model ? profile.model.split('/').pop() : '继承父 Agent 模型';
    $('profileTitle').textContent = cleanName;
    $('profileInitial').textContent = cleanName.slice(0, 1).toUpperCase() || 'P';
    $('profileModel').textContent = model;
    $('metricTools').textContent = profile.tools.names.includes('*') ? 'ALL' : String(profile.tools.names.length);
    $('metricHooks').textContent = String(core.HOOK_PHASES.reduce((sum, phase) => sum + profile.hooks[phase].length, 0));
    $('metricTurns').textContent = profile.limits.max_turns == null ? '∞' : String(profile.limits.max_turns);
  }

  function safeFileName(name) {
    return String(name || 'profile').trim().replace(/[^A-Za-z0-9_-]+/g, '-') || 'profile';
  }

  function scheduleSave() {
    $('saveState').classList.add('saving');
    $('saveState').lastChild.textContent = ' 保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
        $('saveState').classList.remove('saving');
        $('saveState').lastChild.textContent = ' 已自动保存';
      } catch (error) {
        $('saveState').lastChild.textContent = ' 无法保存草稿';
      }
    }, 260);
  }

  function refresh(options = {}) {
    const result = core.validateProfile(profile);
    updateSummary();
    updateValidation(result);
    updatePreview(result);
    if (options.save !== false) scheduleSave();
  }

  function renderAll() {
    profile = core.normalizeProfile(profile);
    writeStaticForm();
    renderSchemas();
    renderHooks();
    refresh({ save: false });
  }

  function onFormChange(event) {
    if (event.target.matches('button')) return;
    collectForm();
    refresh();
  }

  function uniqueSchemaName() {
    let index = 1;
    let name = 'NewTool';
    while (Object.prototype.hasOwnProperty.call(profile.tools.schema, name)) {
      index += 1;
      name = `NewTool${index}`;
    }
    return name;
  }

  function addSchema() {
    collectForm();
    const name = uniqueSchemaName();
    profile.tools.schema[name] = {
      description: '',
      parameters: { type: 'object', properties: {} },
    };
    renderSchemas();
    refresh();
    const input = [...schemaList.querySelectorAll('[data-schema-name]')].pop();
    input?.focus();
    input?.select();
  }

  function addHook(phase) {
    collectForm();
    profile.hooks[phase].push({
      matcher: phase === 'PostResponse' ? 'STOP' : '*',
      match_mode: 'exact',
      hook_id: '',
      on_match: phase === 'PostResponse' ? 'end' : 'continue',
    });
    renderHooks();
    refresh();
    const group = hookGroups.querySelector(`[data-hook-phase="${phase}"]`);
    group?.querySelector('[data-hook-row]:last-child [data-hook-id]')?.focus();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    showToast('配置已复制到剪贴板');
  }

  function downloadToml() {
    collectForm();
    const result = core.validateProfile(profile);
    refresh();
    if (!result.valid) {
      showToast('存在配置错误，暂不能导出', 'error');
      return;
    }
    const blob = new Blob([core.profileToToml(profile)], { type: 'application/toml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFileName(profile.name)}.toml`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('TOML 已导出');
  }

  function showToast(message, kind = 'success') {
    const toast = $('toast');
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle('error', kind === 'error');
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function loadPreset() {
    if (!window.confirm('载入 WebSearch 示例会覆盖当前草稿，是否继续？')) return;
    profile = core.createWebSearchProfile();
    renderAll();
    scheduleSave();
    showToast('已载入 WebSearch Profile');
  }

  async function importJson(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      profile = core.normalizeProfile(parsed);
      renderAll();
      scheduleSave();
      showToast('JSON Profile 已导入');
    } catch (error) {
      showToast(`导入失败：${error.message}`, 'error');
    } finally {
      $('importFile').value = '';
    }
  }

  form.addEventListener('input', onFormChange);
  form.addEventListener('change', onFormChange);
  $('addSchemaButton').addEventListener('click', addSchema);
  schemaList.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-schema]');
    if (!remove) return;
    remove.closest('[data-schema-card]').remove();
    syncSchemasFromDom();
    if (!schemaList.querySelector('[data-schema-card]')) renderSchemas();
    refresh();
  });
  hookGroups.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add-hook]');
    if (add) {
      addHook(add.dataset.addHook);
      return;
    }
    const remove = event.target.closest('[data-remove-hook]');
    if (!remove) return;
    const phase = remove.closest('[data-hook-phase]').dataset.hookPhase;
    remove.closest('[data-hook-row]').remove();
    syncHooksFromDom();
    renderHooks();
    refresh();
    showToast(`${phase} Hook 已删除`);
  });

  document.querySelectorAll('.pe-nav button[data-target]').forEach((button) => {
    button.addEventListener('click', () => {
      $(button.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelectorAll('.pe-nav button').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
    });
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      document.querySelectorAll('.pe-nav button').forEach((item) => {
        item.classList.toggle('active', item.dataset.target === visible.target.id);
      });
    }, { rootMargin: '-90px 0px -58% 0px', threshold: [0.05, 0.25] });
    document.querySelectorAll('.pe-section').forEach((section) => observer.observe(section));
  }

  $('tomlTab').addEventListener('click', () => { previewFormat = 'toml'; refresh({ save: false }); });
  $('jsonTab').addEventListener('click', () => { previewFormat = 'json'; refresh({ save: false }); });
  $('copyButton').addEventListener('click', () => copyText(currentOutput()));
  $('copyPreviewButton').addEventListener('click', () => copyText(currentOutput()));
  $('downloadButton').addEventListener('click', downloadToml);
  $('presetButton').addEventListener('click', loadPreset);
  $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (event) => importJson(event.target.files?.[0]));
  $('validationDetails').addEventListener('click', () => {
    $('validationList').hidden = !$('validationList').hidden;
  });

  renderAll();
})();
