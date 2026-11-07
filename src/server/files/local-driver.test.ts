import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createBlobDriver } from './blob-driver'
import { createLocalDriver, localUploadUrl } from './local-driver'
import { getStorage } from './storage'

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const out: number[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(...value)
  }
  return Uint8Array.from(out)
}

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill)

describe('local driver', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'clasync-local-driver-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('local driver refuses keys with .. and absolute paths', async () => {
    const driver = createLocalDriver(dir)
    const bad = [
      '../outside.pdf',
      'assignments/../../outside.pdf',
      'assignments/a/..',
      '/etc/passwd',
      'C:/windows/win.ini',
      'assignments\\a\\b.pdf',
      './a.pdf',
      'a//b.pdf',
      '',
      'a/b\0.pdf',
    ]
    for (const key of bad) {
      await expect(driver.stat(key), key).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(driver.read(key), key).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(driver.remove(key), key).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(driver.uploadTarget(key, 'application/pdf'), key).rejects.toMatchObject({ code: 'VALIDATION' })
      await expect(driver.write(key, streamOf(bytes(3)), 3), key).rejects.toMatchObject({ code: 'VALIDATION' })
    }
    // Nothing was written anywhere near the upload root.
    expect(await readdir(dir)).toEqual([])
  })

  it('writes, stats, reads and removes an object', async () => {
    const driver = createLocalDriver(dir)
    const key = 'assignments/a1/f1-notes.pdf'
    expect(await driver.stat(key)).toBeNull()
    expect(await driver.write(key, streamOf(bytes(5, 1), bytes(4, 2)), 9)).toEqual({ ok: true, size: 9 })
    expect(await driver.stat(key)).toEqual({ size: 9 })
    expect(Array.from(await readAll(await driver.read(key)))).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2])
    await driver.remove(key)
    expect(await driver.stat(key)).toBeNull()
    // Removing a missing object is not an error.
    await driver.remove(key)
  })

  it('reading a missing object is NOT_FOUND', async () => {
    const driver = createLocalDriver(dir)
    await expect(driver.read('assignments/none/missing.pdf')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('stops an over-size write, leaving neither the object nor a temp file', async () => {
    const driver = createLocalDriver(dir)
    const key = 'submissions/a1/s1/f2-big.pdf'
    expect(await driver.write(key, streamOf(bytes(6), bytes(6)), 10)).toEqual({ ok: false, reason: 'too_large' })
    expect(await driver.stat(key)).toBeNull()
    expect(await readdir(path.join(dir, 'submissions/a1/s1'))).toEqual([])
  })

  it('replaces an object atomically (an earlier version stays until the new one is complete)', async () => {
    const driver = createLocalDriver(dir)
    const key = 'assignments/a2/f3-x.pdf'
    await driver.write(key, streamOf(bytes(3, 1)), 3)
    // A failing body: the old object must survive and no temp file is left behind.
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection dropped'))
      },
    })
    await expect(driver.write(key, failing, 3)).rejects.toThrow('connection dropped')
    expect(Array.from(await readAll(await driver.read(key)))).toEqual([1, 1, 1])
    expect(await readdir(path.join(dir, 'assignments/a2'))).toEqual(['f3-x.pdf'])

    // A commit guard that says no discards the new bytes and keeps the old object.
    expect(await driver.write(key, streamOf(bytes(3, 9)), 3, async () => false)).toEqual({ ok: false, reason: 'aborted' })
    expect(Array.from(await readAll(await driver.read(key)))).toEqual([1, 1, 1])
    expect(await readdir(path.join(dir, 'assignments/a2'))).toEqual(['f3-x.pdf'])
  })

  it('upload target is a PUT to the local upload route with each segment encoded', async () => {
    const driver = createLocalDriver(dir)
    expect(await driver.uploadTarget('assignments/a1/f1-my notes é.pdf', 'application/pdf')).toEqual({
      kind: 'local',
      url: '/api/uploads/local/assignments/a1/f1-my%20notes%20%C3%A9.pdf',
      method: 'PUT',
    })
    expect(localUploadUrl('a/b')).toBe('/api/uploads/local/a/b')
  })
})

describe('blob driver (no network)', () => {
  it('upload target hands the browser the pathname and the token endpoint', async () => {
    const driver = createBlobDriver()
    expect(driver.kind).toBe('blob')
    expect(await driver.uploadTarget('assignments/a1/f1-notes.pdf', 'application/pdf')).toEqual({
      kind: 'blob',
      pathname: 'assignments/a1/f1-notes.pdf',
      handleUploadUrl: '/api/uploads/blob',
    })
  })
})

describe('getStorage', () => {
  const saved = { ...process.env }
  afterEach(() => {
    for (const k of ['STORAGE_DRIVER', 'BLOB_READ_WRITE_TOKEN', 'NODE_ENV', 'LOCAL_UPLOAD_DIR']) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })
  function setEnv(env: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }

  it('defaults to local outside production without a blob token', () => {
    setEnv({ STORAGE_DRIVER: undefined, BLOB_READ_WRITE_TOKEN: undefined, NODE_ENV: 'development' })
    expect(getStorage().kind).toBe('local')
  })
  it('defaults to blob in production or when a blob token is set', () => {
    setEnv({ STORAGE_DRIVER: undefined, BLOB_READ_WRITE_TOKEN: undefined, NODE_ENV: 'production' })
    expect(getStorage().kind).toBe('blob')
    setEnv({ NODE_ENV: 'development', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x_y' })
    expect(getStorage().kind).toBe('blob')
  })
  it('STORAGE_DRIVER wins; anything else is a configuration error', () => {
    setEnv({ STORAGE_DRIVER: 'local', NODE_ENV: 'production' })
    expect(getStorage().kind).toBe('local')
    setEnv({ STORAGE_DRIVER: 'blob', NODE_ENV: 'development' })
    expect(getStorage().kind).toBe('blob')
    setEnv({ STORAGE_DRIVER: 's3' })
    expect(() => getStorage()).toThrow(/STORAGE_DRIVER/)
  })
})
