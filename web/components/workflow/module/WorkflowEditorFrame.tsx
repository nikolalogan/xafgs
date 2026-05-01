'use client'

import type { ReactNode } from 'react'

type WorkflowEditorFrameProps = {
  header: ReactNode
  sidebar?: ReactNode
  canvas: ReactNode
}

export default function WorkflowEditorFrame({ header, sidebar, canvas }: WorkflowEditorFrameProps) {
  const hasSidebar = Boolean(sidebar)

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_18px_60px_-32px_rgba(15,23,42,0.45)]">
        {header}
      </div>
      <div className={`grid gap-4 ${hasSidebar ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
        <div className="min-w-0 rounded-3xl border border-slate-200 bg-slate-50/70 p-4 shadow-[0_18px_60px_-32px_rgba(15,23,42,0.35)]">
          {canvas}
        </div>
        {hasSidebar && (
          <aside className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_18px_60px_-32px_rgba(15,23,42,0.35)]">
            {sidebar}
          </aside>
        )}
      </div>
    </div>
  )
}
