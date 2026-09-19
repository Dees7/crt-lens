import * as fs from "fs";
import * as path from "path";

import { jobsDir } from "../config";
import { JobFlavor } from "../terminals-default";

/** Задания старше суток убираем: вкладку с ними всё равно уже не переподключить. */
const JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Имя файла задания из заголовка вкладки.
 *
 * Ровно те же правила, что в examples/securecrt/open-shell.py, иначе скрипт
 * во вкладке SecureCRT не найдёт задание. Это единственная связка между
 * расширением и скриптом, менять её можно только с обеих сторон сразу.
 */
export function jobFileName(title: string, flavor: JobFlavor): string {
  const base = title.trim().replace(/[^A-Za-z0-9._-]/g, "_");

  return `${base}${flavor === "cmd" ? ".cmd" : ".sh"}`;
}

export function jobPath(title: string, flavor: JobFlavor): string {
  return path.join(jobsDir(), jobFileName(title, flavor));
}

/**
 * Тело задания.
 *
 * posix: `exec`, а не обычный запуск, — выход из kubectl закрывает вкладку,
 * а не возвращает в промежуточный шелл, из которого уже некуда деться.
 * cmd: `@echo off`, чтобы в окне не мелькала сама команда.
 */
export function jobBody(title: string, command: string, flavor: JobFlavor): string {
  if (flavor === "cmd") {
    return ["@echo off", `rem crt-lens: ${title}`, command, ""].join("\r\n");
  }

  return [
    "#!/bin/bash",
    `# crt-lens: ${title}`,
    "# Written by the crt-lens extension; it survives a tab reconnect.",
    `exec ${command}`,
    "",
  ].join("\n");
}

/** Пишет задание рядом со скриптом. Имя файла — из заголовка вкладки. */
export function writeJob(title: string, command: string, flavor: JobFlavor): string {
  fs.mkdirSync(jobsDir(), { recursive: true, mode: 0o700 });

  const file = jobPath(title, flavor);

  fs.writeFileSync(file, jobBody(title, command, flavor), { encoding: "utf8", mode: 0o700 });

  return file;
}

/** Убирает протухшие задания, чтобы каталог не рос бесконечно. */
export function cleanupJobs(now = Date.now()): void {
  let entries: string[];

  try {
    entries = fs.readdirSync(jobsDir());
  } catch {
    return;
  }

  for (const entry of entries) {
    const file = path.join(jobsDir(), entry);

    try {
      if (now - fs.statSync(file).mtimeMs > JOB_MAX_AGE_MS) {
        fs.unlinkSync(file);
      }
    } catch {
      // файл мог исчезнуть сам — это не повод ронять открытие терминала
    }
  }
}
