import { open } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../errors.js'

const MIME_TYPES = {
  '.kml': new Set([
    'application/vnd.google-earth.kml+xml',
    'application/xml',
    'text/xml',
  ]),
  '.kmz': new Set([
    'application/vnd.google-earth.kmz',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
  ]),
}

export function validateBranchId(branchId, allowedBranchIds) {
  const normalized = String(branchId ?? '').trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(normalized)) {
    throw new AppError('Kantor cabang tidak valid.', {
      code: 'invalid_branch',
      statusCode: 400,
    })
  }
  if (!allowedBranchIds.includes(normalized)) {
    throw new AppError('Kantor cabang tidak tersedia atau tidak diizinkan.', {
      code: 'branch_not_allowed',
      statusCode: 400,
    })
  }
  return normalized
}

export function sanitizeSourceFilename(filename) {
  const raw = String(filename ?? '').normalize('NFKC').trim()
  if (!raw) {
    throw new AppError('Nama file sumber wajib tersedia.', {
      code: 'missing_filename',
      statusCode: 400,
    })
  }

  const basename = path.win32.basename(raw.replace(/\//g, '\\'))
  const sanitized = basename
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 180)
    .trim()

  if (!sanitized) {
    throw new AppError('Nama file sumber tidak valid.', {
      code: 'invalid_filename',
      statusCode: 400,
    })
  }
  return sanitized
}

export async function validateUploadedFile({
  filePath,
  filename,
  mimeType,
  size,
  maxFileSize,
}) {
  const sourceFilename = sanitizeSourceFilename(filename)
  const extension = path.extname(sourceFilename).toLowerCase()
  if (!MIME_TYPES[extension]) {
    throw new AppError('Hanya file KML atau KMZ yang dapat diunggah.', {
      code: 'unsupported_file_extension',
      statusCode: 415,
    })
  }
  const normalizedMimeType = String(mimeType ?? '').split(';')[0].trim().toLowerCase()
  if (!MIME_TYPES[extension].has(normalizedMimeType)) {
    throw new AppError('MIME type file tidak sesuai dengan KML/KMZ.', {
      code: 'invalid_mime_type',
      statusCode: 415,
      details: { extension, mimeType: normalizedMimeType },
    })
  }
  if (!Number.isInteger(size) || size <= 0) {
    throw new AppError('File sumber kosong.', {
      code: 'empty_upload',
      statusCode: 400,
    })
  }
  if (size > maxFileSize) {
    throw new AppError('Ukuran file melebihi batas upload.', {
      code: 'file_too_large',
      statusCode: 413,
      details: { maxFileSize },
    })
  }

  const signature = await readSignature(filePath)
  if (extension === '.kmz' && !isZipSignature(signature)) {
    throw new AppError('Isi file KMZ bukan archive ZIP yang valid.', {
      code: 'invalid_kmz_signature',
      statusCode: 415,
    })
  }
  if (extension === '.kml' && !looksLikeXml(signature)) {
    throw new AppError('Isi file KML bukan dokumen XML yang valid.', {
      code: 'invalid_kml_signature',
      statusCode: 415,
    })
  }

  return {
    sourceFilename,
    extension,
    sourceMimeType: normalizedMimeType,
  }
}

async function readSignature(filePath) {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(512)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function isZipSignature(buffer) {
  return buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && (
      (buffer[2] === 0x03 && buffer[3] === 0x04)
      || (buffer[2] === 0x05 && buffer[3] === 0x06)
      || (buffer[2] === 0x07 && buffer[3] === 0x08)
    )
}

function looksLikeXml(buffer) {
  const text = buffer
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .toLowerCase()
  return text.startsWith('<?xml') || text.startsWith('<kml') || text.startsWith('<')
}
