/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DaemonClient, FetchAgentsEntry } from "@server/client/daemon-client";
import type { AgentSnapshotPayload } from "@server/shared/messages";
import { PARENT_AGENT_ID_LABEL } from "@server/shared/agent-labels";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceResumeSheet } from "@/screens/workspace/workspace-resume-sheet";

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

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/components/provider-icons", () => ({
  getProviderIcon: () => () => null,
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () =>
    React.createElement("span", { "data-testid": "workspace-resume-loading-spinner" }),
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

type ResumeSessionsClient = Pick<
  DaemonClient,
  "fetchAgents" | "fetchAgentTimeline" | "resumeAgentSession"
>;

interface RenderOptions {
  visible?: boolean;
  onClose?: () => void;
  onResumedAgent?: (agentId: string) => void;
  openAgentIds?: ReadonlySet<string>;
  serverId?: string | null;
  workspaceDirectory?: string | null;
}

function renderSheet(client: ResumeSessionsClient | null, options?: RenderOptions) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceResumeSheet
        visible={options?.visible ?? true}
        client={client}
        serverId={options?.serverId === undefined ? "server-1" : options.serverId}
        workspaceDirectory={
          options?.workspaceDirectory === undefined ? "/repo/paseo" : options.workspaceDirectory
        }
        openAgentIds={options?.openAgentIds}
        onClose={options?.onClose ?? vi.fn()}
        onResumedAgent={options?.onResumedAgent ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

function createResumeSessionsClient(
  overrides?: Partial<ResumeSessionsClient>,
): ResumeSessionsClient {
  return {
    fetchAgents: vi.fn(async () => createFetchAgentsPayload([])),
    fetchAgentTimeline: vi.fn(async () => createTimelinePayload()),
    resumeAgentSession: vi.fn(async (agentId: string) => createAgentSnapshot({ id: agentId })),
    ...overrides,
  };
}

function createFetchAgentsPayload(entries: FetchAgentsEntry[]) {
  return {
    requestId: "fetch-agents",
    entries,
    pageInfo: {
      nextCursor: null,
      prevCursor: null,
      hasMore: false,
    },
  } satisfies Awaited<ReturnType<DaemonClient["fetchAgents"]>>;
}

function createTimelinePayload(): Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>> {
  return {
    requestId: "timeline",
    agentId: "agent-1",
    agent: null,
    direction: "tail",
    projection: "canonical",
    epoch: "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 0, maxSeq: 0, nextSeq: 0 },
    startCursor: null,
    endCursor: null,
    hasOlder: false,
    hasNewer: false,
    entries: [],
    error: null,
  };
}

function createAgentEntry(agent: AgentSnapshotPayload): FetchAgentsEntry {
  return {
    agent,
    project: {
      projectKey: "project-1",
      projectName: "Paseo",
      checkout: {
        cwd: agent.cwd,
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

function createAgentSnapshot(overrides?: Partial<AgentSnapshotPayload>): AgentSnapshotPayload {
  return {
    id: "agent-1",
    provider: "claude",
    cwd: "/repo/paseo",
    model: "claude-opus-4-7",
    createdAt: "2026-04-30T09:00:00.000Z",
    updatedAt: "2026-04-30T10:00:00.000Z",
    lastUserMessageAt: "2026-04-30T09:30:00.000Z",
    status: "closed",
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
    persistence: {
      provider: "claude",
      sessionId: "session-1",
    },
    title: "Archived session",
    labels: {},
    archivedAt: "2026-04-30T10:00:00.000Z",
    ...overrides,
  };
}

describe("WorkspaceResumeSheet", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("shows a connect message and does not fetch when the workspace is unavailable", async () => {
    const client = createResumeSessionsClient();

    renderSheet(client, { workspaceDirectory: null });

    await screen.findByText("Connect to a workspace to resume sessions");
    expect(client.fetchAgents).not.toHaveBeenCalled();
  });

  it("shows a loading state while sessions are loading", async () => {
    const client = createResumeSessionsClient({
      fetchAgents: vi.fn(
        () => new Promise<Awaited<ReturnType<DaemonClient["fetchAgents"]>>>(() => {}),
      ),
    });

    renderSheet(client);

    await screen.findByText("Loading sessions...");
  });

  it("loads archived workspace sessions and filters sessions that are active, open, external, or not resumable", async () => {
    vi.setSystemTime(new Date("2026-04-30T12:00:00.000Z"));
    const visibleArchived = createAgentSnapshot({
      id: "agent-archived",
      title: "Resume this archived session",
      provider: "claude",
    });
    const closedUnarchived = createAgentSnapshot({
      id: "agent-closed",
      title: "Resume this closed session",
      provider: "codex",
      status: "closed",
      archivedAt: null,
      updatedAt: "2026-04-30T11:00:00.000Z",
    });
    const activeAgent = createAgentSnapshot({
      id: "agent-active",
      title: "Active session",
      status: "idle",
      archivedAt: null,
    });
    const openArchived = createAgentSnapshot({
      id: "agent-open",
      title: "Already in tabbar",
    });
    const otherWorkspace = createAgentSnapshot({
      id: "agent-other-workspace",
      title: "Other workspace",
      cwd: "/repo/other",
    });
    const noPersistence = createAgentSnapshot({
      id: "agent-no-persistence",
      title: "Missing persistence",
      persistence: null,
    });
    const subagent = createAgentSnapshot({
      id: "agent-subagent",
      title: "Subagent",
      labels: { [PARENT_AGENT_ID_LABEL]: "parent-agent" },
    });
    const client = createResumeSessionsClient({
      fetchAgents: vi.fn(async () =>
        createFetchAgentsPayload(
          [
            visibleArchived,
            closedUnarchived,
            activeAgent,
            openArchived,
            otherWorkspace,
            noPersistence,
            subagent,
          ].map(createAgentEntry),
        ),
      ),
    });

    renderSheet(client, { openAgentIds: new Set(["agent-open"]) });

    await waitFor(() => {
      expect(client.fetchAgents).toHaveBeenCalledWith({
        filter: { includeArchived: true },
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 200 },
      });
    });

    await screen.findByText("Resume this archived session");
    screen.getByText("Resume this closed session");
    screen.getByText("1h ago");
    expect(screen.queryByText("Active session")).toBeNull();
    expect(screen.queryByText("Already in tabbar")).toBeNull();
    expect(screen.queryByText("Other workspace")).toBeNull();
    expect(screen.queryByText("Missing persistence")).toBeNull();
    expect(screen.queryByText("Subagent")).toBeNull();
  });

  it("shows an empty state when there are no sessions to resume", async () => {
    const client = createResumeSessionsClient({
      fetchAgents: vi.fn(async () => createFetchAgentsPayload([])),
    });

    renderSheet(client);

    await screen.findByText("No sessions to resume.");
  });

  it("shows a fetch error state when sessions cannot be loaded", async () => {
    const client = createResumeSessionsClient({
      fetchAgents: vi.fn(async () => {
        throw new Error("agents unavailable");
      }),
    });

    renderSheet(client);

    await screen.findByText("Could not load sessions.");
  });

  it("keeps cached rows visible and revalidates when reopened", async () => {
    const client = createResumeSessionsClient({
      fetchAgents: vi.fn(async () =>
        createFetchAgentsPayload([
          createAgentEntry(
            createAgentSnapshot({ id: "agent-cached", title: "Cached resumable session" }),
          ),
        ]),
      ),
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    function TestSheet({ visible }: { visible: boolean }) {
      return (
        <QueryClientProvider client={queryClient}>
          <WorkspaceResumeSheet
            visible={visible}
            client={client}
            serverId="server-1"
            workspaceDirectory="/repo/paseo"
            onClose={vi.fn()}
            onResumedAgent={vi.fn()}
          />
        </QueryClientProvider>
      );
    }

    const { rerender } = render(<TestSheet visible />);

    await screen.findByText("Cached resumable session");
    expect(client.fetchAgents).toHaveBeenCalledTimes(1);

    rerender(<TestSheet visible={false} />);
    vi.mocked(client.fetchAgents).mockClear();
    rerender(<TestSheet visible />);

    await screen.findByText("Cached resumable session");
    await waitFor(() => {
      expect(client.fetchAgents).toHaveBeenCalledWith({
        filter: { includeArchived: true },
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 200 },
      });
    });
  });

  it("resumes a selected session by agent id and reports the resumed agent", async () => {
    const client = createResumeSessionsClient({
      fetchAgents: vi.fn(async () =>
        createFetchAgentsPayload([
          createAgentEntry(createAgentSnapshot({ id: "agent-resume", title: "Resume me" })),
        ]),
      ),
    });
    const onClose = vi.fn();
    const onResumedAgent = vi.fn();

    renderSheet(client, { onClose, onResumedAgent });

    fireEvent.click(await screen.findByTestId("workspace-resume-session-agent-resume"));

    await waitFor(() => {
      expect(client.resumeAgentSession).toHaveBeenCalledWith("agent-resume");
    });
    expect(client.fetchAgentTimeline).toHaveBeenCalledWith("agent-resume", {
      direction: "tail",
      limit: 100,
      projection: "canonical",
    });
    expect(onResumedAgent).toHaveBeenCalledWith("agent-resume");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a resume error state without closing when selected session resume fails", async () => {
    const client = createResumeSessionsClient({
      fetchAgents: vi.fn(async () =>
        createFetchAgentsPayload([
          createAgentEntry(createAgentSnapshot({ id: "agent-fails", title: "Resume fails" })),
        ]),
      ),
      resumeAgentSession: vi.fn(async () => {
        throw new Error("resume unavailable");
      }),
    });
    const onClose = vi.fn();
    const onResumedAgent = vi.fn();

    renderSheet(client, { onClose, onResumedAgent });

    fireEvent.click(await screen.findByTestId("workspace-resume-session-agent-fails"));

    await screen.findByText("Could not resume selected session.");
    expect(client.resumeAgentSession).toHaveBeenCalledWith("agent-fails");
    expect(onResumedAgent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("filters the merged list when a provider badge is selected and restores it on All", async () => {
    const client = createResumeSessionsClient({
      fetchAgents: vi.fn(async () =>
        createFetchAgentsPayload([
          createAgentEntry(
            createAgentSnapshot({
              id: "agent-claude",
              provider: "claude",
              title: "Session claude",
              updatedAt: "2026-04-30T09:00:00.000Z",
            }),
          ),
          createAgentEntry(
            createAgentSnapshot({
              id: "agent-codex",
              provider: "codex",
              title: "Session codex",
              updatedAt: "2026-04-30T10:00:00.000Z",
            }),
          ),
        ]),
      ),
    });

    renderSheet(client);

    await screen.findByText("Session claude");
    await screen.findByText("Session codex");

    fireEvent.click(screen.getByTestId("workspace-resume-filter-codex"));

    screen.getByText("Session codex");
    expect(screen.queryByText("Session claude")).toBeNull();

    fireEvent.click(screen.getByTestId("workspace-resume-filter-all"));

    screen.getByText("Session claude");
    screen.getByText("Session codex");
  });

  it("does not render filter badges when only one provider is present", async () => {
    const client = createResumeSessionsClient({
      fetchAgents: vi.fn(async () =>
        createFetchAgentsPayload([
          createAgentEntry(createAgentSnapshot({ id: "agent-codex", provider: "codex" })),
        ]),
      ),
    });

    renderSheet(client);

    await waitFor(() => {
      expect(client.fetchAgents).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("workspace-resume-filters")).toBeNull();
    expect(screen.queryByTestId("workspace-resume-filter-all")).toBeNull();
  });
});
