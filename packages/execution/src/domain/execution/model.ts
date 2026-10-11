import type { Resource } from '@hanamaru/blueprint/model'
import type {
  Fields,
  RuntimeBlueprint,
  RuntimeGroup,
  RuntimeMiddleware,
  RuntimeMock,
  RuntimeSuite,
} from '@hanamaru/blueprint/model'
import type { SourceLocation } from '@hanamaru/blueprint/model'
import type { ResolvedExecutionConfig } from './config.js'

export interface Frame {
  steps: RuntimeMiddleware[]
  fields: Fields
}

export interface NodeBase {
  resources?: readonly Resource[]
  rootIndex: number
  config: ResolvedExecutionConfig
  mocks: RuntimeMock[]
  frames: Frame[]
  frameCount: number
  entryOrigin: SourceLocation | null
  originalIndex?: number
  stable?: Fields
  resourceFields?: Fields
}

export interface SuiteNode extends NodeBase {
  kind: 'test'
  bp: RuntimeSuite
}

export interface GroupNode extends NodeBase {
  kind: 'group'
  bp: RuntimeGroup
  children: ExecutionNode[]
}

export type ExecutionNode = SuiteNode | GroupNode

export interface Plan {
  resources?: readonly Resource[]
  blueprints: RuntimeBlueprint[]
  allNodes: ExecutionNode[]
  nodes: ExecutionNode[]
  only: boolean
}
