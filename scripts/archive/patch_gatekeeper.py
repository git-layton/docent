import re

with open("src/services/memoryGatekeeper.ts", "r") as f:
    content = f.read()

# Add spaceId to MemoryGatekeeperInput
content = content.replace("  agentName?: string | null;", "  agentName?: string | null;\n  spaceId?: string | null;\n  memoryScopeEnabled?: boolean;")

# Add scope to MemoryGatekeeperDecision
content = content.replace("  shouldSave: boolean;", "  shouldSave: boolean;\n  scope: string;")

# Update makeDefaultDecision
old_default = """    shouldSave: false,
    classification: 'skip',"""
new_default = """    shouldSave: false,
    scope: input?.spaceId || 'global',
    classification: 'skip',"""
content = content.replace(old_default, new_default)

# Update validateMemoryGatekeeperDecision
old_val = """  return {
    shouldSave,"""
new_val = """  return {
    shouldSave,
    scope: pickOne(raw.scope, ['global', ...(fallbackInput?.spaceId ? [fallbackInput.spaceId] : [])] as string[], fallback.scope),"""
content = content.replace(old_val, new_val)

# Update evaluateMemoryGate
old_eval = """    return validateMemoryGatekeeperDecision({
      ...makeDefaultDecision({ ...input, text: cleanedText, sourcePaths, sourceUrls }),
      toolRoutes: routeToolCandidates(input, text, false),
    }, input);"""
new_eval = """    return validateMemoryGatekeeperDecision({
      ...makeDefaultDecision({ ...input, text: cleanedText, sourcePaths, sourceUrls }),
      scope: input.spaceId || 'global',
      toolRoutes: routeToolCandidates(input, text, false),
    }, input);"""
content = content.replace(old_eval, new_eval)

# determine scope in evaluateMemoryGate
old_scope = """  let destination: MemoryDestination = 'skip';"""
new_scope = """  let destination: MemoryDestination = 'skip';
  let scope = input.spaceId || 'global';
  if (explicit && /\\bglobal\\b/i.test(cleanedText)) scope = 'global';
  if (input.provenance?.source === 'web' || input.provenance?.source === 'mixed' || sourceUrls.length > 0) {
      if (!explicit) scope = input.spaceId || 'global';
  }"""
# wait, untrusted external defaults to space scope.
new_scope_better = """  let destination: MemoryDestination = 'skip';
  let scope = input.spaceId || 'global';
  if (explicit && /\\bglobal\\b|\\beverywhere\\b/i.test(cleanedText)) scope = 'global';
  if (input.provenance?.source === 'web' || input.provenance?.source === 'mixed' || sourceUrls.length > 0) {
      // Screen-sourced writes untrusted-external -> default space scope.
      scope = input.spaceId || 'global';
  }"""
content = content.replace(old_scope, new_scope_better)

old_return_eval = """  return validateMemoryGatekeeperDecision({
    shouldSave,
    classification,"""
new_return_eval = """  return validateMemoryGatekeeperDecision({
    shouldSave,
    scope,
    classification,"""
content = content.replace(old_return_eval, new_return_eval)

# buildGatekeeperMemoryWrite
old_b_sig = """export function buildGatekeeperMemoryWrite(input: {
  rootPath: string;
  agentId: string;
  chatId?: string | null;
  channelId?: string | null;
  text: string;
  decision: MemoryGatekeeperDecision;"""
new_b_sig = """export function buildGatekeeperMemoryWrite(input: {
  rootPath: string;
  agentId: string;
  spaceId?: string | null;
  memoryScopeEnabled?: boolean;
  chatId?: string | null;
  channelId?: string | null;
  text: string;
  decision: MemoryGatekeeperDecision;"""
content = content.replace(old_b_sig, new_b_sig)

old_b_path = """  const basePath = input.decision.destination === 'library'
    ? `${input.rootPath}/library`
    : input.decision.destination === 'channel_memory'
      ? `${input.rootPath}/memory/${agentId}/channels/${channelId || 'default'}`
      : `${input.rootPath}/memory/${agentId}/gatekeeper`;"""

new_b_path = """  let basePath = input.decision.destination === 'library'
    ? `${input.rootPath}/library`
    : input.decision.destination === 'channel_memory'
      ? `${input.rootPath}/memory/${agentId}/channels/${channelId || 'default'}`
      : `${input.rootPath}/memory/${agentId}/gatekeeper`;
      
  if (input.memoryScopeEnabled) {
    const scopeId = input.decision.scope === 'global' ? 'space-home' : (input.decision.scope || input.spaceId || 'space-home');
    basePath = input.decision.destination === 'library'
      ? `${input.rootPath}/library`
      : `${input.rootPath}/memory/spaces/${scopeId}/gatekeeper`;
  }"""
content = content.replace(old_b_path, new_b_path)

old_b_fm = """    `agent_id: ${yamlString(agentId)}`,"""
new_b_fm = """    `agent_id: ${yamlString(agentId)}`,
    (input.memoryScopeEnabled) ? `scope: ${yamlString(input.decision.scope)}` : null,"""
content = content.replace(old_b_fm, new_b_fm)

with open("src/services/memoryGatekeeper.ts", "w") as f:
    f.write(content)
