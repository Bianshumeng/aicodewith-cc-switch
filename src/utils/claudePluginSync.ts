export type ClaudePluginSyncAction = "write" | "clear" | "noop";

export const resolveClaudePluginSyncAction = (options: {
  enabled: boolean;
  isOfficial: boolean;
}): ClaudePluginSyncAction => {
  if (!options.enabled) return "clear";
  return options.isOfficial ? "noop" : "write";
};
