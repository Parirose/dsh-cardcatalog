/*
 * 目录卡 / dsh-cardcatalog — 浏览器半端（设置页）。
 *
 * 这是一个自注册脚本，不是 ESM。宿主加载 ./client 时执行
 * window.__ModuleLoader__.load(...)。取不到 react / slots 时整个文件安静跳过，
 * host 半端不受影响。
 */
;(function () {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return

  window.__ModuleLoader__.load({
    id: 'dsh-cardcatalog',
    factory: function (require) {
      var React
      try {
        React = require('react')
      } catch {
        return { inject: [], apply: function () {} }
      }
      var h = React.createElement
      var API = '/api/cardcatalog'

      var SOURCES_TEMPLATE = JSON.stringify([
        {
          id: 'env-facts',
          kind: 'facts',
          path: '~/.dsh/notes/facts.json',
        },
        {
          id: 'reading-log',
          kind: 'jsonl',
          path: '~/.dsh/notes/log.jsonl',
          idField: 'key',
          titleField: 'title',
          dateField: 'at',
        },
        {
          id: 'notes',
          kind: 'markdown',
          path: '~/.dsh/notes/notes.md',
          sections: ['称呼与偏好', '当前在做什么'],
          maxChars: 700,
        },
      ], null, 2)

      var NUDGE_PLACEHOLDER = '「{file}」最后更新在 {hours} 小时前（{lastLine}）。如果这一轮有新进展，结尾补一行。'

      function asJson(res) {
        if (res.ok) return res.json()
        throw new Error('HTTP ' + res.status)
      }

      function jget(path) {
        return fetch(API + path, { credentials: 'same-origin' }).then(asJson)
      }

      function jpost(path, body) {
        return fetch(API + path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        }).then(asJson)
      }

      var CSS = [
        '[data-cc-page]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 10px;max-width:720px;}',
        '[data-cc-sec]{display:flex;flex-direction:column;gap:8px;}',
        '[data-cc-h]{font-size:11px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary,#9aa0a6);}',
        '[data-cc-note]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}',
        '[data-cc-label]{font-size:13px;}',
        '[data-cc-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
        '[data-cc-grid]{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;}',
        '[data-cc-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;',
        'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));',
        'background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:inherit;font-family:inherit;}',
        '[data-cc-input]:focus{outline:none;border-color:#3b82f6;}',
        '[data-cc-num]{width:100%;text-align:center;}',
        '[data-cc-btn]{padding:7px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;',
        'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));',
        'background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));color:inherit;}',
        '[data-cc-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}',
        '[data-cc-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}',
        '[data-cc-btn][disabled]{opacity:.5;cursor:default;}',
        '[data-cc-msg]{font-size:11px;line-height:16px;padding:7px 9px;border-radius:8px;word-break:break-word;',
        'background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:var(--dsw-alias-label-tertiary,#9aa0a6);}',
        '[data-cc-msg][data-warn]{color:#f59e0b;}',
        '[data-cc-msg][data-good]{color:#22c55e;}',
        '[data-cc-pre]{margin:6px 0 0;padding:9px 10px;border-radius:8px;max-height:260px;overflow:auto;font-size:11px;',
        'line-height:16px;white-space:pre-wrap;word-break:break-word;',
        'background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.25));color:var(--dsw-alias-label-secondary,#c9ccd1);}',
        '[data-cc-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;',
        'background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}',
        '[data-cc-sw][data-on]{background:#3b82f6;}',
        '[data-cc-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;',
        'transition:left .15s;display:block;}',
        '[data-cc-sw][data-on] i{left:19px;}',
        '[data-cc-kv]{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a6);word-break:break-word;}',
        '[data-cc-src]{padding:8px 10px;border-radius:8px;display:flex;flex-direction:column;gap:4px;',
        'background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.10));}',
        '[data-cc-badge]{font-size:10px;padding:1px 6px;border-radius:9px;background:rgba(128,128,128,.22);}',
        '[data-cc-badge][data-status="ok"]{color:#22c55e;}',
        '[data-cc-badge][data-status="missing"],[data-cc-badge][data-status="error"]{color:#ef4444;}',
        '[data-cc-badge][data-status="empty"],[data-cc-badge][data-status="stale"]{color:#f59e0b;}',
        '[data-cc-steps]{margin:0;padding-left:18px;font-size:12px;line-height:20px;}',
        '[data-cc-mono]{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;}',
      ].join('')

      function Switch(props) {
        return h('button', {
          'data-cc-sw': '',
          'data-on': props.on ? '' : undefined,
          disabled: Boolean(props.disabled),
          title: props.on ? '开' : '关',
          onClick: function () {
            if (!props.disabled) props.onChange(!props.on)
          },
        }, h('i'))
      }

      function NumberField(props) {
        return h('label', { 'data-cc-sec': '' },
          h('span', { 'data-cc-label': '' }, props.label),
          h('input', {
            'data-cc-input': '',
            'data-cc-num': '',
            type: 'number',
            min: props.min,
            step: 1,
            value: props.value,
            disabled: Boolean(props.disabled),
            onChange: function (event) { props.onChange(event.target.value) },
          }),
          props.note ? h('span', { 'data-cc-note': '' }, props.note) : null)
      }

      function parseSources(text) {
        var parsed = JSON.parse(text)
        if (!Array.isArray(parsed)) throw new Error('sources 必须是数组')
        return parsed
      }

      function fmtTime(value) {
        if (!value) return '—'
        try {
          return new Date(value).toLocaleString('zh-CN', { hour12: false })
        } catch {
          return '—'
        }
      }

      function fmtBytes(value) {
        var n = Number(value) || 0
        if (n < 1024) return n + ' B'
        return (n / 1024).toFixed(1) + ' KB'
      }

      function statusLabel(status) {
        if (status === 'ok') return 'ok'
        if (status === 'missing') return 'missing'
        if (status === 'empty') return 'empty'
        if (status === 'error') return 'error'
        if (status === 'stale') return 'stale'
        if (status === 'disabled') return '未启用'
        return status || '未知'
      }

      function SourceCard(props) {
        var source = props.source || {}
        return h('div', { 'data-cc-src': '' },
          h('div', { 'data-cc-row': '' },
            h('span', { 'data-cc-label': '' }, source.id || '(no-id)'),
            h('span', { 'data-cc-note': '' }, source.kind || ''),
            h('span', {
              'data-cc-badge': '',
              'data-status': source.status || '',
            }, statusLabel(source.status)),
            source.enabled === false ? h('span', { 'data-cc-note': '' }, '已停用') : null),
          h('div', { 'data-cc-kv': '' }, '路径：' + (source.path || '（未配置）')),
          h('div', { 'data-cc-kv': '' },
            '大小/行数：' + fmtBytes(source.bytes) + ' · ' + (source.lines || 0) + ' 行 · 条目 ' + (source.entries || 0),
            h('br'),
            '最后修改：' + fmtTime(source.mtime),
            source.reason ? h('span', {}, ' · ' + source.reason) : null))
      }

      function Panel() {
        var stateHook = React.useState(null)
        var state = stateHook[0]
        var setState = stateHook[1]
        var draftHook = React.useState(null)
        var draft = draftHook[0]
        var setDraft = draftHook[1]
        var sourcesHook = React.useState('[]')
        var sourcesText = sourcesHook[0]
        var setSourcesText = sourcesHook[1]
        var previewHook = React.useState(null)
        var preview = previewHook[0]
        var setPreview = previewHook[1]
        var busyHook = React.useState('')
        var busy = busyHook[0]
        var setBusy = busyHook[1]
        var msgHook = React.useState(null)
        var msg = msgHook[0]
        var setMsg = msgHook[1]
        var copiedHook = React.useState('')
        var copied = copiedHook[0]
        var setCopied = copiedHook[1]

        function adopt(payload) {
          if (!payload || !payload.config) return
          setState(payload)
          setDraft(payload.config)
          var list = payload.config.sources || []
          setSourcesText(list.length ? JSON.stringify(list, null, 2) : SOURCES_TEMPLATE)
          if (payload.preview) setPreview(payload.preview)
        }

        function load() {
          setBusy('load')
          jget('/state').then(function (payload) {
            adopt(payload)
            setMsg(null)
          }).catch(function () {
            setMsg({ tone: 'warn', text: '读不到设置状态：宿主接口可能还没挂上。' })
          }).finally(function () { setBusy('') })
        }

        React.useEffect(function () { load() }, [])

        function buildConfig() {
          var sources
          try {
            sources = parseSources(sourcesText)
          } catch (error) {
            throw new Error('sources JSON 不合法：' + (error && error.message ? error.message : '解析失败'))
          }
          var base = draft || {}
          var nudge = base.nudge || {}
          var tone = base.tone || {}
          var wall = base.wall || {}
          return {
            enabled: base.enabled !== false,
            sources: sources,
            injectAt: base.injectAt === 'every-n-turns' ? 'every-n-turns' : 'session-start',
            everyNTurns: Number(base.everyNTurns) || 0,
            maxLines: Number(base.maxLines) || 0,
            maxLinesPerSource: Number(base.maxLinesPerSource) || 0,
            staleMaxLines: Number(base.staleMaxLines) || 0,
            maxChars: base.maxChars === 0 ? 0 : (Number(base.maxChars) || 1600),
            lineMaxChars: Number(base.lineMaxChars) || 80,
            showStale: base.showStale !== false,
            header: typeof base.header === 'string' ? base.header : '',
            nudge: {
              enabled: nudge.enabled === true,
              file: typeof nudge.file === 'string' ? nudge.file : '',
              staleAfterHours: Number(nudge.staleAfterHours) >= 0 ? Number(nudge.staleAfterHours) : 6,
              text: typeof nudge.text === 'string' ? nudge.text : '',
              maxChars: nudge.maxChars === 0 ? 0 : (Number(nudge.maxChars) || 200),
              alsoEveryNTurns: Number(nudge.alsoEveryNTurns) || 0,
            },
            tone: {
              enabled: tone.enabled !== false,
              turns: tone.turns === 0 ? 0 : (Number(tone.turns) || 1),
              maxChars: tone.maxChars === 0 ? 0 : (Number(tone.maxChars) || 300),
              header: typeof tone.header === 'string' ? tone.header : '',
            },
            wall: {
              enabled: wall.enabled !== false,
              turns: wall.turns === 0 ? 0 : (Number(wall.turns) || 2),
              header: typeof wall.header === 'string' ? wall.header : '',
            },
          }
        }

        function onPreview() {
          var config
          try {
            config = buildConfig()
          } catch (error) {
            setMsg({ tone: 'warn', text: error.message })
            return
          }
          setBusy('preview')
          jpost('/preview', { config: config }).then(function (payload) {
            if (payload && payload.preview) setPreview(payload.preview)
            if (payload && payload.sources) setState(Object.assign({}, state, { sources: payload.sources, nudge: payload.nudge }))
            setMsg({ tone: payload && payload.preview && payload.preview.lines ? 'good' : 'warn', text: '预览已更新（不写入任何东西）。' })
          }).catch(function () {
            setMsg({ tone: 'warn', text: '预览失败：接口没有返回结果。' })
          }).finally(function () { setBusy('') })
        }

        function onSave() {
          var config
          try {
            config = buildConfig()
          } catch (error) {
            setMsg({ tone: 'warn', text: error.message })
            return
          }
          setBusy('save')
          jpost('/config', { config: config }).then(function (payload) {
            adopt(payload)
            setMsg({ tone: 'good', text: '已保存。账本本身没有被修改。' })
          }).catch(function (error) {
            setMsg({ tone: 'warn', text: '保存失败：' + (error && error.message ? error.message : '宿主拒绝写入') })
          }).finally(function () { setBusy('') })
        }

        function copySnippet() {
          var text = (state && state.snippet) || ''
          if (!text) return
          function done() { setCopied('已复制') }
          function fail() { setCopied('复制失败，请手动选中') }
          try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(done).catch(fail)
              return
            }
          } catch {
            // 退回手动选择。
          }
          try {
            var area = document.createElement('textarea')
            area.value = text
            area.setAttribute('readonly', '')
            document.body.appendChild(area)
            area.select()
            document.execCommand('copy')
            document.body.removeChild(area)
            done()
          } catch {
            fail()
          }
        }

        if (!state || !draft) {
          return h('div', { 'data-cc-page': '' },
            h('div', { 'data-cc-msg': '' }, busy === 'load' ? '读取设置中…' : '还没有读到设置。'),
            h('div', { 'data-cc-row': '' },
              h('button', { 'data-cc-btn': '', disabled: Boolean(busy), onClick: load }, '重新读取')))
        }

        var writable = state.settingsAvailable !== false
        var sources = state.sources || []
        var onboarding = state.onboarding || {}
        var nudge = draft.nudge || {}
        var nudgeState = state.nudge || {}
        var nudgeWillFire = state.nudgeWillFire === true
        var nudgeHours = state.nudgeHours
        var staleHours = Number(nudge.staleAfterHours)
        if (!Number.isFinite(staleHours)) staleHours = 6
        var nudgeStatusLine = nudgeWillFire && nudgeHours !== null && nudgeHours !== undefined
          ? ('近况文件已 ' + nudgeHours + ' 小时没更新：下一轮检查会提醒')
          : (nudgeHours !== null && nudgeHours !== undefined
            ? ('近况文件 ' + nudgeHours + ' 小时前更新过：还没到 ' + staleHours + ' 小时，暂不提醒')
            : '读不到近况文件：不会提醒')
        var tone = draft.tone || {}
        var toneState = state.toneState || 'disabled'
        var toneTurns = Number(state.toneTurns) || 0
        var toneStatusLine = toneState === 'injected'
          ? (toneTurns > 0 ? ('压缩点之前取到 ' + toneTurns + ' 轮原话') : '压缩点之前已取到原话')
          : (toneState === 'no-checkpoint'
            ? '本会话还没发生过压缩'
            : (toneState === 'no-quotes'
              ? '压缩点之前没有可用原话'
              : '未开启（压缩后不注入原话样本）'))
        var wall = draft.wall || {}
        var wallState = state.wallState || 'disabled'
        var wallCount = Number(state.wallCount) || 0
        var wallLastMinutes = state.wallLastMinutes
        var wallStatusLine = wallState === 'injected'
          ? (wallCount > 0
            ? ('本会话压缩过 ' + wallCount + ' 次'
              + (wallLastMinutes !== null && wallLastMinutes !== undefined
                ? '，最后一次 ' + wallLastMinutes + ' 分钟前'
                : ''))
            : '压缩痕迹已注入')
          : (wallState === 'no-checkpoint'
            ? '本会话还没被压缩过'
            : (wallState === 'already'
              ? '压缩痕迹已注入过，等待下一次压缩'
              : '已关闭'))
        var hasSources = (draft.sources || []).length > 0

        return h('div', { 'data-cc-page': '' },
          h('div', { 'data-cc-sec': '' },
            h('div', { 'data-cc-h': '' }, '目录卡'),
            h('div', { 'data-cc-note': '' },
              '它只读你的账本，把标题和用户点名的小节投影成上下文；不存储、不检索、不写任何文件。',
              h('br'),
              '这里保存的是「怎么投影」的配置，不是记忆本身。'),
            h('div', { 'data-cc-kv': '' },
              '注入接缝：' + (state.seam === 'none' ? '当前不可用' : state.seam),
              h('br'),
              'nudge 接缝：' + (state.nudgeSeam === 'none' ? '未启用或不可用' : state.nudgeSeam),
              h('br'),
              '配置文件：' + state.configPath),
            h('div', { 'data-cc-row': '' },
              h('span', { 'data-cc-label': '' }, '启用目录卡'),
              h(Switch, {
                on: draft.enabled !== false,
                disabled: !writable,
                onChange: function (value) { setDraft(Object.assign({}, draft, { enabled: value })) },
              }),
              h('span', { 'data-cc-note': '' }, '关掉后整段不注入'))),

          !hasSources
            ? h('div', { 'data-cc-sec': '' },
              h('div', { 'data-cc-h': '' }, '还没有配 sources：三步开始'),
              h('ol', { 'data-cc-steps': '' },
                h('li', {}, '选一个文件：支持 JSON 数组（facts）、JSONL、Markdown。'),
                h('li', {}, '在下面的 JSON 框里填 sources；框里已经放了一个可编辑的模板。'),
                h('li', {}, '把下面「给模型的说明书」复制到你的 AGENTS.md。')),
              h('div', { 'data-cc-note': '' },
                '当前工作区 AGENTS.md：' + (onboarding.agentsPath || '（未知）'),
                h('br'),
                onboarding.agentsExists
                  ? ('已存在 · ' + fmtBytes(onboarding.agentsBytes) + '（只显示，不写入）')
                  : '还不存在（插件不会创建它；需要你自己建）'))
            : null,

          h('div', { 'data-cc-sec': '' },
            h('div', { 'data-cc-h': '' }, '来源状态'),
            sources.length
              ? sources.map(function (source) { return h(SourceCard, { key: source.id + source.kind, source: source }) })
              : h('div', { 'data-cc-note': '' }, '还没有来源。配好 sources 后这里会显示每个文件的读取状态。')),

          h('div', { 'data-cc-sec': '' },
            h('div', { 'data-cc-h': '' }, '账本来源（sources）'),
            h('textarea', {
              'data-cc-input': '',
              rows: 12,
              spellCheck: false,
              value: sourcesText,
              onChange: function (event) { setSourcesText(event.target.value) },
              placeholder: '[]',
            }),
            h('div', { 'data-cc-row': '' },
              h('button', {
                'data-cc-btn': '',
                disabled: !writable,
                onClick: function () { setSourcesText(SOURCES_TEMPLATE) },
              }, '填入模板'),
              h('span', { 'data-cc-note': '' }, '模板是假路径，保存前请换成你自己的只读文件。')),
            h('div', { 'data-cc-note': '' },
              'JSON 数组。每项至少要有 id、kind、path；path 支持 ~ 和环境变量。',
              h('br'),
              'markdown 源用 sections 或 tailLines 取正文，maxChars 是单源硬上限。',
              h('br'),
              '不配 sources ⇒ 目录什么都不注入。')),

          h('div', { 'data-cc-sec': '' },
            h('div', { 'data-cc-h': '' }, 'nudge：提醒，不代写'),
            h('div', { 'data-cc-row': '' },
              h('span', { 'data-cc-label': '' }, '启用 nudge'),
              h(Switch, {
                on: nudge.enabled === true,
                disabled: !writable,
                onChange: function (value) { setDraft(Object.assign({}, draft, { nudge: Object.assign({}, nudge, { enabled: value }) })) },
              }),
              h('span', { 'data-cc-note': '' }, '只提醒文件多久没更新；不写入、不总结')),
            h('label', { 'data-cc-sec': '' },
              h('span', { 'data-cc-label': '' }, '近况文件'),
              h('input', {
                'data-cc-input': '',
                value: nudge.file || '',
                disabled: !writable,
                placeholder: '~/.dsh/notes/now.md',
                onChange: function (event) {
                  setDraft(Object.assign({}, draft, { nudge: Object.assign({}, nudge, { file: event.target.value }) }))
                },
              })),
            h('div', { 'data-cc-grid': '' },
              h(NumberField, {
                label: 'staleAfterHours',
                value: nudge.staleAfterHours,
                min: 0,
                disabled: !writable,
                onChange: function (value) {
                  setDraft(Object.assign({}, draft, { nudge: Object.assign({}, nudge, { staleAfterHours: Number(value) || 0 }) }))
                },
              }),
              h(NumberField, {
                label: 'nudge maxChars',
                value: nudge.maxChars,
                min: 0,
                disabled: !writable,
                onChange: function (value) {
                  setDraft(Object.assign({}, draft, { nudge: Object.assign({}, nudge, { maxChars: Number(value) || 0 }) }))
                },
              }),
              h(NumberField, {
                label: '每 N 轮再检查一次',
                value: nudge.alsoEveryNTurns,
                min: 0,
                disabled: !writable,
                onChange: function (value) {
                  setDraft(Object.assign({}, draft, { nudge: Object.assign({}, nudge, { alsoEveryNTurns: Number(value) || 0 }) }))
                },
                note: '两个数一起决定：文件超过 staleAfterHours 小时没更新，才会在检查的那一轮提醒。',
              })),
            h('label', { 'data-cc-sec': '' },
              h('span', { 'data-cc-label': '' }, '提醒文案'),
              h('textarea', {
                'data-cc-input': '',
                rows: 3,
                value: nudge.text || '',
                disabled: !writable,
                placeholder: NUDGE_PLACEHOLDER,
                onChange: function (event) {
                  setDraft(Object.assign({}, draft, { nudge: Object.assign({}, nudge, { text: event.target.value }) }))
                },
              })),
            h('div', { 'data-cc-note': '' },
              '文案为空时 nudge 不生效。占位符：{file}、{hours}、{lastLine}。',
              h('br'),
              'nudge 文件状态：' + statusLabel(nudgeState.status)
                + (nudgeState.reason ? ' · ' + nudgeState.reason : '')
                + (nudgeState.hours !== null && nudgeState.hours !== undefined ? ' · ' + nudgeState.hours + ' 小时前' : '')),
            nudge.enabled === true && !String(nudge.text || '').trim()
              ? h('div', { 'data-cc-msg': '', 'data-warn': '' }, 'nudge 已开但没有文案，不会注入提醒。')
              : null,
            h('div', { 'data-cc-note': '' }, nudgeStatusLine)),

          h('div', { 'data-cc-sec': '' },
            h('div', { 'data-cc-h': '' }, 'tone：压缩后的原话样本'),
            h('div', { 'data-cc-row': '' },
              h('span', { 'data-cc-label': '' }, '启用原话样本'),
              h(Switch, {
                on: tone.enabled !== false,
                disabled: !writable,
                onChange: function (value) {
                  setDraft(Object.assign({}, draft, { tone: Object.assign({}, tone, { enabled: value }) }))
                },
              }),
              h('span', { 'data-cc-note': '' }, '压缩后给模型一个语气样本；不写文件、不读会话文件')),
            h('div', { 'data-cc-grid': '' },
              h(NumberField, {
                label: 'turns',
                value: tone.turns,
                min: 0,
                disabled: !writable,
                onChange: function (value) {
                  setDraft(Object.assign({}, draft, { tone: Object.assign({}, tone, { turns: Number(value) || 0 }) }))
                },
                note: '取压缩点之前几轮',
              }),
              h(NumberField, {
                label: 'tone maxChars',
                value: tone.maxChars,
                min: 0,
                disabled: !writable,
                onChange: function (value) {
                  setDraft(Object.assign({}, draft, { tone: Object.assign({}, tone, { maxChars: Number(value) || 0 }) }))
                },
                note: '每段原话的字符上限',
              })),
            h('label', { 'data-cc-sec': '' },
              h('span', { 'data-cc-label': '' }, '标题行'),
              h('input', {
                'data-cc-input': '',
                value: tone.header || '',
                disabled: !writable,
                onChange: function (event) {
                  setDraft(Object.assign({}, draft, { tone: Object.assign({}, tone, { header: event.target.value }) }))
                },
              })),
            h('div', { 'data-cc-note': '' },
              '只取当前会话压缩点之前的真人原话与助手正文；不做摘要、不跨会话。'),
            h('div', { 'data-cc-note': '' }, toneStatusLine)),

          h('div', { 'data-cc-sec': '' },
            h('div', { 'data-cc-h': '' }, 'wall：压缩痕迹'),
            h('div', { 'data-cc-row': '' },
              h('span', { 'data-cc-label': '' }, '启用压缩痕迹'),
              h(Switch, {
                on: wall.enabled !== false,
                disabled: !writable,
                onChange: function (value) {
                  setDraft(Object.assign({}, draft, { wall: Object.assign({}, wall, { enabled: value }) }))
                },
              }),
              h('span', { 'data-cc-note': '' }, '压缩后报一次次数、多久前、压掉多少；不含内容摘要')),
            h('div', { 'data-cc-grid': '' },
              h(NumberField, {
                label: 'turns',
                value: wall.turns,
                min: 0,
                disabled: !writable,
                onChange: function (value) {
                  setDraft(Object.assign({}, draft, { wall: Object.assign({}, wall, { turns: Number(value) || 0 }) }))
                },
                note: '提示里建议回取的原话轮数',
              })),
            h('div', { 'data-cc-note': '' },
              '只报元信息与找回命令；不摘要、不估 token、不写文件。'),
            h('div', { 'data-cc-note': '' }, wallStatusLine)),

          h('div', { 'data-cc-sec': '' },
            h('div', { 'data-cc-h': '' }, '裁剪与时机'),
            h('div', { 'data-cc-grid': '' },
              h(NumberField, {
                label: 'maxLines',
                value: draft.maxLines,
                min: 0,
                disabled: !writable,
                onChange: function (value) { setDraft(Object.assign({}, draft, { maxLines: Number(value) || 0 })) },
              }),
              h(NumberField, {
                label: 'maxLinesPerSource',
                value: draft.maxLinesPerSource,
                min: 0,
                disabled: !writable,
                onChange: function (value) { setDraft(Object.assign({}, draft, { maxLinesPerSource: Number(value) || 0 })) },
                note: '0 = 按来源公平分配',
              }),
              h(NumberField, {
                label: 'staleMaxLines',
                value: draft.staleMaxLines,
                min: 0,
                disabled: !writable,
                onChange: function (value) { setDraft(Object.assign({}, draft, { staleMaxLines: Number(value) || 0 })) },
                note: '额外附在末尾',
              }),
              h(NumberField, {
                label: 'maxChars',
                value: draft.maxChars,
                min: 0,
                disabled: !writable,
                onChange: function (value) { setDraft(Object.assign({}, draft, { maxChars: Number(value) || 0 })) },
                note: '整段硬上限',
              }),
              h(NumberField, {
                label: 'lineMaxChars',
                value: draft.lineMaxChars,
                min: 1,
                disabled: !writable,
                onChange: function (value) { setDraft(Object.assign({}, draft, { lineMaxChars: Number(value) || 1 })) },
              }),
              h(NumberField, {
                label: 'everyNTurns',
                value: draft.everyNTurns,
                min: 0,
                disabled: !writable || draft.injectAt !== 'every-n-turns',
                onChange: function (value) { setDraft(Object.assign({}, draft, { everyNTurns: Number(value) || 0 })) },
                note: '仅 every-n-turns 时生效',
              })),
            h('label', { 'data-cc-sec': '' },
              h('span', { 'data-cc-label': '' }, '注入时机'),
              h('select', {
                'data-cc-input': '',
                value: draft.injectAt,
                disabled: !writable,
                onChange: function (event) { setDraft(Object.assign({}, draft, { injectAt: event.target.value })) },
              },
                h('option', { value: 'session-start' }, '会话首轮一次（默认）'),
                h('option', { value: 'every-n-turns' }, '每 N 轮一次（长会话备用）'))),
            h('div', { 'data-cc-row': '' },
              h('span', { 'data-cc-label': '' }, '显示过期条目'),
              h(Switch, {
                on: draft.showStale !== false,
                disabled: !writable,
                onChange: function (value) { setDraft(Object.assign({}, draft, { showStale: value })) },
              }),
              h('span', { 'data-cc-note': '' }, '过期条目会带 ⚠️stale 前缀')),
            h('label', { 'data-cc-sec': '' },
              h('span', { 'data-cc-label': '' }, '目录标题行'),
              h('input', {
                'data-cc-input': '',
                value: draft.header || '',
                disabled: !writable,
                onChange: function (event) { setDraft(Object.assign({}, draft, { header: event.target.value })) },
              }))),

          h('div', { 'data-cc-row': '' },
            h('button', { 'data-cc-btn': '', 'data-primary': '', disabled: Boolean(busy), onClick: onPreview }, '预览'),
            h('button', { 'data-cc-btn': '', disabled: Boolean(busy) || !writable, onClick: onSave }, '保存'),
            h('button', { 'data-cc-btn': '', disabled: Boolean(busy), onClick: load }, '重新读取'),
            msg ? h('div', { 'data-cc-msg': '', 'data-warn': msg.tone === 'warn' ? '' : undefined, 'data-good': msg.tone === 'good' ? '' : undefined }, msg.text) : null),

          h('div', { 'data-cc-sec': '' },
            h('div', { 'data-cc-h': '' }, '注入预览'),
            h('div', { 'data-cc-note': '' },
              preview ? ('目录将注入 ' + preview.lines + ' 行；读到 ' + preview.rowCount + ' 条。') : '还没有预览。'),
            h('pre', { 'data-cc-pre': '' }, preview && preview.text ? preview.text : '（空：一行都取不到时整段不注入）'),
            preview && preview.nudge && preview.nudge.block
              ? h('pre', { 'data-cc-pre': '' }, preview.nudge.block)
              : null,
            preview && preview.notes && preview.notes.length
              ? h('div', { 'data-cc-note': '' }, preview.notes.join(' / '))
              : null),

          h('div', { 'data-cc-sec': '' },
            h('div', { 'data-cc-h': '' }, '给模型的说明书（复制到 AGENTS.md）'),
            h('div', { 'data-cc-note': '' },
              'AGENTS.md：' + (onboarding.agentsPath || '（未知）') + ' · '
                + (onboarding.agentsExists ? ('已存在 · ' + fmtBytes(onboarding.agentsBytes)) : '不存在'),
              h('br'),
              '插件不会创建或修改这个文件；这里只提供可复制的文本。'),
            h('pre', { 'data-cc-pre': '' }, state.snippet || ''),
            h('div', { 'data-cc-row': '' },
              h('button', { 'data-cc-btn': '', onClick: copySnippet }, '复制片段'),
              copied ? h('span', { 'data-cc-note': '' }, copied) : null)),

          !writable
            ? h('div', { 'data-cc-msg': '', 'data-warn': '' },
              '当前宿主没有可写的设置服务。请直接编辑配置文件：' + state.configPath)
            : null)
      }

      return {
        inject: ['slots'],
        apply: function (ctx) {
          var style = document.createElement('style')
          style.setAttribute('data-plugin-css', 'dsh-cardcatalog')
          style.textContent = CSS
          document.head.appendChild(style)
          ctx.effect(function () { return function () { style.remove() } }, 'cardcatalog: settings css')

          var slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
          if (!slots || typeof slots.inject !== 'function') return

          // 没有可写设置服务时不注册面板（避免一个只能看的“设置页”骗人）。
          jget('/state').then(function (payload) {
            if (payload && payload.settingsAvailable === false) return
            slots.inject('settings.section', function () {
              return slots.register(
                { name: 'settings.section', id: 'cardcatalog', order: 30, label: '目录卡' },
                function () { return h(Panel) },
              )
            })
          }).catch(function () {
            // 宿主没有接口时安静跳过，host 半端不受影响。
          })
        },
      }
    },
  })
})()
