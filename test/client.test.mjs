import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function load(requireImpl) {
  let module
  const window = {
    __ModuleLoader__: {
      load(definition) {
        module = definition.factory(requireImpl)
      },
    },
  }
  const context = {
    window,
    document: { createElement: () => ({ setAttribute() {}, remove() {} }), head: { appendChild() {} } },
    console,
    fetch: async () => ({ ok: true, json: async () => ({ settingsAvailable: false }) }),
    setTimeout,
    clearTimeout,
  }
  vm.runInNewContext(SOURCE, context, { filename: 'client.js' })
  return module
}

test('client 半端：有 react 时注册 slots，取不到 react 时安静跳过', () => {
  const react = {
    createElement: () => null,
    useState: (value) => [value, () => {}],
    useEffect: () => {},
  }
  const loaded = load((name) => {
    if (name === 'react') return react
    throw new Error('not found')
  })
  assert.equal(loaded.inject.length, 1)
  assert.equal(loaded.inject[0], 'slots')
  assert.equal(typeof loaded.apply, 'function')

  const skipped = load(() => {
    throw new Error('missing')
  })
  assert.equal(skipped.inject.length, 0)
  assert.equal(typeof skipped.apply, 'function')
})
