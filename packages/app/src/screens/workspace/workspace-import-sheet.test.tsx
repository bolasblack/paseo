/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DaemonClient, FetchRecentProviderSessionEntry } from "@server/client/daemon-client";
import type { ProviderSnapshotEntry } from "@server/server/agent/agent-sdk-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceImportSheet } from "@/screens/workspace/workspace-import-sheet";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 6: 24 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6, lg: 8, full: 9999 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { normal: "400", medium: "500", semibold: "600" },
    iconSize: { sm: 14, md: 16 },
    opacity: { 50: 0.5 },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface0: "#000",
      surface1: "#111",
      surface2: "#222",
      surface3: "#333",
      border: "#444",
      borderAccent: "#555",
    },
  },
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) =>
    ({
      uniProps,
      ...rest
    }: {
      uniProps?: (theme: unknown) => Record<string, unknown>;
    } & Record<string, unknown>) => {
      const themed = uniProps ? uniProps(theme) : {};
      return React.createElement(Component, { ...rest, ...themed });
    },
}));

vi.mock("@/components/provider-icons", () => ({
  getProviderIcon: () => () => null,
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () =>
    React.createElement("span", { "data-testid": "workspace-import-loading-spinner" }),
}));

vi.mock("@/components/ui/segmented-control", () => ({
  SegmentedControl: ({
    options,
    value,
    onValueChange,
    testID,
  }: {
    options: ReadonlyArray<{ value: string; label: string; testID?: string }>;
    value: string;
    onValueChange: (value: string) => void;
    testID?: string;
  }) =>
    React.createElement(
      "div",
      { "data-testid": testID },
      options.map((option) =>
        React.createElement(
          "button",
          {
            key: option.value,
            type: "button",
            "data-testid": option.testID,
            "data-selected": value === option.value,
            onClick: () => onValueChange(option.value),
          },
          option.label,
        ),
      ),
    ),
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    visible,
    title,
    children,
    testID,
  }: {
    visible: boolean;
    title: string;
    children: ReactNode;
    testID?: string;
  }) =>
    visible ? (
      <section data-testid={testID}>
        <h1>{title}</h1>
        {children}
      </section>
    ) : null,
}));

vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return actual;
});

const mockSnapshot = vi.hoisted(() => ({
  current: {
    entries: undefined as ProviderSnapshotEntry[] | undefined,
    supportsSnapshot: false,
  },
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({
    entries: mockSnapshot.current.entries,
    isLoading: false,
    isFetching: false,
    isRefreshing: false,
    error: null,
    supportsSnapshot: mockSnapshot.current.supportsSnapshot,
    refresh: vi.fn(),
    refetchIfStale: vi.fn(),
  }),
}));

type ImportSessionsClient = Pick<DaemonClient, "fetchRecentProviderSessions" | "importAgent">;

interface RenderOptions {
  visible?: boolean;
  onClose?: () => void;
  onImportedAgent?: (agentId: string) => void;
  snapshot?: {
    entries?: ProviderSnapshotEntry[];
    supportsSnapshot?: boolean;
  };
}

function renderSheet(client: ImportSessionsClient, options?: RenderOptions) {
  mockSnapshot.current = {
    entries: options?.snapshot?.entries,
    supportsSnapshot: options?.snapshot?.supportsSnapshot ?? false,
  };

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceImportSheet
        visible={options?.visible ?? true}
        client={client}
        serverId="server-1"
        workspaceDirectory="/repo/paseo"
        onClose={options?.onClose ?? vi.fn()}
        onImportedAgent={options?.onImportedAgent ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function createClient(overrides?: Partial<ImportSessionsClient>): ImportSessionsClient {
  return {
    fetchRecentProviderSessions: vi.fn(async () => ({
      requestId: "recent-provider-sessions",
      entries: [],
    })),
    importAgent: vi.fn(async () => createImportedAgentSnapshot("agent-imported")),
    ...overrides,
  };
}

function createImportedAgentSnapshot(id: string): Awaited<ReturnType<DaemonClient["importAgent"]>> {
  return {
    id,
    provider: "claude",
    cwd: "/repo/paseo",
    model: null,
    createdAt: "2026-04-30T10:00:00.000Z",
    updatedAt: "2026-04-30T10:00:00.000Z",
    lastUserMessageAt: "2026-04-30T10:00:00.000Z",
    status: "idle",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
  };
}

function createProviderSessionEntry(
  overrides?: Partial<FetchRecentProviderSessionEntry>,
): FetchRecentProviderSessionEntry {
  return {
    providerId: "claude",
    providerLabel: "Claude Code",
    providerHandleId: "provider-thread-1",
    cwd: "/repo/paseo",
    title: "Import me",
    firstPromptPreview: "Import this external provider session",
    lastPromptPreview: "Import this external provider session",
    lastActivityAt: "2026-04-30T10:00:00.000Z",
    ...overrides,
  };
}

function createSnapshotEntry(
  provider: string,
  overrides?: Partial<ProviderSnapshotEntry>,
): ProviderSnapshotEntry {
  return {
    provider,
    status: "ready",
    enabled: true,
    label: provider === "claude" ? "Claude Code" : provider,
    ...overrides,
  };
}

describe("WorkspaceImportSheet", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows an update-host message when the daemon does not support provider snapshots", async () => {
    const client = createClient();

    renderSheet(client);

    await screen.findByText("Update the host to import sessions.");
    expect(client.fetchRecentProviderSessions).not.toHaveBeenCalled();
  });

  it("loads recent provider sessions for the workspace", async () => {
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
    const client = createClient({
      fetchRecentProviderSessions: vi.fn(async () => ({
        requestId: "recent-provider-sessions",
        entries: [
          createProviderSessionEntry({
            title: null,
            firstPromptPreview: "Implement the importer sheet",
            lastPromptPreview: "Make the rows readable and provider opaque",
          }),
        ],
      })),
    });

    renderSheet(client, {
      snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
    });

    await waitFor(() => {
      expect(client.fetchRecentProviderSessions).toHaveBeenCalledWith({
        cwd: "/repo/paseo",
        providers: ["claude"],
        limit: 15,
      });
    });

    await screen.findByText("Implement the importer sheet");
    screen.getByText("2h ago");
    screen.getByText("Make the rows readable and provider opaque");
  });

  it("imports a selected session by provider handle", async () => {
    const client = createClient({
      fetchRecentProviderSessions: vi.fn(async () => ({
        requestId: "recent-provider-sessions",
        entries: [createProviderSessionEntry()],
      })),
    });
    const onClose = vi.fn();
    const onImportedAgent = vi.fn();

    renderSheet(client, {
      onClose,
      onImportedAgent,
      snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
    });

    fireEvent.click(await screen.findByTestId("workspace-import-session-claude-provider-thread-1"));

    await waitFor(() => {
      expect(client.importAgent).toHaveBeenCalledWith({
        providerId: "claude",
        providerHandleId: "provider-thread-1",
        cwd: "/repo/paseo",
      });
    });
    expect(onImportedAgent).toHaveBeenCalledWith("agent-imported");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an import error state without closing when selected session import fails", async () => {
    const client = createClient({
      fetchRecentProviderSessions: vi.fn(async () => ({
        requestId: "recent-provider-sessions",
        entries: [createProviderSessionEntry()],
      })),
      importAgent: vi.fn(async () => {
        throw new Error("import unavailable");
      }),
    });
    const onClose = vi.fn();
    const onImportedAgent = vi.fn();

    renderSheet(client, {
      onClose,
      onImportedAgent,
      snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
    });

    fireEvent.click(await screen.findByTestId("workspace-import-session-claude-provider-thread-1"));

    await screen.findByText("Could not import selected session.");
    expect(onImportedAgent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows all-already-imported empty state when provider sessions were filtered", async () => {
    const client = createClient({
      fetchRecentProviderSessions: vi.fn(async () => ({
        requestId: "recent-provider-sessions",
        entries: [],
        filteredAlreadyImportedCount: 3,
      })),
    });

    renderSheet(client, {
      snapshot: { supportsSnapshot: true, entries: [createSnapshotEntry("claude")] },
    });

    await screen.findByText("All recent sessions are already in Paseo.");
    expect(screen.queryByText("No recent sessions to import.")).toBeNull();
  });

  it("shows no-importable-providers message when no enabled provider can be imported", async () => {
    const client = createClient();

    renderSheet(client, {
      snapshot: {
        supportsSnapshot: true,
        entries: [createSnapshotEntry("claude", { enabled: false }), createSnapshotEntry("z-ai")],
      },
    });

    await screen.findByText("No importable providers are enabled.");
    expect(client.fetchRecentProviderSessions).not.toHaveBeenCalled();
  });
});
