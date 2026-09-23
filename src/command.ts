import { ButtonSpec, CrtLensConfig } from "./config";
import { chooseTerminal, isProblem, localFlavor } from "./launch/terminals";
import { normalizeKubeVersion, resolve, Resolved, resolveVars, Target } from "./match";
import { ScopeSpec } from "./scopes";
import { JobFlavor } from "./terminals-default";
import { cutTitle, quote, renderTemplate } from "./template";

export interface BuiltCommand {
  /** Готовая строка для задания или дока; пусто — команду взять неоткуда */
  command: string;
  /** Готовая ссылка для `type: url`; пусто — ссылку взять неоткуда */
  url: string;
  /** Заголовок вкладки, уже обрезанный до tab_title_max */
  title: string;
  /** Шаблон заголовка до подстановок — чтобы пересобрать его с ответом на `input` */
  titleTemplate: string;
  /** Шелл, под который экранируются значения: нужен той же пересборке */
  flavor: JobFlavor;
  cmd: Resolved<string>;
  shell: Resolved<string>;
  image: Resolved<string>;
  terminal: Resolved<string>;
  /** Шаблоны ссылки и селектора — какое правило их дало, для превью */
  urlRule: Resolved<string>;
  queryRule: Resolved<string>;
  /** Что подставлялось — для превью в настройках */
  vars: Record<string, string>;
  /** Почему кнопка не запустится: нет пресета, нет терминала, нечего открывать */
  problem?: string;
}

/**
 * Спека привилегированного пода для шелла на ноду.
 *
 * Повторяет то, что делает сам Lens (node-shell-session.ts): хостовые
 * неймспейсы, privileged, толерантность ко всем taint'ам и системный
 * priorityClass, чтобы под заехал даже на забитую ноду.
 */
export function nodeOverrides(node: string, image: string, shell: string): string {
  return JSON.stringify({
    spec: {
      nodeName: node,
      hostPID: true,
      hostIPC: true,
      hostNetwork: true,
      restartPolicy: "Never",
      terminationGracePeriodSeconds: 0,
      tolerations: [{ operator: "Exists" }],
      priorityClassName: "system-node-critical",
      containers: [
        {
          name: "shell",
          image,
          stdin: true,
          tty: true,
          securityContext: { privileged: true },
          command: ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "--", "sh", "-c", shell],
        },
      ],
    },
  });
}

/** Имя пода для шелла на ноду: как у Lens, но короче и без зависимости от uuid. */
export function nodePodName(): string {
  return "node-shell-" + Math.random().toString(36).slice(2, 10);
}

/**
 * Версия кластера для подстановок: `v1.33.3` → `1.33.3` и `1.33`.
 *
 * Нужна, чтобы `kubectl_path` мог указывать на бинарь под конкретный кластер:
 * версии кластеров разные, а skew у kubectl всего ±1 минор.
 */
export function versionVars(kubeVersion?: string): Record<string, string> {
  const full = normalizeKubeVersion(kubeVersion);

  return { kube_version: full, kube_minor: full.split(".").slice(0, 2).join(".") };
}

/**
 * Команда по умолчанию для scope.
 *
 * Есть только у `containers` (kubectl exec) и `nodes` (привилегированный под):
 * остальным scope'ам команду взять неоткуда, кнопка обязана задать `cmd` сама.
 */
export function scopeDefaultCommand(config: CrtLensConfig, scope: ScopeSpec): string {
  if (scope.containers) return config.pod_command;
  if (scope.kind === "Node") return config.node_command;

  return "";
}

export function scopeDefaultTitle(config: CrtLensConfig, scope: ScopeSpec): string {
  if (scope.containers) return config.pod_tab_title;
  if (scope.kind === "Node") return config.node_tab_title;

  return "{{name}}";
}

/** Кавычки и формат задания зависят от того, куда команда в итоге уедет. */
function flavorFor(
  config: CrtLensConfig,
  button: ButtonSpec,
  terminal: string,
): { flavor: JobFlavor; problem?: string } {
  if (button.type !== "ext") return { flavor: localFlavor() };

  const chosen = chooseTerminal(config, terminal);

  if (isProblem(chosen)) return { flavor: localFlavor(), problem: chosen.problem };

  return { flavor: chosen.flavor === "none" ? localFlavor() : chosen.flavor };
}

/**
 * Ответ на запрос ввода — под тремя именами.
 *
 * `input` и `userinput` — одно и то же значение как есть, `input_quoted` — оно
 * же в кавычках того шелла, в котором команда выполнится. Пустой ответ не
 * превращается в пустые кавычки: `{{input_quoted}}` тогда исчезает из команды
 * целиком, а не оставляет после себя `''`.
 */
export function inputVars(value: string, flavor: JobFlavor): Record<string, string> {
  return {
    input: value,
    userinput: value,
    input_quoted: value ? quote(value, flavor) : "",
  };
}

/** Шаблоны, из которых собираются команда, ссылка и заголовок. */
interface Templates {
  cmd: string;
  url: string;
  query: string;
  title: string;
}

/**
 * Финальный рендер: сначала селектор, потом всё, что его использует.
 *
 * Вынесено отдельно, потому что делается дважды: при сборке меню — с пустым
 * `{{input}}`, и ещё раз, когда человек ответил на запрос ввода (см. withInput).
 */
function renderOutputs(
  button: ButtonSpec,
  templates: Templates,
  vars: Record<string, string>,
  titleMax: number,
): Pick<BuiltCommand, "command" | "url" | "title" | "vars"> {
  // селектор рендерится первым: в ссылку он попадает уже url-encoded
  const query = templates.query ? renderTemplate(templates.query, vars) : "";
  const full = { ...vars, query, query_encoded: encodeURIComponent(query) };

  return {
    command: button.type === "url" || !templates.cmd ? "" : renderTemplate(templates.cmd, full),
    url: button.type === "url" && templates.url ? renderTemplate(templates.url, full) : "",
    title: cutTitle(renderTemplate(templates.title, full), titleMax),
    vars: full,
  };
}

/**
 * Пересобирает уже готовую кнопку с ответом на запрос ввода.
 *
 * Меню строит команду заранее, до клика, когда ответа ещё нет; диалог ввода
 * зовёт это на каждое нажатие клавиши — и чтобы показать команду, и чтобы её
 * запустить. Всё остальное (какое правило дало команду, какой терминал выбран)
 * остаётся прежним: ввод на подбор значений не влияет.
 */
export function withInput(
  config: CrtLensConfig,
  button: ButtonSpec,
  built: BuiltCommand,
  value: string,
): BuiltCommand {
  const templates: Templates = {
    cmd: built.cmd.value,
    url: built.urlRule.value,
    query: built.queryRule.value,
    title: built.titleTemplate,
  };
  const vars = { ...built.vars, ...inputVars(value, built.flavor) };

  return { ...built, ...renderOutputs(button, templates, vars, config.tab_title_max) };
}

/**
 * Собирает команду или ссылку кнопки для конкретной цели.
 *
 * `cmd`, `shell`, `image`, `url`, `query` и `terminal` подбираются независимо:
 * правило кнопки → значение кнопки → дефолт конфига. Пустой `command` (или
 * `url` у ссылки) означает, что открывать нечего — вызывающий такую кнопку
 * не рисует.
 */
export function buildButtonCommand(
  config: CrtLensConfig,
  button: ButtonSpec,
  scope: ScopeSpec,
  target: Target,
  kubeconfig: string,
): BuiltCommand {
  const cmd = resolve(
    button.rules,
    target,
    "cmd",
    button.cmd ?? scopeDefaultCommand(config, scope),
  );
  const shell = resolve(button.rules, target, "shell", button.shell ?? config.default_shell);
  const image = resolve(
    button.rules,
    target,
    "image",
    button.image ?? config.default_node_image,
  );
  const url = resolve(button.rules, target, "url", button.url ?? "");
  const query = resolve(button.rules, target, "query", button.query ?? "");
  const terminal = resolve(button.rules, target, "terminal", button.terminal ?? "");

  const { flavor, problem } = flavorFor(config, button, terminal.value);
  const version = versionVars(target.kubeVersion);

  const vars: Record<string, string> = {
    // окно по умолчанию для ссылок; перебивается своей записью в vars
    from: "now-1h",
    to: "now",
    // таблица окружений; имена, занятые под цель и кластер, ниже перекрываются —
    // подменить {{pod}} через vars нельзя намеренно
    ...resolveVars(config.vars, button, target),
    ...version,
    // сам путь к kubectl тоже шаблон: так он может зависеть от версии кластера
    kubectl: renderTemplate(config.kubectl_path, version),
    kubeconfig,
    context: target.context,
    namespace: target.namespace ?? "",
    pod: target.pod ?? "",
    container: target.container ?? "",
    node: target.node ?? "",
    name: target.name ?? "",
    kind: target.kind ?? scope.kind,
    api_version: target.apiVersion ?? "",
    ...providerVars(target.providerId),
    button: button.id,
    platform: process.platform,
    node_namespace: config.node_namespace,
    node_pod: nodePodName(),
    image: image.value,
    shell: shell.value,
    shell_quoted: quote(shell.value, flavor),
    // ответа на `input` здесь ещё нет — команда собирается до клика; пустые
    // значения нужны, чтобы в превью и в команде без запроса не осталось
    // неподставленного {{input}}
    ...inputVars("", flavor),
    overrides: target.node
      ? quote(nodeOverrides(target.node, image.value, shell.value), flavor)
      : "",
  };

  const title = button.title ?? scopeDefaultTitle(config, scope);
  const templates: Templates = {
    cmd: cmd.value,
    url: url.value,
    query: query.value,
    title,
  };

  return {
    ...renderOutputs(button, templates, vars, config.tab_title_max),
    titleTemplate: title,
    flavor,
    cmd,
    shell,
    image,
    terminal,
    urlRule: url,
    queryRule: query,
    ...(problem ? { problem } : {}),
  };
}

/**
 * Путь `spec.providerID` ноды без схемы, по сегментам:
 * `gce://proj/europe-west1-b/node-1` → `["proj", "europe-west1-b", "node-1"]`,
 * `aws:///eu-west-1a/i-0ab…` → `["eu-west-1a", "i-0ab…"]`.
 */
function providerSegments(providerId: string | undefined): string[] {
  if (!providerId) return [];

  return providerId
    .replace(/^[a-z][\w+.-]*:\/\//i, "")
    .split("/")
    .filter((part) => part !== "");
}

/**
 * Id машины — последний сегмент пути: `yandex://a7l…` → `a7l…`,
 * `aws:///eu-west-1a/i-0ab…` → `i-0ab…`. Облачные консоли адресуют ноду им,
 * а не именем из кубера.
 */
export function instanceId(providerId: string | undefined): string {
  return providerSegments(providerId).pop() ?? "";
}

/**
 * Всё, что шаблон знает про машину под нодой: `provider_id` как есть,
 * `provider_path` без схемы, `provider_1`, `provider_2`, … по сегментам и
 * `instance_id`. Сегментов у провайдеров разное число, поэтому номера, которых
 * нет, отдаются пустыми до `provider_9`: ссылка без них не останется с
 * неподставленным `{{provider_4}}`.
 */
export function providerVars(providerId: string | undefined): Record<string, string> {
  const segments = providerSegments(providerId);
  const vars: Record<string, string> = {
    provider_id: providerId ?? "",
    provider_path: segments.join("/"),
    instance_id: segments[segments.length - 1] ?? "",
  };

  for (let index = 0; index < Math.max(9, segments.length); index += 1) {
    vars[`provider_${index + 1}`] = segments[index] ?? "";
  }

  return vars;
}

/**
 * Есть ли у кнопки что открывать: команда для терминала или ссылка для браузера.
 *
 * У `logs` открывать всегда есть что — цель известна из самого объекта, команду
 * и ссылку такая кнопка не использует. Пустой ли список подов, выясняется уже по
 * клику: спрашивать кластер на каждый рендер меню нельзя.
 */
export function isRunnable(button: ButtonSpec, built: BuiltCommand): boolean {
  if (button.type === "logs") return true;

  return button.type === "url" ? built.url !== "" : built.command !== "";
}

export { cutTitle, renderTemplate };
export { posixQuote as shellQuote } from "./template";
