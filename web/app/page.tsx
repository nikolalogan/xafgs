import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold">SXFG Console（Next.js 版）</h1>
      <p className="text-sm text-gray-500">框架已切换为 Next.js + Tailwind + reactflow@11</p>
      <Link href="/app/workflow" className="rounded-lg bg-blue-600 px-5 py-2.5 text-white hover:bg-blue-700">
        进入 Workflow 画布
      </Link>
    </main>
  )
}
