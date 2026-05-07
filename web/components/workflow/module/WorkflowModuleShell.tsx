'use client'

import type { ReactNode } from 'react'

type WorkflowModuleShellProps = {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}

export default function WorkflowModuleShell({
  title,
  description,
  actions,
  children,
}: WorkflowModuleShellProps) {
  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_60px_-32px_rgba(15,23,42,0.45)]">
        <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eef2ff_45%,#ecfeff_100%)] px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Workflow Studio</div>
              <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
              {description && <p className="max-w-3xl text-sm text-slate-600">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        </div>
        <div className="px-6 py-6">{children}</div>
      </section>
    </div>
  )
}
