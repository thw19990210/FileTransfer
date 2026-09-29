(function initializeProfileEditor() {
  'use strict';

  const core = window.ProfileEditorCore;
  if (!core) throw new Error('ProfileEditorCore is required');

  const STORAGE_KEY = 'taichu_profile_editor_draft_v1';
  const PLATFORM_STORAGE_KEY = 'taichu_profile_editor_platform_v1';
  const $ = (id) => document.getElementById(id);
  const form = $('profileForm');
  const promptFileList = $('promptFileList');
  let profile = loadDraft();
  let platform = loadPlatformDraft();
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

  function loadPlatformDraft() {
    const defaults = {
      visibility: {
        scope: 'system',
        skills: [],
      },
      version: '1.0.0',
      status: 'published',
      lifecycle: {
        max_active_turns: null,
        invalidate_on_other_skill_load: true,
      },
    };
    try {
      const raw = localStorage.getItem(PLATFORM_STORAGE_KEY);
      if (!raw) return defaults;
      const saved = JSON.parse(raw);
      const savedVisibleSkills = Array.isArray(saved.visibility?.skills)
        ? saved.visibility.skills
        : saved.consumer_skills;
      return {
        visibility: {
          scope: saved.visibility?.scope === 'skills' || saved.scope === 'skill'
            ? 'skills'
            : 'system',
          skills: Array.isArray(savedVisibleSkills)
            ? [...new Set(savedVisibleSkills.map(String).map((item) => item.trim()).filter(Boolean))]
            : [],
        },
        version: String(saved.version || defaults.version),
        status: ['draft', 'published', 'disabled'].includes(saved.status)
          ? saved.status
          : defaults.status,
        lifecycle: {
          max_active_turns: saved.lifecycle?.max_active_turns == null
            ? null
            : Number(saved.lifecycle.max_active_turns),
          invalidate_on_other_skill_load: saved.lifecycle?.invalidate_on_other_skill_load !== false,
        },
      };
    } catch (error) {
      console.warn('profile platform metadata ignored', error);
      return defaults;
    }
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

  function formatSchema(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return JSON.stringify(value, null, 2);
    }
    return String(value ?? '');
  }

  function parseSchemaField(id) {
    const value = $(id).value.trim();
    try {
      return JSON.parse(value);
    } catch (_) {
      return value;
    }
  }

  function setValue(id, value) {
    const element = $(id);
    if (element) element.value = value == null ? '' : String(value);
  }

  function setChecked(id, value) {
    const element = $(id);
    if (element) element.checked = Boolean(value);
  }

  function skillSnippet() {
    const profileId = profile.name.trim() || 'profile-name';
    return [
      '### Step 3：调用子 Agent',
      '',
      '调用 `run_subagent`，设置：',
      `\`subagent_profile_id: ${profileId}\``,
      '',
      '将上一步得到的文件和用户要求传给 Subagent。',
      '等待 Subagent 完成后，继续执行下一步。',
    ].join('\n');
  }

  function writePlatformForm() {
    setValue('fieldVisibilityScope', platform.visibility.scope);
    setValue('fieldVisibleSkills', platform.visibility.skills.join(', '));
    setValue('fieldVersion', platform.version);
    setValue('fieldPublishStatus', platform.status);
    setValue('fieldMaxActiveTurns', platform.lifecycle.max_active_turns);
    setChecked('fieldInvalidateOnOtherSkillLoad', platform.lifecycle.invalidate_on_other_skill_load);
  }

  function readPlatformForm() {
    platform.visibility.scope = $('fieldVisibilityScope').value === 'skills' ? 'skills' : 'system';
    platform.visibility.skills = splitList($('fieldVisibleSkills').value);
    platform.version = $('fieldVersion').value.trim();
    platform.status = $('fieldPublishStatus').value;
    platform.lifecycle.max_active_turns = nullableInteger($('fieldMaxActiveTurns').value);
    platform.lifecycle.invalidate_on_other_skill_load = $('fieldInvalidateOnOtherSkillLoad').checked;
  }

  function writeStaticForm() {
    writePlatformForm();
    setValue('fieldName', profile.name);
    setValue('fieldModel', profile.model);
    setValue('fieldDescription', profile.description);
    setValue('fieldToolsMode', profile.tools.mode);
    setValue('fieldToolNames', profile.tools.names.join(', '));
    setChecked('fieldToolsStrict', profile.tools.strict);
    setValue('fieldTimeout', profile.limits.timeout_secs);
    setValue('fieldMaxTurns', profile.limits.max_turns);
    setValue('fieldMaxOutput', profile.limits.max_output_chars);
    setValue('fieldOnMaxTurns', profile.limits.on_max_turns);
    setValue('fieldOnMaxMessage', profile.limits.on_max_turns_message);
    setValue('fieldSystemPromptMode', profile.prompt.system.mode);
    setValue('fieldSystemPromptContent', profile.prompt.system.content);
    setValue('fieldSkillAllow', profile.skills.allow.join(', '));
    setValue('fieldSkillDeny', profile.skills.deny.join(', '));
    setValue('fieldSkillPreload', profile.skills.preload.join(', '));
    setChecked('fieldIncludeHistory', profile.fork.include_parent_history);
    setValue('fieldMaxPriorTurns', profile.fork.max_prior_turns);
    setValue('fieldMaxHistoryChars', profile.fork.max_history_chars);
    setValue('fieldPriorTurns', profile.fork.prior_turns);
    setValue('fieldOutOfScope', profile.fork.out_of_scope_tool_instruction);
    setValue('fieldInputSchema', formatSchema(profile.input_schema));
    setValue('fieldOutputSchema', formatSchema(profile.output_schema));
  }

  function readStaticForm() {
    readPlatformForm();
    profile.name = $('fieldName').value;
    profile.model = nullableText($('fieldModel').value);
    profile.description = $('fieldDescription').value;
    profile.tools.mode = $('fieldToolsMode').value;
    profile.tools.names = splitList($('fieldToolNames').value);
    profile.tools.strict = $('fieldToolsStrict').checked;
    profile.limits.timeout_secs = nullableInteger($('fieldTimeout').value);
    profile.limits.max_turns = nullableInteger($('fieldMaxTurns').value);
    profile.limits.max_output_chars = nullableInteger($('fieldMaxOutput').value);
    profile.limits.on_max_turns = $('fieldOnMaxTurns').value;
    profile.limits.on_max_turns_message = nullableText($('fieldOnMaxMessage').value);
    profile.prompt.system.mode = $('fieldSystemPromptMode').value;
    profile.prompt.system.content = $('fieldSystemPromptContent').value;
    profile.skills.allow = splitList($('fieldSkillAllow').value);
    profile.skills.deny = splitList($('fieldSkillDeny').value);
    profile.skills.preload = splitList($('fieldSkillPreload').value);
    profile.fork.include_parent_history = $('fieldIncludeHistory').checked;
    profile.fork.max_prior_turns = nullableInteger($('fieldMaxPriorTurns').value);
    profile.fork.max_history_chars = nullableInteger($('fieldMaxHistoryChars').value);
    profile.fork.prior_turns = $('fieldPriorTurns').value;
    profile.fork.out_of_scope_tool_instruction = $('fieldOutOfScope').value;
    profile.input_schema = parseSchemaField('fieldInputSchema');
    profile.output_schema = parseSchemaField('fieldOutputSchema');
  }

  const promptFileDescriptions = {
    'SOUL.md': '身份、角色气质与稳定表达风格。',
    'AGENTS.md': '代理工作规则、决策边界与执行约束。',
    'TOOLS.md': '工具选择、参数约束与调用规则。',
    'USER.md': '用户身份、偏好和长期稳定信息。',
    'MEMORY.md': '跨会话保留的精炼记忆与经验。',
  };

  function renderPromptFiles() {
    promptFileList.replaceChildren();
    core.PROMPT_FILES.forEach((fileName) => {
      const slot = profile.prompt.files[fileName];
      const card = document.createElement('article');
      card.className = 'pe-prompt-file-card';
      card.dataset.promptFile = fileName;
      card.innerHTML = `
        <div class="pe-prompt-file-head">
          <div><code>${fileName}</code><p>${promptFileDescriptions[fileName]}</p></div>
          <label><span>处理方式</span><select data-prompt-file-mode>
            <option value="inherit">沿用父 Prompt</option>
            <option value="empty">置空</option>
            <option value="custom">自定义</option>
          </select></label>
        </div>
        <div class="pe-prompt-mode-note" data-prompt-mode-note></div>
        <label class="pe-field pe-prompt-content" data-prompt-custom-content>
          <span>自定义内容 <code>prompt.files.${fileName}.content</code></span>
          <textarea class="pe-code-input" rows="8" spellcheck="false" data-prompt-file-content placeholder="填写完整的 ${fileName} 内容"></textarea>
        </label>`;
      card.querySelector('[data-prompt-file-mode]').value = slot.mode;
      card.querySelector('[data-prompt-file-content]').value = slot.content;
      promptFileList.appendChild(card);
    });
    updatePromptEditorState();
  }

  function syncPromptFilesFromDom() {
    promptFileList.querySelectorAll('[data-prompt-file]').forEach((card) => {
      const fileName = card.dataset.promptFile;
      profile.prompt.files[fileName] = {
        mode: card.querySelector('[data-prompt-file-mode]').value,
        content: card.querySelector('[data-prompt-file-content]').value,
      };
    });
  }

  function updatePromptEditorState() {
    const systemMode = $('fieldSystemPromptMode').value;
    $('systemPromptContentField').hidden = systemMode !== 'custom';
    promptFileList.querySelectorAll('[data-prompt-file]').forEach((card) => {
      const mode = card.querySelector('[data-prompt-file-mode]').value;
      const customContent = card.querySelector('[data-prompt-custom-content]');
      const note = card.querySelector('[data-prompt-mode-note]');
      customContent.hidden = mode !== 'custom';
      note.hidden = mode === 'custom';
      note.textContent = mode === 'empty'
        ? '此槽位不会注入任何内容。'
        : '运行时沿用父 Agent 中的对应 Markdown 内容。';
      card.dataset.mode = mode;
    });
  }

  function updateForkEditorState() {
    const enabled = $('fieldIncludeHistory').checked;
    const options = $('forkOptions');
    options.classList.toggle('is-disabled', !enabled);
    options.querySelectorAll('input, select, textarea').forEach((control) => {
      control.disabled = !enabled;
    });
  }

  function collectForm() {
    readStaticForm();
    syncPromptFilesFromDom();
  }

  function sectionForPath(path) {
    if (/^(name|description|model)/.test(path)) return 'basic';
    if (/^(tools|limits|skills)/.test(path)) return 'runtime';
    if (/^(prompt|fork|input_schema|output_schema)/.test(path)) return 'context';
    return 'basic';
  }

  function validatePlatform() {
    const errors = [];
    const warnings = [];
    const isRestricted = platform.visibility.scope === 'skills';
    if (isRestricted && platform.visibility.skills.length === 0) {
      errors.push({ path: 'platform.visibility.skills', message: '限定可见范围至少需要填写一个可见 Skill。' });
    }
    if (isRestricted) {
      const maxActiveTurns = platform.lifecycle.max_active_turns;
      if (maxActiveTurns !== null && (!Number.isInteger(maxActiveTurns) || maxActiveTurns < 1)) {
        errors.push({
          path: 'platform.lifecycle.max_active_turns',
          message: '限定可见 Profile 的最大生效轮数必须是正整数或留空。',
        });
      }
    }
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(platform.version)) {
      errors.push({ path: 'platform.version', message: '版本号应使用语义化版本，例如 1.0.0。' });
    }
    if (platform.status === 'draft') {
      warnings.push({ path: 'platform.status', message: '草稿 Profile 尚未形成可供生产使用的稳定版本。' });
    }
    if (platform.status === 'disabled') {
      warnings.push({ path: 'platform.status', message: '已禁用的 Profile 不应继续被 Skill 引用。' });
    }
    return { errors, warnings };
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
    $('fieldVersion').classList.toggle(
      'invalid',
      result.errors.some((item) => item.path === 'platform.version'),
    );
    $('fieldSystemPromptContent').classList.toggle(
      'invalid',
      result.errors.some((item) => item.path === 'prompt.system.content'),
    );
    promptFileList.querySelectorAll('[data-prompt-file]').forEach((card) => {
      const path = `prompt.files.${card.dataset.promptFile}.content`;
      card.querySelector('[data-prompt-file-content]').classList.toggle(
        'invalid',
        result.errors.some((item) => item.path === path),
      );
    });
    $('fieldVisibleSkills').classList.toggle(
      'invalid',
      result.errors.some((item) => item.path === 'platform.visibility.skills'),
    );
    $('fieldMaxActiveTurns').classList.toggle(
      'invalid',
      result.errors.some((item) => item.path === 'platform.lifecycle.max_active_turns'),
    );
    $('fieldInputSchema').classList.toggle(
      'invalid',
      result.errors.some((item) => item.path.startsWith('input_schema')),
    );
    $('fieldOutputSchema').classList.toggle(
      'invalid',
      result.errors.some((item) => item.path.startsWith('output_schema')),
    );
    ['fieldMaxPriorTurns', 'fieldMaxHistoryChars', 'fieldPriorTurns'].forEach((id) => {
      const pathById = {
        fieldMaxPriorTurns: 'fork.max_prior_turns',
        fieldMaxHistoryChars: 'fork.max_history_chars',
        fieldPriorTurns: 'fork.prior_turns',
      };
      $(id).classList.toggle(
        'invalid',
        result.errors.some((item) => item.path === pathById[id]),
      );
    });
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
    $('metricPreload').textContent = String(profile.skills.preload.length);
    $('metricTurns').textContent = profile.limits.max_turns == null ? '∞' : String(profile.limits.max_turns);

    const isRestricted = platform.visibility.scope === 'skills';
    const visibilityLabel = isRestricted ? '特定 Skills 可见' : '系统范围可见';
    const visibilityDescription = isRestricted
      ? '只有可见列表中的 Skills 能发现并选择此 Profile；激活生命周期可以单独配置。'
      : '所有 Skills 都能发现并选择此 Profile；Profile 独立发布和演进。';
    $('visibleSkillsField').hidden = !isRestricted;
    $('visibilityLifecycleCard').hidden = !isRestricted;
    $('heroVisibilityBadge').textContent = visibilityLabel;
    $('heroVisibilityBadge').classList.toggle('all', !isRestricted);
    $('heroVisibilityBadge').classList.toggle('restricted', isRestricted);
    $('heroScopeDescription').textContent = visibilityDescription;
    $('skillSnippet').textContent = skillSnippet();
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
        localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(platform));
        $('saveState').classList.remove('saving');
        $('saveState').lastChild.textContent = ' 已自动保存';
      } catch (error) {
        $('saveState').lastChild.textContent = ' 无法保存草稿';
      }
    }, 260);
  }

  function refresh(options = {}) {
    const runtimeResult = core.validateProfile(profile);
    const platformResult = validatePlatform();
    const result = {
      errors: [...runtimeResult.errors, ...platformResult.errors],
      warnings: [...runtimeResult.warnings, ...platformResult.warnings],
    };
    result.valid = result.errors.length === 0;
    updateSummary();
    updatePromptEditorState();
    updateForkEditorState();
    updateValidation(result);
    updatePreview(result);
    if (options.save !== false) scheduleSave();
  }

  function renderAll() {
    profile = core.normalizeProfile(profile);
    writeStaticForm();
    renderPromptFiles();
    refresh({ save: false });
  }

  function onFormChange(event) {
    if (event.target.matches('button')) return;
    collectForm();
    refresh();
  }

  async function copyText(text, message = '配置已复制到剪贴板') {
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
    showToast(message);
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
    platform = {
      visibility: {
        scope: 'system',
        skills: [],
      },
      version: '1.0.0',
      status: 'published',
      lifecycle: {
        max_active_turns: null,
        invalidate_on_other_skill_load: true,
      },
    };
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
  $('copySnippetButton').addEventListener('click', () => copyText(skillSnippet(), 'SKILL.md 示例已复制'));
  $('downloadButton').addEventListener('click', downloadToml);
  $('presetButton').addEventListener('click', loadPreset);
  $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (event) => importJson(event.target.files?.[0]));
  $('validationDetails').addEventListener('click', () => {
    $('validationList').hidden = !$('validationList').hidden;
  });

  renderAll();
})();
