// Re-export of the shared GitHub client (@nexus/github-sync). Every existing
// `@/lib/deploy/github` import keeps working unchanged; the CLI imports the
// exact same functions from the package, so web and CLI never diverge.

export * from "@nexus/github-sync";
