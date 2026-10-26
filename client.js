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
        '[data-cc-page]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 10px;max-width:680px;}',
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
        '[data-cc-pre]{margin:6px 0 0;padding:9px 10px;border-radius:8px;max-height:230px;overflow:auto;font-size:11px;',
        'line-height:16px;white-space:pre-wrap;word-break:break-word;',
        'background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.25));color:var(--dsw-alias-label-secondary,#c9ccd1);}',
        '[data-cc-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;',
        'background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}',
        '[data-cc-sw][data-on]{background:#3b82f6;}',
        '[data-cc-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;',
        'transition:left .15s;display:block;}',
        '[data-cc-sw][data-on] i{left:19px;}',
        '[data-cc-kv]{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a6);word-break:break-word;}',
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

        function adopt(payload) {
          if (!payload || !payload.config) return
          setState(payload)
          setDraft(payload.config)
          setSourcesText(JSON.stringify(payload.config.sources || [], null, 2))
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
          return {
            enabled: base.enabled !== false,
            sources: sources,
            injectAt: base.injectAt === 'every-n-turns' ? 'every-n-turns' : 'session-start',
            everyNTurns: Number(base.everyNTurns) || 0,
            maxLines: Number(base.maxLines) || 0,
            maxChars: Number(base.maxChars) || 0,
            lineMaxChars: Number(base.lineMaxChars) || 80,
            showStale: base.showStale !== false,
            header: typeof base.header === 'string' ? base.header : '',
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

        if (!state || !draft) {
          return h('div', { 'data-cc-page': '' },
            h('div', { 'data-cc-msg': '' }, busy === 'load' ? '读取设置中…' : '还没有读到设置。'),
            h('div', { 'data-cc-row': '' },
              h('button', { 'data-cc-btn': '', disabled: Boolean(busy), onClick: load }, '重新读取')))
        }

        var writable = state.settingsAvailable !== false

        return h('div', { 'data-cc-page': '' },
          h('div', { 'data-cc-sec': '' },
            h('div', { 'data-cc-h': '' }, '目录卡'),
            h('div', { 'data-cc-note': '' },
              '它只读你的账本，把标题投影成上下文；不存储、不检索、不写任何文件。',
              h('br'),
              '这里保存的是「怎么投影」的配置，不是记忆本身。'),
            h('div', { 'data-cc-kv': '' },
              '注入接缝：' + (state.seam === 'none' ? '当前不可用' : state.seam),
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

          h('div', { 'data-cc-sec': '' },
            h('div', { 'data-cc-h': '' }, '账本来源（sources）'),
            h('textarea', {
              'data-cc-input': '',
              rows: 10,
              spellCheck: false,
              value: sourcesText,
              onChange: function (event) { setSourcesText(event.target.value) },
              placeholder: '[]',
            }),
            h('div', { 'data-cc-note': '' },
              'JSON 数组。每项至少要有 id、kind、path；path 支持 ~ 和环境变量。',
              h('br'),
              '不配 sources ⇒ 什么都不注入。')),
          h('div', { 'data-cc-note': '' },
            'path 示例：~/.dsh/notes/facts.json（这里只是示例，不会替你创建文件）。'),

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
                label: 'maxChars',
                value: draft.maxChars,
                min: 0,
                disabled: !writable,
                onChange: function (value) { setDraft(Object.assign({}, draft, { maxChars: Number(value) || 0 })) },
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
              preview ? ('将注入 ' + preview.lines + ' 行；读到 ' + preview.rowCount + ' 条。') : '还没有预览。'),
            h('pre', { 'data-cc-pre': '' }, preview && preview.text ? preview.text : '（空：一行都取不到时整段不注入）'),
            preview && preview.notes && preview.notes.length
              ? h('div', { 'data-cc-note': '' }, preview.notes.join(' / '))
              : null),

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
