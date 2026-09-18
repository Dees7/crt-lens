import { JobFlavor } from "./terminals-default";

/** Подстановка {{name}}, регистр ключа не важен. Одинарные скобки не трогаются. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  const lower: Record<string, string> = {};

  for (const key of Object.keys(vars)) {
    lower[key.toLowerCase()] = vars[key];
  }

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const value = lower[key.toLowerCase()];

    return value === undefined ? match : value;
  });
}

/** Аргумент для /bin/sh: одинарные кавычки, внутренние — через '\''. */
export function posixQuote(value: string): string {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

/**
 * Аргумент для cmd.exe: двойные кавычки, внутренние удваиваются.
 *
 * Проценты тоже удваиваются: команда уезжает в .cmd-файл, а там `%foo%`
 * подставится как переменная окружения и съест кусок команды. В батнике `%%`
 * читается как один литеральный процент.
 */
export function cmdQuote(value: string): string {
  return '"' + String(value).replace(/"/g, '""').replace(/%/g, "%%") + '"';
}

/** Кавычки под тот шелл, в котором команда в итоге выполнится. */
export function quote(value: string, flavor: JobFlavor): string {
  return flavor === "cmd" ? cmdQuote(value) : posixQuote(value);
}

/** Обрезка заголовка вкладки: просто срез, без многоточия. */
export function cutTitle(title: string, max: number): string {
  return max > 0 && title.length > max ? title.slice(0, max) : title;
}
