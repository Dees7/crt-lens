/**
 * Диалог запроса строки: ответ должен доехать до запуска, а не остаться в поле.
 *
 * Freelens кладёт параметры `ConfirmDialog.open` в `observable.box` с глубоким
 * преобразованием, поэтому здесь они проходят через настоящий mobx — ровно так,
 * как это делает хост. Любой простой объект в пропсах диалога после такого
 * преобразования приезжает в компонент копией, и общее состояние между полем и
 * колбэком `ok` через пропсы не передать.
 */
import * as assert from "assert";
import { createRequire } from "module";
import { beforeEach, test as check, vi } from "vitest";

interface DialogParams {
  labelOk?: string;
  message: { props: Record<string, unknown> };
  ok: () => void;
}

const opened: DialogParams[] = [];
const sent: string[] = [];
const errors: string[] = [];

vi.mock("@freelensapp/extensions", () => ({
  Renderer: {
    Component: {
      ConfirmDialog: { open: (params: DialogParams) => opened.push(params) },
      Input: () => null,
      Notifications: { error: (text: string) => errors.push(text), info: () => {} },
      createTerminalTab: () => ({ id: "tab-1" }),
      terminalStore: {
        sendCommand: (command: string) => {
          sent.push(command);

          return Promise.resolve();
        },
      },
    },
    K8sApi: {},
  },
}));

/**
 * React и mobx расширение берёт с глобала: сборка подменяет эти импорты шимами
 * (см. vite.config.mjs), и в тестах глобалы приходится расставить самим — иначе
 * `src/run.tsx` не импортируется вовсе. `createRequire` здесь потому, что для
 * обычного импорта шим сработал бы и на сам тест.
 *
 * `MobxReact` — заглушка: `observer` в цепочке `run.tsx` не участвует, а сам
 * пакет тянет за собой react-dom, которого в devDependencies нет.
 */
const load = createRequire(import.meta.url);
const mobx = load("mobx") as typeof import("mobx");
const host = {
  React: load("react"),
  ReactJsxRuntime: load("react/jsx-runtime"),
  Mobx: mobx,
  MobxReact: { observer: <T,>(component: T) => component },
};

// 1.x держит их прямо на глобале, 2.x — внутри FreelensExtensionApi; тест общий
// для обеих веток, поэтому кладём в оба места
Object.assign(globalThis, host, { FreelensExtensionApi: { ...host } });

const { observable } = mobx;

const { buildButtonCommand } = await import("./command");
const { DEFAULT_CONFIG, normalizeButton } = await import("./config");
const { parseScope } = await import("./scopes");
const { runButton } = await import("./run");

const TARGET = {
  context: "acme-eu-prod-1",
  namespace: "web",
  pod: "deploy-worker-abc",
  container: "app",
  name: "app",
  kind: "Pod",
};

/** Кнопка с запросом строки: дефолт приезжает в поле, ответ — в конец команды. */
function openDialog(over: Record<string, unknown> = {}) {
  const button = normalizeButton(
    {
      id: "logs",
      name: "Logs",
      type: "local",
      cmd: "kubectl logs {{pod}} {{input}}",
      input: { label: "Filter", default: "| grep -i -E 'error|warn'" },
      ...over,
    },
    0,
  );
  const built = buildButtonCommand(DEFAULT_CONFIG, button, parseScope("containers")!, TARGET, "/kubeconfig");

  runButton(DEFAULT_CONFIG, button, built);

  // то же, что делает Freelens: параметры уезжают в observable.box, и оттуда их
  // берёт сам диалог — уже глубоко преобразованными
  const box = observable.box<DialogParams | undefined>();

  box.set(opened[opened.length - 1]);

  return box.get()!;
}

beforeEach(() => {
  opened.length = 0;
  sent.length = 0;
  errors.length = 0;
});

check("запускается ответ из поля, а не дефолт", () => {
  const dialog = openDialog();
  const submit = dialog.message.props.submit as (value: string) => string;

  // трубы, кавычки и дефисы внутри ответа — обычный текст, он уезжает как есть
  const filter = '| grep --color=always --line-buffered -v "levelno.*20"';
  const preview = submit(filter);

  dialog.ok();

  assert.strictEqual(preview, `kubectl logs deploy-worker-abc ${filter}`);
  assert.deepStrictEqual(sent, [`kubectl logs deploy-worker-abc ${filter}`]);
});

check("поле не трогали — запускается дефолт", () => {
  const dialog = openDialog();

  dialog.ok();

  assert.deepStrictEqual(sent, ["kubectl logs deploy-worker-abc | grep -i -E 'error|warn'"]);
});

check("пустой ответ при required: true не запускается", () => {
  const dialog = openDialog({ input: { label: "Filter", default: "-f", required: true } });
  const submit = dialog.message.props.submit as (value: string) => string;

  submit("   ");
  dialog.ok();

  assert.deepStrictEqual(sent, []);
  assert.strictEqual(errors.length, 1);
});

check("в диалог уходят только строки, флаги и функции", () => {
  const dialog = openDialog();

  for (const [key, value] of Object.entries(dialog.message.props)) {
    assert.ok(
      ["string", "boolean", "function"].includes(typeof value),
      `проп ${key} — простой объект: mobx отдаст компоненту его копию`,
    );
  }
});
