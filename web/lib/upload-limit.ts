export const MAX_SINGLE_UPLOAD_BYTES = 200 * 1024 * 1024
export const MAX_SINGLE_UPLOAD_TEXT = '200MB'

export const isSingleUploadOversized = (file?: { size?: number } | null) => {
  const size = Number(file?.size || 0)
  return size > MAX_SINGLE_UPLOAD_BYTES
}
