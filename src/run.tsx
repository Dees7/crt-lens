import { useEffect, useRef, useState } from "react";
import { Renderer } from "@freelensapp/extensions";

import { BuiltCommand, withInput } from "./command";
import { ButtonSpec, CrtLensConfig } from "./config";
import { chooseTerminal, isProblem, openInTerminal } from "./launch/terminals";
import { OWNER_CHAIN, ownedByAny, pickContainer, pickPod } from "./logs";
import styles from "./styles.module.css";
import { renderTemplate } from "./template";

type KubeObject = Renderer.K8sApi.KubeObject;
type Pod = Renderer.K8sApi.Pod;

/**
 * К стору терминала и диалогам ходим лениво, уже по клику: это ленивые
 * глобалы Freelens, тянуть их на этапе загрузки расширения рано.
 */
function components() {
  return Renderer.Component;
}

/** Апи и сторы кубера — такие же ленивые глобалы, как и компоненты. */
function k8s() {
  return Renderer.K8sApi;
}

/** Внешний терминал: задание на диск (если пресет его хочет) и запуск argv. */
function runInExternalTerminal(config: CrtLensConfig, built: BuiltCommand): void {
  const chosen = chooseTerminal(config, built.terminal.value);

  if (isProblem(chosen)) {
    throw new Error(chosen.problem);
  }

  const job = openInTerminal(chosen, built.title, built.command);

  console.info(`[crt-lens] ${built.title} → ${chosen.name}: ${built.command} (${job || "argv"})`);
}

/** Терминал в доке — тот же, что открывает штатная кнопка Shell. */
function runInLensTerminal(built: BuiltCommand): void {
  const { createTerminalTab, terminalStore, Notifications } = components();
  const tab = createTerminalTab({ title: built.title });

  console.info(`[crt-lens] ${built.title}: ${built.command} (dock ${tab.id})`);

  terminalStore.sendCommand(built.command, { enter: true, tabId: tab.id }).catch((error) => {
    console.warn("[crt-lens] could not send the command to the terminal:", error);
    Notifications.error(`crt-lens: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/**
 * Uid'ы промежуточных владельцев: ReplicaSet'ы деплоя, Job'ы кронджобы.
 *
 * Спрашиваем кластер напрямую, а не стор: стор знает только те kind'ы и
 * неймспейсы, на которые кто-то подписался, а кнопку жмут из списка, где
 * подписки на ReplicaSet может не быть вовсе.
 */
async function childOwnerIds(object: KubeObject, namespace: string): Promise<string[]> {
  const chain = OWNER_CHAIN[object.kind];

  if (!chain) return [];

  const api = chain === "ReplicaSet" ? k8s().replicaSetApi : k8s().jobApi;
  const items = (await api.list({ namespace })) ?? [];
  const ownerIds = new Set([object.getId()]);

  return items.filter((item) => ownedByAny(item, ownerIds)).map((item) => item.getId());
}

/**
 * Поды объекта: сам под, либо всё, чем владеет воркоад.
 *
 * Сначала стор — он уже загружен, когда кнопку жмут со списка подов, и тогда
 * запроса в кластер не будет вовсе. Пусто — идём в апи: на странице воркоадов
 * поды обычно не подписаны, и штатный `createWorkloadTab` в этом месте как раз
 * молча возвращает undefined.
 */
async function podsOf(object: KubeObject): Promise<Pod[]> {
  if (object.kind === "Pod") return [object as Pod];

  const fromStore = k8s().podsStore.getPodsByOwnerId(object.getId());

  if (fromStore.length > 0) return fromStore;

  const namespace = object.getNs() ?? "";
  const ownerIds = new Set([object.getId(), ...(await childOwnerIds(object, namespace))]);
  const pods = (await k8s().podsApi.list({ namespace })) ?? [];

  return pods.filter((pod) => ownedByAny(pod, ownerIds));
}

/**
 * Логи в доке — тот же таб, что открывает штатная кнопка Logs у пода.
 *
 * Контейнер берётся из цели: у scope `containers` это выбранный контейнер, у
 * воркоада — основной контейнер найденного пода. Соседние поды и контейнеры
 * потом переключаются селекторами самого таба.
 */
function openLogsTab(object: KubeObject, built: BuiltCommand): void {
  const { logTabStore, Notifications } = components();
  const what = `${built.vars.kind}/${built.vars.name}`;

  podsOf(object)
    .then((pods) => {
      const pod = pickPod(pods);

      if (!pod) {
        Notifications.info(`crt-lens: ${what} has no pods — nothing to open the logs on`);

        return;
      }

      const container = pickContainer(pod, built.vars.container || undefined);

      if (!container) {
        Notifications.error(`crt-lens: pod ${pod.getName()} has no containers`);

        return;
      }

      const tab = logTabStore.createPodTab({ selectedPod: pod, selectedContainer: container });

      console.info(`[crt-lens] logs ${what}: ${pod.getName()}/${container.name} (dock ${tab})`);
    })
    .catch((error) => {
      console.warn("[crt-lens] could not open the logs:", error);
      Notifications.error(
        `crt-lens: could not find the pods of ${what} — ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

/** Ссылка — во внешний браузер, а не во встроенное окно приложения. */
function openUrl(built: BuiltCommand): void {
  console.info(`[crt-lens] ${built.title}: ${built.url}`);
  window.open(built.url, "_blank");
}

/** Что именно покажет диалог подтверждения: команду, ссылку или цель логов. */
function confirmText(button: ButtonSpec, built: BuiltCommand): string {
  if (button.type === "url") return built.url;
  if (button.type === "logs") return `logs ${built.vars.kind}/${built.vars.name}`;

  return built.command;
}

/**
 * Ссылка на кнопку «Запустить» самого диалога.
 *
 * `ConfirmDialog.open` не отдаёт ничего, чем диалог можно было бы закрыть
 * снаружи, поэтому Enter в поле ввода жмёт его кнопку — разметка диалога у
 * Freelens своя и стабильная (`.ConfirmDialog .confirm-buttons .ok`). Не нашли
 * — ничего не делаем: запустить всегда можно мышкой.
 */
function okButtonOf(node: HTMLElement | null): HTMLElement | null {
  return node?.closest(".ConfirmDialog")?.querySelector<HTMLElement>(".confirm-buttons .ok") ?? null;
}

/**
 * Тело диалога с запросом строки: подпись, поле и превью того, что запустится.
 *
 * Превью пересобирается на каждое нажатие клавиши — так видно, куда именно
 * подставился ответ. Пересборкой занимается `submit` снаружи: там же живёт
 * значение, которое потом запустит `ok` у диалога — обычный колбэк, к состоянию
 * компонента ему не дотянуться.
 *
 * Пропсы здесь — только строки, флаги и функции, и это важно: Freelens кладёт
 * параметры диалога в `observable.box` с глубоким преобразованием, и любой
 * простой объект в пропсах приезжает сюда **копией**. Объект, общий с колбэком
 * `ok`, так не передать: компонент правил бы копию, а запускался бы дефолт.
 */
function InputDialogBody(props: {
  name: string;
  label: string;
  required: boolean;
  initial: string;
  initialPreview: string;
  /** Принять новое значение и вернуть превью того, что запустится */
  submit: (value: string) => string;
}) {
  const { name, label, required, initial, initialPreview, submit } = props;
  const { Input } = components();
  const [value, setValue] = useState(initial);
  const [preview, setPreview] = useState(initialPreview);
  const box = useRef<HTMLDivElement | null>(null);

  // ConfirmDialog puts autoFocus on its own Run button, and it takes the focus
  // after us — so we come back to the field on the next tick.
  useEffect(() => {
    const timer = setTimeout(() => box.current?.querySelector("input")?.focus(), 0);

    return () => clearTimeout(timer);
  }, []);

  const change = (next: string) => {
    setValue(next);
    setPreview(submit(next));
  };

  const empty = required && value.trim() === "";

  return (
    <div className={styles.dialog} ref={box}>
      <p>
        Run <b>{name}</b>?
      </p>
      <p className={styles.hint}>{label}</p>
      <Input value={value} onChange={change} onSubmit={() => okButtonOf(box.current)?.click()} />
      <p className={styles.preview}>{preview}</p>
      {empty && <p className={styles.error}>a non-empty answer is required</p>}
    </div>
  );
}

/**
 * Запускает кнопку и рассказывает об ошибке, если запустить не вышло.
 * `confirm: true` — сначала диалог с готовой командой, `input` — диалог с полем.
 *
 * `object` нужен только кнопке `logs`: она открывает таб по самому объекту, а не
 * по собранной строке. Без него такая кнопка ругается в консоль и ничего не
 * делает — вызывать её из места, где объекта нет, незачем.
 */
export function runButton(
  config: CrtLensConfig,
  button: ButtonSpec,
  built: BuiltCommand,
  object?: KubeObject,
): void {
  const start = (run: BuiltCommand) => {
    try {
      if (button.type === "logs") {
        if (!object) {
          console.warn(`[crt-lens] button ${button.id}: logs need an object to open on`);

          return;
        }

        openLogsTab(object, run);
      } else if (button.type === "url") {
        openUrl(run);
      } else if (button.type === "local") {
        runInLensTerminal(run);
      } else {
        runInExternalTerminal(config, run);
      }
    } catch (error) {
      console.warn("[crt-lens] could not run the button:", error);
      components().Notifications.error(
        `crt-lens: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  // запрос строки — сам по себе диалог: отдельное подтверждение к нему не нужно
  if (button.input) {
    const spec = button.input;
    const initial = renderTemplate(spec.default, built.vars);
    const state = { value: initial, built: withInput(config, button, built, initial) };
    // единственный мостик между полем и `ok`: функция доезжает до компонента как
    // есть и правит тот самый `state`, который потом запустится
    const submit = (value: string): string => {
      state.value = value;
      state.built = withInput(config, button, built, value);

      return confirmText(button, state.built);
    };

    components().ConfirmDialog.open({
      labelOk: "Run",
      message: (
        <InputDialogBody
          name={button.name}
          label={spec.label || "Input"}
          required={spec.required}
          initial={initial}
          initialPreview={confirmText(button, state.built)}
          submit={submit}
        />
      ),
      ok: () => {
        if (spec.required && state.value.trim() === "") {
          components().Notifications.error(
            `crt-lens: ${button.name} — a non-empty answer is required`,
          );

          return;
        }

        start(state.built);
      },
    });

    return;
  }

  if (!button.confirm) {
    start(built);

    return;
  }

  components().ConfirmDialog.open({
    labelOk: "Run",
    message: (
      <div>
        <p>
          Run <b>{button.name}</b>?
        </p>
        <p style={{ fontFamily: "var(--font-monospace)", wordBreak: "break-all" }}>
          {confirmText(button, built)}
        </p>
      </div>
    ),
    ok: () => start(built),
  });
}
