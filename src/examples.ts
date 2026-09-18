import * as fs from "fs";
import * as path from "path";

import { extensionDir, workDir } from "./config";

/** Что копируем из репозитория расширения в рабочий каталог. */
const SECURECRT_FILES = ["open-shell.py", "crt-lens.ini", "README.md"];

export function examplesDir(): string {
  return path.join(extensionDir(), "examples", "securecrt");
}

export function installedExamplesDir(): string {
  return path.join(workDir(), "securecrt");
}

/**
 * Копирует примеры SecureCRT в рабочий каталог.
 *
 * Единственная вольность, которую расширение себе позволяет, — подставить в
 * сессии реальный путь к скрипту вместо `{{script}}`: это наш собственный
 * пример, а не чужой конфиг. Настройки SecureCRT при этом не трогаются —
 * положить сессию в его каталог человек должен сам, см. README рядом.
 *
 * Возвращает пути к разложенным файлам.
 */
export function installExamples(): string[] {
  const from = examplesDir();
  const to = installedExamplesDir();

  fs.mkdirSync(to, { recursive: true });

  const script = path.join(to, "open-shell.py");

  return SECURECRT_FILES.map((name) => {
    const source = path.join(from, name);
    const target = path.join(to, name);
    const body = fs.readFileSync(source, "utf8").replace(/\{\{script\}\}/g, script);

    fs.writeFileSync(target, body, { encoding: "utf8", mode: name.endsWith(".py") ? 0o700 : 0o600 });

    return target;
  });
}
