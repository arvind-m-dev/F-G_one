'use client';
import { PortalGate } from '@/components/shell/portal';
import { WorkspaceShell } from '@/components/shell/workspace-shell';

/** Employee portal (/app). */
export default function EmployeePortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalGate>
      <WorkspaceShell portal="app">{children}</WorkspaceShell>
    </PortalGate>
  );
}
