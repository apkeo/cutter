import path from 'node:path';
import { parse } from 'yaml';

export interface Target {
  selector?: string;
  testId?: string;
  role?: string;
  name?: string;
  text?: string;
  exact?: boolean;
  expression?: string;
}
export type Step =
  | { action: 'goto'; url: string }
  | { action: 'wait'; ms: number }
  | { action: 'waitFor'; target: Target; state: 'visible' | 'hidden'; timeout?: number }
  | { action: 'move'; target: Target; duration?: number }
  | { action: 'click'; target: Target; duration?: number; button: 'left' | 'right' | 'middle' }
  | { action: 'type'; target?: Target; text: string; delay?: number; submit: boolean }
  | { action: 'press'; keys: string }
  | { action: 'scroll'; target?: Target; x: number; y: number; duration: number }
  | { action: 'eval'; expression: string }
  | {
      action: 'screenshot';
      name: string;
      targets: Target[];
      padding: number;
      fullPage: boolean;
      format: 'png' | 'jpeg';
    }
  | { action: 'record'; name: string; fps: number }
  | { action: 'stop' };
export interface IndexedDbEntry {
  database: string;
  store: string;
  key: string;
  value: unknown;
}
export interface CookieEntry {
  name: string;
  value: string;
  url: string;
}
export interface SessionSpec {
  origin?: string;
  settle: number;
  indexedDb: IndexedDbEntry[];
  localStorage: Record<string, string>;
  cookies: CookieEntry[];
  storageState?: string;
  blockRequests: string[];
}
export interface CaptureSpec {
  url: string;
  viewport: { width: number; height: number; scale: number };
  browser: { channel?: string; headless: boolean };
  locale?: string;
  timezone?: string;
  colorScheme?: 'light' | 'dark';
  clock?: string;
  timeout: number;
  testIdAttribute: string;
  hide: string[];
  css: string;
  initScript?: string;
  cursor: { size: number; visible: boolean; clicks: boolean; smooth: boolean };
  session?: SessionSpec;
  steps: Step[];
}

type Raw = Record<string, unknown>;
const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function expandVariables<T>(value: T, variables: Record<string, string | undefined>): T {
  if (typeof value === 'string')
    return value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, name: string) => {
      const replacement = variables[name];
      if (replacement === undefined) throw new Error(`Spec: variable ${name} is not set.`);
      return replacement;
    }) as T;
  if (Array.isArray(value)) return value.map((item) => expandVariables(item, variables)) as T;
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, expandVariables(item, variables)]),
    ) as T;
  return value;
}

function positive(value: unknown, label: string, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be a positive number.`);
  return value;
}
function nonNegative(value: unknown, label: string, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error(`${label} must be zero or a positive number.`);
  return value;
}
function optionalPositive(value: unknown, label: string) {
  return value === undefined ? undefined : positive(value, label, 0);
}
function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string.`);
  return value;
}
function outputName(value: unknown, label: string, used: Set<string>) {
  const name = text(value, label);
  if (!/^[\w.-]+$/.test(name) || name.startsWith('.'))
    throw new Error(`${label} may only use letters, digits, ".", "_" and "-".`);
  if (used.has(name)) throw new Error(`${label} "${name}" is already used by another step.`);
  used.add(name);
  return name;
}

export function parseTarget(value: unknown, label: string): Target {
  if (typeof value === 'string' && value) return { selector: value };
  if (!isObject(value))
    throw new Error(`${label} needs a selector, testId, role, text or expression.`);
  const target: Target = {};
  for (const key of ['selector', 'testId', 'role', 'name', 'text', 'expression'] as const)
    if (value[key] !== undefined) target[key] = text(value[key], `${label}.${key}`);
  if (value.exact !== undefined) target.exact = value.exact === true;
  const ways = [target.selector, target.testId, target.role, target.text, target.expression];
  if (ways.filter((way) => way !== undefined).length !== 1)
    throw new Error(`${label} needs exactly one of selector, testId, role, text or expression.`);
  if (target.name !== undefined && !target.role)
    throw new Error(`${label}.name only works together with role.`);
  return target;
}

function parseStep(raw: unknown, index: number, used: Set<string>): Step {
  const prefix = `Step ${index + 1}`;
  if (!isObject(raw) || Object.keys(raw).length !== 1)
    throw new Error(`${prefix} must be an object with exactly one action.`);
  const [action, value] = Object.entries(raw)[0];
  const label = `${prefix} (${action})`;
  const options = isObject(value) ? value : {};
  switch (action) {
    case 'goto':
      return { action, url: text(value, label) };
    case 'wait':
      return { action, ms: nonNegative(value, label, 0) };
    case 'waitFor': {
      const state = options.state ?? 'visible';
      if (state !== 'visible' && state !== 'hidden')
        throw new Error(`${label}.state must be visible or hidden.`);
      return {
        action,
        target: parseTarget(value, label),
        state,
        timeout: optionalPositive(options.timeout, `${label}.timeout`),
      };
    }
    case 'move':
      return {
        action,
        target: parseTarget(value, label),
        duration: optionalPositive(options.duration, `${label}.duration`),
      };
    case 'click': {
      const button = options.button ?? 'left';
      if (button !== 'left' && button !== 'right' && button !== 'middle')
        throw new Error(`${label}.button must be left, right or middle.`);
      return {
        action,
        target: parseTarget(value, label),
        duration: optionalPositive(options.duration, `${label}.duration`),
        button,
      };
    }
    case 'type': {
      if (!isObject(value)) throw new Error(`${label} needs a text.`);
      const { text: typed, delay, submit, ...rest } = value;
      if (typeof typed !== 'string') throw new Error(`${label}.text must be a string.`);
      return {
        action,
        target: Object.keys(rest).length ? parseTarget(rest, label) : undefined,
        text: typed,
        delay: delay === undefined ? undefined : nonNegative(delay, `${label}.delay`, 0),
        submit: submit === true,
      };
    }
    case 'press':
      return { action, keys: text(value, label) };
    case 'scroll': {
      if (!isObject(value)) throw new Error(`${label} needs x or y.`);
      const { x, y, duration, ...rest } = value;
      return {
        action,
        target: Object.keys(rest).length ? parseTarget(rest, label) : undefined,
        x: Number(x ?? 0),
        y: Number(y ?? 0),
        duration: positive(duration, `${label}.duration`, 500),
      };
    }
    case 'eval':
      return { action, expression: text(value, label) };
    case 'screenshot': {
      if (!isObject(value)) throw new Error(`${label} needs a name.`);
      const { name, targets, padding, fullPage, format, ...rest } = value;
      const list =
        targets === undefined
          ? Object.keys(rest).length
            ? [parseTarget(rest, label)]
            : []
          : (targets as unknown[]).map((item, i) => parseTarget(item, `${label}.targets[${i}]`));
      const type = format ?? 'png';
      if (type !== 'png' && type !== 'jpeg')
        throw new Error(`${label}.format must be png or jpeg.`);
      return {
        action,
        name: outputName(name, `${label}.name`, used),
        targets: list,
        padding: nonNegative(padding, `${label}.padding`, 0),
        fullPage: fullPage === true,
        format: type,
      };
    }
    case 'record':
      return {
        action,
        name: outputName(options.name, `${label}.name`, used),
        fps: positive(options.fps, `${label}.fps`, 30),
      };
    case 'stop':
      return { action };
    default:
      throw new Error(`${prefix}: unknown action "${action}".`);
  }
}

function parseSession(raw: unknown, specDir: string): SessionSpec | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) throw new Error('Spec: session must be an object.');
  const indexedDb = (raw.indexedDb ?? []) as IndexedDbEntry[];
  const cookies = (raw.cookies ?? []) as CookieEntry[];
  const localStorage = (raw.localStorage ?? {}) as Record<string, string>;
  if ((indexedDb.length || Object.keys(localStorage).length) && !raw.origin)
    throw new Error('Spec: session.origin is required to write indexedDb or localStorage.');
  for (const entry of indexedDb)
    for (const key of ['database', 'store', 'key'] as const)
      text(entry[key], `Spec: session.indexedDb.${key}`);
  return {
    origin: raw.origin === undefined ? undefined : text(raw.origin, 'Spec: session.origin'),
    settle: nonNegative(raw.settle, 'Spec: session.settle', 0),
    indexedDb,
    localStorage,
    cookies,
    storageState:
      raw.storageState === undefined
        ? undefined
        : path.resolve(specDir, text(raw.storageState, 'Spec: session.storageState')),
    blockRequests: ((raw.blockRequests ?? []) as unknown[]).map((pattern) =>
      text(pattern, 'Spec: session.blockRequests'),
    ),
  };
}

export function normalizeSpec(raw: unknown, specDir = process.cwd()): CaptureSpec {
  if (!isObject(raw)) throw new Error('Spec must be an object.');
  if (raw.version !== undefined && raw.version !== 1)
    throw new Error(`Spec: unsupported version ${String(raw.version)}.`);
  if (!Array.isArray(raw.steps) || !raw.steps.length)
    throw new Error('Spec: steps must list at least one step.');
  const viewport = isObject(raw.viewport) ? raw.viewport : {};
  const browser = isObject(raw.browser) ? raw.browser : {};
  const cursor = isObject(raw.cursor) ? raw.cursor : {};
  const scale = positive(viewport.scale, 'Spec: viewport.scale', 2);
  const colorScheme = raw.colorScheme;
  if (colorScheme !== undefined && colorScheme !== 'light' && colorScheme !== 'dark')
    throw new Error('Spec: colorScheme must be light or dark.');
  const used = new Set<string>();
  const steps = raw.steps.map((step, index) => parseStep(step, index, used));
  let open = false;
  steps.forEach((step, index) => {
    if (step.action === 'record' && open)
      throw new Error(`Step ${index + 1} (record): a recording is already running.`);
    if (step.action === 'stop' && !open)
      throw new Error(`Step ${index + 1} (stop): no recording is running.`);
    if (step.action === 'record') open = true;
    if (step.action === 'stop') open = false;
  });
  return {
    url: text(raw.url, 'Spec: url'),
    viewport: {
      width: positive(viewport.width, 'Spec: viewport.width', 1440),
      height: positive(viewport.height, 'Spec: viewport.height', 900),
      scale,
    },
    browser: {
      channel:
        browser.channel === undefined ? undefined : text(browser.channel, 'Spec: browser.channel'),
      headless: browser.headless !== false,
    },
    locale: raw.locale === undefined ? undefined : text(raw.locale, 'Spec: locale'),
    timezone: raw.timezone === undefined ? undefined : text(raw.timezone, 'Spec: timezone'),
    colorScheme,
    clock: raw.clock === undefined ? undefined : text(raw.clock, 'Spec: clock'),
    timeout: positive(raw.timeout, 'Spec: timeout', 15000),
    testIdAttribute:
      raw.testIdAttribute === undefined
        ? 'data-testid'
        : text(raw.testIdAttribute, 'Spec: testIdAttribute'),
    hide: ((raw.hide ?? []) as unknown[]).map((selector) => text(selector, 'Spec: hide')),
    css: raw.css === undefined ? '' : text(raw.css, 'Spec: css'),
    initScript: raw.initScript === undefined ? undefined : text(raw.initScript, 'Spec: initScript'),
    cursor: {
      size: positive(cursor.size, 'Spec: cursor.size', 24),
      visible: cursor.visible !== false,
      clicks: cursor.clicks !== false,
      smooth: cursor.smooth === true,
    },
    session: parseSession(raw.session, specDir),
    steps,
  };
}

export function parseSpec(
  source: string,
  variables: Record<string, string | undefined>,
  specDir = process.cwd(),
) {
  return normalizeSpec(expandVariables(parse(source), variables), specDir);
}
