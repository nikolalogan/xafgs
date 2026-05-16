'use client'

import { useEffect, useRef } from 'react'
import UniverNativeEditor from './UniverNativeEditor'

export type SelectionRange = {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

type UniverTableEditorProps = {
  editorSessionKey: string
  valueHtml: string
  disabled?: boolean
  onChange: (nextHtml: string) => void
  onError?: (message: string) => void
  activeCell?: { row: number; col: number } | null
  onSelectionChange?: (
    row: number,
    col: number,
    meta?: { ranges: SelectionRange[]; source: string; fromKeyboard?: boolean },
  ) => void
  onHoverCellChange?: (row: number, col: number | null) => void
  onInteractionDebug?: (phase: 'selection-event' | 'selection-fallback' | 'hover' | 'focus', payload: Record<string, unknown>) => void
  exportFileNamePrefix?: string
  hideExportButton?: boolean
  showMenu?: boolean
  previewMode?: boolean
  renderContext?: Record<string, unknown> | null
}

const warnDeprecated = (flags: Record<string, boolean>) => {
  if (process.env.NODE_ENV === 'production') {
    return
  }
  const used = Object.entries(flags)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
  if (used.length === 0) {
    return
  }
  console.warn(`[UniverTableEditor] 以下 props 在最小原生模式中已暂停生效: ${used.join(', ')}`)
}

export default function UniverTableEditor(props: UniverTableEditorProps) {
  const warnedRef = useRef(false)

  useEffect(() => {
    if (warnedRef.current) {
      return
    }
    warnedRef.current = true
    warnDeprecated({
      activeCell: props.activeCell !== undefined,
      onSelectionChange: typeof props.onSelectionChange === 'function',
      onHoverCellChange: typeof props.onHoverCellChange === 'function',
      onInteractionDebug: typeof props.onInteractionDebug === 'function',
      exportFileNamePrefix: typeof props.exportFileNamePrefix === 'string' && props.exportFileNamePrefix.trim() !== '',
      hideExportButton: props.hideExportButton !== undefined,
      showMenu: props.showMenu !== undefined,
      previewMode: props.previewMode !== undefined,
      renderContext: props.renderContext !== undefined,
    })
  }, [props.activeCell, props.exportFileNamePrefix, props.hideExportButton, props.onHoverCellChange, props.onInteractionDebug, props.onSelectionChange, props.previewMode, props.renderContext, props.showMenu])

  return (
    <UniverNativeEditor
      editorSessionKey={props.editorSessionKey}
      valueHtml={props.valueHtml}
      disabled={props.disabled}
      onChange={props.onChange}
      onError={props.onError}
    />
  )
}