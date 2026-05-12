import { Command } from "commander";
import type { DaemonClient } from "@getpaseo/server";
import { connectToDaemon, getDaemonHost, resolveAgentId } from "../../utils/client.js";
import type {
  CommandOptions,
  SingleResult,
  OutputSchema,
  CommandError,
} from "../../output/index.js";

export interface AgentResumeResult {
  agentId: string;
  status: "resumed";
}

export const resumeSchema: OutputSchema<AgentResumeResult> = {
  idField: "agentId",
  columns: [
    { header: "AGENT ID", field: "agentId" },
    { header: "STATUS", field: "status" },
  ],
};

export function addResumeOptions(cmd: Command): Command {
  return cmd
    .description("Resume an archived or closed agent session")
    .argument("<id>", "Agent ID, prefix, or name");
}

export interface AgentResumeOptions extends CommandOptions {
  host?: string;
}

export type AgentResumeCommandResult = SingleResult<AgentResumeResult>;

export async function runResumeCommand(
  agentIdArg: string,
  options: AgentResumeOptions,
  _command: Command,
): Promise<AgentResumeCommandResult> {
  const host = getDaemonHost({ host: options.host });

  if (!agentIdArg || agentIdArg.trim().length === 0) {
    const error: CommandError = {
      code: "MISSING_AGENT_ID",
      message: "Agent ID is required",
      details: "Usage: paseo agent resume <id-or-name>",
    };
    throw error;
  }

  let client: DaemonClient;
  try {
    client = await connectToDaemon({ host: options.host });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${host}: ${message}`,
      details: "Start the daemon with: paseo daemon start",
    };
    throw error;
  }

  try {
    const agentsPayload = await client.fetchAgents({ filter: { includeArchived: true } });
    const agents = agentsPayload.entries.map((entry) => entry.agent);
    const agentId = resolveAgentId(agentIdArg, agents);
    if (!agentId) {
      const error: CommandError = {
        code: "AGENT_NOT_FOUND",
        message: `Agent not found: ${agentIdArg}`,
        details: 'Use "paseo ls -a" to list archived agents',
      };
      throw error;
    }

    const agent = await client.resumeAgentSession(agentId);

    await client.close();

    return {
      type: "single",
      data: {
        agentId: agent.id,
        status: "resumed",
      },
      schema: resumeSchema,
    };
  } catch (err) {
    await client.close().catch(() => {});

    if (err && typeof err === "object" && "code" in err) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "RESUME_FAILED",
      message: `Failed to resume agent: ${message}`,
    };
    throw error;
  }
}
