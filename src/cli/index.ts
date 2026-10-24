import { runErrorsCommand } from "./errors-command.js";
import { runInsightsCommand } from "./insights-command.js";
import { runShowCommand } from "./show-command.js";
import { runTailCommand } from "./tail-command.js";

const io = {
  stdout: (text: string) => process.stdout.write(text),
  stderr: (text: string) => process.stderr.write(text),
};

const argv = process.argv.slice(2);
const run =
  argv[0] === "tail"
    ? runTailCommand
    : argv[0] === "show"
      ? runShowCommand
      : argv[0] === "insights"
        ? runInsightsCommand
        : runErrorsCommand;

void run(argv, io)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
