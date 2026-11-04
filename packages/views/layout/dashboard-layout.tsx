"use client";

import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@multica/ui/components/ui/sidebar";
import { ModalRegistry } from "../modals/registry";
import { SourceBackfillModal } from "../onboarding";
import { AppSidebar } from "./app-sidebar";
import { DockedStatusBar } from "./docked-status-bar";
import { DashboardGuard } from "./dashboard-guard";
import { NavigationProgress } from "./navigation-progress";
import { WorkspacePresencePrefetch } from "./workspace-presence-prefetch";
import { GlobalShortcuts } from "./global-shortcuts";

interface DashboardLayoutProps {
  children: ReactNode;
  /** Rendered inside SidebarInset (e.g. ChatWindow, ChatFab — absolute-positioned overlays) */
  extra?: ReactNode;
  /** Rendered inside sidebar header as a search trigger */
  searchSlot?: ReactNode;
  /** Loading indicator */
  loadingIndicator?: ReactNode;
}

export function DashboardLayout({
  children,
  extra,
  searchSlot,
  loadingIndicator,
}: DashboardLayoutProps) {
  return (
    <DashboardGuard
      loadingFallback={
        <div className="flex h-svh items-center justify-center">
          {loadingIndicator}
        </div>
      }
    >
      <div className="flex h-svh flex-col bg-app-shell">
        <SidebarProvider className="min-h-0 flex-1 bg-app-shell">
          <GlobalShortcuts />
          <WorkspacePresencePrefetch />
          <AppSidebar searchSlot={searchSlot} />
          <SidebarInset className="relative overflow-hidden">
            <NavigationProgress />
            {children}
            <ModalRegistry />
            <SourceBackfillModal />
            {extra}
          </SidebarInset>
        </SidebarProvider>
        <DockedStatusBar />
      </div>
    </DashboardGuard>
  );
}
