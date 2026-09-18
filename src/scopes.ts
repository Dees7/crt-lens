import { ButtonSpec, CrtLensConfig } from "./config";

/**
 * Scope кнопки, разобранный до того, чем его фильтрует Lens.
 *
 * Пункты меню отбираются строкой: `item.kind === object.kind &&
 * item.apiVersions.includes(object.apiVersion)`, поэтому для произвольного kind
 * нужен точный apiVersion — берём его из таблицы ниже или из явной записи
 * `apps/v1:Deployment`.
 */
export interface ScopeSpec {
  /** Как написано в конфиге */
  raw: string;
  kind: string;
  apiVersions: string[];
  /**
   * Псевдо-scope `containers`: пункт рисуется с подменю контейнеров пода,
   * а целью команды становится контейнер.
   */
  containers: boolean;
}

/** Короткие алиасы в стиле k9s. */
const ALIASES: Record<string, { kind: string; containers?: boolean }> = {
  containers: { kind: "Pod", containers: true },
  container: { kind: "Pod", containers: true },
  pods: { kind: "Pod" },
  pod: { kind: "Pod" },
  nodes: { kind: "Node" },
  node: { kind: "Node" },
  namespaces: { kind: "Namespace" },
  namespace: { kind: "Namespace" },
};

/** apiVersion для ходовых kind: иначе пункт меню не совпадёт с объектом. */
const KNOWN_KINDS: Record<string, string[]> = {
  Pod: ["v1"],
  Node: ["v1"],
  Namespace: ["v1"],
  Service: ["v1"],
  Endpoints: ["v1"],
  ConfigMap: ["v1"],
  Secret: ["v1"],
  ServiceAccount: ["v1"],
  PersistentVolume: ["v1"],
  PersistentVolumeClaim: ["v1"],
  ReplicationController: ["v1"],
  LimitRange: ["v1"],
  ResourceQuota: ["v1"],
  Event: ["v1", "events.k8s.io/v1"],
  Deployment: ["apps/v1"],
  StatefulSet: ["apps/v1"],
  DaemonSet: ["apps/v1"],
  ReplicaSet: ["apps/v1"],
  Job: ["batch/v1"],
  CronJob: ["batch/v1", "batch/v1beta1"],
  Ingress: ["networking.k8s.io/v1"],
  IngressClass: ["networking.k8s.io/v1"],
  NetworkPolicy: ["networking.k8s.io/v1"],
  HorizontalPodAutoscaler: ["autoscaling/v2", "autoscaling/v1"],
  PodDisruptionBudget: ["policy/v1"],
  StorageClass: ["storage.k8s.io/v1"],
  Role: ["rbac.authorization.k8s.io/v1"],
  RoleBinding: ["rbac.authorization.k8s.io/v1"],
  ClusterRole: ["rbac.authorization.k8s.io/v1"],
  ClusterRoleBinding: ["rbac.authorization.k8s.io/v1"],
  CustomResourceDefinition: ["apiextensions.k8s.io/v1"],
  PriorityClass: ["scheduling.k8s.io/v1"],
  Lease: ["coordination.k8s.io/v1"],
};

/** Kind'ы, для которых пункт меню регистрируется всегда. */
export const ALWAYS_REGISTERED = ["Pod", "Node", "Namespace"];

function kindWithKnownApiVersion(kind: string): ScopeSpec | undefined {
  const known = Object.keys(KNOWN_KINDS).find(
    (candidate) => candidate.toLowerCase() === kind.toLowerCase(),
  );

  if (!known) return undefined;

  return { raw: kind, kind: known, apiVersions: KNOWN_KINDS[known], containers: false };
}

/**
 * Разбирает запись scope: алиас, голый kind или `<group>/<version>:<Kind>`.
 * Неизвестный kind без явного apiVersion — undefined, про это ругается validate.
 */
export function parseScope(raw: string): ScopeSpec | undefined {
  const scope = raw.trim();

  if (scope === "") return undefined;

  const alias = ALIASES[scope.toLowerCase()];

  if (alias) {
    return {
      raw: scope,
      kind: alias.kind,
      apiVersions: KNOWN_KINDS[alias.kind],
      containers: alias.containers === true,
    };
  }

  const explicit = /^(.+):([^:]+)$/.exec(scope);

  if (explicit) {
    return {
      raw: scope,
      kind: explicit[2].trim(),
      apiVersions: [explicit[1].trim()],
      containers: false,
    };
  }

  return kindWithKnownApiVersion(scope);
}

/**
 * Scope кнопки, подходящий под этот kind.
 *
 * `containers` важнее: кнопка, заявленная и как `containers`, и как `pods`,
 * рисуется с подменю контейнеров.
 */
export function buttonScopeFor(button: ButtonSpec, kind: string): ScopeSpec | undefined {
  const scopes = button.scopes
    .map(parseScope)
    .filter((scope): scope is ScopeSpec => scope !== undefined)
    .filter((scope) => scope.kind === kind);

  return scopes.find((scope) => scope.containers) ?? scopes[0];
}

/**
 * Объявила ли кнопка для этого kind ещё и scope на сам объект.
 *
 * Важно для пода: кнопка со scope'ами `containers` и `pods` — это «пункт про
 * под целиком, а в подменю контейнеры». Клик по самому пункту тогда открывает
 * под, а не первый контейнер. Так устроены логи: у пода свой селектор, у
 * контейнера — уточнённый.
 */
export function buttonWantsObject(button: ButtonSpec, kind: string): boolean {
  return button.scopes
    .map(parseScope)
    .some((scope) => scope !== undefined && scope.kind === kind && !scope.containers);
}

/**
 * Kind'ы, под которые надо зарегистрировать пункт меню.
 *
 * Считается один раз при старте Lens: `kubeObjectMenuItems` — статическое поле
 * расширения, новый kind в конфиге виден только после перезагрузки окна.
 */
export function scopeRegistrations(config: CrtLensConfig): { kind: string; apiVersions: string[] }[] {
  const byKind = new Map<string, Set<string>>();

  const add = (scope: ScopeSpec) => {
    const versions = byKind.get(scope.kind) ?? new Set<string>();

    scope.apiVersions.forEach((version) => versions.add(version));
    byKind.set(scope.kind, versions);
  };

  for (const kind of ALWAYS_REGISTERED) {
    const scope = kindWithKnownApiVersion(kind);

    if (scope) add(scope);
  }

  for (const button of config.buttons) {
    for (const raw of button.scopes) {
      const scope = parseScope(raw);

      if (scope) add(scope);
    }
  }

  return [...byKind.entries()].map(([kind, versions]) => ({
    kind,
    apiVersions: [...versions],
  }));
}

/** Колонка в списке объектов: одна кнопка на один kind. */
export interface ColumnScope {
  buttonId: string;
  kind: string;
  apiVersions: string[];
}

/**
 * Колонки, которые надо зарегистрировать: по одной на пару «кнопка с
 * `column: true`» × kind из её `scopes`. Колонка появляется только у того kind,
 * который кнопка и так поддерживает.
 *
 * Пара считается один раз: кнопка со scope'ами `containers` и `pods` даёт одну
 * колонку у Pod, а не две. Кнопки с одинаковым `id` тоже дают одну колонку на
 * kind — иначе в списке было бы две неразличимые иконки, а `id` колонки в Lens
 * обязан быть уникальным внутри kind.
 *
 * Считается один раз при старте, как и `scopeRegistrations`: новая колонка
 * видна после перезагрузки окна.
 */
export function columnScopes(config: CrtLensConfig): ColumnScope[] {
  const columns = new Map<string, ColumnScope>();

  for (const button of config.buttons) {
    if (!button.column) continue;

    for (const raw of button.scopes) {
      const scope = parseScope(raw);

      if (!scope) continue;

      const key = JSON.stringify([button.id, scope.kind]);
      const existing = columns.get(key);

      if (existing) {
        for (const version of scope.apiVersions) {
          if (!existing.apiVersions.includes(version)) existing.apiVersions.push(version);
        }

        continue;
      }

      columns.set(key, {
        buttonId: button.id,
        kind: scope.kind,
        apiVersions: [...scope.apiVersions],
      });
    }
  }

  return [...columns.values()];
}
