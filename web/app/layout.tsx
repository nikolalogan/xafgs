import type { Metadata } from 'next'
import './globals.css'
import 'antd/dist/reset.css'

export const metadata: Metadata = {
  title: 'SXFG Console',
  description: 'Next.js + Tailwind + React Flow 11'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
