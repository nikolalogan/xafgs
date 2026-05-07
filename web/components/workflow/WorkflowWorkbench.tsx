'use client'

import type { ReactNode } from 'react'

type WorkflowWorkbenchProps = {
  library: ReactNode
  canvas: ReactNode
}

export default function WorkflowWorkbench({ library, canvas }: WorkflowWorkbenchProps) {
  return (
    <div className="grid min-h-[78vh] gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <div className="min-h-0">{library}</div>
      <div className="min-h-0">{canvas}</div>
    </div>
  )
}
