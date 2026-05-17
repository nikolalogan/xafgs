'use client'

import { Alert } from 'antd'
import { useMemo } from 'react'

type TableTemplatePreviewProps = {
  valueHtml: string
  className?: string
}

const extractFirstTableHtml = (valueHtml: string): string => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(String(valueHtml || ''), 'text/html')
  const table = doc.querySelector('table')
  if (!table)
    throw new Error('未找到可解析的表格')
  return table.outerHTML
}

export default function TableTemplatePreview({ valueHtml, className }: TableTemplatePreviewProps) {
  const parsed = useMemo(() => {
    try {
      return { tableHtml: extractFirstTableHtml(valueHtml), error: '' }
    } catch (error) {
      return { tableHtml: '', error: error instanceof Error ? error.message : '表格解析失败' }
    }
  }, [valueHtml])

  if (!parsed.tableHtml) {
    return (
      <Alert
        type="warning"
        showIcon
        message="表格预览失败"
        description={parsed.error || '请检查模板内容是否包含有效 table 结构'}
      />
    )
  }

  return (
    <div className={className}>
      <div className="table-preview-scroll">
        <div className="table-preview-content" dangerouslySetInnerHTML={{ __html: parsed.tableHtml }} />
      </div>
      <style jsx>{`
        .table-preview-scroll {
          overflow-x: auto;
        }
        .table-preview-content :global(table) {
          border-collapse: collapse;
          width: 100%;
          min-width: max-content;
        }
        .table-preview-content :global(th),
        .table-preview-content :global(td) {
          border: 1px solid #d9d9d9;
          padding: 8px 10px;
          vertical-align: top;
        }
        .table-preview-content :global(th) {
          background: #fafafa;
          font-weight: 600;
        }
      `}</style>
    </div>
  )
}
