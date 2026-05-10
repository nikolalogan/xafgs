'use client'

import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Empty, InputNumber, Select, Space, Table, Tabs, Typography, Upload, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import { CopyOutlined, DownloadOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { isSingleUploadOversized, MAX_SINGLE_UPLOAD_TEXT } from '@/lib/upload-limit'

type BoxPolygon = number[][]

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
  detectorThreshold: number
  structureThreshold: number
  pageCount: number
  tableCount: number
  durationMs: number
  pages: ExtractedPage[]
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

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

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

function TableRectifyPreview({ page, table }: { page: ExtractedPage; table: ExtractedTable }) {
  const [beforeImageUrl, setBeforeImageUrl] = useState<string>('')

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
      }
    }
    source.src = page.pageImageDataUrl
    return () => {
      cancelled = true
    }
  }, [page.pageImageDataUrl, page.height, page.width, table.bbox])

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap size={12}>
        <Typography.Text>rectifyMode: {table.meta.rectifyMode || 'fallback_none'}</Typography.Text>
        <Typography.Text>rectified: {table.meta.rectified ? '是' : '否'}</Typography.Text>
        <Typography.Text>rotationApplied: {table.meta.rotationApplied || 0}°</Typography.Text>
        <Typography.Text>deskewAngle: {table.meta.deskewAngle || 0}°</Typography.Text>
        <Typography.Text>quadScore: {table.meta.quadScore || 0}</Typography.Text>
      </Space>
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
            <img src={beforeImageUrl} alt={`${table.tableId}-before-rectify`} style={{ display: 'block', width: '100%', borderRadius: 8 }} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正在生成矫正前裁剪图" />
          )}
        </Card>
        <Card size="small" title="矫正后">
          <img src={table.tableImageDataUrl} alt={`${table.tableId}-after-rectify`} style={{ display: 'block', width: '100%', borderRadius: 8 }} />
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
  const [detectorThreshold, setDetectorThreshold] = useState(0.25)
  const [structureThreshold, setStructureThreshold] = useState(0.35)
  const [maxTablesPerPage, setMaxTablesPerPage] = useState(24)
  const [submitting, setSubmitting] = useState(false)
  const [lastRequest, setLastRequest] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<TableExtractResponse | null>(null)
  const [selectedPageNo, setSelectedPageNo] = useState<number | null>(null)
  const [selectedTableId, setSelectedTableId] = useState<string>('')

  const canSubmit = useMemo(() => !!uploadFile?.originFileObj && !submitting, [uploadFile, submitting])
  const selectedPage = useMemo(() => result?.pages.find(page => page.pageNo === selectedPageNo) || result?.pages[0] || null, [result, selectedPageNo])
  const selectedTable = useMemo(() => selectedPage?.tables.find(table => table.tableId === selectedTableId) || selectedPage?.tables[0] || null, [selectedPage, selectedTableId])

  const resetState = () => {
    setUploadFile(null)
    setResult(null)
    setLastRequest(null)
    setSelectedPageNo(null)
    setSelectedTableId('')
    setDetectorThreshold(0.25)
    setStructureThreshold(0.35)
    setMaxTablesPerPage(24)
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
        detectorThreshold,
        structureThreshold,
        maxTablesPerPage,
      }
      setLastRequest(payload)
      const response = await fetch('/ocr/table-extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const raw = await response.json() as TableExtractResponse & { detail?: string }
      if (!response.ok) {
        throw new Error(raw.detail || `请求失败(${response.status})`)
      }
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
            <InputNumber min={0.05} max={0.95} step={0.05} value={detectorThreshold} onChange={value => setDetectorThreshold(Number(value || 0.25))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>结构阈值</Typography.Text>
            <InputNumber min={0.05} max={0.95} step={0.05} value={structureThreshold} onChange={value => setStructureThreshold(Number(value || 0.35))} style={{ width: '100%' }} />
          </div>
          <div style={{ minWidth: 180 }}>
            <Typography.Text>每页最大表数</Typography.Text>
            <InputNumber min={1} max={64} step={1} value={maxTablesPerPage} onChange={value => setMaxTablesPerPage(Number(value || 24))} style={{ width: '100%' }} />
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
            defaultActiveKey="preview"
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
                children: selectedPage && selectedTable ? (
                  <TableRectifyPreview page={selectedPage} table={selectedTable} />
                ) : (
                  <Empty description={selectedPage ? '当前页面未检测到表格' : '当前没有可预览页面'} />
                ),
              },
              {
                key: 'crop',
                label: '3. 表格裁剪',
                children: selectedTable ? (
                  <CropPreview table={selectedTable} />
                ) : (
                  <Empty description={selectedPage ? '当前页面未检测到表格' : '当前没有可预览表格'} />
                ),
              },
              {
                key: 'cells',
                label: 'Cells',
                children: selectedTable ? (
                  <Table<TableCell>
                    rowKey={(record, index) => `${record.rowIndex}-${record.colIndex}-${index}`}
                    columns={cellColumns}
                    dataSource={selectedTable.cells}
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
                    {pretty(result)}
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
