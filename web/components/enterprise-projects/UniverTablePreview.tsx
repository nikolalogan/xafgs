'use client'

import UniverTableEditor from './UniverTableEditor'

type UniverTablePreviewProps = {
  workbook: Record<string, unknown>
}

export default function UniverTablePreview({ workbook }: UniverTablePreviewProps) {
  return <UniverTableEditor workbook={workbook} />
}
