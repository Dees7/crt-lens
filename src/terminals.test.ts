/**
 * Тесты выбора внешнего терминала и файлов-заданий.
 *
 * Пресеты — данные, поэтому тут проверяется ровно то, что делает код: мерж,
 * выбор, формат задания. Сами argv дефолтных пресетов не проверяются: их правит
 * человек в конфиге, и тест на них ломался бы от каждой правки таблицы.
 */
import * as assert from "assert";
import * as fs from "fs";
import * as yaml from "js-yaml";
import { test as check } from "vitest";

import { DEFAULT_CONFIG, normalizeConfig, terminalsSamplePath } from "./config";
import { jobBody, jobFileName } from "./launch/job";
import { chooseTerminal, currentPlatform, isProblem, jobFlavorOf } from "./launch/terminals";
import { AUTODETECT_ORDER, DEFAULT_TERMINALS, TerminalSpec } from "./terminals-default";

/** Тесты гоняются на той платформе, где запущены, — секции пишем под неё. */
const PLATFORM = currentPlatform()!;

function withTerminals(terminals: Record<string, TerminalSpec>, default_terminal = "") {
  return { ...DEFAULT_CONFIG, terminals, default_terminal };
}

const spec = (over: Partial<TerminalSpec> = {}): TerminalSpec => ({
  job: "posix",
  [PLATFORM]: { argv: [process.execPath, "{{job}}"] },
  ...over,
});

// ── формат задания ───────────────────────────────────────────────────────────

check("флейвор берётся из секции платформы, потом из пресета", () => {
  assert.strictEqual(jobFlavorOf({ job: "cmd", [PLATFORM]: { argv: ["x"] } }, PLATFORM), "cmd");
  assert.strictEqual(
    jobFlavorOf({ job: "cmd", [PLATFORM]: { argv: ["x"], job: "posix" } }, PLATFORM),
    "posix",
  );
});

check("без указания флейвор задаётся платформой", () => {
  assert.strictEqual(jobFlavorOf({ win32: { argv: ["x"] } }, "win32"), "cmd");
  assert.strictEqual(jobFlavorOf({ darwin: { argv: ["x"] } }, "darwin"), "posix");
  assert.strictEqual(jobFlavorOf({ linux: { argv: ["x"] } }, "linux"), "posix");
});

check("имя файла задания чистится так же, как в open-shell.py", () => {
  assert.strictEqual(jobFileName("web/worker-1", "posix"), "web_worker-1.sh");
  assert.strictEqual(jobFileName("web/worker-1", "cmd"), "web_worker-1.cmd");
  // края обрезаются, всё небезопасное внутри становится подчёркиванием
  assert.strictEqual(jobFileName("  a b  ", "posix"), "a_b.sh");
  // кириллица в заголовке тоже небезопасна для имени файла
  assert.strictEqual(jobFileName("под:1", "posix"), "____1.sh");
});

check("posix-задание запускает команду через exec", () => {
  const body = jobBody("t", "kubectl exec -it pod", "posix");

  assert.ok(body.startsWith("#!/bin/bash\n"));
  assert.ok(body.includes("\nexec kubectl exec -it pod\n"));
});

check("cmd-задание — батник с CRLF и без эха", () => {
  const body = jobBody("t", "kubectl exec -it pod", "cmd");

  assert.ok(body.startsWith("@echo off\r\n"));
  assert.ok(body.includes("kubectl exec -it pod"));
  assert.ok(!body.includes("exec kubectl"));
});

// ── выбор терминала ──────────────────────────────────────────────────────────

check("явно названный пресет выигрывает у default_terminal", () => {
  const config = withTerminals({ a: spec(), b: spec() }, "b");
  const chosen = chooseTerminal(config, "a");

  assert.ok(!isProblem(chosen));
  assert.strictEqual(chosen.name, "a");
});

check("без имени берётся default_terminal", () => {
  const chosen = chooseTerminal(withTerminals({ a: spec(), b: spec() }, "b"), "");

  assert.ok(!isProblem(chosen));
  assert.strictEqual(chosen.name, "b");
});

check("несуществующий пресет — понятная жалоба, а не молчание", () => {
  const chosen = chooseTerminal(withTerminals({ a: spec() }), "нетакого");

  assert.ok(isProblem(chosen));
  assert.ok(chosen.problem.includes("нетакого"));
});

check("пресет без секции под текущую платформу — тоже жалоба", () => {
  const other = PLATFORM === "win32" ? "linux" : "win32";
  const chosen = chooseTerminal(withTerminals({ a: { job: "posix", [other]: { argv: ["x"] } } }), "a");

  assert.ok(isProblem(chosen));
  assert.ok(chosen.problem.includes(PLATFORM));
});

check("автоопределение берёт первый пресет, чей бинарь существует", () => {
  const config = withTerminals({
    нету: { job: "posix", [PLATFORM]: { argv: ["/такого/файла/нет", "{{job}}"] } },
    есть: spec(),
  });
  const chosen = chooseTerminal(config, "");

  assert.ok(!isProblem(chosen));
  assert.strictEqual(chosen.name, "есть");
});

check("ни одного установленного терминала — кнопка не запустится", () => {
  const config = withTerminals({
    нету: { job: "posix", [PLATFORM]: { argv: ["/такого/файла/нет"] } },
  });
  const chosen = chooseTerminal(config, "");

  assert.ok(isProblem(chosen));
});

// ── мерж пресетов ────────────────────────────────────────────────────────────

check("свой пресет добавляется к дефолтным, не затирая их", () => {
  const config = normalizeConfig({
    terminals: { мой: { job: "posix", darwin: { argv: ["/bin/мой"] } } },
  });

  assert.ok(config.terminals.мой !== undefined);
  assert.ok(config.terminals.crt !== undefined);
  assert.ok(config.terminals.kitty !== undefined);
});

check("одноимённый пресет заменяет дефолтный целиком", () => {
  const config = normalizeConfig({
    terminals: { kitty: { job: "cmd", darwin: { argv: ["/bin/другое"] } } },
  });

  assert.deepStrictEqual(config.terminals.kitty.darwin?.argv, ["/bin/другое"]);
  assert.strictEqual(config.terminals.kitty.job, "cmd");
});

check("секция без argv выбрасывается — пустой запуск хуже отсутствия пресета", () => {
  const config = normalizeConfig({
    terminals: { пустой: { darwin: { argv: [] }, linux: { argv: ["/bin/ok"] } } },
  });

  assert.strictEqual(config.terminals.пустой.darwin, undefined);
  assert.deepStrictEqual(config.terminals.пустой.linux?.argv, ["/bin/ok"]);
});

// ── справочник пресетов рядом с расширением ──────────────────────────────────

/**
 * terminals.sample.yaml — копия таблицы пресетов для человека: из него
 * копируют запись к себе в конфиг. Копия обязана совпадать с кодом дословно,
 * иначе скопированный пресет ведёт себя не так, как встроенный.
 */
const sample = yaml.load(fs.readFileSync(terminalsSamplePath(), "utf8")) as Record<string, unknown>;

check("справочник пресетов совпадает со встроенной таблицей", () => {
  assert.deepStrictEqual(sample.terminals, DEFAULT_TERMINALS);
});

check("в справочнике записан тот же порядок автоопределения", () => {
  const text = fs.readFileSync(terminalsSamplePath(), "utf8");

  assert.ok(
    text.includes(AUTODETECT_ORDER.join(", ")),
    `в шапке файла должен быть порядок: ${AUTODETECT_ORDER.join(", ")}`,
  );
});

check("справочник кладётся в конфиг как есть и ничего не ломает", () => {
  const config = normalizeConfig(sample);

  assert.deepStrictEqual(config.terminals, DEFAULT_TERMINALS);
});
