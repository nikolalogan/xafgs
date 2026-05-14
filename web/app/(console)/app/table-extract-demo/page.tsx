'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Empty, InputNumber, Select, Space, Table, Tabs, Typography, Upload, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import { CopyOutlined, DownloadOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { isSingleUploadOversized, MAX_SINGLE_UPLOAD_TEXT } from '@/lib/upload-limit'

type BoxPolygon = number[][]
type Point = { x: number; y: number }

type BoxLike = {
  bbox: number[]
  polygon?: BoxPolygon
  score?: number
  label?: string
}

type TableCell = {
  rowIndex: number
  colIndex: number
  rowSpan: number
  colSpan: number
  confidence: number
  isColumnHeader: boolean
  isProjectedRowHeader: boolean
  pageBBox: number[]
  pagePolygon: BoxPolygon
  cropBBox: number[]
  cropPolygon: BoxPolygon
}

type WarpPreviewResult = {
  dataUrl: string
  width: number
  height: number
  rectifyScale: number
  rectifyInterpolation: string
}

type ExtractedTable = {
  tableId: string
  pageNo: number
  tableIndex: number
  score: number
  bbox: number[]
  polygon: BoxPolygon
  cropBBox: number[]
  cropPolygon: BoxPolygon
  tableImageDataUrl: string
  tableType: string
  rowCount: number
  colCount: number
  cells: TableCell[]
  structures: {
    rows: BoxLike[]
    columns: BoxLike[]
    columnHeaders: BoxLike[]
    projectedRowHeaders: BoxLike[]
    spanningCells: BoxLike[]
    rawDetections: BoxLike[]
  }
  meta: {
    cropWidth: number
    cropHeight: number
    originalCropWidth?: number
    originalCropHeight?: number
    rectified?: boolean
    rectifyMode?: string
    rectifyScale?: number
    rectifyInterpolation?: string
    rectifiedWidth?: number
    rectifiedHeight?: number
    borderTrimApplied?: boolean
    borderTrimBBox?: number[]
    borderTrimMarginPx?: number
    borderTrimMinProjectionRatio?: number
    rotationApplied?: number
    deskewAngle?: number
    quadScore?: number
    lineCoverageHorizontal?: number
    lineCoverageVertical?: number
  }
}

type ExtractedPage = {
  pageNo: number
  source: string
  width: number
  height: number
  pageImageDataUrl: string
  tableCount: number
  detections: BoxLike[]
  tables: ExtractedTable[]
}

type TableExtractResponse = {
  provider: string
  layoutModel: string
  structureModel: string
  detection_threshold: number
  structure_threshold: number
  pageCount: number
  tableCount: number
  durationMs: number
  pages: ExtractedPage[]
}

type ManualReviewState = {
  sourceTableId: string
  rectifiedImageDataUrl: string
  response: TableExtractResponse
  table: ExtractedTable
}

type ManualPreviewMeta = {
  width: number
  height: number
  rectifyScale: number
  rectifyInterpolation: string
}

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || '')
      const base64 = raw.includes(',') ? raw.split(',')[1] || '' : raw
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

const detectFileType = (file: File, base64: string): 0 | 1 => {
  const normalized = String(base64 || '').trim()
  if (normalized) {
    try {
      const bytes = atob(normalized.slice(0, 120))
      if (bytes.startsWith('%PDF-')) {
        return 0
      }
    } catch {}
  }
  const lowerName = String(file.name || '').toLowerCase()
  const lowerMime = String(file.type || '').toLowerCase()
  if (lowerMime.includes('application/pdf') || lowerName.endsWith('.pdf')) {
    return 0
  }
  return 1
}

const getAccessToken = () => {
  if (typeof window === 'undefined') {
    return ''
  }
  return window.localStorage.getItem('sxfg_access_token')
    || window.localStorage.getItem('access_token')
    || window.localStorage.getItem('token')
    || ''
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

const dataUrlToBase64 = (dataUrl: string) => {
  const raw = String(dataUrl || '')
  return raw.includes(',') ? raw.split(',')[1] || '' : raw
}

const MANUAL_RECTIFY_SCALE = 1.5
const MANUAL_RECTIFY_MAX_EDGE = 4096
const PARAM_DEFAULTS = {
  detection_threshold: 0.85,
  structure_threshold: 0.6,
  table_crop_padding: 44,
  span_overlap_threshold: 0.5,
  use_line_refinement: true,
  row_merge_gap_ratio: 0.44,
  line_detection_sensitivity: 0.56,
  min_line_support_ratio: 0.25,
  use_table_deskew: true,
  deskew_min_angle_deg: 0.2,
  deskew_max_angle_deg: 5.0,
  deskew_min_confidence: 0.45,
  use_post_sharpen: true,
  post_sharpen_strength: 0.25,
  suppress_red_stamps: true,
  enhance_contrast: true,
  reduce_noise: true,
}

const computePaddedBBox = (bbox: number[], width: number, height: number, paddingRatio = 0.02, minPaddingPx = 8) => {
  const padX = Math.max(minPaddingPx, Math.round((bbox[2] - bbox[0]) * paddingRatio))
  const padY = Math.max(minPaddingPx, Math.round((bbox[3] - bbox[1]) * paddingRatio))
  return [
    Math.max(0, Math.min(width, Math.round(bbox[0] - padX))),
    Math.max(0, Math.min(height, Math.round(bbox[1] - padY))),
    Math.max(0, Math.min(width, Math.round(bbox[2] + padX))),
    Math.max(0, Math.min(height, Math.round(bbox[3] + padY))),
  ]
}

const distanceBetween = (left: Point, right: Point) => Math.hypot(left.x - right.x, left.y - right.y)

const orderQuadPoints = (points: Point[]) => {
  const sortedBySum = [...points].sort((left, right) => left.x + left.y - (right.x + right.y))
  const topLeft = sortedBySum[0]
  const bottomRight = sortedBySum[3]
  const remaining = sortedBySum.slice(1, 3).sort((left, right) => left.y - left.x - (right.y - right.x))
  const topRight = remaining[0]
  const bottomLeft = remaining[1]
  return [topLeft, topRight, bottomRight, bottomLeft]
}

const solveLinearSystem = (matrix: number[][], values: number[]) => {
  const size = values.length
  const augmented = matrix.map((row, rowIndex) => [...row, values[rowIndex]])
  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
        maxRow = row
      }
    }
    if (Math.abs(augmented[maxRow][pivot]) < 1e-8) {
      throw new Error('无法计算透视变换矩阵')
    }
    ;[augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]]
    const pivotValue = augmented[pivot][pivot]
    for (let column = pivot; column <= size; column += 1) {
      augmented[pivot][column] /= pivotValue
    }
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue
      const factor = augmented[row][pivot]
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column]
      }
    }
  }
  return augmented.map(row => row[size])
}

const buildPerspectiveMatrix = (sourcePoints: Point[], destinationPoints: Point[]) => {
  const matrix: number[][] = []
  const values: number[] = []
  for (let index = 0; index < 4; index += 1) {
    const source = sourcePoints[index]
    const destination = destinationPoints[index]
    matrix.push([source.x, source.y, 1, 0, 0, 0, -destination.x * source.x, -destination.x * source.y])
    values.push(destination.x)
    matrix.push([0, 0, 0, source.x, source.y, 1, -destination.y * source.x, -destination.y * source.y])
    values.push(destination.y)
  }
  const [a, b, c, d, e, f, g, h] = solveLinearSystem(matrix, values)
  return [
    [a, b, c],
    [d, e, f],
    [g, h, 1],
  ]
}

const invert3x3 = (matrix: number[][]) => {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(determinant) < 1e-8) {
    throw new Error('透视矩阵不可逆')
  }
  const scale = 1 / determinant
  return [
    [(e * i - f * h) * scale, (c * h - b * i) * scale, (b * f - c * e) * scale],
    [(f * g - d * i) * scale, (a * i - c * g) * scale, (c * d - a * f) * scale],
    [(d * h - e * g) * scale, (b * g - a * h) * scale, (a * e - b * d) * scale],
  ]
}

const projectPoint = (matrix: number[][], point: Point) => {
  const denominator = matrix[2][0] * point.x + matrix[2][1] * point.y + matrix[2][2]
  if (Math.abs(denominator) < 1e-8) {
    return point
  }
  return {
    x: (matrix[0][0] * point.x + matrix[0][1] * point.y + matrix[0][2]) / denominator,
    y: (matrix[1][0] * point.x + matrix[1][1] * point.y + matrix[1][2]) / denominator,
  }
}

const computeRectifiedSize = (width: number, height: number, scale = MANUAL_RECTIFY_SCALE, maxEdge = MANUAL_RECTIFY_MAX_EDGE) => {
  let targetWidth = Math.max(1, width) * scale
  let targetHeight = Math.max(1, height) * scale
  const longestEdge = Math.max(targetWidth, targetHeight)
  if (longestEdge > maxEdge) {
    const ratio = maxEdge / longestEdge
    targetWidth *= ratio
    targetHeight *= ratio
  }
  return {
    width: Math.max(1, Math.round(targetWidth)),
    height: Math.max(1, Math.round(targetHeight)),
    scale,
  }
}

const sampleBilinear = (data: Uint8ClampedArray, width: number, height: number, x: number, y: number) => {
  const clampedX = Math.max(0, Math.min(width - 1, x))
  const clampedY = Math.max(0, Math.min(height - 1, y))
  const x0 = Math.floor(clampedX)
  const y0 = Math.floor(clampedY)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const dx = clampedX - x0
  const dy = clampedY - y0
  const topLeftIndex = (y0 * width + x0) * 4
  const topRightIndex = (y0 * width + x1) * 4
  const bottomLeftIndex = (y1 * width + x0) * 4
  const bottomRightIndex = (y1 * width + x1) * 4
  const channels = [0, 0, 0, 0]
  for (let channel = 0; channel < 4; channel += 1) {
    const top = data[topLeftIndex + channel] * (1 - dx) + data[topRightIndex + channel] * dx
    const bottom = data[bottomLeftIndex + channel] * (1 - dx) + data[bottomRightIndex + channel] * dx
    channels[channel] = Math.round(top * (1 - dy) + bottom * dy)
  }
  return channels
}

const loadImageElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('加载图像失败'))
    image.src = src
  })

const warpImageByQuad = async (src: string, rawPoints: Point[]): Promise<WarpPreviewResult> => {
  const image = await loadImageElement(src)
  const sourcePoints = orderQuadPoints(rawPoints)
  const { width: targetWidth, height: targetHeight, scale } = computeRectifiedSize(
    Math.max(distanceBetween(sourcePoints[0], sourcePoints[1]), distanceBetween(sourcePoints[3], sourcePoints[2])),
    Math.max(distanceBetween(sourcePoints[0], sourcePoints[3]), distanceBetween(sourcePoints[1], sourcePoints[2]))
  )
  const destinationPoints = [
    { x: 0, y: 0 },
    { x: targetWidth - 1, y: 0 },
    { x: targetWidth - 1, y: targetHeight - 1 },
    { x: 0, y: targetHeight - 1 },
  ]
  const matrix = buildPerspectiveMatrix(sourcePoints, destinationPoints)
  const inverseMatrix = invert3x3(matrix)
  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = image.naturalWidth
  sourceCanvas.height = image.naturalHeight
  const sourceContext = sourceCanvas.getContext('2d')
  if (!sourceContext) {
    throw new Error('无法创建源图上下文')
  }
  sourceContext.drawImage(image, 0, 0)
  const sourceData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
  const outputCanvas = document.createElement('canvas')
  outputCanvas.width = targetWidth
  outputCanvas.height = targetHeight
  const outputContext = outputCanvas.getContext('2d')
  if (!outputContext) {
    throw new Error('无法创建目标图上下文')
  }
  const outputImage = outputContext.createImageData(targetWidth, targetHeight)
  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const sourcePoint = projectPoint(inverseMatrix, { x: x + 0.5, y: y + 0.5 })
      const targetIndex = (y * targetWidth + x) * 4
      const rgba = sampleBilinear(sourceData.data, sourceCanvas.width, sourceCanvas.height, sourcePoint.x, sourcePoint.y)
      outputImage.data[targetIndex] = rgba[0]
      outputImage.data[targetIndex + 1] = rgba[1]
      outputImage.data[targetIndex + 2] = rgba[2]
      outputImage.data[targetIndex + 3] = rgba[3]
    }
  }
  outputContext.putImageData(outputImage, 0, 0)
  return {
    dataUrl: outputCanvas.toDataURL('image/jpeg', 0.92),
    width: targetWidth,
    height: targetHeight,
    rectifyScale: scale,
    rectifyInterpolation: 'bilinear',
  }
}

const buildOverlayStyle = (bbox: number[], width: number, height: number, color: string, lineWidth = 2) => ({
  position: 'absolute' as const,
  left: `${(bbox[0] / width) * 100}%`,
  top: `${(bbox[1] / height) * 100}%`,
  width: `${((bbox[2] - bbox[0]) / width) * 100}%`,
  height: `${((bbox[3] - bbox[1]) / height) * 100}%`,
  border: `${lineWidth}px solid ${color}`,
  boxSizing: 'border-box' as const,
  pointerEvents: 'none' as const,
})

const buildInteractiveOverlayStyle = (
  bbox: number[],
  width: number,
  height: number,
  options: {
    borderColor: string
    backgroundColor: string
    lineWidth?: number
    zIndex?: number
  }
) => ({
  position: 'absolute' as const,
  left: `${(bbox[0] / width) * 100}%`,
  top: `${(bbox[1] / height) * 100}%`,
  width: `${((bbox[2] - bbox[0]) / width) * 100}%`,
  height: `${((bbox[3] - bbox[1]) / height) * 100}%`,
  border: `${options.lineWidth || 1}px solid ${options.borderColor}`,
  background: options.backgroundColor,
  boxSizing: 'border-box' as const,
  cursor: 'pointer' as const,
  zIndex: options.zIndex || 1,
})

const cellColumns: ColumnsType<TableCell> = [
  { title: '行', dataIndex: 'rowIndex', width: 60 },
  { title: '列', dataIndex: 'colIndex', width: 60 },
  { title: 'rowSpan', dataIndex: 'rowSpan', width: 90 },
  { title: 'colSpan', dataIndex: 'colSpan', width: 90 },
  {
    title: '表头',
    dataIndex: 'isColumnHeader',
    width: 80,
    render: value => (value ? '是' : '否'),
  },
  {
    title: '投影行头',
    dataIndex: 'isProjectedRowHeader',
    width: 100,
    render: value => (value ? '是' : '否'),
  },
  {
    title: '页坐标',
    dataIndex: 'pageBBox',
    render: value => String(Array.isArray(value) ? value.join(', ') : '-'),
  },
]

function PagePreview({ page, selectedTableId }: { page: ExtractedPage; selectedTableId: string }) {
  return (
    <div style={{ position: 'relative', width: '100%', border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}>
      <img src={page.pageImageDataUrl} alt={`page-${page.pageNo}`} style={{ display: 'block', width: '100%' }} />
      {page.detections.map((item, index) => (
        <div key={`${page.pageNo}-det-${index}`} style={buildOverlayStyle(item.bbox, page.width, page.height, '#fa8c16', 2)}>
          <span style={{ position: 'absolute', top: -24, left: 0, background: '#fa8c16', color: '#fff', fontSize: 12, padding: '0 6px', borderRadius: 4 }}>
            T{index + 1}
          </span>
        </div>
      ))}
      {page.tables.filter(table => table.tableId === selectedTableId).map(table => (
        <div key={table.tableId} style={buildOverlayStyle(table.bbox, page.width, page.height, '#1677ff', 3)} />
      ))}
    </div>
  )
}

function TableRectifyPreview({
  page,
  table,
  manualReview,
  onApplyManualReview,
  reviewSubmitting,
}: {
  page: ExtractedPage
  table: ExtractedTable
  manualReview: ManualReviewState | null
  onApplyManualReview: (dataUrl: string, meta: ManualPreviewMeta | null) => Promise<void>
  reviewSubmitting: boolean
}) {
  const [beforeImageUrl, setBeforeImageUrl] = useState<string>('')
  const [beforeSize, setBeforeSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [manualPoints, setManualPoints] = useState<Point[]>([])
  const [manualPreviewUrl, setManualPreviewUrl] = useState<string>('')
  const [manualPreviewMeta, setManualPreviewMeta] = useState<ManualPreviewMeta | null>(null)
  const [manualWarping, setManualWarping] = useState(false)
  const imageBoxRef = useRef<HTMLDivElement | null>(null)
  const currentReview = manualReview?.sourceTableId === table.tableId ? manualReview : null
  const afterImageUrl = currentReview?.rectifiedImageDataUrl || manualPreviewUrl || table.tableImageDataUrl

  useEffect(() => {
    let cancelled = false
    const source = new Image()
    source.onload = () => {
      const paddedBBox = computePaddedBBox(table.bbox, page.width, page.height)
      const cropWidth = Math.max(1, paddedBBox[2] - paddedBBox[0])
      const cropHeight = Math.max(1, paddedBBox[3] - paddedBBox[1])
      const canvas = document.createElement('canvas')
      canvas.width = cropWidth
      canvas.height = cropHeight
      const context = canvas.getContext('2d')
      if (!context) {
        if (!cancelled) setBeforeImageUrl('')
        return
      }
      context.drawImage(source, paddedBBox[0], paddedBBox[1], cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
      if (!cancelled) {
        setBeforeImageUrl(canvas.toDataURL('image/jpeg', 0.92))
        setBeforeSize({ width: cropWidth, height: cropHeight })
      }
    }
    source.src = page.pageImageDataUrl
    return () => {
      cancelled = true
    }
  }, [page.pageImageDataUrl, page.height, page.width, table.bbox])

  useEffect(() => {
    setManualPoints([])
    setManualPreviewUrl(currentReview?.rectifiedImageDataUrl || '')
    setManualPreviewMeta(
      currentReview
        ? {
            width: currentReview.table.meta.rectifiedWidth || currentReview.table.meta.cropWidth,
            height: currentReview.table.meta.rectifiedHeight || currentReview.table.meta.cropHeight,
            rectifyScale: currentReview.table.meta.rectifyScale || MANUAL_RECTIFY_SCALE,
            rectifyInterpolation: currentReview.table.meta.rectifyInterpolation || 'bilinear',
          }
        : null
    )
  }, [currentReview?.rectifiedImageDataUrl, table.tableId])

  const handlePickPoint = (event: { clientX: number; clientY: number }) => {
    if (!imageBoxRef.current || !beforeSize.width || !beforeSize.height) return
    const bounds = imageBoxRef.current.getBoundingClientRect()
    const relativeX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))
    const relativeY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
    const point = {
      x: Number(((relativeX / bounds.width) * beforeSize.width).toFixed(2)),
      y: Number(((relativeY / bounds.height) * beforeSize.height).toFixed(2)),
    }
    setManualPreviewUrl('')
    setManualPreviewMeta(null)
    setManualPoints(previous => (previous.length >= 4 ? [point] : [...previous, point]))
  }

  const buildManualPreview = async () => {
    if (manualPoints.length !== 4 || !beforeImageUrl) return
    setManualWarping(true)
    try {
      const warped = await warpImageByQuad(beforeImageUrl, manualPoints)
      setManualPreviewUrl(warped.dataUrl)
      setManualPreviewMeta({
        width: warped.width,
        height: warped.height,
        rectifyScale: warped.rectifyScale,
        rectifyInterpolation: warped.rectifyInterpolation,
      })
    } finally {
      setManualWarping(false)
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap size={12}>
        <Typography.Text>默认模式: {table.meta.rectifyMode || 'fallback_none'}</Typography.Text>
        <Typography.Text>自动矫正: {table.meta.rectified ? '是' : '否'}</Typography.Text>
        <Typography.Text>rectifyScale: {table.meta.rectifyScale || 1}</Typography.Text>
        <Typography.Text>rectifyInterpolation: {table.meta.rectifyInterpolation || 'linear'}</Typography.Text>
        <Typography.Text>rectifiedSize: {(table.meta.rectifiedWidth || table.meta.cropWidth)} x {(table.meta.rectifiedHeight || table.meta.cropHeight)}</Typography.Text>
        <Typography.Text>borderTrim: {table.meta.borderTrimApplied ? '是' : '否'}</Typography.Text>
        <Typography.Text>borderTrimMargin: {table.meta.borderTrimMarginPx || 0}px</Typography.Text>
        <Typography.Text>borderTrimRatio: {table.meta.borderTrimMinProjectionRatio || 0}</Typography.Text>
        <Typography.Text>rotationApplied: {table.meta.rotationApplied || 0}°</Typography.Text>
        <Typography.Text>deskewAngle: {table.meta.deskewAngle || 0}°</Typography.Text>
        <Typography.Text>quadScore: {table.meta.quadScore || 0}</Typography.Text>
      </Space>
      <Card size="small" title="手动四点矫正">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            默认先使用自动矫正。如果对第 3 步检查结果不满意，可在左图按顺时针点选 4 个角点，生成手动矫正图后再点“基于手动矫正重新检查”。
          </Typography.Text>
          <Space wrap size={12}>
            <Button onClick={() => {
              setManualPoints([])
              setManualPreviewUrl(currentReview?.rectifiedImageDataUrl || '')
              setManualPreviewMeta(
                currentReview
                  ? {
                      width: currentReview.table.meta.rectifiedWidth || currentReview.table.meta.cropWidth,
                      height: currentReview.table.meta.rectifiedHeight || currentReview.table.meta.cropHeight,
                      rectifyScale: currentReview.table.meta.rectifyScale || MANUAL_RECTIFY_SCALE,
                      rectifyInterpolation: currentReview.table.meta.rectifyInterpolation || 'bilinear',
                    }
                  : null
              )
            }}>
              清空点位
            </Button>
            <Button onClick={buildManualPreview} disabled={manualPoints.length !== 4 || !beforeImageUrl} loading={manualWarping}>
              生成手动矫正预览
            </Button>
            <Button
              type="primary"
              onClick={() => void onApplyManualReview(manualPreviewUrl, manualPreviewMeta)}
              disabled={!manualPreviewUrl}
              loading={reviewSubmitting}
            >
              基于手动矫正重新检查
            </Button>
          </Space>
          <Space wrap size={8}>
            {manualPoints.map((point, index) => (
              <Typography.Text key={`${point.x}-${point.y}-${index}`}>P{index + 1}: ({point.x}, {point.y})</Typography.Text>
            ))}
            {!manualPoints.length ? <Typography.Text type="secondary">尚未选择点位</Typography.Text> : null}
          </Space>
          {manualPreviewMeta ? (
            <Typography.Text type="secondary">
              手动预览: {manualPreviewMeta.width} x {manualPreviewMeta.height} / scale {manualPreviewMeta.rectifyScale} / {manualPreviewMeta.rectifyInterpolation}
            </Typography.Text>
          ) : null}
          {Array.isArray(table.meta.borderTrimBBox) ? (
            <Typography.Text type="secondary">
              自动裁边框: {table.meta.borderTrimBBox.join(', ')}
            </Typography.Text>
          ) : null}
          {currentReview ? (
            <Alert
              type="success"
              showIcon
              message="当前表格裁剪与 Cells 已切换到手动矫正后的复检结果"
            />
          ) : null}
        </Space>
      </Card>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          width: '100%',
        }}
      >
        <Card size="small" title="矫正前">
          {beforeImageUrl ? (
            <div
              ref={imageBoxRef}
              style={{ position: 'relative', cursor: 'crosshair' }}
              onClick={handlePickPoint}
            >
              <img src={beforeImageUrl} alt={`${table.tableId}-before-rectify`} style={{ display: 'block', width: '100%', borderRadius: 8 }} />
              {manualPoints.map((point, index) => (
                <div
                  key={`${point.x}-${point.y}-${index}`}
                  style={{
                    position: 'absolute',
                    left: `calc(${(point.x / beforeSize.width) * 100}% - 9px)`,
                    top: `calc(${(point.y / beforeSize.height) * 100}% - 9px)`,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: '#1677ff',
                    color: '#fff',
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.24)',
                  }}
                >
                  {index + 1}
                </div>
              ))}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正在生成矫正前裁剪图" />
          )}
        </Card>
        <Card size="small" title="矫正后">
          <img src={afterImageUrl} alt={`${table.tableId}-after-rectify`} style={{ display: 'block', width: '100%', borderRadius: 8 }} />
        </Card>
      </div>
    </Space>
  )
}

function CropPreview({ table }: { table: ExtractedTable }) {
  const [hoveredCellKey, setHoveredCellKey] = useState<string>('')
  const hoveredCell = table.cells.find((cell, index) => `${cell.rowIndex}-${cell.colIndex}-${index}` === hoveredCellKey) || null

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div
        style={{ position: 'relative', width: '100%', border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden' }}
        onMouseLeave={() => setHoveredCellKey('')}
      >
        <img src={table.tableImageDataUrl} alt={table.tableId} style={{ display: 'block', width: '100%' }} />
        {table.cells.map((cell, index) => {
          const cellKey = `${cell.rowIndex}-${cell.colIndex}-${index}`
          const isHovered = hoveredCellKey === cellKey
          const isMerged = cell.rowSpan > 1 || cell.colSpan > 1
          const accent = isMerged ? '#ff7875' : '#52c41a'

          return (
            <div
              key={`${table.tableId}-cell-${index}`}
              style={buildInteractiveOverlayStyle(cell.cropBBox, table.meta.cropWidth, table.meta.cropHeight, {
                borderColor: isHovered ? accent : isMerged ? 'rgba(255, 120, 117, 0.45)' : 'rgba(82, 196, 26, 0.32)',
                backgroundColor: isHovered ? (isMerged ? 'rgba(255, 120, 117, 0.18)' : 'rgba(82, 196, 26, 0.16)') : isMerged ? 'rgba(255, 120, 117, 0.07)' : 'rgba(82, 196, 26, 0.04)',
                lineWidth: isHovered ? 2 : 1,
                zIndex: isHovered ? 2 : 1,
              })}
              onMouseEnter={() => setHoveredCellKey(cellKey)}
            >
              {isHovered ? (
                <span
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    background: accent,
                    color: '#fff',
                    fontSize: 11,
                    lineHeight: 1.4,
                    padding: '2px 6px',
                    borderRadius: 999,
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
                    pointerEvents: 'none',
                  }}
                >
                  r{cell.rowIndex} c{cell.colIndex}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>

      <Card size="small" bodyStyle={{ padding: 12, background: '#fafafa' }}>
        {hoveredCell ? (
          <Space wrap size={12}>
            <Typography.Text strong>当前单元格</Typography.Text>
            <Typography.Text>r{hoveredCell.rowIndex} c{hoveredCell.colIndex}</Typography.Text>
            <Typography.Text>rowSpan {hoveredCell.rowSpan}</Typography.Text>
            <Typography.Text>colSpan {hoveredCell.colSpan}</Typography.Text>
            <Typography.Text>列表头 {hoveredCell.isColumnHeader ? '是' : '否'}</Typography.Text>
            <Typography.Text>投影行头 {hoveredCell.isProjectedRowHeader ? '是' : '否'}</Typography.Text>
          </Space>
        ) : (
          <Space wrap size={12}>
            <Typography.Text strong>预览说明</Typography.Text>
            <Typography.Text>移动到单元格上查看行列位置和跨度信息</Typography.Text>
            <Typography.Text type="secondary">红色表示跨行或跨列单元格</Typography.Text>
          </Space>
        )}
      </Card>
    </Space>
  )
}

export default function TableExtractDemoPage() {
  const [msgApi, contextHolder] = message.useMessage()
  const [uploadFile, setUploadFile] = useState<UploadFile | null>(null)
  const [params, setParams] = useState(PARAM_DEFAULTS)
  const [submitting, setSubmitting] = useState(false)
  const [lastRequest, setLastRequest] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<TableExtractResponse | null>(null)
  const [selectedPageNo, setSelectedPageNo] = useState<number | null>(null)
  const [selectedTableId, setSelectedTableId] = useState<string>('')
  const [manualReview, setManualReview] = useState<ManualReviewState | null>(null)
  const [reviewSubmitting, setReviewSubmitting] = useState(false)

  const canSubmit = useMemo(() => !!uploadFile?.originFileObj && !submitting, [uploadFile, submitting])
  const selectedPage = useMemo(() => result?.pages.find(page => page.pageNo === selectedPageNo) || result?.pages[0] || null, [result, selectedPageNo])
  const selectedTable = useMemo(() => selectedPage?.tables.find(table => table.tableId === selectedTableId) || selectedPage?.tables[0] || null, [selectedPage, selectedTableId])
  const inspectedTable = useMemo(() => {
    if (!selectedTable || manualReview?.sourceTableId !== selectedTable.tableId) {
      return selectedTable
    }
    return manualReview.table
  }, [manualReview, selectedTable])
  const inspectedRaw = useMemo(() => {
    if (!selectedTable || manualReview?.sourceTableId !== selectedTable.tableId) {
      return result
    }
    return manualReview.response
  }, [manualReview, result, selectedTable])

  const resetState = () => {
    setUploadFile(null)
    setResult(null)
    setLastRequest(null)
    setSelectedPageNo(null)
    setSelectedTableId('')
    setParams(PARAM_DEFAULTS)
    setManualReview(null)
  }

  const runExtract = async () => {
    const file = uploadFile?.originFileObj
    if (!file) {
      msgApi.warning('请先上传文件')
      return
    }
    if (isSingleUploadOversized(file)) {
      msgApi.error(`单文件大小不能超过 ${MAX_SINGLE_UPLOAD_TEXT}`)
      return
    }
    setSubmitting(true)
    try {
      const base64 = await toBase64(file)
      const payload = {
        file: base64,
        fileType: detectFileType(file, base64),
        ...params,
      }
      setLastRequest(payload)
      const token = getAccessToken()
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
      const response = await fetch('/api/ocr/table-repair-preview', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const raw = await response.json() as TableExtractResponse & { detail?: string }
      if (!response.ok) {
        throw new Error(raw.detail || `请求失败(${response.status})`)
      }
      setManualReview(null)
      setResult(raw)
      const firstPage = raw.pages[0] || null
      setSelectedPageNo(firstPage?.pageNo || null)
      setSelectedTableId(firstPage?.tables[0]?.tableId || '')
      msgApi.success(`提取完成，共 ${raw.tableCount} 张表`)
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : '提取失败')
    } finally {
      setSubmitting(false)
    }
  }

  const runManualReview = async (dataUrl: string, manualPreviewMeta: ManualPreviewMeta | null) => {
    if (!selectedTable) {
      msgApi.warning('当前没有可复检的表格')
      return
    }
    setReviewSubmitting(true)
    try {
      const payload = {
        file: dataUrlToBase64(dataUrl),
        fileType: 1,
        ...params,
      }
      const token = getAccessToken()
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
      const response = await fetch('/api/ocr/table-repair-preview', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const raw = await response.json() as TableExtractResponse & { detail?: string }
      if (!response.ok) {
        throw new Error(raw.detail || `手动复检失败(${response.status})`)
      }
      const reviewedTable = raw.pages[0]?.tables[0]
      if (!reviewedTable) {
        throw new Error('手动矫正后的图像未检出表格')
      }
      setManualReview({
        sourceTableId: selectedTable.tableId,
        rectifiedImageDataUrl: dataUrl,
        response: raw,
        table: {
          ...reviewedTable,
          tableImageDataUrl: dataUrl,
          meta: {
            ...reviewedTable.meta,
            rectified: true,
            rectifyMode: 'manual_quad',
            rectifyScale: manualPreviewMeta?.rectifyScale || MANUAL_RECTIFY_SCALE,
            rectifyInterpolation: manualPreviewMeta?.rectifyInterpolation || 'bilinear',
            rectifiedWidth: manualPreviewMeta?.width || reviewedTable.meta.rectifiedWidth || reviewedTable.meta.cropWidth,
            rectifiedHeight: manualPreviewMeta?.height || reviewedTable.meta.rectifiedHeight || reviewedTable.meta.cropHeight,
          },
        },
      })
      msgApi.success('已基于手动矫正结果重新检查，表格裁剪和 Cells 已切换')
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : '手动复检失败')
    } finally {
      setReviewSubmitting(false)
    }
  }

  const copyRequest = async () => {
    if (!lastRequest) {
      msgApi.warning('暂无请求参数')
      return
    }
    try {
      await navigator.clipboard.writeText(pretty(lastRequest))
      msgApi.success('已复制请求参数')
    } catch {
      msgApi.error('复制失败')
    }
  }

  const downloadResponse = () => {
    if (!result) {
      msgApi.warning('暂无返回结果')
      return
    }
    const blob = new Blob([pretty(result)], { type: 'application/json;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `table-extract-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(href)
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
      {contextHolder}
      <Alert
        type="info"
        showIcon
        title="表格提取测试页"
        description="链路为整页 PDF/图片 -> DocLayout-YOLO 表格定位 -> 矩形矫正/回退 -> Table Transformer 结构识别。下方按阶段拆分为表格定位、矩形矫正、表格裁剪三个主视图。"
      />

      <Card title="输入参数" extra={<Button icon={<ReloadOutlined />} onClick={resetState}>重置</Button>}>
        <Space wrap size={16} style={{ width: '100%' }} align="end">
          <Upload beforeUpload={() => false} maxCount={1} fileList={uploadFile ? [uploadFile] : []} onChange={({ fileList }) => setUploadFile(fileList[0] || null)}>
            <Button icon={<UploadOutlined />}>上传文件（PDF/图片）</Button>
          </Upload>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>检测阈值</Typography.Text>
            <InputNumber min={0} max={1} step={0.01} value={params.detection_threshold} onChange={value => setParams(previous => ({ ...previous, detection_threshold: Number(value || PARAM_DEFAULTS.detection_threshold) }))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>结构阈值</Typography.Text>
            <InputNumber min={0} max={1} step={0.01} value={params.structure_threshold} onChange={value => setParams(previous => ({ ...previous, structure_threshold: Number(value || PARAM_DEFAULTS.structure_threshold) }))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>裁剪扩边(px)</Typography.Text>
            <InputNumber min={0} max={200} step={1} value={params.table_crop_padding} onChange={value => setParams(previous => ({ ...previous, table_crop_padding: Number(value || PARAM_DEFAULTS.table_crop_padding) }))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>跨格重叠阈值</Typography.Text>
            <InputNumber min={0} max={1} step={0.01} value={params.span_overlap_threshold} onChange={value => setParams(previous => ({ ...previous, span_overlap_threshold: Number(value || PARAM_DEFAULTS.span_overlap_threshold) }))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>线细化</Typography.Text>
            <Select
              value={params.use_line_refinement ? 'on' : 'off'}
              style={{ width: '100%' }}
              options={[
                { label: '开启', value: 'on' },
                { label: '关闭', value: 'off' },
              ]}
              onChange={value => setParams(previous => ({ ...previous, use_line_refinement: value === 'on' }))}
            />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>行合并间隔比例</Typography.Text>
            <InputNumber min={0} max={2} step={0.01} value={params.row_merge_gap_ratio} onChange={value => setParams(previous => ({ ...previous, row_merge_gap_ratio: Number(value || PARAM_DEFAULTS.row_merge_gap_ratio) }))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>线检测敏感度</Typography.Text>
            <InputNumber min={0} max={1} step={0.01} value={params.line_detection_sensitivity} onChange={value => setParams(previous => ({ ...previous, line_detection_sensitivity: Number(value || PARAM_DEFAULTS.line_detection_sensitivity) }))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>最小线支撑比例</Typography.Text>
            <InputNumber min={0} max={1} step={0.01} value={params.min_line_support_ratio} onChange={value => setParams(previous => ({ ...previous, min_line_support_ratio: Number(value || PARAM_DEFAULTS.min_line_support_ratio) }))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>开启 deskew</Typography.Text>
            <Select value={params.use_table_deskew ? 'on' : 'off'} style={{ width: '100%' }} options={[{ label: '开启', value: 'on' }, { label: '关闭', value: 'off' }]} onChange={value => setParams(previous => ({ ...previous, use_table_deskew: value === 'on' }))} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>deskew 最小角度</Typography.Text>
            <InputNumber min={-10} max={10} step={0.1} value={params.deskew_min_angle_deg} onChange={value => setParams(previous => ({ ...previous, deskew_min_angle_deg: Number(value || PARAM_DEFAULTS.deskew_min_angle_deg) }))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>deskew 最大角度</Typography.Text>
            <InputNumber min={0} max={10} step={0.1} value={params.deskew_max_angle_deg} onChange={value => setParams(previous => ({ ...previous, deskew_max_angle_deg: Number(value || PARAM_DEFAULTS.deskew_max_angle_deg) }))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>deskew 最小置信度</Typography.Text>
            <InputNumber min={0} max={1} step={0.01} value={params.deskew_min_confidence} onChange={value => setParams(previous => ({ ...previous, deskew_min_confidence: Number(value || PARAM_DEFAULTS.deskew_min_confidence) }))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>后锐化</Typography.Text>
            <Select value={params.use_post_sharpen ? 'on' : 'off'} style={{ width: '100%' }} options={[{ label: '开启', value: 'on' }, { label: '关闭', value: 'off' }]} onChange={value => setParams(previous => ({ ...previous, use_post_sharpen: value === 'on' }))} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>锐化强度</Typography.Text>
            <InputNumber min={0} max={1} step={0.01} value={params.post_sharpen_strength} onChange={value => setParams(previous => ({ ...previous, post_sharpen_strength: Number(value || PARAM_DEFAULTS.post_sharpen_strength) }))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>抑制红章</Typography.Text>
            <Select value={params.suppress_red_stamps ? 'on' : 'off'} style={{ width: '100%' }} options={[{ label: '开启', value: 'on' }, { label: '关闭', value: 'off' }]} onChange={value => setParams(previous => ({ ...previous, suppress_red_stamps: value === 'on' }))} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>增强对比度</Typography.Text>
            <Select value={params.enhance_contrast ? 'on' : 'off'} style={{ width: '100%' }} options={[{ label: '开启', value: 'on' }, { label: '关闭', value: 'off' }]} onChange={value => setParams(previous => ({ ...previous, enhance_contrast: value === 'on' }))} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>降噪</Typography.Text>
            <Select value={params.reduce_noise ? 'on' : 'off'} style={{ width: '100%' }} options={[{ label: '开启', value: 'on' }, { label: '关闭', value: 'off' }]} onChange={value => setParams(previous => ({ ...previous, reduce_noise: value === 'on' }))} />
          </div>
          <Space>
            <Button type="primary" onClick={runExtract} loading={submitting} disabled={!canSubmit}>开始提取</Button>
            <Button icon={<CopyOutlined />} onClick={copyRequest}>复制请求</Button>
          </Space>
        </Space>
      </Card>

      <Card
        title="提取结果"
        extra={<Button icon={<DownloadOutlined />} onClick={downloadResponse}>下载 JSON</Button>}
      >
        {!result ? (
          <Empty description="请先上传文件并执行表格提取" />
        ) : (
          <Tabs
            defaultActiveKey="locate"
            items={[
              {
                key: 'locate',
                label: '1. 表格定位',
                children: (
                  <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                    <Space wrap size={12}>
                      <Typography.Text>provider: {result.provider}</Typography.Text>
                      <Typography.Text>pages: {result.pageCount}</Typography.Text>
                      <Typography.Text>tables: {result.tableCount}</Typography.Text>
                      <Typography.Text>duration: {result.durationMs}ms</Typography.Text>
                    </Space>

                    <Space wrap size={12}>
                      <Select
                        value={selectedPage?.pageNo}
                        placeholder="选择页面"
                        style={{ width: 180 }}
                        options={result.pages.map(page => ({ label: `第 ${page.pageNo} 页 (${page.tableCount} tables)`, value: page.pageNo }))}
                        onChange={value => {
                          const nextPage = result.pages.find(page => page.pageNo === value) || null
                          setSelectedPageNo(value)
                          setSelectedTableId(nextPage?.tables[0]?.tableId || '')
                        }}
                      />
                      <Select
                        value={selectedTable?.tableId}
                        placeholder="选择表格"
                        style={{ width: 220 }}
                        options={(selectedPage?.tables || []).map(table => ({
                          label: `T${table.tableIndex} ${table.tableType} ${table.rowCount}x${table.colCount}`,
                          value: table.tableId,
                        }))}
                        onChange={value => setSelectedTableId(value)}
                      />
                    </Space>

                    {selectedPage ? (
                      <Card size="small" title={`整页预览 · 第 ${selectedPage.pageNo} 页`}>
                        <PagePreview page={selectedPage} selectedTableId={selectedTable?.tableId || ''} />
                      </Card>
                    ) : (
                      <Empty description="当前没有可预览页面" />
                    )}
                  </Space>
                ),
              },
              {
                key: 'rectify',
                label: '2. 矩形矫正',
                children: (
                  <Alert
                    type="info"
                    showIcon
                    message="已移除旧版手动四点/梯形校正"
                    description="当前仅保留与 tatr 一致的自动 deskew 校正链路（阈值与实现一致），不再提供旧版页面内手动梯形矫正。"
                  />
                ),
              },
              {
                key: 'crop',
                label: '3. 表格裁剪',
                children: inspectedTable ? (
                  <CropPreview table={inspectedTable} />
                ) : (
                  <Empty description={selectedPage ? '当前页面未检测到表格' : '当前没有可预览表格'} />
                ),
              },
              {
                key: 'cells',
                label: 'Cells',
                children: inspectedTable ? (
                  <Table<TableCell>
                    rowKey={(record, index) => `${record.rowIndex}-${record.colIndex}-${index}`}
                    columns={cellColumns}
                    dataSource={inspectedTable.cells}
                    pagination={{ pageSize: 10 }}
                    size="small"
                    scroll={{ x: 1000 }}
                  />
                ) : (
                  <Empty description="当前没有表格单元格结果" />
                ),
              },
              {
                key: 'raw',
                label: '原始响应',
                children: (
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflow: 'auto', fontSize: 12 }}>
                    {pretty(inspectedRaw)}
                  </pre>
                ),
              },
            ]}
          />
        )}
      </Card>
    </Space>
  )
}
