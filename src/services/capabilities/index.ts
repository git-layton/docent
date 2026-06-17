// Capability registry entry point. v1 uses an EXPLICIT import-list (design §8 #5): each built-in is
// imported and registered here on module load. Adding a capability = import it + register it below.
import { registerCapability } from './registry';
import { knowledgeSearchCapability } from './builtins/knowledgeSearch';
import { webSearchCapability } from './builtins/webSearch';
import { browseCapability } from './builtins/browse';
import { calendarCapability } from './builtins/calendar';
import { filesCapability } from './builtins/files';
import { previewObserveCapability } from './builtins/previewObserve';

// Register on first import. ES modules are singletons, so this runs exactly once.
registerCapability(knowledgeSearchCapability);
registerCapability(webSearchCapability);
registerCapability(browseCapability);
registerCapability(calendarCapability);
registerCapability(filesCapability);
registerCapability(previewObserveCapability);

export * from './types';
export * from './registry';
