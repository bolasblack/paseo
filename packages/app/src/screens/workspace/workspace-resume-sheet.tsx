import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, type PressableStateCallbackType, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient, FetchAgentsEntry } from "@server/client/daemon-client";
import type { AgentSnapshotPayload } from "@server/shared/messages";
import { PARENT_AGENT_ID_LABEL } from "@server/shared/agent-labels";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { getProviderIcon } from "@/components/provider-icons";
import { useAgentInitialization } from "@/hooks/use-agent-initialization";
import { formatTimeAgo } from "@/utils/time";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

const AGENT_DIRECTORY_PAGE_LIMIT = 200;
const IMPORT_SHEET_SNAP_POINTS = ["70%", "92%"];
const DISABLED_ACCESSIBILITY_STATE = { disabled: true };
const ALL_FILTER_VALUE = "__all__";

type ResumeSessionsClient = Pick<
  DaemonClient,
  "fetchAgents" | "fetchAgentTimeline" | "resumeAgentSession"
>;

interface WorkspaceResumeSheetProps {
  visible: boolean;
  client: ResumeSessionsClient | null;
  serverId: string | null;
  workspaceDirectory: string | null;
  openAgentIds?: ReadonlySet<string>;
  onClose: () => void;
  onResumedAgent: (agentId: string) => void;
}

async function fetchAllAgentDirectoryEntries(
  client: Pick<DaemonClient, "fetchAgents">,
): Promise<FetchAgentsEntry[]> {
  const entries: FetchAgentsEntry[] = [];
  let cursor: string | null = null;

  while (true) {
    const payload = await client.fetchAgents({
      filter: { includeArchived: true },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: cursor
        ? { limit: AGENT_DIRECTORY_PAGE_LIMIT, cursor }
        : { limit: AGENT_DIRECTORY_PAGE_LIMIT },
    });

    entries.push(...payload.entries);

    if (!payload.pageInfo.hasMore || !payload.pageInfo.nextCursor) {
      break;
    }
    cursor = payload.pageInfo.nextCursor;
  }

  return entries;
}

function isRootAgent(agent: AgentSnapshotPayload): boolean {
  return !agent.labels[PARENT_AGENT_ID_LABEL]?.trim();
}

function isResumableAgent(agent: AgentSnapshotPayload): boolean {
  return Boolean(
    agent.persistence && isRootAgent(agent) && (agent.archivedAt || agent.status === "closed"),
  );
}

function isInWorkspace(agent: AgentSnapshotPayload, workspaceDirectory: string): boolean {
  return normalizeWorkspacePath(agent.cwd) === normalizeWorkspacePath(workspaceDirectory);
}

function listResumableWorkspaceAgents(input: {
  entries: ReadonlyArray<FetchAgentsEntry>;
  workspaceDirectory: string;
}): AgentSnapshotPayload[] {
  const seen = new Set<string>();
  const agents: AgentSnapshotPayload[] = [];

  for (const entry of input.entries) {
    const agent = entry.agent;
    if (seen.has(agent.id)) continue;
    seen.add(agent.id);
    if (!isInWorkspace(agent, input.workspaceDirectory)) continue;
    if (!isResumableAgent(agent)) continue;
    agents.push(agent);
  }

  return agents.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function filterOpenAgents(
  agents: ReadonlyArray<AgentSnapshotPayload>,
  openAgentIds: ReadonlySet<string> | undefined,
): AgentSnapshotPayload[] {
  if (!openAgentIds || openAgentIds.size === 0) {
    return [...agents];
  }
  return agents.filter((agent) => !openAgentIds.has(agent.id));
}

function buildProviderLabelMap(agents: ReadonlyArray<AgentSnapshotPayload>): Map<string, string> {
  const map = new Map<string, string>();
  for (const agent of agents) {
    map.set(agent.provider, agent.provider);
  }
  return map;
}

function getAgentTitle(agent: AgentSnapshotPayload): string {
  const title = agent.title?.trim();
  if (title) {
    return title;
  }
  return `Session ${agent.id.slice(0, 8)}`;
}

function getAgentPreview(agent: AgentSnapshotPayload): string {
  const status = agent.archivedAt ? "Archived" : "Closed";
  const model = agent.model?.trim();
  return [status, agent.provider, model].filter(Boolean).join(" · ");
}

interface SheetStatusMessagesProps {
  isClientReady: boolean;
  isLoadingSessions: boolean;
  isLoadError: boolean;
  resumeErrored: boolean;
  showEmptyState: boolean;
}

function SheetStatusMessages({
  isClientReady,
  isLoadingSessions,
  isLoadError,
  resumeErrored,
  showEmptyState,
}: SheetStatusMessagesProps) {
  const { theme } = useUnistyles();
  if (!isClientReady) {
    return <Text style={styles.statusText}>Connect to a workspace to resume sessions</Text>;
  }
  return (
    <>
      {isLoadingSessions ? (
        <View style={styles.statusRow}>
          <LoadingSpinner color={theme.colors.foregroundMuted} />
          <Text style={styles.statusText}>Loading sessions...</Text>
        </View>
      ) : null}
      {isLoadError ? <Text style={styles.statusText}>Could not load sessions.</Text> : null}
      {resumeErrored ? (
        <Text style={styles.statusText}>Could not resume selected session.</Text>
      ) : null}
      {showEmptyState ? <Text style={styles.statusText}>No sessions to resume.</Text> : null}
    </>
  );
}

function buildProviderFilterOptions(
  providers: ReadonlyArray<string>,
  providerLabelById: ReadonlyMap<string, string>,
): SegmentedControlOption<string>[] {
  const options: SegmentedControlOption<string>[] = [
    { value: ALL_FILTER_VALUE, label: "All", testID: "workspace-resume-filter-all" },
  ];
  for (const provider of providers) {
    const ProviderIcon = getProviderIcon(provider);
    options.push({
      value: provider,
      label: providerLabelById.get(provider) ?? provider,
      testID: `workspace-resume-filter-${provider}`,
      icon: ({ color, size }) => <ProviderIcon color={color} size={size} />,
    });
  }
  return options;
}

function WorkspaceImportSheetRow({
  agent,
  disabled,
  resuming,
  onResumeSession,
}: {
  agent: AgentSnapshotPayload;
  disabled: boolean;
  resuming: boolean;
  onResumeSession: (agent: AgentSnapshotPayload) => void;
}) {
  const { theme } = useUnistyles();
  const title = getAgentTitle(agent);
  const preview = getAgentPreview(agent);
  const lastActivity = formatTimeAgo(new Date(agent.updatedAt));
  const ProviderIcon = getProviderIcon(agent.provider);
  const accessibilityState = useMemo(
    () => (disabled ? DISABLED_ACCESSIBILITY_STATE : undefined),
    [disabled],
  );
  const handlePress = useCallback(() => {
    onResumeSession(agent);
  }, [agent, onResumeSession]);
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [],
  );

  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      style={pressableStyle}
      testID={`workspace-resume-session-${agent.id}`}
    >
      <View style={styles.rowIconWrap}>
        <ProviderIcon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
      </View>
      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowMeta}>{resuming ? "Resuming..." : lastActivity}</Text>
        </View>
        <Text style={styles.rowPreview} numberOfLines={2}>
          {preview}
        </Text>
      </View>
    </Pressable>
  );
}

export function WorkspaceResumeSheet({
  visible,
  client,
  serverId,
  workspaceDirectory,
  openAgentIds,
  onClose,
  onResumedAgent,
}: WorkspaceResumeSheetProps) {
  const queryClient = useQueryClient();
  const resolvedServerId = serverId ?? "";
  const { resumeAgentSession } = useAgentInitialization({
    serverId: resolvedServerId,
    client,
  });
  const isClientReady = Boolean(client && serverId && workspaceDirectory);
  const sessionsQueryRoot = useMemo(
    () => ["resumable-workspace-sessions", serverId, workspaceDirectory] as const,
    [serverId, workspaceDirectory],
  );

  const agentsQuery = useQuery({
    queryKey: sessionsQueryRoot,
    enabled: visible && isClientReady,
    queryFn: async () => {
      if (!client || !workspaceDirectory) {
        throw new Error("Host is not connected");
      }
      const entries = await fetchAllAgentDirectoryEntries(client);
      return listResumableWorkspaceAgents({ entries, workspaceDirectory });
    },
  });

  const resumableEntries = useMemo(
    () => filterOpenAgents(agentsQuery.data ?? [], openAgentIds),
    [agentsQuery.data, openAgentIds],
  );

  const filterProviders = useMemo(
    () => Array.from(new Set(resumableEntries.map((entry) => entry.provider))).sort(),
    [resumableEntries],
  );

  const providerLabelById = useMemo(
    () => buildProviderLabelMap(resumableEntries),
    [resumableEntries],
  );

  const [selectedProvider, setSelectedProvider] = useState<string>(ALL_FILTER_VALUE);

  useEffect(() => {
    if (
      !visible ||
      (selectedProvider !== ALL_FILTER_VALUE && !filterProviders.includes(selectedProvider))
    ) {
      setSelectedProvider(ALL_FILTER_VALUE);
    }
  }, [visible, filterProviders, selectedProvider]);

  const visibleEntries = useMemo(() => {
    if (selectedProvider === ALL_FILTER_VALUE) return resumableEntries;
    return resumableEntries.filter((entry) => entry.provider === selectedProvider);
  }, [resumableEntries, selectedProvider]);

  const filterOptions = useMemo(
    () => buildProviderFilterOptions(filterProviders, providerLabelById),
    [filterProviders, providerLabelById],
  );

  const resumeMutation = useMutation({
    mutationFn: async (agent: AgentSnapshotPayload) => {
      await resumeAgentSession(agent.id);
      return agent;
    },
    onSuccess: async (agent) => {
      await queryClient.invalidateQueries({ queryKey: sessionsQueryRoot });
      onClose();
      onResumedAgent(agent.id);
    },
  });

  const resumingAgentId = resumeMutation.isPending ? resumeMutation.variables?.id : null;

  const handleResumeSession = useCallback(
    (agent: AgentSnapshotPayload) => {
      resumeMutation.mutate(agent);
    },
    [resumeMutation],
  );

  const isLoadingSessions = agentsQuery.isPending;
  const showEmptyState = !isLoadingSessions && !agentsQuery.isError && visibleEntries.length === 0;
  const showFilter = filterProviders.length > 1;

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      title="Resume session"
      testID="workspace-resume-sheet"
      desktopMaxWidth={560}
      snapPoints={IMPORT_SHEET_SNAP_POINTS}
    >
      {showFilter ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <SegmentedControl
            testID="workspace-resume-filters"
            size="sm"
            options={filterOptions}
            value={selectedProvider}
            onValueChange={setSelectedProvider}
          />
        </ScrollView>
      ) : null}
      <SheetStatusMessages
        isClientReady={isClientReady}
        isLoadingSessions={isLoadingSessions}
        isLoadError={agentsQuery.isError}
        resumeErrored={resumeMutation.isError}
        showEmptyState={showEmptyState}
      />
      {visibleEntries.length > 0 ? (
        <View style={styles.list}>
          {visibleEntries.map((agent) => (
            <WorkspaceImportSheetRow
              key={agent.id}
              agent={agent}
              disabled={resumeMutation.isPending}
              resuming={resumingAgentId === agent.id}
              onResumeSession={handleResumeSession}
            />
          ))}
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  filterRow: {
    flexDirection: "row",
    paddingBottom: theme.spacing[2],
  },
  list: {
    gap: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    marginHorizontal: -theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  rowIconWrap: {
    width: theme.iconSize.md,
    paddingTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  rowPreview: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
