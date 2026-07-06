import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { serializeFormData, deserializeToFormData, isSerializedForm } from './formSerialize.js'
import { createMemoryStore } from './memoryStore.js'
import { listReplayable } from './outbox.js'
import { offlineMutateForm } from './index.js'

describe('formSerialize round-trip', () => {
  it('preserves text fields and file bytes', async () => {
    const fd = new FormData()
    fd.append('kind', 'NOR')
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 65, 66])
    fd.append('files', new File([bytes], 'nor.pdf', { type: 'application/pdf' }))

    const serialized = await serializeFormData(fd)
    assert.equal(isSerializedForm(serialized), true)

    const rebuilt = deserializeToFormData(serialized)
    assert.equal(rebuilt.get('kind'), 'NOR')
    const file = rebuilt.get('files')
    assert.equal(file.name, 'nor.pdf')
    assert.equal(file.type, 'application/pdf')
    const outBytes = new Uint8Array(await file.arrayBuffer())
    assert.deepEqual([...outBytes], [...bytes])
  })

  it('handles multiple files', async () => {
    const fd = new FormData()
    fd.append('files', new File([new Uint8Array([1, 2])], 'a.txt', { type: 'text/plain' }))
    fd.append('files', new File([new Uint8Array([3, 4, 5])], 'b.txt', { type: 'text/plain' }))
    const rebuilt = deserializeToFormData(await serializeFormData(fd))
    const all = rebuilt.getAll('files')
    assert.equal(all.length, 2)
    assert.equal(all[1].name, 'b.txt')
    assert.deepEqual([...new Uint8Array(await all[1].arrayBuffer())], [3, 4, 5])
  })

  it('isSerializedForm is false for plain bodies', () => {
    assert.equal(isSerializedForm({ a: 1 }), false)
    assert.equal(isSerializedForm(null), false)
  })
})

describe('offlineMutateForm seam', () => {
  const policies = [{ match: /^\/operation-documents\/operations\//, write: 'outbox', entity: 'operation-document' }]
  const path = '/operation-documents/operations/9/NOR'

  it('queues the upload as a serialized form when offline', async () => {
    const store = createMemoryStore()
    const fd = new FormData()
    fd.append('files', new File([new Uint8Array([9, 9, 9])], 'nor.pdf', { type: 'application/pdf' }))

    let fetched = 0
    const out = await offlineMutateForm(path, 1, fd, async () => { fetched++ }, {
      isNative: () => true,
      getOnline: async () => false,
      store,
      newId: () => 'form-1',
      policies,
    })
    assert.equal(out.queued, true)
    assert.equal(fetched, 0)
    const [row] = await listReplayable(store)
    assert.equal(row.isForm, true)
    assert.equal(row.body.__form, true)
    assert.equal(row.entity, 'operation-document')
  })

  it('web (non-native) uploads straight through', async () => {
    let fetched = 0
    await offlineMutateForm(path, 1, new FormData(), async () => { fetched++ }, { isNative: () => false })
    assert.equal(fetched, 1)
  })

  it('online uploads immediately (no queue)', async () => {
    const store = createMemoryStore()
    let fetched = 0
    await offlineMutateForm(path, 1, new FormData(), async () => { fetched++ }, {
      isNative: () => true,
      getOnline: async () => true,
      store,
      policies,
    })
    assert.equal(fetched, 1)
    assert.equal((await listReplayable(store)).length, 0)
  })
})
