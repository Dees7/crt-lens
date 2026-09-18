/**
 * Выбор цели для кнопки `type: logs`: чей под открыть и какой контейнер.
 *
 * Поды здесь — заглушки с теми же методами, что зовёт код: настоящие объекты
 * кубера тянут за собой приложение, а проверять надо именно порядок выбора.
 */
import * as assert from "assert";
import { test as check } from "vitest";

import {
  DEFAULT_CONTAINER_ANNOTATION,
  LOG_KINDS,
  logsKindSupported,
  ownedByAny,
  OWNER_CHAIN,
  pickContainer,
  pickPod,
} from "./logs";

type FakePod = Parameters<typeof pickPod>[0][number];

function pod(
  name: string,
  options: {
    status?: string;
    containers?: string[];
    defaultContainer?: string;
    created?: string;
  } = {},
): FakePod {
  const containers = (options.containers ?? ["app"]).map((container) => ({ name: container }));
  const annotations = options.defaultContainer
    ? { [DEFAULT_CONTAINER_ANNOTATION]: options.defaultContainer }
    : undefined;

  return {
    metadata: { annotations, creationTimestamp: options.created },
    getName: () => name,
    getStatus: () => options.status ?? "Running",
    getAllContainers: () => containers,
  } as unknown as FakePod;
}

function owned(uid: string, ownerUids: string[]) {
  return {
    getId: () => uid,
    getOwnerRefs: () => ownerUids.map((owner) => ({ uid: owner })),
  } as unknown as Parameters<typeof ownedByAny>[0];
}

check("под выбирается бегущий, а не первый по алфавиту", () => {
  const pods = [pod("web-aaa", { status: "Terminating" }), pod("web-zzz")];

  assert.equal(pickPod(pods)?.getName(), "web-zzz");
});

check("живых нет — берётся первый по имени, логи упавшего пода тоже нужны", () => {
  const pods = [pod("web-b", { status: "Failed" }), pod("web-a", { status: "Failed" })];

  assert.equal(pickPod(pods)?.getName(), "web-a");
});

check("пустой список подов — открывать нечего", () => {
  assert.equal(pickPod([]), undefined);
});

check("на выкате берётся под новой ревизии, а не старой", () => {
  const pods = [
    pod("web-old", { created: "2026-09-17T10:00:00Z" }),
    pod("web-new", { created: "2026-09-18T10:00:00Z" }),
  ];

  assert.equal(pickPod(pods)?.getName(), "web-new");
});

check("свежий, но уже не бегущий под уступает живому старому", () => {
  const pods = [
    pod("web-old", { created: "2026-09-17T10:00:00Z" }),
    pod("web-new", { created: "2026-09-18T10:00:00Z", status: "Pending" }),
  ];

  assert.equal(pickPod(pods)?.getName(), "web-old");
});

check("живых нет — открывается самый свежий", () => {
  const pods = [
    pod("web-old", { created: "2026-09-17T10:00:00Z", status: "Failed" }),
    pod("web-new", { created: "2026-09-18T10:00:00Z", status: "Failed" }),
  ];

  assert.equal(pickPod(pods)?.getName(), "web-new");
});

check("контейнер из цели важнее аннотации: подменю контейнеров целится точно", () => {
  const target = pod("web-1", { containers: ["app", "envoy"], defaultContainer: "app" });

  assert.equal(pickContainer(target, "envoy")?.name, "envoy");
});

check("контейнера из цели у пода нет — падаем на основной, а не на пустоту", () => {
  const target = pod("web-1", { containers: ["app", "envoy"], defaultContainer: "envoy" });

  assert.equal(pickContainer(target, "sidecar")?.name, "envoy");
});

check("без аннотации берётся первый контейнер", () => {
  const target = pod("web-1", { containers: ["app", "envoy"] });

  assert.equal(pickContainer(target)?.name, "app");
});

check("у пода без контейнеров цели нет", () => {
  assert.equal(pickContainer(pod("web-1", { containers: [] })), undefined);
});

check("владелец ищется по uid, а не по имени", () => {
  const ids = new Set(["rs-1"]);

  assert.ok(ownedByAny(owned("pod-1", ["rs-1"]), ids));
  assert.ok(!ownedByAny(owned("pod-2", ["rs-2"]), ids));
  assert.ok(!ownedByAny(owned("pod-3", []), ids));
});

check("промежуточное звено знают только Deployment и CronJob", () => {
  assert.equal(OWNER_CHAIN.Deployment, "ReplicaSet");
  assert.equal(OWNER_CHAIN.CronJob, "Job");
  assert.equal(OWNER_CHAIN.DaemonSet, undefined);
  assert.equal(OWNER_CHAIN.StatefulSet, undefined);
});

check("kind без подов кнопкой логов не открывается", () => {
  assert.ok(logsKindSupported("DaemonSet"));
  assert.ok(logsKindSupported("Pod"));
  assert.ok(!logsKindSupported("Node"));
  assert.ok(!logsKindSupported("ConfigMap"));
  // все kind'ы из списка должны проходить проверку — иначе сообщение валидатора врёт
  LOG_KINDS.forEach((kind) => assert.ok(logsKindSupported(kind), kind));
});
