import { redirect } from 'next/navigation'

export default async function EnterpriseProjectReportPageRedirect({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  redirect(`/app/enterprise-projects/${projectId}`)
}
