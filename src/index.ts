import {
  createSdkMcpServer,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import z from "zod";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export class Hands {
  prefix: string[];

  constructor(container: string) {
    this.prefix = ["docker", "exec", "-i", container];
  }

  execute(args: string[]): Promise<CommandResult> {
    const command = [...this.prefix, ...args];

    return new Promise((resolve) => {
      const child = spawn(command[0]!, [...this.prefix.slice(1), ...args]);

      const out: Buffer[] = [];
      const err: Buffer[] = [];

      child.stdout.on("data", (b: Buffer) => out.push(b));
      child.stderr.on("data", (b: Buffer) => err.push(b));

      child.on("error", (err) => {
        resolve({
          stdout: "",
          stderr: String(err),
        });
      });
      child.on("close", (_code) => {
        resolve({
          stdout: Buffer.concat(out).toString("utf-8"),
          stderr: Buffer.concat(err).toString("utf-8"),
        });
      });
    });
  }
}

const runCommand = (hands: Hands) =>
  tool(
    "run_command",
    "Run a bash command inside Linux sandbox",
    { command: z.string().describe("Bash command to run") },
    async ({ command }) => {
      const response = await hands.execute(["bash", "-c", command]);

      return {
        content: [{ type: "text", text: response.stderr || response.stdout }],
      };
    },
  );

const main = async () => {
  const { values } = parseArgs({
    options: {
      container: { type: "string" },
      model: { type: "string" },
      prompt: { type: "string" },
    },
  });

  const hands = new Hands(values.container!);

  const server = createSdkMcpServer({
    name: "sandbox",
    tools: [runCommand(hands)],
  });

  for await (const message of query({
    prompt: values.prompt!,
    options: {
      tools: [],
      mcpServers: { sandbox: server },
      settingSources: [],
      allowedTools: ["mcp__sandbox__*"],
      permissionMode: "dontAsk",
      systemPrompt: {
        type: "custom",
        prompt: "You are an agent with hands in a sandbox",
      },
      // systemPrompt: { type: "preset", preset: "claude_code" },
      model: values.model,
    },
  })) {
    console.log(message);
  }
};

main();
