import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { CrtLensConfig } from "../config";
import {
  AUTODETECT_ORDER,
  JobFlavor,
  Platform,
  PLATFORMS,
  TerminalPlatform,
  TerminalSpec,
} from "../terminals-default";
import { quote, renderTemplate } from "../template";
import { cleanupJobs, writeJob } from "./job";

/** Выбранный терминал: пресет, его секция под текущую платформу и формат задания. */
export interface ChosenTerminal {
  name: string;
  platform: TerminalPlatform;
  flavor: JobFlavor;
}

export function currentPlatform(): Platform | undefined {
  return (PLATFORMS as readonly string[]).includes(process.platform)
    ? (process.platform as Platform)
    : undefined;
}

/** Формат задания: секция платформы важнее пресета, дефолт — по платформе. */
export function jobFlavorOf(spec: TerminalSpec, platform: Platform): JobFlavor {
  return spec[platform]?.job ?? spec.job ?? (platform === "win32" ? "cmd" : "posix");
}

/** Кавычки для команды, которая уйдёт в док Freelens: там шелл самой системы. */
export function localFlavor(): JobFlavor {
  return process.platform === "win32" ? "cmd" : "posix";
}

/**
 * Есть ли на машине бинарь пресета.
 *
 * Абсолютный путь проверяем на диске, голое имя ищем по PATH сами: автоопределение
 * зовётся из рендера меню, и запускать ради него `which` на каждую кнопку не годится.
 * Результат кешируется на сессию — терминалы редко ставят при открытом Freelens.
 */
const availability = new Map<string, boolean>();

export function binaryExists(binary: string): boolean {
  const cached = availability.get(binary);

  if (cached !== undefined) return cached;

  let found = false;

  try {
    if (binary.includes("/") || binary.includes("\\")) {
      found = fs.existsSync(binary);
    } else {
      const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);

      found = dirs.some((dir) => fs.existsSync(path.join(dir, binary)));
    }
  } catch {
    found = false;
  }

  availability.set(binary, found);

  return found;
}

export function terminalAvailable(spec: TerminalSpec, platform: Platform): boolean {
  const section = spec[platform];

  return section !== undefined && section.argv.length > 0 && binaryExists(section.argv[0]);
}

/** Почему кнопку `ext` не удалось запустить — текст для превью и для нотификации. */
export interface TerminalProblem {
  problem: string;
}

export function isProblem(value: ChosenTerminal | TerminalProblem): value is TerminalProblem {
  return (value as TerminalProblem).problem !== undefined;
}

/**
 * Какой терминал открывать: имя у кнопки → `default_terminal` → автоопределение.
 *
 * Автоопределение идёт по фиксированному порядку предпочтения и берёт первый
 * пресет, у которого есть секция под текущую платформу и существует бинарь.
 * Явно названный пресет на наличие бинаря НЕ проверяется: человек мог поставить
 * терминал в нестандартное место, и запрет тут был бы вреднее ошибки запуска.
 */
export function chooseTerminal(
  config: CrtLensConfig,
  wanted: string,
): ChosenTerminal | TerminalProblem {
  const platform = currentPlatform();

  if (!platform) {
    return { problem: `платформа ${process.platform} не поддерживается` };
  }

  const explicit = wanted || config.default_terminal;

  if (explicit) {
    const spec = config.terminals[explicit];

    if (!spec) {
      return { problem: `нет пресета терминала ${explicit} — опишите его в terminals` };
    }

    const section = spec[platform];

    if (!section) {
      return { problem: `у пресета ${explicit} нет секции ${platform}` };
    }

    return { name: explicit, platform: section, flavor: jobFlavorOf(spec, platform) };
  }

  const names = [
    ...AUTODETECT_ORDER.filter((name) => config.terminals[name]),
    ...Object.keys(config.terminals).filter((name) => !AUTODETECT_ORDER.includes(name)),
  ];
  const found = names.find((name) => terminalAvailable(config.terminals[name], platform));

  if (!found) {
    return { problem: `не нашёл ни одного установленного терминала для ${platform}` };
  }

  const spec = config.terminals[found];

  return { name: found, platform: spec[platform] as TerminalPlatform, flavor: jobFlavorOf(spec, platform) };
}

function detach(argv: string[]): void {
  const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: "ignore" });

  child.unref();
}

/**
 * Открывает команду во внешнем терминале.
 *
 * Команда доезжает файлом задания (`{{job}}`), а не аргументом: так её не нужно
 * протаскивать через кавычки терминала, и так же её находит вкладка SecureCRT,
 * которой в argv достаётся только заголовок. Пресет с `job: none` получает
 * команду прямо в argv — для терминалов, которые это умеют.
 *
 * Возвращает путь к заданию (удобно для логов) либо пустую строку.
 */
export function openInTerminal(
  chosen: ChosenTerminal,
  title: string,
  command: string,
): string {
  const job = chosen.flavor === "none" ? "" : writeJob(title, command, chosen.flavor);

  if (job) cleanupJobs();

  const vars: Record<string, string> = {
    job,
    title,
    command,
    command_quoted: quote(command, chosen.flavor === "none" ? localFlavor() : chosen.flavor),
  };
  const argv = chosen.platform.argv.map((arg) => renderTemplate(arg, vars));

  if (!binaryExists(argv[0])) {
    throw new Error(`не нашёл ${argv[0]} — поправьте пресет ${chosen.name} в terminals`);
  }

  detach(argv);

  if (chosen.platform.activate) {
    detach(chosen.platform.activate.map((arg) => renderTemplate(arg, vars)));
  }

  return job;
}
