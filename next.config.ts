import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // @codebuff/sdk pulls in web-tree-sitter / @vscode/tree-sitter-wasm, whose
  // .wasm loader modules use special WASM import schemes (GOT.mem, env,
  // WASM_HELPER) that bundlers cannot resolve. Keep the whole SDK external to
  // the server bundle: it is required at runtime from node_modules instead.
  serverExternalPackages: ["@codebuff/sdk"],
};

export default nextConfig;
