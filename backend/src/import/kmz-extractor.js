import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { AppError } from '../errors.js'

const ALLOWED_RESOURCE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

export async function extractKmzArchive(archivePath, workspace, limits) {
  const archive = await openArchive(archivePath)
  const kmlFiles = []
  const resources = []
  const ignoredEntries = []
  let entryCount = 0
  let totalExtractedSize = 0

  try {
    await new Promise((resolve, reject) => {
      let settled = false

      const fail = (error) => {
        if (settled) return
        settled = true
        archive.close()
        reject(error)
      }

      archive.on('error', (error) => fail(archiveError(error)))
      archive.on('end', () => {
        if (settled) return
        settled = true
        resolve()
      })
      archive.on('entry', async (entry) => {
        try {
          entryCount += 1
          if (entryCount > limits.maxArchiveEntries) {
            throw new AppError('Jumlah file dalam KMZ melebihi batas.', {
              code: 'kmz_too_many_entries',
              statusCode: 422,
              details: { maxArchiveEntries: limits.maxArchiveEntries },
            })
          }
          if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
            throw new AppError('KMZ terenkripsi tidak dapat diproses.', {
              code: 'encrypted_kmz',
              statusCode: 422,
            })
          }

          const safeRelativePath = validateArchiveEntryPath(entry.fileName)
          if (safeRelativePath.endsWith('/')) {
            archive.readEntry()
            return
          }

          totalExtractedSize += entry.uncompressedSize
          if (totalExtractedSize > limits.maxExtractedSize) {
            throw new AppError('Total ukuran hasil ekstraksi KMZ melebihi batas.', {
              code: 'kmz_extracted_size_exceeded',
              statusCode: 422,
              details: { maxExtractedSize: limits.maxExtractedSize },
            })
          }
          const ratio = entry.compressedSize === 0
            ? (entry.uncompressedSize > 0 ? Number.POSITIVE_INFINITY : 1)
            : entry.uncompressedSize / entry.compressedSize
          if (ratio > limits.maxCompressionRatio) {
            throw new AppError('KMZ ditolak karena rasio kompresi tidak aman.', {
              code: 'kmz_compression_ratio_exceeded',
              statusCode: 422,
              details: { maxCompressionRatio: limits.maxCompressionRatio },
            })
          }

          const extension = path.extname(safeRelativePath).toLowerCase()
          const isKml = extension === '.kml'
          const isResource = ALLOWED_RESOURCE_EXTENSIONS.has(extension)
          if (!isKml && !isResource) {
            ignoredEntries.push(safeRelativePath)
            archive.readEntry()
            return
          }

          const target = resolveWorkspaceTarget(workspace, safeRelativePath)
          await mkdir(path.dirname(target), { recursive: true })
          const source = await openEntryStream(archive, entry)
          await pipeline(source, createWriteStream(target, { flags: 'wx' }))

          if (isKml) {
            kmlFiles.push({
              relativePath: safeRelativePath,
              absolutePath: target,
              size: entry.uncompressedSize,
            })
          } else {
            resources.push({
              relativePath: safeRelativePath,
              size: entry.uncompressedSize,
              extension,
            })
          }
          archive.readEntry()
        } catch (error) {
          fail(error)
        }
      })

      archive.readEntry()
    })
  } catch (error) {
    if (error instanceof AppError) throw error
    throw archiveError(error)
  }

  if (!kmlFiles.length) {
    throw new AppError('KMZ tidak berisi file KML.', {
      code: 'kmz_without_kml',
      statusCode: 422,
    })
  }

  return {
    kmlFiles,
    resources,
    ignoredEntries,
    entryCount,
    totalExtractedSize,
  }
}

export function validateArchiveEntryPath(entryName) {
  const normalized = String(entryName ?? '').replace(/\\/g, '/')
  if (
    !normalized
    || normalized.includes('\u0000')
    || normalized.startsWith('/')
    || /^[a-zA-Z]:/.test(normalized)
  ) {
    throw new AppError('KMZ memuat path file yang tidak aman.', {
      code: 'kmz_unsafe_path',
      statusCode: 422,
    })
  }

  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '..')) {
    throw new AppError('KMZ terindikasi melakukan zip slip.', {
      code: 'kmz_zip_slip',
      statusCode: 422,
    })
  }
  const safe = path.posix.normalize(normalized)
  if (safe === '..' || safe.startsWith('../')) {
    throw new AppError('KMZ terindikasi melakukan zip slip.', {
      code: 'kmz_zip_slip',
      statusCode: 422,
    })
  }
  return safe
}

export function orderKmlCandidates(kmlFiles) {
  return [...kmlFiles].sort((left, right) => {
    const leftPriority = candidatePriority(left.relativePath)
    const rightPriority = candidatePriority(right.relativePath)
    if (leftPriority !== rightPriority) return leftPriority - rightPriority
    return left.relativePath.localeCompare(right.relativePath, 'en', {
      sensitivity: 'base',
    })
  })
}

function candidatePriority(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase()
  if (normalized === 'doc.kml') return 0
  if (path.posix.basename(normalized) === 'doc.kml') return 1
  return 2
}

function resolveWorkspaceTarget(workspace, relativePath) {
  const root = path.resolve(workspace)
  const target = path.resolve(root, ...relativePath.split('/'))
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('Target ekstraksi berada di luar temporary directory.', {
      code: 'kmz_zip_slip',
      statusCode: 422,
    })
  }
  return target
}

function openArchive(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, {
      lazyEntries: true,
      autoClose: false,
      decodeStrings: true,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (error, archive) => {
      if (error) reject(archiveError(error))
      else resolve(archive)
    })
  })
}

function openEntryStream(archive, entry) {
  return new Promise((resolve, reject) => {
    archive.openReadStream(entry, (error, stream) => {
      if (error) reject(archiveError(error))
      else resolve(stream)
    })
  })
}

function archiveError(error) {
  return new AppError('Archive KMZ rusak atau tidak dapat dibaca.', {
    code: 'corrupt_kmz',
    statusCode: 422,
    cause: error,
  })
}
