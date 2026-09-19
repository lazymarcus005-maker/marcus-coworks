import type { ActivityRepository, SettingsRepository } from '@studio/persistence'
import type { TaskManager } from '@studio/task-manager'

export type WorkflowTemplate = {
  id: string
  name: string
  description: string
  /** Goal contract defaults applied on activation. */
  goalDefaults: {
    scope?: string[]
    nonGoals?: string[]
    constraints?: string[]
    doneWhen: string[]
    risk: 'low' | 'medium' | 'high'
    maxAttempts: number
  }
  /** Deterministic verification pipeline run after implementation. */
  verification: {
    kind: 'format' | 'lint' | 'build' | 'test' | 'custom'
    command: string
    required: boolean
  }[]
  independentVerifier: boolean
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'bug-fix',
    name: 'Bug Fix',
    description: 'Reproduce, fix, and prove a regression test.',
    goalDefaults: {
      nonGoals: ['no unrelated refactor'],
      doneWhen: [
        'build passes',
        'unit tests pass',
        'regression test added and passes',
        'no unrelated files modified',
      ],
      risk: 'medium',
      maxAttempts: 3,
    },
    verification: [
      { kind: 'build', command: 'npm run build', required: true },
      { kind: 'test', command: 'npm test', required: true },
    ],
    independentVerifier: true,
  },
  {
    id: 'feature',
    name: 'Feature',
    description: 'Implement a feature slice with tests.',
    goalDefaults: {
      doneWhen: ['build passes', 'new tests pass', 'docs updated', 'no unrelated files modified'],
      risk: 'medium',
      maxAttempts: 3,
    },
    verification: [
      { kind: 'build', command: 'npm run build', required: true },
      { kind: 'test', command: 'npm test', required: true },
      { kind: 'lint', command: 'npm run lint', required: false },
    ],
    independentVerifier: true,
  },
  {
    id: 'refactor-slice',
    name: 'Refactor Slice',
    description: 'One narrow slice; behavior unchanged.',
    goalDefaults: {
      constraints: ['behavior must not change'],
      doneWhen: ['build passes', 'all tests pass unchanged', 'no behavior diff', 'slice is small'],
      risk: 'medium',
      maxAttempts: 3,
    },
    verification: [
      { kind: 'build', command: 'npm run build', required: true },
      { kind: 'test', command: 'npm test', required: true },
    ],
    independentVerifier: true,
  },
  {
    id: 'review',
    name: 'Review',
    description: 'Independent review of a diff; no edits.',
    goalDefaults: {
      doneWhen: ['structured verdict produced', 'every finding cites evidence'],
      risk: 'low',
      maxAttempts: 2,
    },
    verification: [],
    independentVerifier: true,
  },
  {
    id: 'ci-repair',
    name: 'CI Repair',
    description: 'Diagnose and repair a broken pipeline.',
    goalDefaults: {
      constraints: ['only touch pipeline/config files unless the failure is a product regression'],
      doneWhen: ['pipeline command passes locally', 'no unrelated files modified'],
      risk: 'medium',
      maxAttempts: 3,
    },
    verification: [{ kind: 'custom', command: 'npm test', required: true }],
    independentVerifier: true,
  },
  {
    id: 'documentation',
    name: 'Documentation',
    description: 'Write or update docs against shipped behavior.',
    goalDefaults: {
      doneWhen: ['docs match actual behavior', 'no secrets in docs', 'examples verified'],
      risk: 'low',
      maxAttempts: 2,
    },
    verification: [],
    independentVerifier: false,
  },
]

export interface TemplateManagerDeps {
  tasks: TaskManager
  activity: ActivityRepository
  settings: SettingsRepository
  now?: () => Date
}

/**
 * Workflow templates (spec §49 / P5.5): configure harness behavior —
 * goal defaults, verification pipeline, verifier requirement — not model
 * prompt tricks.
 */
export class TemplateManager {
  constructor(private readonly deps: TemplateManagerDeps) {}

  list(): WorkflowTemplate[] {
    return WORKFLOW_TEMPLATES
  }

  get(id: string): WorkflowTemplate | undefined {
    return WORKFLOW_TEMPLATES.find((template) => template.id === id)
  }

  /** Applies a template to a project: goal draft + defaults + config.
   *  A draft goal is reused; a ready goal is superseded (cancelled);
   *  an active goal refuses — finish it first. */
  apply(input: { projectId: string; templateId: string; objective: string }): {
    goalId: string
    template: WorkflowTemplate
  } {
    const template = this.get(input.templateId)
    if (!template) throw new Error(`Unknown template: ${input.templateId}`)

    const existing = this.deps.tasks.stateForProject(input.projectId).goal
    if (existing?.status === 'active') {
      throw new Error(
        'A goal is already active for this project; finish it before applying a template',
      )
    }
    if (existing?.status === 'ready') {
      this.deps.tasks.updateGoalContract(existing.id, { status: 'cancelled' })
    }

    const goal = this.deps.tasks.createGoalDraft(input.projectId, input.objective)
    this.deps.tasks.updateGoalContract(goal.id, {
      ...template.goalDefaults,
      status: 'ready',
    })
    this.deps.settings.setJson(`template/active/${input.projectId}`, {
      templateId: template.id,
      goalId: goal.id,
      verification: template.verification,
      independentVerifier: template.independentVerifier,
    })
    this.deps.activity.record('template.applied', `Template ${template.name} applied`, {
      projectId: input.projectId,
      payload: { goalId: goal.id, templateId: template.id },
    })
    return { goalId: goal.id, template }
  }

  activeFor(projectId: string):
    | {
        templateId: string
        goalId: string
        verification: WorkflowTemplate['verification']
        independentVerifier: boolean
      }
    | undefined {
    return this.deps.settings.getJson(`template/active/${projectId}`, undefined)
  }
}
