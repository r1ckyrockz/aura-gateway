# Extending AURA: writing tools

A tool is a capability the model can call. Built-in tools live in `src/tools/builtin/`. Adding your own takes three steps.

## 1. Implement `AuraTool`

```ts
// src/tools/builtin/waste-collection.tool.ts
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { result, type AuraTool, type ToolContext } from '../tool.types';

const schema = z.object({
  type: z.enum(['paper', 'plastic', 'organic', 'residual']).optional().describe('Bin type'),
});

@Injectable()
export class WasteCollectionTool implements AuraTool<typeof schema> {
  readonly name = 'waste_collection_next';
  readonly description = 'Tell when the next waste collection is, optionally for one bin type.';
  readonly schema = schema;

  isAvailable() {
    return true; // e.g. return false if a required setting is missing
  }

  async execute({ type }: z.infer<typeof schema>, { principal }: ToolContext) {
    const next = await lookUpSomewhere(type);
    return result({ type: type ?? 'any', date: next });
  }
}
```

Guidelines:

- **Name and describe tools for the model.** Short, concrete descriptions work best with small models. Use `.describe()` on schema fields.
- **Validate with zod.** Arguments are parsed before `execute` is called, and invalid input never reaches your code.
- **Return data, not prose.** The model phrases the answer. Return `{ error: '…' }` for recoverable problems; thrown errors are caught and passed to the model the same way.
- **Respect policy.** If your tool changes the physical world, check `this.policy.canControl(principal, …)` like `HaCallServiceTool` does. Return `{ kind: 'confirmation_required', action }` for anything sensitive.

## 2. Register it

Add the class to `BUILTIN_TOOLS` in `src/tools/tools.module.ts`:

```ts
const BUILTIN_TOOLS = [
  GetTimeTool,
  HaListEntitiesTool,
  HaGetStateTool,
  HaCallServiceTool,
  WasteCollectionTool,
];
```

## 3. Test it

Unit-test the tool directly, then run it through `ConversationService` with the scripted `FakeLlm` (see `src/conversation/conversation.service.spec.ts`):

```ts
const llm = new FakeLlm([
  [{ tool: 'waste_collection_next', args: { type: 'paper' } }],
  'Paper is collected on Friday.',
]);
```

## Other extension points

- **Another LLM backend:** implement the abstract `LlmClient` (`chat`, `ping`) and bind it in `LlmModule`.
- **Another client protocol:** add a controller in `src/compat/` that maps to `ConversationService.converse()`.
