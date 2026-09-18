import {
  BUTTON_FIELDS,
  BUTTON_TYPES,
  ButtonSpec,
  ButtonType,
  CrtLensConfig,
  CRT_TERMINAL,
  INPUT_FIELDS,
  MASK_FIELDS,
  normalizeButton,
  normalizeConfig,
  normalizeInput,
  VALUE_FIELDS,
} from "./config";
import { scopeDefaultCommand } from "./command";
import { currentPlatform } from "./launch/terminals";
import { LOG_KINDS, logsKindSupported } from "./logs";
import { parseScope } from "./scopes";

const KNOWN_BUTTON_FIELDS = [...BUTTON_FIELDS, ...MASK_FIELDS, ...VALUE_FIELDS] as string[];
const KNOWN_RULE_FIELDS = [...MASK_FIELDS, ...VALUE_FIELDS, "vars"] as string[];

/**
 * Кроме канонических типов, разбор понимает синонимы: старый `crt` — это `ext`
 * с пресетом crt, `log` — то же, что `logs`.
 */
const ACCEPTED_TYPES = [...BUTTON_TYPES, "crt", "log"];

/**
 * Неизвестные поля — почти всегда опечатка, и молчать о ней нельзя: разбор такие
 * поля выкидывает, из-за чего правило с опечатанной маской становится безмасочным
 * и начинает применяться ко всему подряд.
 */
function unknownFields(raw: unknown, known: string[], where: string): string[] {
  if (!raw || typeof raw !== "object") return [];

  return Object.keys(raw as Record<string, unknown>)
    .filter((field) => !known.includes(field))
    .map((field) => `${where}: неизвестное поле ${JSON.stringify(field)} — оно игнорируется`);
}

/**
 * Маски с негодным значением.
 *
 * Разбор такие маски выбрасывает, и это худшая из молчаливых ошибок: кнопка
 * с выброшенной маской становится безмасочной, то есть видна везде. Особенно
 * легко нарваться на `namespace: [prod, 1]` или на `namespace: ''`.
 */
function maskProblems(raw: unknown, where: string): string[] {
  if (!raw || typeof raw !== "object") return [];

  const source = raw as Record<string, unknown>;
  const problems: string[] = [];

  for (const field of MASK_FIELDS) {
    const value = source[field];

    if (value === undefined) continue;

    if (typeof value === "string") {
      if (value === "") {
        problems.push(`${where}: маска ${field} пустая — она игнорируется, а не «совпадает с пустым»`);
      }

      continue;
    }

    if (Array.isArray(value)) {
      const bad = value.filter((item) => typeof item !== "string" || item === "");

      if (value.length === 0) {
        problems.push(`${where}: маска ${field} — пустой список, она игнорируется`);
      } else if (bad.length > 0) {
        problems.push(
          `${where}: в маске ${field} есть значения, которые не строки: ` +
            `${JSON.stringify(bad)} — они выброшены`,
        );
      }

      continue;
    }

    problems.push(
      `${where}: маска ${field} должна быть строкой или списком строк, а не ` +
        `${JSON.stringify(value)} — она игнорируется, и кнопка видна везде`,
    );
  }

  return problems;
}

/**
 * Пресеты, которые кнопка может попросить: её `terminal` и все `terminal`
 * из правил. Отсутствующий пресет — это молча не нарисованная кнопка,
 * поэтому про него надо сказать заранее.
 */
function terminalProblems(
  config: CrtLensConfig,
  button: ButtonSpec,
  where: string,
): string[] {
  if (button.type !== "ext") return [];

  const wanted = [button.terminal, ...button.rules.map((rule) => rule.terminal)].filter(
    (name): name is string => name !== undefined && name !== "",
  );
  const platform = currentPlatform();
  const problems: string[] = [];

  for (const name of [...new Set(wanted)]) {
    const spec = config.terminals[name];

    if (!spec) {
      problems.push(`${where}: нет пресета терминала ${JSON.stringify(name)} в terminals`);

      continue;
    }

    if (platform && !spec[platform]) {
      problems.push(
        `${where}: у пресета ${name} нет секции ${platform} — на этой машине кнопки не будет`,
      );
    }
  }

  if (wanted.length === 0 && !config.default_terminal && !config.terminals[CRT_TERMINAL]) {
    problems.push(
      `${where}: не задан terminal и нет default_terminal — терминал выберется автоопределением`,
    );
  }

  return problems;
}

/** Подстановка ответа на запрос ввода — во всех трёх её именах. */
const INPUT_PLACEHOLDER = /\{\{\s*(input|userinput|input_quoted)\s*\}\}/i;

/**
 * Шаблоны, куда ответ на `input` может подставиться.
 *
 * Значения из `vars` сюда не входят намеренно: подстановка делается в один
 * проход, и `{{input}}`, написанный внутри переменной, так и останется текстом.
 * Команды по умолчанию из конфига — входят: кнопка без своего `cmd` работает
 * именно ими.
 */
function inputTemplates(config: CrtLensConfig, button: ButtonSpec): string[] {
  return [
    button.cmd,
    button.url,
    button.query,
    button.title,
    config.pod_command,
    config.node_command,
    ...button.rules.flatMap((rule) => [rule.cmd, rule.url, rule.query]),
  ].filter((template): template is string => typeof template === "string");
}

/**
 * Запрос строки: сам он и то, подставляется ли ответ хоть куда-нибудь.
 *
 * Обе половины молчаливы: запрос без `{{input}}` в шаблонах спросит и выбросит
 * ответ, а `{{input}}` без запроса подставит пустую строку — и то и другое видно
 * только по странному результату запуска.
 */
function inputProblems(
  config: CrtLensConfig,
  button: ButtonSpec,
  raw: Record<string, unknown>,
  where: string,
): string[] {
  const problems: string[] = [];
  const used = inputTemplates(config, button).some((template) =>
    INPUT_PLACEHOLDER.test(template),
  );

  if (raw.input !== undefined && raw.input !== false && !normalizeInput(raw.input)) {
    problems.push(
      `${where}: input должен быть true, строкой-подписью или мапой ` +
        `{ label, placeholder, default, required } — запроса ввода не будет`,
    );
  }

  if (!button.input) {
    if (used) {
      problems.push(
        `${where}: в шаблонах есть {{input}}, но input не задан — подставится пустая строка`,
      );
    }

    return problems;
  }

  problems.push(...unknownFields(raw.input, INPUT_FIELDS, `${where}, input`));

  if (!used) {
    problems.push(
      `${where}: input спрашивает строку, но подставлять её некуда — добавьте {{input}} ` +
        "в cmd, url, query или title",
    );
  }

  if (button.type === "logs") {
    problems.push(`${where}: type logs не собирает команду — ответ на input некуда девать`);
  }

  return problems;
}

/**
 * Разбор конфига на вменяемость.
 *
 * Нормализация мусор молча проглатывает (чтобы меню не падало), поэтому всё,
 * что было проглочено, человек должен увидеть в настройках. На вход идёт сырой
 * результат `yaml.load`: неизвестный `type` после нормализации уже не отличить
 * от `crt`.
 */
export function validateConfig(raw: unknown): string[] {
  const problems: string[] = [];

  if (!raw || typeof raw !== "object") {
    return ["конфиг должен быть YAML-объектом"];
  }

  const source = raw as Record<string, unknown>;

  if (source.buttons !== undefined && !Array.isArray(source.buttons)) {
    return ["buttons должен быть списком — у каждой кнопки своё поле id"];
  }

  if (source.vars !== undefined && !Array.isArray(source.vars)) {
    problems.push("vars должен быть списком записей вида { context: ..., set: { ключ: значение } }");
  } else if (Array.isArray(source.vars)) {
    source.vars.forEach((entry, index) => {
      const fields = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;

      if (!fields.set || typeof fields.set !== "object" || Array.isArray(fields.set)) {
        problems.push(`vars #${index}: нет мапы set — запись ничего не задаёт и игнорируется`);
      }

      problems.push(...unknownFields(entry, [...MASK_FIELDS, "set"] as string[], `vars #${index}`));
      problems.push(...maskProblems(entry, `vars #${index}`));
    });
  }

  if (
    source.terminals !== undefined &&
    (typeof source.terminals !== "object" || Array.isArray(source.terminals))
  ) {
    problems.push("terminals должен быть мапой: имя пресета → описание");
  }

  const config = normalizeConfig(raw);
  const rawButtons = Array.isArray(source.buttons) ? source.buttons : [];

  rawButtons.forEach((rawButton, index) => {
    const button = normalizeButton(rawButton, index);
    const fields = (rawButton && typeof rawButton === "object" ? rawButton : {}) as Record<
      string,
      unknown
    >;
    const where = `кнопка #${index + 1} (${button.id})`;

    if (typeof fields.id !== "string" || fields.id === "") {
      problems.push(`${where}: нет id — кнопки с одинаковым id перекрывают друг друга, задайте его`);
    }

    if (fields.type !== undefined && !ACCEPTED_TYPES.includes(fields.type as ButtonType)) {
      problems.push(
        `${where}: неизвестный type ${JSON.stringify(fields.type)}, бывает local, ext, url и logs ` +
          "(старый crt читается как ext с пресетом crt)",
      );
    }

    if (fields.vars !== undefined && (typeof fields.vars !== "object" || Array.isArray(fields.vars))) {
      problems.push(`${where}: vars должен быть мапой ключ → значение`);
    }

    problems.push(...terminalProblems(config, button, where));
    problems.push(...inputProblems(config, button, fields, where));

    if (button.type === "url") {
      const hasUrl = button.url !== undefined || button.rules.some((rule) => rule.url !== undefined);

      if (!hasUrl) {
        problems.push(`${where}: type url без url — задайте ссылку у кнопки или в rules`);
      }
    }

    problems.push(...unknownFields(rawButton, KNOWN_BUTTON_FIELDS, where));
    problems.push(...maskProblems(rawButton, where));

    if (fields.rules !== undefined && !Array.isArray(fields.rules)) {
      problems.push(`${where}: rules должен быть списком`);
    } else if (Array.isArray(fields.rules)) {
      fields.rules.forEach((rule, ruleIndex) => {
        const ruleWhere = `${where}, правило #${ruleIndex}`;

        problems.push(...unknownFields(rule, KNOWN_RULE_FIELDS, ruleWhere));
        problems.push(...maskProblems(rule, ruleWhere));
      });
    }

    if (button.scopes.length === 0) {
      problems.push(`${where}: не задан scopes — кнопка нигде не появится`);

      return;
    }

    for (const raw of button.scopes) {
      const scope = parseScope(raw);

      if (!scope) {
        problems.push(
          `${where}: неизвестный scope ${JSON.stringify(raw)} — для своего kind укажите ` +
            "apiVersion явно, например apps/v1:MyKind",
        );

        continue;
      }

      // logs открывает штатный таб по самому объекту — ни команда, ни ссылка ей не нужны
      if (button.type === "logs") {
        if (!logsKindSupported(scope.kind)) {
          problems.push(
            `${where}: type logs не умеет scope ${raw} — логи есть у ${LOG_KINDS.join(", ")}`,
          );
        }

        continue;
      }

      const hasCmd =
        button.type === "url" ||
        button.cmd !== undefined ||
        button.rules.some((rule) => rule.cmd !== undefined) ||
        scopeDefaultCommand(config, scope) !== "";

      if (!hasCmd) {
        problems.push(
          `${where}: в scope ${raw} нет команды по умолчанию — задайте cmd у кнопки или в rules`,
        );
      }
    }
  });

  return problems;
}
