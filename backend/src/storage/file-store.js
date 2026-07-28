import { createHash } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  unlink,
} from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../errors.js'

export class ImportFileStore {
  constructor(dataRoot) {
    this.dataRoot = path.resolve(dataRoot)
    this.uploadRoot = path.join(this.dataRoot, 'temporary-uploads')
    this.workspaceRoot = path.join(this.dataRoot, 'workspaces')
    this.sourceRoot = path.join(this.dataRoot, 'source-files')
  }

  async initialize() {
    await Promise.all([
      mkdir(this.uploadRoot, { recursive: true }),
      mkdir(this.workspaceRoot, { recursive: true }),
      mkdir(this.sourceRoot, { recursive: true }),
    ])
  }

  async createTemporaryUpload() {
    await this.initialize()
    const filePath = path.join(this.uploadRoot, `${crypto.randomUUID()}.upload`)
    const handle = await open(filePath, 'wx')
    await handle.close()
    return filePath
  }

  async commitOriginal(temporaryPath, datasetVersionId, extension) {
    assertWorkspaceChild(this.uploadRoot, temporaryPath)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(datasetVersionId)) {
      throw new TypeError('datasetVersionId tidak aman untuk storage.')
    }
    if (!['.kml', '.kmz'].includes(extension)) {
      throw new TypeError('Extension file sumber tidak didukung.')
    }

    const versionDirectory = path.join(this.sourceRoot, datasetVersionId)
    await mkdir(versionDirectory, { recursive: true })
    const internalName = `source-${crypto.randomUUID()}${extension}`
    const target = path.join(versionDirectory, internalName)
    await copyFile(temporaryPath, target, 1)
    await unlink(temporaryPath)
    return {
      absolutePath: target,
      storageKey: path.relative(this.dataRoot, target).split(path.sep).join('/'),
    }
  }

  async createWorkspace() {
    await this.initialize()
    return mkdtemp(path.join(this.workspaceRoot, 'import-'))
  }

  async readVerifiedOriginal({
    storageKey,
    expectedSize,
    expectedChecksum,
  }) {
    if (!storageKey) {
      throw new AppError('File sumber asli tidak tersedia untuk dataset version ini.', {
        code: 'source_file_missing',
        statusCode: 404,
      })
    }
    const target = path.resolve(this.dataRoot, String(storageKey))
    try {
      assertWorkspaceChild(this.sourceRoot, target)
    } catch {
      throw new AppError('Referensi file sumber tidak valid.', {
        code: 'source_file_reference_invalid',
        statusCode: 409,
      })
    }

    let fileInfo
    try {
      fileInfo = await lstat(target)
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new AppError('File sumber asli sudah tidak tersedia.', {
          code: 'source_file_missing',
          statusCode: 404,
        })
      }
      throw error
    }
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new AppError('Referensi file sumber tidak valid.', {
        code: 'source_file_reference_invalid',
        statusCode: 409,
      })
    }
    if (Number.isInteger(expectedSize) && fileInfo.size !== expectedSize) {
      throw new AppError(
        'Integritas file sumber tidak dapat diverifikasi. Hubungi Administrator.',
        {
          code: 'source_file_integrity_failed',
          statusCode: 409,
        },
      )
    }
    const bytes = await readFile(target)
    const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if ((Number.isInteger(expectedSize) && bytes.length !== expectedSize)
      || (expectedChecksum && checksum !== expectedChecksum)) {
      throw new AppError(
        'Integritas file sumber tidak dapat diverifikasi. Hubungi Administrator.',
        {
          code: 'source_file_integrity_failed',
          statusCode: 409,
        },
      )
    }
    return {
      bytes,
      size: bytes.length,
      checksum,
    }
  }

  async removeTemporary(filePath) {
    if (!filePath) return
    assertWorkspaceChild(this.uploadRoot, filePath)
    await rm(filePath, { force: true })
  }

  async removeWorkspace(directory) {
    if (!directory) return
    assertWorkspaceChild(this.workspaceRoot, directory)
    await rm(directory, { recursive: true, force: true })
  }
}

function assertWorkspaceChild(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TypeError('Target storage berada di luar direktori yang diizinkan.')
  }
}
