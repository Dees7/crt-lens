import React from "react";
import { Renderer } from "@freelensapp/extensions";
import * as yaml from "js-yaml";

import { buildButtonCommand } from "./command";
import {
  configPath,
  CrtLensConfig,
  defaultConfigYaml,
  loadConfig,
  readConfigYaml,
  saveConfigYaml,
} from "./config";
import { refreshConfig } from "./config-store";
import { installExamples } from "./examples";
import { chooseTerminal, isProblem } from "./launch/terminals";
import { pickButtons, Resolved, Target } from "./match";
import { activeCluster, ClusterInfo } from "./menu-common";
import { scopeRegistrations } from "./scopes";
import styles from "./styles.module.css";
import { validateConfig } from "./validate";

const {
  Component: { Button },
} = Renderer;

/** Monospace fragment in theme colours — so it does not go white on a dark theme. */
function Mono(props: { children: React.ReactNode }) {
  return <span className={styles.mono}>{props.children}</span>;
}

export function CrtLensPreferenceHint() {
  return (
    <span className={styles.hint}>
      Plugin buttons in the menus of cluster objects: every entry under <Mono>buttons</Mono> is a
      menu item with its own action. <Mono>type: local</Mono> opens a terminal in the dock,{" "}
      <Mono>type: ext</Mono> an external terminal by a preset from <Mono>terminals</Mono>,{" "}
      <Mono>type: url</Mono> a link in the browser, <Mono>type: logs</Mono> the built-in log
      viewer.
      <br />
      Where a button shows up is decided by <Mono>scopes</Mono> (<Mono>containers</Mono>,{" "}
      <Mono>pods</Mono>, <Mono>nodes</Mono>, <Mono>namespaces</Mono> or any kind), and the values
      are picked by <Mono>rules</Mono> through masks — the most specific rule wins. Environment
      identifiers for links live in <Mono>vars</Mono> and are picked by the same masks.
      <br />
      <Mono>column: true</Mono> also adds the button as a column in the object list — one column
      per kind in its <Mono>scopes</Mono> (hide it with the gear in the table header).
      <br />
      The config lives in <Mono>{configPath()}</Mono> and can be edited by hand as well. A new
      kind in <Mono>scopes</Mono> and a new column show up after a window reload (Cmd+R).
      <br />
      The <Mono>crt</Mono> preset needs a one-time manual setup of a SecureCRT session — the
      “Write out SecureCRT examples” button prepares the files and prints what to do with them.
    </span>
  );
}

/** Sample objects the preview is computed on. */
function sampleTargets(
  kind: string,
  cluster: ClusterInfo,
): { containers: Target[]; object: Target } {
  const base: Target = { context: cluster.context, kubeVersion: cluster.kubeVersion, kind };

  if (kind === "Node") {
    return {
      containers: [],
      object: { ...base, node: "example-node-0", name: "example-node-0" },
    };
  }

  if (kind === "Namespace") {
    return { containers: [], object: { ...base, namespace: "default", name: "default" } };
  }

  if (kind === "Pod") {
    const pod: Target = {
      ...base,
      namespace: "default",
      pod: "example-pod-0",
      name: "example-pod-0",
    };

    return {
      containers: [{ ...pod, container: "app", name: "app" }],
      object: pod,
    };
  }

  return {
    containers: [],
    object: { ...base, namespace: "default", name: `example-${kind.toLowerCase()}` },
  };
}

function ruleLine(label: string, resolved: Resolved<string>): string {
  return resolved.rule
    ? `    ${label}: rule #${resolved.index} ${JSON.stringify(resolved.rule)}`
    : `    ${label}: ${resolved.value ? "default" : "not set"}`;
}

/** The terminals line: what is described and what of it was found on this machine. */
function terminalsLine(config: CrtLensConfig): string {
  const auto = chooseTerminal(config, "");
  const names = Object.keys(config.terminals).join(", ");

  return isProblem(auto)
    ? `terminals: ${names || "none at all"} — autodetection: ${auto.problem}`
    : `terminals: ${names} — autodetection picked ${auto.name} (job ${auto.flavor})`;
}

function previewFor(config: CrtLensConfig, cluster: ClusterInfo): string[] {
  const head = [
    `cluster: context ${cluster.context}, version ${cluster.kubeVersion || "unknown"}`,
    terminalsLine(config),
  ];
  const lines: string[] = [];

  for (const { kind } of scopeRegistrations(config)) {
    const targets = sampleTargets(kind, cluster);

    for (const item of pickButtons(config, kind, targets)) {
      const built = buildButtonCommand(
        config,
        item.button,
        item.scope,
        item.targets[0],
        cluster.kubeconfig,
      );
      const where =
        item.button.type === "ext" ? `ext:${built.terminal.value || "auto"}` : item.button.type;

      lines.push(
        `[${item.button.id}] ${kind}/${item.scope.raw} ${where}` +
          `${item.button.confirm ? " confirm" : ""}${item.button.input ? " input" : ""}` +
          `${item.button.column ? " column" : ""}` +
          `${item.button.include_stopped ? " stopped" : ""}  «${built.title}»`,
      );

      if (built.problem) {
        lines.push(`    ! ${built.problem}`);
      }

      if (item.button.type === "url") {
        lines.push(
          `    ${built.url || "nowhere to take the link from — set url"}`,
          ruleLine("link", built.urlRule),
        );

        if (built.vars.query) {
          lines.push(`    selector: ${built.vars.query}`, ruleLine("selector", built.queryRule));
        }

        continue;
      }

      lines.push(
        `    ${built.command || "nowhere to take the command from — set cmd"}`,
        ruleLine("command", built.cmd),
        ruleLine("shell", built.shell),
      );

      if (kind === "Node") {
        lines.push(ruleLine("image", built.image));
      }
    }
  }

  if (lines.length === 0) {
    lines.push("no button matched the sample objects");
  }

  return [...head, ...lines];
}

/** What comes out for the samples — for the current cluster and the saved config. */
function preview(): string[] {
  const cluster = activeCluster();

  try {
    const config = loadConfig();
    const problems = validateConfig(yaml.load(readConfigYaml()));
    const head = problems.map((problem) => `! ${problem}`);

    if (!cluster) {
      return [...head, "no active cluster — nothing to compute the commands against"];
    }

    return [...head, ...previewFor(config, cluster)];
  } catch (error) {
    return [`could not compute the preview: ${String(error)}`];
  }
}

export function CrtLensPreferenceInput() {
  const [text, setText] = React.useState<string>(() => {
    try {
      return readConfigYaml();
    } catch {
      return defaultConfigYaml();
    }
  });
  const [status, setStatus] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [lines, setLines] = React.useState<string[]>(() => preview());

  const save = () => {
    try {
      saveConfigYaml(text);
      // the list columns live off an observable — without this they would wait for a file poll
      refreshConfig();

      const problems = validateConfig(yaml.load(text));

      setStatus({
        ok: problems.length === 0,
        message: problems.length
          ? `Saved to ${configPath()}, but there are warnings — see below`
          : `Saved to ${configPath()}`,
      });
      setLines(preview());
    } catch (error) {
      setStatus({ ok: false, message: `Not saved: ${String(error)}` });
    }
  };

  const reload = () => {
    try {
      setText(readConfigYaml());
      setStatus({ ok: true, message: "Re-read the file from disk" });
      setLines(preview());
    } catch (error) {
      setStatus({ ok: false, message: `Not read: ${String(error)}` });
    }
  };

  const reset = () => {
    setText(defaultConfigYaml());
    setStatus({ ok: true, message: "Filled in the defaults — press “Save” to write them" });
  };

  /** Write out the SecureCRT examples. SecureCRT's own settings are not touched. */
  const examples = () => {
    try {
      const files = installExamples();
      const session = files.find((file) => file.endsWith(".ini"));

      setStatus({
        ok: true,
        message:
          `Wrote the files out: ${session}. What is left is to copy the .ini into the ` +
          "SecureCRT sessions directory and enable Single Instance — the README.md next to " +
          "them says how.",
      });
    } catch (error) {
      setStatus({ ok: false, message: `Not written out: ${String(error)}` });
    }
  };

  return (
    <div className={styles.editor}>
      <textarea
        className={styles.textarea}
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className={styles.row}>
        <Button primary label="Save" onClick={save} />
        <Button plain label="Re-read" onClick={reload} />
        <Button plain label="Defaults" onClick={reset} />
        <Button plain label="Write out SecureCRT examples" onClick={examples} />
      </div>
      {status && <div className={status.ok ? styles.ok : styles.error}>{status.message}</div>}
      <div className={styles.preview}>{lines.join("\n")}</div>
    </div>
  );
}
