import { Command, CommanderError } from "commander";
import { VERSION } from "../version.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export async function runErrorsCommand(argv: string[], io: CliIo): Promise<number> {
  const program = new Command();
  program
    .name("tb")
    .description("Toil Buster - CloudWatch Logs エラー抽出・統計CLI")
    .version(VERSION);
  program.exitOverride();
  program.configureOutput({
    writeOut: (s) => io.stdout(s),
    writeErr: (s) => io.stderr(s),
  });
  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode;
    throw err;
  }
}
