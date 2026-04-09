import { redirect } from 'next/navigation'

export default async function HomePage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams
  const raw = searchParams?.redirect
  const target = Array.isArray(raw) ? raw[0] : raw
  if (target) {
    redirect(`/login?redirect=${encodeURIComponent(target)}`)
  }
  redirect('/login')
}
