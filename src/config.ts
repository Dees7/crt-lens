import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import * as yaml from "js-yaml";

import { DEFAULT_TERMINALS, Terminals, TerminalSpec } from "./terminals-default";

/**
 * Значение маски: одна строка или список альтернатив.
 *
 * Список — это «или»: `namespace: [prod, temporal]` совпадает и с тем, и с
 * другим. Альтернативы — такие же glob-маски, как одиночное значение.
 */
export type Mask = string | string[];

/**
 * Маски цели. Все необязательные, glob: `*` и `?`, матч по всей строке.
 *
 * Стоят на кнопке (видимость и перекрытие), на правиле внутри кнопки (подбор
 * значения) и на записи `vars` (подбор переменной). Совпасть должны ВСЕ
 * объявленные маски; маска, которой у цели нет вовсе (`pod` у ноды, `node`
 * у пода), считается несовпавшей.
 */
export interface Masks {
  context?: Mask;
  namespace?: Mask;
  pod?: Mask;
  container?: Mask;
  node?: Mask;
  /**
   * Имя выделенного объекта в текущем scope — то же, что подставляется как
   * `{{name}}`: контейнер для `containers`, под для `pods`, нода для `nodes`.
   * Маска называется `object`, потому что `name` у кнопки занят подписью.
   */
  object?: Mask;
  /** Версия сервера кластера без `v`: `1.33.3`. Маска та же, что и у остальных */
  kube_version?: Mask;
}

/** Набор переменных под маской — из него собирается таблица окружений. */
export interface VarsEntry extends Masks {
  set: Record<string, string>;
}

/**
 * Правило подбора значений кнопки.
 *
 * Поля значений (`cmd`, `shell`, `image`, `url`, `query`, `terminal`)
 * разрешаются независимо друг от друга: для каждого берётся своё самое
 * специфичное правило (см. match.ts). `vars` — тоже независимо, но по ключам.
 */
export interface ButtonRule extends Masks {
  cmd?: string;
  shell?: string;
  image?: string;
  url?: string;
  query?: string;
  terminal?: string;
  vars?: Record<string, string>;
}

/** Старое имя ButtonRule — верхнеуровневый `rules` из старого формата. */
export type ShellRule = ButtonRule;

/**
 * Запрос строки у человека перед запуском кнопки.
 *
 * Ответ подставляется как `{{input}}` — и как `{{userinput}}`, это то же самое
 * значение под привычным именем; `{{input_quoted}}` — он же в кавычках того
 * шелла, в котором команда выполнится. Заданный `input` сам по себе открывает
 * диалог: `confirm` для этого не нужен, диалог и так показывает готовую команду
 * и пересобирает её на каждое нажатие клавиши.
 */
export interface InputSpec {
  /** Подпись над полем; пусто — имя кнопки */
  label: string;
  /**
   * Чем поле заполнено при открытии диалога.
   *
   * Не подсказка серым, а настоящее значение: обычный запуск — это Enter, а
   * править приходится только когда нужен другой фильтр. Такой же шаблон, как
   * `cmd`, — знает про все переменные.
   */
  default: string;
  /** Пустую строку не принимать */
  required: boolean;
}

/** Поля `input` — для проверки опечаток в validate.ts */
export const INPUT_FIELDS = ["label", "default", "required"];

/**
 * `input` из YAML: `true`, строка-подпись или мапа полей.
 *
 * Короткие формы — потому что в большинстве случаев нужна только подпись:
 * `input: true` спрашивает строку молча, `input: "фильтр"` — с подписью.
 * Всё, что не то и не другое (в том числе `false`), — запроса нет.
 */
export function normalizeInput(raw: unknown): InputSpec | undefined {
  const empty: InputSpec = { label: "", default: "", required: false };

  if (raw === true) return empty;

  if (typeof raw === "string") {
    return raw === "" ? undefined : { ...empty, label: raw };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const source = raw as Record<string, unknown>;

  return {
    label: str(source.label) ?? "",
    default: str(source.default) ?? "",
    required: source.required === true,
  };
}

/**
 * Что кнопка делает по клику.
 *
 * `local` — терминал в доке Freelens, `ext` — внешний терминал по пресету из
 * `terminals`, `url` — ссылка в браузере, `logs` — штатный просмотрщик логов в
 * доке. Старый `crt` при разборе конфига превращается в `ext` с `terminal: crt`:
 * SecureCRT — обычный пресет, ничего особенного в коде про него больше нет.
 */
export type ButtonType = "local" | "ext" | "url" | "logs";

export const BUTTON_TYPES: ButtonType[] = ["local", "ext", "url", "logs"];

/**
 * Синонимы `type`, которые разбор приводит к каноническому имени.
 *
 * `log` — то же, что `logs`: ошибиться в числе тут слишком легко, а молча
 * свалиться в `ext` (кнопка запустит несуществующую команду) — худший исход.
 */
const TYPE_ALIASES: Record<string, ButtonType> = { log: "logs" };

/** Неизвестный тип — `ext`: про это ругается validateConfig. */
export function normalizeType(raw: string | undefined): ButtonType {
  if (raw === undefined) return "ext";

  const alias = TYPE_ALIASES[raw];

  if (alias) return alias;

  return (BUTTON_TYPES as string[]).includes(raw) ? (raw as ButtonType) : "ext";
}

/** Имя пресета, который получает кнопка со старым `type: crt`. */
export const CRT_TERMINAL = "crt";

/**
 * Кнопка-плагин: пункт меню у объекта кластера.
 *
 * Маски (из `Masks`) решают, показывать ли кнопку вообще. Кнопки с одинаковым
 * `id` схлопываются в одну — побеждает самая специфичная применимая, при
 * равенстве нижняя в файле (это и есть перекрытие под конкретный контекст).
 */
export interface ButtonSpec extends Masks {
  id: string;
  /** Подпись пункта и тултип иконки */
  name: string;
  type: ButtonType;
  /** material-имя, `svg:<имя или xml>`, `text:<глиф>`; пусто — иконка терминала */
  icon: string;
  /** `containers`, `pods`, `nodes`, `namespaces`, `Deployment`, `apps/v1:Deployment` */
  scopes: string[];
  /** Шаблон заголовка вкладки; пусто — `pod_tab_title` / `node_tab_title` / `{{name}}` */
  title?: string;
  /** Значения по умолчанию для кнопки, если ни одно правило не задало своё */
  cmd?: string;
  shell?: string;
  image?: string;
  /** Шаблон ссылки для `type: url` */
  url?: string;
  /** Шаблон селектора; рендерится в `{{query}}` и `{{query_encoded}}` */
  query?: string;
  /** Имя пресета из `terminals` для `type: ext` */
  terminal?: string;
  /** Переменные кнопки — под её же масками */
  vars?: Record<string, string>;
  /** Спросить подтверждение перед запуском */
  confirm: boolean;
  /** Спросить строку перед запуском; она же `{{input}}` в шаблонах */
  input?: InputSpec;
  /**
   * Показывать кнопку и на остановленном поде или контейнере.
   *
   * По умолчанию кнопка есть только у живых: в под, который уже не бежит,
   * шеллом не зайти. Но логи у упавшего пода и у завершённой джобы есть — им
   * это и включают. Мёртвые контейнеры тогда тоже попадают в подменю, со своим
   * цветом кирпича.
   */
  include_stopped: boolean;
  /**
   * Показывать кнопку ещё и колонкой в списке объектов — по колонке на каждый
   * kind из `scopes`. Пункт меню при этом остаётся: колонка его не заменяет.
   */
  column: boolean;
  rules: ButtonRule[];
}

export interface CrtLensConfig {
  /** Подпись кнопки из старого формата — дефолт для legacy-кнопки */
  name: string;
  /** Имя material-иконки из старого формата — дефолт для legacy-кнопки */
  material_icon: string;
  /** Шрифт для текстовых иконок (`icon: 'text:'`) — глифы Nerd Font */
  icon_font: string;

  kubectl_path: string;

  pod_tab_title: string;
  node_tab_title: string;
  /** Длиннее — срезаем хвост, без многоточия */
  tab_title_max: number;

  default_shell: string;
  default_node_image: string;
  node_namespace: string;

  /** Команда по умолчанию для scope `containers` и `pods` */
  pod_command: string;
  /** Команда по умолчанию для scope `nodes` */
  node_command: string;

  /** Пресет для кнопок `ext` без своего `terminal`; пусто — автоопределение */
  default_terminal: string;
  /** Пресеты внешних терминалов: пользовательские поверх дефолтных, по имени */
  terminals: Terminals;
  /** Таблица переменных: окружения для ссылок и всё, что нужно подставлять */
  vars: VarsEntry[];

  /** Верхнеуровневый список правил из старого формата */
  rules: ButtonRule[];

  buttons: ButtonSpec[];
}

export const DEFAULT_SHELL = "clear; (bash || ash || sh)";

/** Образ по умолчанию — тот же, что у штатного node shell в Lens (initialNodeShellImage) */
export const DEFAULT_NODE_IMAGE = "docker.io/alpine:3.13";

export const DEFAULT_POD_COMMAND =
  '{{kubectl}} --kubeconfig "{{kubeconfig}}" --context {{context}} ' +
  "exec -i -t -n {{namespace}} {{pod}} -c {{container}} -- sh -c {{shell_quoted}}";

export const DEFAULT_NODE_COMMAND =
  '{{kubectl}} --kubeconfig "{{kubeconfig}}" --context {{context}} -n {{node_namespace}} ' +
  "run {{node_pod}} --rm -it --restart=Never --image {{image}} --overrides {{overrides}}";

/** Кнопка, которую получает конфиг без секции `buttons`. */
export const LEGACY_BUTTON_ID = "shell";

export const MASK_FIELDS: (keyof Masks)[] = [
  "context",
  "namespace",
  "pod",
  "container",
  "node",
  "object",
  "kube_version",
];

export type ValueField = "cmd" | "shell" | "image" | "url" | "query" | "terminal";

export const VALUE_FIELDS: ValueField[] = ["cmd", "shell", "image", "url", "query", "terminal"];

/** Поля кнопки сверх масок и значений — для проверки опечаток в validate.ts */
export const BUTTON_FIELDS = [
  "id",
  "name",
  "type",
  "icon",
  "scopes",
  "title",
  "confirm",
  "input",
  "column",
  "include_stopped",
  "rules",
  "vars",
];

export const DEFAULT_BUTTON: ButtonSpec = {
  id: LEGACY_BUTTON_ID,
  name: "SecureCRT",
  type: "ext",
  terminal: CRT_TERMINAL,
  icon: "",
  scopes: ["containers", "nodes"],
  confirm: false,
  column: false,
  include_stopped: false,
  rules: [],
};

export const DEFAULT_CONFIG: CrtLensConfig = {
  name: "SecureCRT",
  material_icon: "",
  icon_font: "",

  kubectl_path: "kubectl",

  pod_tab_title: "{{pod}}/{{container}}",
  node_tab_title: "{{node}}",
  tab_title_max: 32,

  default_shell: DEFAULT_SHELL,
  default_node_image: DEFAULT_NODE_IMAGE,
  node_namespace: "kube-system",

  pod_command: DEFAULT_POD_COMMAND,
  node_command: DEFAULT_NODE_COMMAND,

  default_terminal: "",
  terminals: DEFAULT_TERMINALS,
  // окружения — дело конкретной команды, в коде их нет: пример в crt-lens.sample.yaml
  vars: [],

  rules: [],
  buttons: [DEFAULT_BUTTON],
};

const CONFIG_FILE = "crt-lens.yaml";

/**
 * Домашние каталоги приложений, в порядке предпочтения.
 *
 * У Freelens это ~/.freelens, у Lens/OpenLens было ~/.k8slens. Расширение
 * теперь только под Freelens, но уже лежащий на диске конфиг важнее: тот, кто
 * переехал, продолжает работать со своим файлом, а не получает пустые дефолты.
 */
const APP_HOMES = [".freelens", ".k8slens"];

/** Имя файла-примера рядом с расширением; он же то, что подставляет «Дефолты». */
const SAMPLE_FILE = "crt-lens.sample.yaml";

/**
 * Справочник по пресетам терминалов рядом с расширением.
 *
 * Копия `DEFAULT_TERMINALS` в YAML: пресеты живут в коде и работают без этого
 * файла, а он нужен, чтобы человек увидел, как пресет устроен, и скопировал
 * похожий к себе. Что копия не разъехалась с кодом, проверяет тест.
 */
const TERMINALS_SAMPLE_FILE = "terminals.sample.yaml";

/**
 * Каталог самого расширения.
 *
 * Бандл лежит в `<расширение>/dist/renderer.js`, пример конфига и примеры
 * SecureCRT — рядом с ним. `import.meta.url` переживает сборку Vite в ESM,
 * поэтому дотянуться до соседних файлов можно без зашитых путей: в собранном
 * виде это `dist/..`, в тестах — `src/..`, и там и там корень расширения.
 */
export function extensionDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function sampleConfigPath(): string {
  return path.join(extensionDir(), SAMPLE_FILE);
}

export function terminalsSamplePath(): string {
  return path.join(extensionDir(), TERMINALS_SAMPLE_FILE);
}

function existingOrFirst(file: (home: string) => string): string {
  const candidates = APP_HOMES.map((home) => file(path.join(os.homedir(), home)));

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export function configPath(): string {
  return existingOrFirst((home) => path.join(home, CONFIG_FILE));
}

/**
 * Рабочий каталог расширения: задания для внешних терминалов и примеры.
 *
 * Те же правила поиска, что у конфига, и ровно те же, что зашиты в
 * examples/securecrt/open-shell.py — скрипт во вкладке ищет задание сам.
 */
export function workDir(): string {
  return existingOrFirst((home) => path.join(home, "crt-lens"));
}

export function jobsDir(): string {
  return path.join(workDir(), "jobs");
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Мапа строк из YAML: всё, что не строка, приводится к строке, мусор выкидывается. */
function strMap(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const source = raw as Record<string, unknown>;
  const result: Record<string, string> = {};

  for (const key of Object.keys(source)) {
    const value = source[key];

    if (value === null || value === undefined || typeof value === "object") continue;

    result[key] = String(value);
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Значение маски из YAML: строка либо список строк.
 *
 * Пустое значение и пустой список — это «маски нет»; мусор внутри списка
 * выбрасывается. Про всё выброшенное ругается validateConfig: маска, которая
 * молча исчезла, делает кнопку видимой везде, а это худший вид ошибки.
 */
export function normalizeMask(value: unknown): Mask | undefined {
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === "string" && item !== "");

    return items.length > 0 ? items : undefined;
  }

  return str(value);
}

function masksFrom(source: Record<string, unknown>, into: Masks): void {
  for (const field of MASK_FIELDS) {
    const value = normalizeMask(source[field]);

    if (value !== undefined) into[field] = value;
  }
}

/** Маски и значения правила: всё, что не строка или пусто, выкидывается. */
export function normalizeRule(raw: unknown): ButtonRule | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const source = raw as Record<string, unknown>;
  const rule: ButtonRule = {};

  masksFrom(source, rule);

  for (const field of VALUE_FIELDS) {
    const value = str(source[field]);

    if (value !== undefined) rule[field] = value;
  }

  const vars = strMap(source.vars);

  if (vars) rule.vars = vars;

  return rule;
}

function normalizeRules(raw: unknown): ButtonRule[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map(normalizeRule)
    .filter((rule): rule is ButtonRule => rule !== undefined);
}

/** Запись таблицы переменных: маски плюс `set`. Без `set` запись бессмысленна. */
export function normalizeVarsEntry(raw: unknown): VarsEntry | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const source = raw as Record<string, unknown>;
  const set = strMap(source.set);

  if (!set) return undefined;

  const entry: VarsEntry = { set };

  masksFrom(source, entry);

  return entry;
}

function normalizeVars(raw: unknown): VarsEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map(normalizeVarsEntry)
    .filter((entry): entry is VarsEntry => entry !== undefined);
}

/**
 * Кнопка из YAML. Мусор не роняет расширение: неизвестный `type` превращается
 * в `ext`, пустой `id` — в `button-<номер>`; про то и другое ругается
 * validateConfig, чтобы человек увидел это в настройках.
 */
export function normalizeButton(raw: unknown, index: number): ButtonSpec {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = str(source.id) ?? `button-${index + 1}`;
  const rawType = str(source.type);

  const button: ButtonSpec = {
    id,
    name: str(source.name) ?? id,
    type: normalizeType(rawType),
    icon: str(source.icon) ?? "",
    scopes: Array.isArray(source.scopes)
      ? source.scopes.map(String).filter((scope) => scope !== "")
      : [],
    confirm: source.confirm === true,
    column: source.column === true,
    include_stopped: source.include_stopped === true,
    rules: normalizeRules(source.rules),
  };

  masksFrom(source, button);

  for (const field of VALUE_FIELDS) {
    const value = str(source[field]);

    if (value !== undefined) button[field] = value;
  }

  // Старый `type: crt` — это `ext` с пресетом crt. Явный terminal у кнопки важнее:
  // так `type: crt` + `terminal: iterm` не превращается в противоречие.
  if (rawType === "crt" && button.terminal === undefined) {
    button.terminal = CRT_TERMINAL;
  }

  const vars = strMap(source.vars);

  if (vars) button.vars = vars;

  const title = str(source.title);

  if (title !== undefined) button.title = title;

  const input = normalizeInput(source.input);

  if (input) button.input = input;

  return button;
}

/**
 * Конфиг без секции `buttons` — старый формат. Собираем из него одну кнопку,
 * чтобы существующие файлы продолжали работать без правок.
 */
export function legacyButton(config: Partial<CrtLensConfig>): ButtonSpec {
  return {
    ...DEFAULT_BUTTON,
    name: config.name || DEFAULT_CONFIG.name,
    icon: config.material_icon || "",
    rules: config.rules ?? [],
  };
}

/** Пресет терминала из YAML. Платформенные секции — только с непустым argv. */
export function normalizeTerminal(raw: unknown): TerminalSpec | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const source = raw as Record<string, unknown>;
  const spec: TerminalSpec = {};
  const job = str(source.job);

  if (job === "posix" || job === "cmd" || job === "none") spec.job = job;

  for (const platform of ["darwin", "win32", "linux"] as const) {
    const section = source[platform];

    if (!section || typeof section !== "object" || Array.isArray(section)) continue;

    const parsed = section as Record<string, unknown>;
    const argv = Array.isArray(parsed.argv) ? parsed.argv.map(String) : [];

    if (argv.length === 0) continue;

    spec[platform] = {
      argv,
      ...(Array.isArray(parsed.activate) ? { activate: parsed.activate.map(String) } : {}),
      ...(str(parsed.job) === "posix" || str(parsed.job) === "cmd" || str(parsed.job) === "none"
        ? { job: str(parsed.job) as TerminalSpec["job"] }
        : {}),
    };
  }

  return spec;
}

function normalizeTerminals(raw: unknown): Terminals {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const source = raw as Record<string, unknown>;
  const terminals: Terminals = {};

  for (const name of Object.keys(source)) {
    const spec = normalizeTerminal(source[name]);

    if (spec) terminals[name] = spec;
  }

  return terminals;
}

/**
 * Пресет `crt` из ключей старого формата.
 *
 * Раньше путь к SecureCRT, аргументы и имя сессии были отдельными настройками,
 * а про активацию окна знал сам код. Теперь это обычный пресет — но старый
 * конфиг должен продолжать работать, поэтому собираем пресет из его ключей.
 * Если человек описал `crt` в `terminals` сам, побеждает описанное явно.
 */
export function legacyCrtTerminal(source: Record<string, unknown>): TerminalSpec | undefined {
  const binary = str(source.securecrt_path);
  const session = str(source.session_name) ?? "crt-lens";
  const args = Array.isArray(source.securecrt_args) ? source.securecrt_args.map(String) : [];
  const hasLegacyKeys =
    binary !== undefined || args.length > 0 || source.session_name !== undefined || source.activate_app !== undefined;

  if (!hasLegacyKeys) return undefined;

  const argv = [
    binary ?? "/Applications/SecureCRT.app/Contents/MacOS/SecureCRT",
    ...args,
    "/T",
    "/N",
    "{{title}}",
    "/S",
    session,
  ];
  const activate = DEFAULT_TERMINALS[CRT_TERMINAL].darwin?.activate;

  return {
    job: "posix",
    darwin: {
      argv,
      ...(source.activate_app === false || !activate ? {} : { activate }),
    },
  };
}

/** Разбирает уже прочитанный YAML-объект. Вынесено ради тестов. */
export function normalizeConfig(parsed: unknown): CrtLensConfig {
  if (!parsed || typeof parsed !== "object") {
    return DEFAULT_CONFIG;
  }

  const source = parsed as Partial<CrtLensConfig> & Record<string, unknown>;
  const userTerminals = normalizeTerminals(source.terminals);
  const legacyCrt = legacyCrtTerminal(source);

  const config: CrtLensConfig = {
    name: source.name || DEFAULT_CONFIG.name,
    material_icon: source.material_icon || "",
    icon_font: source.icon_font || "",

    kubectl_path: source.kubectl_path || DEFAULT_CONFIG.kubectl_path,

    pod_tab_title: source.pod_tab_title || DEFAULT_CONFIG.pod_tab_title,
    node_tab_title: source.node_tab_title || DEFAULT_CONFIG.node_tab_title,
    tab_title_max: Number(source.tab_title_max) > 0
      ? Number(source.tab_title_max)
      : DEFAULT_CONFIG.tab_title_max,

    default_shell: source.default_shell || DEFAULT_SHELL,
    default_node_image: source.default_node_image || DEFAULT_NODE_IMAGE,
    node_namespace: source.node_namespace || DEFAULT_CONFIG.node_namespace,

    pod_command: source.pod_command || DEFAULT_POD_COMMAND,
    node_command: source.node_command || DEFAULT_NODE_COMMAND,

    default_terminal: source.default_terminal || "",
    // порядок важен: явные пресеты человека > собранный из старых ключей crt > дефолты
    terminals: {
      ...DEFAULT_TERMINALS,
      ...(legacyCrt ? { [CRT_TERMINAL]: legacyCrt } : {}),
      ...userTerminals,
    },
    vars: normalizeVars(source.vars),

    rules: normalizeRules(source.rules),
    buttons: Array.isArray(source.buttons) ? source.buttons.map(normalizeButton) : [],
  };

  if (config.buttons.length === 0) {
    config.buttons = [legacyButton(config)];
  }

  return config;
}

/**
 * Минимальный пример на случай, когда файла-примера рядом нет.
 *
 * Такого быть не должно — `crt-lens.sample.yaml` перечислен в `files` пакета,
 * — но кнопка «Дефолты» в настройках не должна падать из-за неполной установки.
 */
const FALLBACK_SAMPLE = [
  "# No crt-lens.sample.yaml was found next to the extension — here is the minimum.",
  "# The full example with every field lives in the extension repository.",
  "",
  "buttons:",
  "  - id: shell",
  "    name: Shell",
  "    type: local",
  "    scopes: [containers, nodes]",
  "",
].join("\n");

/**
 * Пример конфига — то, что видит человек, у которого своего файла ещё нет,
 * и то, что подставляет кнопка «Дефолты».
 *
 * Лежит отдельным файлом рядом с расширением, а не собирается из кода: пример
 * — это данные, его правят и читают глазами, и в нём нужны комментарии, которых
 * дамп YAML не умеет.
 */
export function defaultConfigYaml(): string {
  try {
    return fs.readFileSync(sampleConfigPath(), "utf8");
  } catch {
    return FALLBACK_SAMPLE;
  }
}

/** Кеш по mtime: меню перечитывает конфиг на каждый рендер. */
let cache: { mtimeMs: number; size: number; config: CrtLensConfig } | undefined;

/**
 * Читает конфиг с диска. Файла нет — отдаёт дефолты.
 * Бросает исключение, если YAML битый: вызывающий решает, что показать.
 */
export function loadConfig(): CrtLensConfig {
  const file = configPath();

  let stat: fs.Stats;

  try {
    stat = fs.statSync(file);
  } catch {
    return DEFAULT_CONFIG;
  }

  if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
    return cache.config;
  }

  const config = normalizeConfig(yaml.load(fs.readFileSync(file, "utf8")));

  cache = { mtimeMs: stat.mtimeMs, size: stat.size, config };

  return config;
}

export function readConfigYaml(): string {
  const file = configPath();

  if (!fs.existsSync(file)) {
    return defaultConfigYaml();
  }

  return fs.readFileSync(file, "utf8");
}

/** Проверяет YAML на разбираемость и пишет на диск. Бросает исключение при битом YAML. */
export function saveConfigYaml(text: string): void {
  const parsed = yaml.load(text);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("the config must be a YAML object");
  }

  const { rules, buttons, vars, terminals } = parsed as Partial<CrtLensConfig>;

  if (rules !== undefined && !Array.isArray(rules)) {
    throw new Error("rules must be a list");
  }

  if (buttons !== undefined && !Array.isArray(buttons)) {
    throw new Error("buttons must be a list — every button has its own id field");
  }

  if (vars !== undefined && !Array.isArray(vars)) {
    throw new Error("vars must be a list of entries with a set field");
  }

  if (terminals !== undefined && (typeof terminals !== "object" || Array.isArray(terminals))) {
    throw new Error("terminals must be a map: preset name → description");
  }

  const file = configPath();

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  cache = undefined;
}

export type { Terminals, TerminalSpec };
