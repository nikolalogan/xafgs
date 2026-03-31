'use client'

import { useEffect, useState } from 'react'

export type ConsoleRole = 'admin' | 'user' | 'guest'

export function useConsoleRole() {
  const [role, setRole] = useState<ConsoleRole>('guest')
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const syncRole = () => {
      const raw = (window.localStorage.getItem('sxfg_user_role') || window.localStorage.getItem('user_role') || 'guest').toLowerCase()
      if (raw === 'admin' || raw === 'user') {
        setRole(raw)
        return
      }
      setRole('guest')
    }

    syncRole()
    setHydrated(true)
    window.addEventListener('storage', syncRole)
    return () => window.removeEventListener('storage', syncRole)
  }, [])

  return { role, hydrated }
}

