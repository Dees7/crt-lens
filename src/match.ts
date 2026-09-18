import { ButtonRule, ButtonSpec, CrtLensConfig, Mask, Masks, ValueField, VarsEntry } from "./config";
import { buttonScopeFor, buttonWantsObject, ScopeSpec } from "./scopes";

/**
 * Что именно открываем. Для контейнера заполнены namespace/pod/container,
 * для ноды — node, для остальных объектов — namespace/name.
 *
 * `name` — имя выделенного объекта в текущем scope, как `$NAME` в k9s:
 * контейнер для `containers`, под для `pods`, нода для `nodes`.
 */
export interface Target {
  context: string;
  namespace?: string;
  pod?: string;
  container?: string;
  node?: string;
  name?: string;
  kind?: string;
  apiVersion?: string;
  /** Версия сервера кластера, как её отдал Lens: `v1.33.3` */
  kubeVersion?: string;
  /**
   * Бежит ли цель прямо сейчас: под в фазе Running, контейнер в состоянии
   * running. `undefined` там, где вопрос не имеет смысла (нода, неймспейс,
   * произвольный kind) — такие цели доступны всегда.
   */
  running?: boolean;
}

export interface Resolved<T> {
  value: T;
  /** Правило, которое выиграло; undefined — сработал дефолт */
  rule?: ButtonRule;
  /** Номер правила в конфиге, для превью в настройках */
  index?: number;
}

/** Маски по имени объекта считаются самыми точными, контекст — самой грубой. */
const WEIGHT_OBJECT = 4; // pod, node, container или name
const WEIGHT_NAMESPACE = 2;
const WEIGHT_CONTEXT = 1;

/**
 * glob по всей строке: `*` — любые символы, `?` — один, `[0-6]` — класс
 * (с `!` или `^` в начале — отрицание). Остальное экранируется.
 *
 * Класс нужен ради версий: «всё, что старше 1.27» — это `1.2[0-6].*`.
 */
export function globToRegExp(mask: string): RegExp {
  let pattern = "";

  for (let index = 0; index < mask.length; index += 1) {
    const char = mask[index];

    if (char === "*") {
      pattern += "[\\s\\S]*";
      continue;
    }

    if (char === "?") {
      pattern += "[\\s\\S]";
      continue;
    }

    if (char === "[") {
      const end = mask.indexOf("]", index + 1);

      if (end > index + 1) {
        const body = mask.slice(index + 1, end).replace(/\\/g, "\\\\");

        pattern += "[" + (body.startsWith("!") ? "^" + body.slice(1) : body) + "]";
        index = end;
        continue;
      }
    }

    pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }

  return new RegExp("^" + pattern + "$");
}

/** Версия кластера в том виде, в каком её сравнивают маски и подставляют команды. */
export function normalizeKubeVersion(kubeVersion?: string): string {
  return (kubeVersion ?? "").replace(/^v/, "");
}

/** Альтернативы маски: одиночная строка — список из одного элемента. */
function alternatives(mask: Mask): string[] {
  return Array.isArray(mask) ? mask : [mask];
}

/** Список в маске — это «или»: достаточно совпадения с одной альтернативой. */
export function matchesMask(mask: Mask, value: string | undefined): boolean {
  if (value === undefined) return false;

  return alternatives(mask).some((item) => globToRegExp(item).test(value));
}

/**
 * Правило (или кнопка) применимо, когда совпали все объявленные в нём маски.
 *
 * Маска, которой у цели нет вовсе (pod у ноды, node у пода), считается
 * несовпавшей — иначе правило про поды влияло бы на ноды.
 */
export function applies(masks: Masks, target: Target): boolean {
  if (masks.context !== undefined && !matchesMask(masks.context, target.context)) return false;
  if (masks.namespace !== undefined && !matchesMask(masks.namespace, target.namespace)) return false;
  if (masks.pod !== undefined && !matchesMask(masks.pod, target.pod)) return false;
  if (masks.container !== undefined && !matchesMask(masks.container, target.container)) return false;
  if (masks.node !== undefined && !matchesMask(masks.node, target.node)) return false;
  // маска object сравнивается с именем выделенного объекта — тем же, что идёт в {{name}}
  if (masks.object !== undefined && !matchesMask(masks.object, target.name)) return false;

  if (masks.kube_version !== undefined) {
    const version = normalizeKubeVersion(target.kubeVersion);

    // версия ещё не определилась — считаем, что маска не совпала
    if (version === "" || !matchesMask(masks.kube_version, version)) return false;
  }

  return true;
}

/**
 * Маски уровня кластера — единственные, которые можно проверить, ещё не зная
 * объекта. По ним колонка списка решает, показываться ли ей вообще: маски по
 * имени пода или неймспейсу считаются уже в ячейке, на конкретной строке.
 */
export function clusterMasksApply(masks: Masks, context: string, kubeVersion?: string): boolean {
  if (masks.context !== undefined && !matchesMask(masks.context, context)) return false;

  if (masks.kube_version !== undefined) {
    const version = normalizeKubeVersion(kubeVersion);

    if (version === "" || !matchesMask(masks.kube_version, version)) return false;
  }

  return true;
}

/** Вес правила: чем точнее маски, тем больше. */
export function weight(masks: Masks): number {
  let total = 0;

  if (masks.pod !== undefined) total += WEIGHT_OBJECT;
  if (masks.node !== undefined) total += WEIGHT_OBJECT;
  if (masks.container !== undefined) total += WEIGHT_OBJECT;
  if (masks.object !== undefined) total += WEIGHT_OBJECT;
  if (masks.namespace !== undefined) total += WEIGHT_NAMESPACE;
  if (masks.context !== undefined) total += WEIGHT_CONTEXT;
  // версия — свойство кластера, как и контекст, поэтому вес тот же
  if (masks.kube_version !== undefined) total += WEIGHT_CONTEXT;

  return total;
}

/**
 * Длина литеральной части одной маски.
 *
 * У списка берём самую короткую альтернативу: набор вариантов не может быть
 * точнее самого слабого из них, иначе `namespace: [prod, '*']` выигрывал бы
 * у честной маски `namespace: prod`.
 */
function maskLiteral(mask: Mask): number {
  return Math.min(...alternatives(mask).map((item) => item.replace(/[*?]/g, "").length));
}

/**
 * Длина литеральной части всех масок — тай-брейк при равном весе.
 * `deploy-worker*` точнее, чем `deploy*`, потому что задаёт больше символов.
 */
export function literalLength(masks: Masks): number {
  const list = [
    masks.context,
    masks.namespace,
    masks.pod,
    masks.container,
    masks.node,
    masks.object,
    masks.kube_version,
  ];

  return list.reduce((sum: number, mask) => {
    if (mask === undefined) return sum;

    return sum + maskLiteral(mask);
  }, 0);
}

/**
 * Самое специфичное подошедшее правило, у которого задано поле `field`.
 *
 * Порядок сравнения: вес → длина литеральной части → номер в файле (раньше — лучше).
 */
export function resolve(
  rules: ButtonRule[],
  target: Target,
  field: ValueField,
  fallback: string,
): Resolved<string> {
  let best: Resolved<string> | undefined;
  let bestWeight = -1;
  let bestLiteral = -1;

  rules.forEach((rule, index) => {
    const value = rule && rule[field];

    if (typeof value !== "string" || value === "") return;
    if (!applies(rule, target)) return;

    const ruleWeight = weight(rule);
    const ruleLiteral = literalLength(rule);

    if (ruleWeight > bestWeight || (ruleWeight === bestWeight && ruleLiteral > bestLiteral)) {
      best = { value, rule, index };
      bestWeight = ruleWeight;
      bestLiteral = ruleLiteral;
    }
  });

  return best ?? { value: fallback };
}

/**
 * Откуда пришла переменная. Ранг решает спор при одинаковых масках: то, что
 * человек написал ближе к кнопке, важнее общей таблицы окружений.
 */
const VAR_RANK_GLOBAL = 0;
const VAR_RANK_BUTTON = 1;
const VAR_RANK_RULE = 2;

interface VarSource {
  masks: Masks;
  set: Record<string, string>;
  rank: number;
}

/** Все места, где кнопка может получить переменные, в порядке появления. */
function varSources(vars: VarsEntry[], button: ButtonSpec): VarSource[] {
  const sources: VarSource[] = vars.map((entry) => ({
    masks: entry,
    set: entry.set,
    rank: VAR_RANK_GLOBAL,
  }));

  if (button.vars) {
    sources.push({ masks: button, set: button.vars, rank: VAR_RANK_BUTTON });
  }

  for (const rule of button.rules) {
    if (rule.vars) {
      sources.push({ masks: rule, set: rule.vars, rank: VAR_RANK_RULE });
    }
  }

  return sources;
}

/**
 * Переменные для цели: каждый ключ разрешается независимо.
 *
 * Порядок сравнения тот же, что у правил, плюс ранг источника:
 * вес масок → длина литеральной части → источник (правило > кнопка > таблица) →
 * раньше в файле.
 */
export function resolveVars(
  vars: VarsEntry[],
  button: ButtonSpec,
  target: Target,
): Record<string, string> {
  const best = new Map<string, { weight: number; literal: number; rank: number }>();
  const result: Record<string, string> = {};

  varSources(vars, button).forEach((source) => {
    if (!applies(source.masks, target)) return;

    const sourceWeight = weight(source.masks);
    const sourceLiteral = literalLength(source.masks);

    for (const key of Object.keys(source.set)) {
      const previous = best.get(key);

      if (
        previous &&
        (sourceWeight < previous.weight ||
          (sourceWeight === previous.weight && sourceLiteral < previous.literal) ||
          (sourceWeight === previous.weight &&
            sourceLiteral === previous.literal &&
            source.rank <= previous.rank))
      ) {
        continue;
      }

      best.set(key, { weight: sourceWeight, literal: sourceLiteral, rank: source.rank });
      result[key] = source.set[key];
    }
  });

  return result;
}

/** Кнопка, которую надо нарисовать, и цели, на которые она может сходить. */
export interface PickedButton {
  button: ButtonSpec;
  scope: ScopeSpec;
  /**
   * Что кнопка может открыть. `targets[0]` — то, что делает клик по самому
   * пункту меню и по иконке в строке списка; остальное уходит в подменю.
   *
   * Для scope `containers` это контейнеры пода. Если кнопка объявила ещё и
   * `pods`, первым идёт сам под: пункт открывает под целиком, подменю —
   * контейнеры.
   */
  targets: Target[];
}

/**
 * Кнопки для объекта такого kind.
 *
 * Кнопки с одинаковым `id` схлопываются в одну: выигрывает самая специфичная
 * применимая, при равенстве — нижняя в файле (перекрытие под контекст).
 * Порядок пунктов — по первому применимому появлению `id`.
 */
export function pickButtons(
  config: CrtLensConfig,
  kind: string,
  targets: { containers: Target[]; object: Target },
): PickedButton[] {
  interface Candidate extends PickedButton {
    weight: number;
    literal: number;
  }

  const chosen = new Map<string, Candidate>();

  config.buttons.forEach((button) => {
    const scope = buttonScopeFor(button, kind);

    if (!scope) return;

    // сам объект впереди контейнеров — только если кнопка попросила оба scope'а
    const candidates = scope.containers
      ? [...(buttonWantsObject(button, kind) ? [targets.object] : []), ...targets.containers]
      : [targets.object];
    const matched = candidates
      // в остановленный под не зайти шеллом, но логи у него есть — решает кнопка
      .filter((target) => button.include_stopped || target.running !== false)
      .filter((target) => applies(button, target));

    if (matched.length === 0) return;

    const buttonWeight = weight(button);
    const buttonLiteral = literalLength(button);
    const previous = chosen.get(button.id);

    if (
      previous &&
      (buttonWeight < previous.weight ||
        (buttonWeight === previous.weight && buttonLiteral < previous.literal))
    ) {
      return;
    }

    // Map держит позицию первого ключа: перекрытие не двигает кнопку в меню
    chosen.set(button.id, {
      button,
      scope,
      targets: matched,
      weight: buttonWeight,
      literal: buttonLiteral,
    });
  });

  return [...chosen.values()].map(({ button, scope, targets: matched }) => ({
    button,
    scope,
    targets: matched,
  }));
}
