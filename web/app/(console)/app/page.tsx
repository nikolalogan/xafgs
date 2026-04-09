export default function AppIndexPage() {
  return (
    <div className="grid grid-cols-4 gap-6">
      <section className="col-span-3 space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="mb-4 h-7 w-40 animate-pulse rounded bg-gray-200" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`summary-${index}`} className="rounded-xl border border-gray-100 p-4">
                <div className="mb-3 h-4 w-20 animate-pulse rounded bg-gray-100" />
                <div className="mb-2 h-8 w-24 animate-pulse rounded bg-gray-200" />
                <div className="h-3 w-28 animate-pulse rounded bg-gray-100" />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="mb-4 h-6 w-48 animate-pulse rounded bg-gray-200" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={`table-${index}`} className="grid grid-cols-12 gap-3 rounded-xl border border-gray-100 p-4">
                <div className="col-span-4 h-4 animate-pulse rounded bg-gray-100" />
                <div className="col-span-3 h-4 animate-pulse rounded bg-gray-100" />
                <div className="col-span-3 h-4 animate-pulse rounded bg-gray-100" />
                <div className="col-span-2 h-4 animate-pulse rounded bg-gray-100" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="col-span-1 space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-4 h-6 w-24 animate-pulse rounded bg-gray-200" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`shortcut-${index}`} className="rounded-xl border border-gray-100 p-3">
                <div className="mb-2 h-4 w-20 animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-full animate-pulse rounded bg-gray-100" />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-4 h-6 w-20 animate-pulse rounded bg-gray-200" />
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`notice-${index}`} className="space-y-2">
                <div className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-full animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  )
}
