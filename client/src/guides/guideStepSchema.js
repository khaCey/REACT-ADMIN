const DEFAULT_TARGET = {
  selector: null,
  fallbackSelectors: [],
  scrollIntoView: true,
  placement: 'bottom-right',
}

const DEFAULT_HIGHLIGHT = {
  shape: 'rect',
  padding: 8,
  zIndex: 10000,
}

const DEFAULT_TOOLTIP = {
  title: '',
  body: '',
  placement: 'bottom-right',
  showProgress: true,
}

const DEFAULT_INTERACTION_GUARD = {
  allowSelectors: [],
  blockOutsideClick: false,
  blockKeyboardOutside: false,
  allowEscape: true,
}

const DEFAULT_COMPLETION = {
  type: 'custom',
  payload: null,
}

const DEFAULT_SANDBOX = {
  useDummyStudentId: 565,
  forbidMutations: false,
}

export function createGuideStep(step) {
  return {
    id: step.id,
    route: step.route,
    title: step.title,
    description: step.description,
    target: {
      ...DEFAULT_TARGET,
      ...(step.target || {}),
    },
    highlight: {
      ...DEFAULT_HIGHLIGHT,
      ...(step.highlight || {}),
    },
    tooltip: {
      ...DEFAULT_TOOLTIP,
      ...(step.tooltip || {}),
      title: step.tooltip?.title || step.title,
      body: step.tooltip?.body || step.description,
    },
    interactionGuard: {
      ...DEFAULT_INTERACTION_GUARD,
      ...(step.interactionGuard || {}),
    },
    completion: {
      ...DEFAULT_COMPLETION,
      ...(step.completion || {}),
    },
    sandbox: {
      ...DEFAULT_SANDBOX,
      ...(step.sandbox || {}),
    },
  }
}

export function createGuideDefinition({ title, steps }) {
  return {
    title,
    steps: steps.map(createGuideStep),
  }
}
