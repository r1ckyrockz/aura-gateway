import { Module } from '@nestjs/common';
import { HomeAssistantModule } from '../home-assistant/ha.module';
import { PolicyModule } from '../policy/policy.module';
import { GetTimeTool } from './builtin/get-time.tool';
import { HaCallServiceTool } from './builtin/ha-call-service.tool';
import { HaGetStateTool } from './builtin/ha-get-state.tool';
import { HaListEntitiesTool } from './builtin/ha-list-entities.tool';
import { ToolRegistry } from './tool-registry.service';
import { AURA_TOOLS, type AuraTool } from './tool.types';

const BUILTIN_TOOLS = [GetTimeTool, HaListEntitiesTool, HaGetStateTool, HaCallServiceTool];

@Module({
  imports: [HomeAssistantModule, PolicyModule],
  providers: [
    ...BUILTIN_TOOLS,
    {
      provide: AURA_TOOLS,
      useFactory: (...tools: AuraTool[]) => tools,
      inject: BUILTIN_TOOLS,
    },
    ToolRegistry,
  ],
  exports: [ToolRegistry],
})
export class ToolsModule {}
