/**
 * Пресеты внешних терминалов.
 *
 * Пресет — это данные, а не код: расширение умеет только развернуть argv,
 * подставить в него задание и запустить процесс. SecureCRT здесь ничем не
 * выделен — такая же запись, как kitty или Windows Terminal. Всё, что делает
 * её особенной, живёт снаружи: сессия-обёртка и скрипт вкладки из
 * examples/securecrt, которые человек раскладывает руками один раз.
 *
 * Таблица встроенная, в примере конфига её нет: секция `terminals` в файле
 * настроек добавляется к этой и перекрывает записи по имени, так что любой
 * пресет можно поправить или заменить своим, не трогая расширение.
 *
 * Для чтения глазами эта же таблица выписана в `terminals.sample.yaml` рядом с
 * расширением — оттуда пресет копируют к себе в конфиг. Файл ни на что не
 * влияет, но обязан совпадать с кодом: за этим следит тест в terminals.test.ts,
 * так что правку здесь надо повторить и там.
 */

/** Как доставляется команда: файлом задания для sh, для cmd.exe или прямо в argv. */
export type JobFlavor = "posix" | "cmd" | "none";

export interface TerminalPlatform {
  /** Аргументы запуска; подстановки {{job}}, {{title}}, {{command}}, {{command_quoted}} */
  argv: string[];
  /** Чем поднять окно после запуска — там, где терминал не делает этого сам */
  activate?: string[];
  /** Перекрывает `job` пресета: Git Bash на Windows хочет posix-задание */
  job?: JobFlavor;
}

export interface TerminalSpec {
  job?: JobFlavor;
  darwin?: TerminalPlatform;
  win32?: TerminalPlatform;
  linux?: TerminalPlatform;
}

export type Terminals = Record<string, TerminalSpec>;

/** Платформы, под которые пресет может быть описан. */
export const PLATFORMS = ["darwin", "win32", "linux"] as const;

export type Platform = (typeof PLATFORMS)[number];

const SECURECRT_ACTIVATE = [
  "/usr/bin/osascript",
  "-e",
  'tell application id "com.vandyke.securecrt" to activate',
];

export const DEFAULT_TERMINALS: Terminals = {
  /**
   * SecureCRT. Команда доезжает не аргументами, а через файл задания: вкладка
   * находит его по своему заголовку (`/N {{title}}`), поэтому задание пишется
   * всегда, хотя в argv его и нет. Про ручную установку — examples/securecrt.
   */
  crt: {
    job: "posix",
    darwin: {
      argv: [
        "/Applications/SecureCRT.app/Contents/MacOS/SecureCRT",
        "/T",
        "/N",
        "{{title}}",
        "/S",
        "crt-lens",
      ],
      activate: SECURECRT_ACTIVATE,
    },
    win32: {
      argv: [
        "C:\\Program Files\\VanDyke Software\\SecureCRT\\SecureCRT.exe",
        "/T",
        "/N",
        "{{title}}",
        "/S",
        "crt-lens",
      ],
      job: "cmd",
    },
    linux: {
      argv: ["/usr/bin/SecureCRT", "/T", "/N", "{{title}}", "/S", "crt-lens"],
    },
  },

  /** Штатный Terminal.app: другого способа открыть вкладку, кроме AppleScript, нет. */
  terminal: {
    job: "posix",
    darwin: {
      argv: [
        "/usr/bin/osascript",
        "-e",
        'tell application "Terminal" to do script "{{job}}"',
        "-e",
        'tell application "Terminal" to activate',
      ],
    },
  },

  iterm: {
    job: "posix",
    darwin: {
      argv: [
        "/usr/bin/osascript",
        "-e",
        'tell application "iTerm" to create window with default profile command "{{job}}"',
        "-e",
        'tell application "iTerm" to activate',
      ],
    },
  },

  kitty: {
    job: "posix",
    darwin: {
      argv: ["/Applications/kitty.app/Contents/MacOS/kitty", "--title", "{{title}}", "/bin/bash", "{{job}}"],
    },
    linux: {
      argv: ["kitty", "--title", "{{title}}", "/bin/bash", "{{job}}"],
    },
  },

  wezterm: {
    job: "posix",
    darwin: {
      argv: ["/Applications/WezTerm.app/Contents/MacOS/wezterm", "start", "--", "/bin/bash", "{{job}}"],
    },
    linux: {
      argv: ["wezterm", "start", "--", "/bin/bash", "{{job}}"],
    },
  },

  ghostty: {
    job: "posix",
    darwin: {
      argv: ["/Applications/Ghostty.app/Contents/MacOS/ghostty", "-e", "/bin/bash", "{{job}}"],
    },
    linux: {
      argv: ["ghostty", "-e", "/bin/bash", "{{job}}"],
    },
  },

  alacritty: {
    job: "posix",
    darwin: {
      argv: [
        "/Applications/Alacritty.app/Contents/MacOS/alacritty",
        "--title",
        "{{title}}",
        "-e",
        "/bin/bash",
        "{{job}}",
      ],
    },
    linux: {
      argv: ["alacritty", "--title", "{{title}}", "-e", "/bin/bash", "{{job}}"],
    },
  },

  /** Windows Terminal: `-w 0` подселяет вкладку в уже открытое окно. */
  wt: {
    job: "cmd",
    win32: {
      argv: ["wt.exe", "-w", "0", "nt", "--title", "{{title}}", "cmd.exe", "/k", "{{job}}"],
    },
  },

  cmd: {
    job: "cmd",
    win32: {
      argv: ["cmd.exe", "/c", "start", "{{title}}", "cmd.exe", "/k", "{{job}}"],
    },
  },

  powershell: {
    job: "cmd",
    win32: {
      argv: ["powershell.exe", "-NoExit", "-Command", "& '{{job}}'"],
    },
  },

  /** Git Bash — единственный на Windows, кому нужно posix-задание. */
  gitbash: {
    win32: {
      argv: ["C:\\Program Files\\Git\\git-bash.exe", "{{job}}"],
      job: "posix",
    },
  },
};

/** Порядок автоопределения: чем раньше, тем предпочтительнее. */
export const AUTODETECT_ORDER = [
  "crt",
  "wt",
  "iterm",
  "kitty",
  "wezterm",
  "ghostty",
  "alacritty",
  "terminal",
  "gitbash",
  "cmd",
];
