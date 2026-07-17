import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { K8sResource, HelmRenderContext, HelmChartMeta } from '../types';

const DEFAULT_CHART_DIR = path.resolve(__dirname, '../../../chart/charts/superset');

export interface HelmRenderResult {
  resources: K8sResource[];
  warnings: string[];
}

export function renderHelmTemplates(
  context: HelmRenderContext,
  chartDir: string = DEFAULT_CHART_DIR,
): HelmRenderResult {
  const resolved = path.resolve(chartDir);
  const repoChartDir = path.resolve(__dirname, '../../../chart/charts');
  if (!resolved.startsWith(repoChartDir + path.sep)) {
    throw new Error('chartDir must be within the chart/charts/ directory');
  }

  const chartMeta = loadChartMeta(resolved);
  const values = mergeDefaults(resolved, context.values);
  const helpers = buildHelpers(context, chartMeta, values);

  const templatesDir = path.join(resolved, 'templates');
  const templateFiles = fs
    .readdirSync(templatesDir)
    .filter((f) => f.endsWith('.yaml'))
    .sort();

  const resources: K8sResource[] = [];
  const warnings: string[] = [];

  for (const file of templateFiles) {
    const templatePath = path.join(templatesDir, file);
    const raw = fs.readFileSync(templatePath, 'utf8');
    const rendered = renderTemplate(raw, helpers, values, context, chartMeta, warnings);
    if (!rendered.trim()) continue;

    const docs = rendered.split(/^---\s*$/m).filter((d) => d.trim());
    for (const doc of docs) {
      try {
        const parsed = yaml.load(doc) as K8sResource;
        if (parsed && typeof parsed === 'object' && parsed.apiVersion) {
          if (!parsed.metadata.namespace) {
            parsed.metadata.namespace = context.namespace;
          }
          resources.push(parsed);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Failed to parse YAML document in ${file}: ${message}`);
      }
    }
  }

  return { resources, warnings };
}

function loadChartMeta(chartDir: string): HelmChartMeta {
  const chartYaml = fs.readFileSync(path.join(chartDir, 'Chart.yaml'), 'utf8');
  const chart = yaml.load(chartYaml) as Record<string, string>;
  return {
    name: chart.name || 'superset',
    version: chart.version || '0.1.0',
    appVersion: chart.appVersion || '4.1.1',
  };
}

function mergeDefaults(
  chartDir: string,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const valuesPath = path.join(chartDir, 'values.yaml');
  const defaultValues = yaml.load(
    fs.readFileSync(valuesPath, 'utf8'),
  ) as Record<string, unknown>;
  return deepMerge(defaultValues, overrides);
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

interface TemplateHelpers {
  'superset.name': string;
  'superset.fullname': string;
  'superset.chart': string;
  'superset.labels': string;
  'superset.selectorLabels': string;
  'superset.serviceAccountName': string;
  'superset.postgres.fullname': string;
  'superset.postgres.selectorLabels': string;
  'superset.postgres.labels': string;
  'superset.postgres.uri': string;
}

function buildHelpers(
  context: HelmRenderContext,
  chartMeta: HelmChartMeta,
  values: Record<string, unknown>,
): TemplateHelpers {
  const name = 'superset';
  const fullname = truncate(`${context.releaseName}-superset`, 41);
  const chart = truncate(
    `${chartMeta.name}-${chartMeta.version}`.replace(/\+/g, '_'),
    63,
  );
  const postgresFullname = truncate(`${fullname}-postgres`, 50);

  const postgres = values.postgres as Record<string, unknown>;
  const postgresUser = (postgres?.user as string) || 'superset';
  const postgresPassword = (postgres?.password as string) || '';
  const postgresDatabase = (postgres?.database as string) || 'superset';
  const postgresUri = `postgresql+psycopg2://${postgresUser}:${postgresPassword}@${postgresFullname}-svc:5432/${postgresDatabase}`;

  const sa = values.serviceAccount as Record<string, unknown>;
  const saCreate = sa?.create !== false;
  const saName = (sa?.name as string) || '';
  const serviceAccountName = saCreate
    ? saName || `${fullname}-sa`
    : saName || 'default';

  const selectorLabels = [
    `app.kubernetes.io/name: ${name}`,
    `app.kubernetes.io/instance: ${context.releaseName}`,
  ].join('\n');

  const labels = [
    `helm.sh/chart: ${chart}`,
    selectorLabels,
    `app.kubernetes.io/version: "${chartMeta.appVersion}"`,
    `app.kubernetes.io/managed-by: Helm`,
    `app.kubernetes.io/part-of: superset`,
  ].join('\n');

  const postgresSelectorLabels = [
    `app.kubernetes.io/name: ${name}-postgres`,
    `app.kubernetes.io/instance: ${context.releaseName}`,
  ].join('\n');

  const postgresLabels = [
    `helm.sh/chart: ${chart}`,
    postgresSelectorLabels,
    `app.kubernetes.io/version: "${chartMeta.appVersion}"`,
    `app.kubernetes.io/managed-by: Helm`,
    `app.kubernetes.io/part-of: superset`,
    `app.kubernetes.io/component: database`,
  ].join('\n');

  return {
    'superset.name': name,
    'superset.fullname': fullname,
    'superset.chart': chart,
    'superset.labels': labels,
    'superset.selectorLabels': selectorLabels,
    'superset.serviceAccountName': serviceAccountName,
    'superset.postgres.fullname': postgresFullname,
    'superset.postgres.selectorLabels': postgresSelectorLabels,
    'superset.postgres.labels': postgresLabels,
    'superset.postgres.uri': postgresUri,
  };
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  let result = s.slice(0, maxLen);
  while (result.endsWith('-')) {
    result = result.slice(0, -1);
  }
  return result;
}

function renderTemplate(
  template: string,
  helpers: TemplateHelpers,
  values: Record<string, unknown>,
  context: HelmRenderContext,
  chartMeta: HelmChartMeta,
  warnings: string[],
): string {
  let result = template;

  // Process top-level if blocks (e.g., {{- if .Values.route.enabled }})
  result = processConditionals(result, values, helpers);

  // Replace include directives
  result = replaceIncludes(result, helpers);

  // Replace .Values references
  result = replaceValues(result, values);

  // Replace .Release references
  result = replaceRelease(result, context);

  // Replace .Chart references
  result = replaceChart(result, chartMeta);

  // Handle toYaml with nindent
  result = processToYaml(result, values);

  // Handle pipe functions: quote, int, default
  result = processPipeFunctions(result, values, chartMeta);

  // Handle required function
  result = processRequired(result, values);

  // Handle printf
  result = processPrintf(result);

  // Handle checksum annotations (replace with a stable hash)
  result = processChecksums(result);

  // Clean up remaining template artifacts
  result = cleanupTemplate(result, warnings);

  return result;
}

function processConditionals(
  template: string,
  values: Record<string, unknown>,
  helpers: TemplateHelpers,
): string {
  let result = template;
  let safety = 0;

  // Process {{- if ... }}...{{- else }}...{{- end }} and {{- if ... }}...{{- end }}
  // Also handles with blocks: {{- with .Values.x }}...{{- end }}
  while (safety++ < 50) {
    // Match innermost if/with block (no nested if/with inside)
    const ifMatch = result.match(
      /\{\{-?\s*(?:if|with)\s+(.+?)\s*-?\}\}([\s\S]*?)(?:\{\{-?\s*else\s*-?\}\}([\s\S]*?))?\{\{-?\s*end\s*-?\}\}/,
    );
    if (!ifMatch) break;

    const condition = ifMatch[1].trim();
    const ifBody = ifMatch[2];
    const elseBody = ifMatch[3] ?? '';

    const conditionValue = evaluateCondition(condition, values, helpers);
    const replacement = conditionValue ? ifBody : elseBody;
    result = result.replace(ifMatch[0], replacement);
  }

  return result;
}

function evaluateCondition(
  condition: string,
  values: Record<string, unknown>,
  helpers: TemplateHelpers,
): boolean {
  if (condition.startsWith('.Values.')) {
    const val = resolvePath(values, condition.slice('.Values.'.length));
    return isTruthy(val);
  }
  if (condition.startsWith('.Values')) {
    return isTruthy(values);
  }
  if (condition.startsWith('not ')) {
    return !evaluateCondition(condition.slice(4).trim(), values, helpers);
  }
  // Check for regexMatch or other function calls — treat as true (validation passes)
  if (condition.includes('regexMatch')) {
    return true;
  }
  return true;
}

function isTruthy(val: unknown): boolean {
  if (val === undefined || val === null || val === '' || val === false) return false;
  if (typeof val === 'number' && val === 0) return false;
  if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val as object).length === 0) return false;
  return true;
}

function replaceIncludes(
  template: string,
  helpers: TemplateHelpers,
): string {
  let result = template;

  // {{ include "templateName" . | nindent N }} or {{ include "templateName" . | quote }} or bare
  result = result.replace(
    /\{\{-?\s*include\s+"([^"]+)"\s+\.\s*(?:\|\s*(nindent\s+\d+|quote))?\s*-?\}\}/g,
    (_match, name: string, pipe?: string) => {
      const value = helpers[name as keyof TemplateHelpers];
      if (value === undefined) return '';
      if (pipe) {
        const nindentMatch = pipe.match(/nindent\s+(\d+)/);
        if (nindentMatch) {
          return indentMultiline(value, parseInt(nindentMatch[1], 10));
        }
        if (pipe === 'quote') {
          return `"${value}"`;
        }
      }
      return value;
    },
  );

  // {{ include (print ...) . | sha256sum }} — just produce a stable placeholder
  result = result.replace(
    /\{\{-?\s*include\s+\(print[^)]*\)\s+\.\s*\|\s*sha256sum\s*-?\}\}/g,
    'placeholder-checksum',
  );

  return result;
}

function replaceValues(
  template: string,
  values: Record<string, unknown>,
): string {
  return template.replace(
    /\{\{-?\s*\.Values\.([a-zA-Z0-9_.]+)\s*-?\}\}/g,
    (_match, path: string) => {
      const val = resolvePath(values, path);
      return val !== undefined ? String(val) : '';
    },
  );
}

function replaceRelease(
  template: string,
  context: HelmRenderContext,
): string {
  return template
    .replace(/\{\{-?\s*\.Release\.Name\s*-?\}\}/g, context.releaseName)
    .replace(/\{\{-?\s*\.Release\.Namespace\s*-?\}\}/g, context.namespace)
    .replace(/\{\{-?\s*\.Release\.Service\s*-?\}\}/g, 'Helm');
}

function replaceChart(
  template: string,
  chartMeta: HelmChartMeta,
): string {
  return template
    .replace(/\{\{-?\s*\.Chart\.Name\s*-?\}\}/g, chartMeta.name)
    .replace(/\{\{-?\s*\.Chart\.Version\s*-?\}\}/g, chartMeta.version)
    .replace(/\{\{-?\s*\.Chart\.AppVersion\s*-?\}\}/g, chartMeta.appVersion);
}

function processToYaml(
  template: string,
  values: Record<string, unknown>,
): string {
  return template.replace(
    /\{\{-?\s*toYaml\s+\.Values\.([a-zA-Z0-9_.]+)\s*\|\s*nindent\s+(\d+)\s*-?\}\}/g,
    (_match, valuePath: string, nindent: string) => {
      const val = resolvePath(values, valuePath);
      if (val === undefined || val === null) return '';
      const yamlStr = yaml.dump(val, { flowLevel: -1, lineWidth: -1 }).trimEnd();
      return indentMultiline(yamlStr, parseInt(nindent, 10));
    },
  );
}

function processPipeFunctions(
  template: string,
  values: Record<string, unknown>,
  chartMeta: HelmChartMeta,
): string {
  let result = template;

  // {{ default .Values.x .Values.y | quote }}
  result = result.replace(
    /\{\{-?\s*default\s+\.Values\.([a-zA-Z0-9_.]+)\s+\.Values\.([a-zA-Z0-9_.]+)\s*\|\s*quote\s*-?\}\}/g,
    (_match, defaultPath: string, valuePath: string) => {
      const val = resolvePath(values, valuePath);
      const def = resolvePath(values, defaultPath);
      const resolved = isTruthy(val) ? val : def;
      return `"${resolved !== undefined ? String(resolved) : ''}"`;
    },
  );

  // {{ default .Values.x .Values.y }} (no pipe)
  result = result.replace(
    /\{\{-?\s*default\s+\.Values\.([a-zA-Z0-9_.]+)\s+\.Values\.([a-zA-Z0-9_.]+)\s*-?\}\}/g,
    (_match, defaultPath: string, valuePath: string) => {
      const val = resolvePath(values, valuePath);
      const def = resolvePath(values, defaultPath);
      const resolved = isTruthy(val) ? val : def;
      return resolved !== undefined ? String(resolved) : '';
    },
  );

  // {{ .Values.x | quote }}
  result = result.replace(
    /\{\{-?\s*\.Values\.([a-zA-Z0-9_.]+)\s*\|\s*quote\s*-?\}\}/g,
    (_match, path: string) => {
      const val = resolvePath(values, path);
      return `"${val !== undefined ? String(val) : ''}"`;
    },
  );

  // {{ .Values.x | int }}
  result = result.replace(
    /\{\{-?\s*\.Values\.([a-zA-Z0-9_.]+)\s*\|\s*int\s*-?\}\}/g,
    (_match, path: string) => {
      const val = resolvePath(values, path);
      return String(parseInt(String(val), 10) || 0);
    },
  );

  // {{ .Chart.AppVersion | quote }}
  result = result.replace(
    /\{\{-?\s*\.Chart\.AppVersion\s*\|\s*quote\s*-?\}\}/g,
    () => `"${chartMeta.appVersion}"`,
  );

  // {{ .Values.image.tag | default .Chart.AppVersion }}
  result = result.replace(
    /\{\{-?\s*\.Values\.([a-zA-Z0-9_.]+)\s*\|\s*default\s+\.Chart\.AppVersion\s*-?\}\}/g,
    (_match, path: string) => {
      const val = resolvePath(values, path);
      if (val && String(val)) return String(val);
      return chartMeta.appVersion;
    },
  );

  return result;
}

function processRequired(
  template: string,
  values: Record<string, unknown>,
): string {
  // {{ required "msg" .Values.x | quote }}
  let result = template.replace(
    /\{\{-?\s*required\s+"([^"]*)"\s+\.Values\.([a-zA-Z0-9_.]+)\s*\|\s*quote\s*-?\}\}/g,
    (_match, msg: string, valuePath: string) => {
      const val = resolvePath(values, valuePath);
      if (val === undefined || val === null || val === '') {
        throw new Error(`Helm render error: ${msg} (.Values.${valuePath})`);
      }
      return `"${String(val)}"`;
    },
  );

  // {{ required "msg" .Values.x }}
  result = result.replace(
    /\{\{-?\s*required\s+"([^"]*)"\s+\.Values\.([a-zA-Z0-9_.]+)\s*-?\}\}/g,
    (_match, msg: string, valuePath: string) => {
      const val = resolvePath(values, valuePath);
      if (val === undefined || val === null || val === '') {
        throw new Error(`Helm render error: ${msg} (.Values.${valuePath})`);
      }
      return String(val);
    },
  );

  return result;
}

function processPrintf(template: string): string {
  // {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
  // These are already resolved via helper functions; just clean up any remaining
  return template;
}

function processChecksums(template: string): string {
  return template.replace(
    /\{\{-?\s*include\s+\(print[^)]*\)[^}]*sha256sum\s*-?\}\}/g,
    'placeholder-checksum',
  );
}

function cleanupTemplate(template: string, warnings: string[]): string {
  let result = template;

  // Remove {{ $var := ... }} assignment lines
  result = result.replace(/\{\{-?\s*\$\w+\s*:=.*?-?\}\}\n?/g, '');

  // Remove {{- fail "..." -}} lines
  result = result.replace(/\{\{-?\s*fail\s+"[^"]*"\s*-?\}\}\n?/g, '');

  // Detect and warn about unresolved template directives before stripping them
  const unresolvedMatches = result.match(/\{\{-?[^}]*-?\}\}/g);
  if (unresolvedMatches) {
    const unique = [...new Set(unresolvedMatches)];
    for (const directive of unique) {
      warnings.push(`Unresolved template directive stripped: ${directive}`);
    }
  }

  // Remove any remaining unresolved template directives (catch-all)
  result = result.replace(/\{\{-?[^}]*-?\}\}/g, '');

  // Clean blank lines (but preserve intentional single blank lines in YAML)
  result = result
    .split('\n')
    .filter((line) => line.trim() !== '' || line === '')
    .join('\n');

  // Remove consecutive blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function indentMultiline(text: string, spaces: number): string {
  const indent = ' '.repeat(spaces);
  const lines = text.split('\n');
  return '\n' + lines.map((line) => indent + line).join('\n');
}
