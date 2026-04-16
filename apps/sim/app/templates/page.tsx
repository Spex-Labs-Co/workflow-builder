import { db } from '@sim/db'
import { permissions, workspace } from '@sim/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'Templates',
  description: 'Browse workflow templates in your Spex workspace.',
}

export default async function TemplatesPage() {
  const session = await getSession()

  if (!session?.user?.id) {
    redirect('/login')
  }

  const userWorkspaces = await db
    .select({
      workspace,
    })
    .from(permissions)
    .innerJoin(workspace, eq(permissions.entityId, workspace.id))
    .where(and(eq(permissions.userId, session.user.id), eq(permissions.entityType, 'workspace')))
    .orderBy(desc(workspace.createdAt))
    .limit(1)

  if (userWorkspaces.length > 0) {
    redirect(`/workspace/${userWorkspaces[0].workspace.id}/templates`)
  }

  redirect('/workspace')
}
