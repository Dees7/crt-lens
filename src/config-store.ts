import * as fs from "fs";
import { observable, runInAction } from "mobx";

import { configPath, CrtLensConfig, loadConfig } from "./config";

/**
 * Конфиг в mobx-observable — для колонок списка.
 *
 * Меню читает конфиг прямо с диска на каждый рендер, и это дёшево: меню одно.
 * Колонка так не может: её `content` зовут на каждую строку списка (а строк
 * бывают сотни) и на каждое обновление из watch, а `visible` обязан быть
 * честным computed — от значения, которое кто-то меняет, иначе колонка залипнет
 * до перезапуска приложения. Поэтому файл опрашивается раз в POLL_MS в одном
 * месте, а строки читают уже готовое значение.
 */
const POLL_MS = 2000;

const box = observable.box<CrtLensConfig | undefined>(undefined, { deep: false });

let watching = false;

function read(): CrtLensConfig | undefined {
  try {
    return loadConfig();
  } catch (error) {
    console.warn("[crt-lens] не смог прочитать конфиг для колонок:", error);

    return undefined;
  }
}

/**
 * Перечитывает конфиг в observable.
 *
 * Битый YAML (человек правит файл руками) прошлое значение не затирает: иначе
 * колонки пропадали бы на каждое промежуточное сохранение.
 */
export function refreshConfig(): void {
  const next = read();

  // loadConfig отдаёт тот же объект, пока mtime и размер файла не изменились
  if (next === undefined || next === box.get()) return;

  runInAction(() => box.set(next));
}

/** Первое чтение и опрос файла. Зовётся один раз, при регистрации колонок. */
export function watchConfig(): void {
  if (watching) return;

  watching = true;
  refreshConfig();

  try {
    fs.watchFile(configPath(), { interval: POLL_MS }, () => refreshConfig());
  } catch (error) {
    console.warn("[crt-lens] не слежу за конфигом, колонки будут видеть его состояние на старте:", error);
  }
}

/** Конфиг для колонки. Читать только внутри рендера или computed. */
export function observedConfig(): CrtLensConfig | undefined {
  return box.get();
}
