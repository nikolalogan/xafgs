'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AppIndexPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/app/workflow')
  }, [router])

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="text-sm text-gray-500">加载中...</div>
    </div>
  )
}
