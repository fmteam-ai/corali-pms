import path from "node:path";
import { fileURLToPath } from "node:url";
import module from "node:module";
import { loadRuntimeEnvironment } from "./scripts/load-runtime-env.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const runtimeFile = path.join(directory, "runtime.env");
loadRuntimeEnvironment(runtimeFile);
module.createRequire(import.meta.url)("./server.js");
