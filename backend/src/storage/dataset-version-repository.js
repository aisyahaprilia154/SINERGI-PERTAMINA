import { createHash } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../errors.js'

export class JsonDatasetVersionRepository {
  constructor(rootDirectory, {
    activationHooks = {},
    staleLockMilliseconds = 5 * 60 * 1000,
  } = {}) {
    this.rootDirectory = path.resolve(rootDirectory)
    this.activePointerDirectory = path.join(this.rootDirectory, '.active')
    this.activationLockDirectory = path.join(this.rootDirectory, '.locks')
    this.activationHooks = activationHooks
    this.staleLockMilliseconds = staleLockMilliseconds
  }

  async create(record) {
    await mkdir(this.rootDirectory, { recursive: true })
    const target = this.#pathFor(record.datasetVersion.id)
    try {
      await writeFile(target, JSON.stringify(record, null, 2), {
        encoding: 'utf8',
        flag: 'wx',
      })
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new AppError('Dataset version sudah tersedia.', {
          code: 'dataset_version_exists',
          statusCode: 409,
        })
      }
      throw error
    }
    return structuredClone(record)
  }

  async get(id) {
    assertSafeId(id)
    try {
      return JSON.parse(await readFile(this.#pathFor(id), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new AppError('Dataset version tidak ditemukan.', {
          code: 'dataset_version_not_found',
          statusCode: 404,
        })
      }
      throw error
    }
  }

  async list() {
    await mkdir(this.rootDirectory, { recursive: true })
    const entries = await readdir(this.rootDirectory, { withFileTypes: true })
    const records = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      records.push(JSON.parse(await readFile(
        path.join(this.rootDirectory, entry.name),
        'utf8',
      )))
    }
    return records
  }

  async findActive(datasetId, { excludeId } = {}) {
    const resolved = await this.resolveActiveVersion({ datasetId })
    if (resolved && resolved.record.datasetVersion.id !== excludeId) {
      return resolved.record
    }
    return null
  }

  /**
   * The pointer is the sole publication boundary for map, inventory, relation,
   * detail, and export consumers. Version status fields are descriptive only.
   */
  async resolveActiveVersion({
    datasetId,
    branchId,
    allowLegacyDuringActivation = false,
  } = {}) {
    assertDatasetContext(datasetId)
    const pointer = await this.#readActivePointer(datasetId)
    if (pointer) {
      const record = await this.get(pointer.datasetVersionId)
      assertPointerIntegrity(pointer, record, { datasetId, branchId })
      return {
        pointer: structuredClone(pointer),
        record,
      }
    }

    // Never expose status-only data while the first pointer transaction is open.
    if (!allowLegacyDuringActivation && await this.#activationLockExists(datasetId)) {
      return null
    }

    // Compatibility path for records created before active pointers existed.
    const legacyActive = (await this.list()).filter((record) => (
      record.datasetVersion.datasetId === datasetId
      && (!branchId || record.datasetVersion.branchId === branchId)
      && record.datasetVersion.status === 'active'
    ))
    if (legacyActive.length > 1) {
      throw new AppError('Ditemukan lebih dari satu dataset version aktif.', {
        code: 'active_version_integrity_error',
        statusCode: 409,
      })
    }
    if (!legacyActive.length) return null
    return {
      pointer: {
        datasetId,
        branchId: legacyActive[0].datasetVersion.branchId,
        datasetVersionId: legacyActive[0].datasetVersion.id,
        revision: 'legacy',
      },
      record: legacyActive[0],
    }
  }

  async activateVersionAtomically({
    datasetVersionId,
    actorId,
    activatedAt,
    expectedActiveVersionId,
    validateTarget,
  }) {
    const initialTarget = await this.get(datasetVersionId)
    const { datasetId, branchId } = initialTarget.datasetVersion
    return this.#withActivationLock(datasetId, async () => {
      // Re-read and re-validate after acquiring the lock to prevent TOCTOU.
      const target = await this.get(datasetVersionId)
      if (target.datasetVersion.datasetId !== datasetId
        || target.datasetVersion.branchId !== branchId) {
        throw new AppError('Konteks dataset version berubah saat aktivasi.', {
          code: 'activation_context_changed',
          statusCode: 409,
        })
      }
      if (target.datasetVersion.status === 'active') {
        throw new AppError('Dataset version ini sudah aktif.', {
          code: 'dataset_version_already_active',
          statusCode: 409,
        })
      }
      await validateTarget(structuredClone(target))

      const resolved = await this.resolveActiveVersion({
        datasetId,
        branchId,
        allowLegacyDuringActivation: true,
      })
      const previous = resolved?.record ?? null
      const previousVersionId = previous?.datasetVersion.id ?? null
      if (expectedActiveVersionId !== undefined
        && expectedActiveVersionId !== previousVersionId) {
        throw new AppError(
          'Dataset aktif telah berubah sejak preview dimuat. Muat ulang sebelum aktivasi.',
          {
            code: 'stale_activation_request',
            statusCode: 409,
            details: {
              expectedActiveVersionId,
              currentActiveVersionId: previousVersionId,
            },
          },
        )
      }
      if (resolved?.pointer.revision === 'legacy') {
        await this.#writeActivePointer({
          schemaVersion: '1.0.0',
          datasetId,
          branchId,
          datasetVersionId: previousVersionId,
          previousVersionId: null,
          activatedBy: previous.datasetVersion.activatedBy ?? null,
          activatedAt: previous.datasetVersion.activatedAt ?? null,
          revision: crypto.randomUUID(),
          migratedFromLegacyStatus: true,
        })
      }

      const datasetRecords = (await this.list()).filter((record) => (
        record.datasetVersion.datasetId === datasetId
        && record.datasetVersion.branchId === branchId
      ))
      const recordsToArchive = uniqueRecords([
        ...datasetRecords.filter((record) => (
          record.datasetVersion.status === 'active'
          && record.datasetVersion.id !== datasetVersionId
        )),
        ...(previous && previous.datasetVersion.id !== datasetVersionId ? [previous] : []),
      ])
      const snapshots = new Map([
        [target.datasetVersion.id, target],
        ...recordsToArchive.map((record) => [record.datasetVersion.id, record]),
      ])
      let archivedRecords = []

      try {
        archivedRecords = await Promise.all(recordsToArchive.map((record) => (
          this.update(record.datasetVersion.id, (current) => ({
            ...current,
            datasetVersion: {
              ...current.datasetVersion,
              status: 'archived',
              publicationStatus: 'archived',
              archivedAt: activatedAt,
              archivedBy: actorId,
            },
          }))
        )))
        const activated = await this.update(datasetVersionId, (current) => ({
          ...current,
          datasetVersion: {
            ...current.datasetVersion,
            status: 'active',
            publicationStatus: 'published',
            activatedBy: actorId,
            activatedAt,
          },
        }))

        await this.activationHooks.beforePointerCommit?.({
          datasetId,
          branchId,
          previousVersionId,
          newVersionId: datasetVersionId,
        })
        const pointer = {
          schemaVersion: '1.0.0',
          datasetId,
          branchId,
          datasetVersionId,
          previousVersionId,
          activatedBy: actorId,
          activatedAt,
          revision: crypto.randomUUID(),
        }
        await this.#writeActivePointer(pointer)
        return {
          activated,
          archivedRecords,
          previous,
          pointer,
        }
      } catch (error) {
        try {
          for (const [id, snapshot] of snapshots) {
            await this.update(id, () => snapshot)
          }
        } catch (rollbackError) {
          throw new AppError('Rollback transaksi aktivasi gagal.', {
            code: 'activation_rollback_failed',
            statusCode: 500,
            details: {
              datasetId,
              branchId,
              previousVersionId,
              newVersionId: datasetVersionId,
              cause: rollbackError.code ?? rollbackError.name,
            },
          })
        }
        error.activationContext = {
          datasetId,
          branchId,
          previousVersionId,
          newVersionId: datasetVersionId,
        }
        throw error
      }
    })
  }

  async update(id, updater) {
    const current = await this.get(id)
    const next = typeof updater === 'function'
      ? await updater(structuredClone(current))
      : { ...current, ...updater }
    const target = this.#pathFor(id)
    const temporary = `${target}.${crypto.randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(next, null, 2), 'utf8')
    await rename(temporary, target)
    return structuredClone(next)
  }

  async #withActivationLock(datasetId, operation, staleLockRetried = false) {
    await mkdir(this.activationLockDirectory, { recursive: true })
    const lockPath = this.#activationLockPath(datasetId)
    const token = crypto.randomUUID()
    try {
      await writeFile(lockPath, JSON.stringify({
        token,
        datasetId,
        acquiredAt: new Date().toISOString(),
      }), {
        encoding: 'utf8',
        flag: 'wx',
      })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (!staleLockRetried && await this.#isStaleLock(lockPath)) {
        await unlink(lockPath).catch(() => {})
        return this.#withActivationLock(datasetId, operation, true)
      }
      throw new AppError('Aktivasi dataset lain sedang berlangsung.', {
        code: 'activation_in_progress',
        statusCode: 409,
        details: { datasetId },
      })
    }

    try {
      return await operation()
    } finally {
      const lock = await readJsonFile(lockPath).catch(() => null)
      if (lock?.token === token) await unlink(lockPath).catch(() => {})
    }
  }

  async #isStaleLock(lockPath) {
    try {
      const info = await stat(lockPath)
      return Date.now() - info.mtimeMs > this.staleLockMilliseconds
    } catch {
      return false
    }
  }

  async #activationLockExists(datasetId) {
    try {
      await stat(this.#activationLockPath(datasetId))
      return true
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  }

  async #readActivePointer(datasetId) {
    try {
      return await readJsonFile(this.#activePointerPath(datasetId))
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  async #writeActivePointer(pointer) {
    await mkdir(this.activePointerDirectory, { recursive: true })
    const target = this.#activePointerPath(pointer.datasetId)
    const temporary = `${target}.${crypto.randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(pointer, null, 2), 'utf8')
    await rename(temporary, target)
  }

  #activePointerPath(datasetId) {
    return path.join(this.activePointerDirectory, `${datasetKey(datasetId)}.json`)
  }

  #activationLockPath(datasetId) {
    return path.join(this.activationLockDirectory, `${datasetKey(datasetId)}.lock`)
  }

  #pathFor(id) {
    assertSafeId(id)
    return path.join(this.rootDirectory, `${id}.json`)
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

function datasetKey(datasetId) {
  return createHash('sha256').update(String(datasetId)).digest('hex')
}

function assertDatasetContext(datasetId) {
  if (!String(datasetId ?? '').trim()) {
    throw new AppError('Dataset ID wajib tersedia.', {
      code: 'invalid_dataset_id',
      statusCode: 400,
    })
  }
}

function assertPointerIntegrity(pointer, record, { datasetId, branchId }) {
  if (pointer.datasetId !== datasetId
    || record.datasetVersion.datasetId !== datasetId
    || pointer.datasetVersionId !== record.datasetVersion.id
    || pointer.branchId !== record.datasetVersion.branchId
    || (branchId && pointer.branchId !== branchId)) {
    throw new AppError('Pointer dataset aktif tidak konsisten.', {
      code: 'active_pointer_integrity_error',
      statusCode: 409,
    })
  }
}

function uniqueRecords(records) {
  return [...new Map(
    records.map((record) => [record.datasetVersion.id, record]),
  ).values()]
}

function assertSafeId(id) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(String(id))) {
    throw new AppError('Identifier dataset version tidak valid.', {
      code: 'invalid_dataset_version_id',
      statusCode: 400,
    })
  }
}
