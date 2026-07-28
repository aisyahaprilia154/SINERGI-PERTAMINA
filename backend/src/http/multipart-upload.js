import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { finished } from 'node:stream/promises'
import Busboy from 'busboy'
import { AppError } from '../errors.js'

export async function receiveImportUpload(request, {
  fileStore,
  maxFileSize,
}) {
  const contentType = request.headers['content-type']
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new AppError('Upload harus menggunakan multipart/form-data.', {
      code: 'invalid_content_type',
      statusCode: 415,
    })
  }

  const contentLength = Number(request.headers['content-length'])
  if (Number.isFinite(contentLength) && contentLength > maxFileSize + 1024 * 1024) {
    throw new AppError('Ukuran request melebihi batas upload.', {
      code: 'request_too_large',
      statusCode: 413,
    })
  }

  const temporaryPath = await fileStore.createTemporaryUpload()
  let upload
  try {
    upload = await consumeMultipart(request, {
      temporaryPath,
      maxFileSize,
    })
    return upload
  } catch (error) {
    await fileStore.removeTemporary(temporaryPath)
    throw error
  }
}

function consumeMultipart(request, { temporaryPath, maxFileSize }) {
  return new Promise((resolve, reject) => {
    let busboy
    try {
      busboy = Busboy({
        headers: request.headers,
        limits: {
          fileSize: maxFileSize,
          files: 1,
          fields: 8,
          parts: 10,
        },
      })
    } catch (error) {
      reject(new AppError('Multipart upload tidak valid.', {
        code: 'invalid_multipart',
        statusCode: 400,
        cause: error,
      }))
      return
    }

    const fields = {}
    let fileMetadata = null
    let filePromise = null
    let terminalError = null

    busboy.on('field', (name, value) => {
      if ([
        'branchId',
        'datasetId',
        'versionName',
        'versionNote',
        'officialSourceConfirmed',
      ].includes(name)) {
        fields[name] = value
      }
    })

    busboy.on('file', (fieldName, stream, info) => {
      if (fieldName !== 'file' || fileMetadata) {
        terminalError = new AppError('Upload hanya menerima satu field file.', {
          code: 'invalid_file_field',
          statusCode: 400,
        })
        stream.resume()
        return
      }

      const hash = createHash('sha256')
      let size = 0
      let truncated = false
      const writer = createWriteStream(temporaryPath, { flags: 'w' })
      fileMetadata = {
        filename: info.filename,
        mimeType: info.mimeType,
      }

      stream.on('data', (chunk) => {
        size += chunk.length
        hash.update(chunk)
      })
      stream.on('limit', () => {
        truncated = true
      })
      stream.pipe(writer)

      filePromise = finished(writer).then(() => {
        if (truncated) {
          throw new AppError('Ukuran file melebihi batas upload.', {
            code: 'file_too_large',
            statusCode: 413,
            details: { maxFileSize },
          })
        }
        return {
          temporaryPath,
          filename: fileMetadata.filename,
          mimeType: fileMetadata.mimeType,
          size,
          checksum: `sha256:${hash.digest('hex')}`,
          fields,
        }
      })
    })

    busboy.on('filesLimit', () => {
      terminalError = new AppError('Upload hanya menerima satu file.', {
        code: 'too_many_files',
        statusCode: 400,
      })
    })
    busboy.on('error', (error) => {
      reject(new AppError('Multipart upload rusak atau tidak lengkap.', {
        code: 'invalid_multipart',
        statusCode: 400,
        cause: error,
      }))
    })
    busboy.on('finish', async () => {
      try {
        if (terminalError) throw terminalError
        if (!filePromise) {
          throw new AppError('File KML/KMZ wajib dipilih.', {
            code: 'missing_file',
            statusCode: 400,
          })
        }
        resolve(await filePromise)
      } catch (error) {
        reject(error)
      }
    })

    request.pipe(busboy)
  })
}
