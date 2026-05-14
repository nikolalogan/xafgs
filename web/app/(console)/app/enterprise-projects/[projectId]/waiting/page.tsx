import { redirect } from 'next/navigation'

export default async function EnterpriseProjectWaitingPageRedirect({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  redirect(`/app/enterprise-projects/${projectId}`)
}
