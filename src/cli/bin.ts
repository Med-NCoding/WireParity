#!/usr/bin/env node
import { runCLI } from "./index.js";

runCLI(process.argv.slice(2)).then((code) => {
  process.exit(code);
});
