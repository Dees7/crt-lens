# $language = "Python3"
# $interface = "1.0"
"""crt-lens: выполняет задание во вкладке, в которой подключился локальный шелл.

Какое задание — узнаём из имени вкладки: расширение запускает сессию как
`/N <заголовок>`, а рядом кладёт <рабочий каталог>/jobs/<заголовок>.sh (или .cmd
на Windows). В имени файла всё, кроме букв, цифр, точки, минуса и подчёркивания,
заменено на подчёркивание — те же правила, что в src/launch/job.ts.

Рабочий каталог ищется так же, как его ищет расширение: сначала
~/.freelens/crt-lens, потом ~/.k8slens/crt-lens.

Скрипт ничего не спрашивает и не показывает диалогов: он выполняется при каждом
подключении вкладки, в том числе при реконнекте, и модальное окно в этот момент
мешало бы работать.

Шапку (# $language / # $interface) SecureCRT разбирает строго: любой другой
комментарий в этих двух строках даёт «Invalid character encountered in script
header».
"""
import json
import os
import re
import time

HOMES = ["~/.freelens/crt-lens", "~/.k8slens/crt-lens"]
WINDOWS = os.name == "nt"


def work_dir():
    paths = [os.path.expanduser(home) for home in HOMES]

    for path in paths:
        if os.path.isdir(path):
            return path

    return paths[0]


def job_path(caption):
    name = re.sub(r"[^A-Za-z0-9._-]", "_", str(caption).strip())
    jobs = os.path.join(work_dir(), "jobs")
    # расширение пишет задание под свой шелл; ищем оба на случай общего каталога
    order = [".cmd", ".sh"] if WINDOWS else [".sh", ".cmd"]

    for suffix in order:
        candidate = os.path.join(jobs, name + suffix)

        if os.path.exists(candidate):
            return candidate

    return os.path.join(jobs, name + order[0])


def debug(**fields):
    # положите рядом с каталогом jobs пустой файл debug — и скрипт будет писать,
    # что за вкладку он увидел и какое задание искал
    flag = os.path.join(work_dir(), "debug")

    if not os.path.exists(flag):
        return

    fields["at"] = time.strftime("%H:%M:%S")

    try:
        with open(os.path.join(work_dir(), "debug.json"), "w") as handle:
            json.dump(fields, handle, ensure_ascii=False, indent=1)
    except Exception:
        pass


def status(tab, text):
    try:
        tab.Session.SetStatusText("crt-lens: " + text)
    except Exception:
        pass


def main():
    tab = crt.GetScriptTab()  # noqa: F821 — crt приходит из SecureCRT
    caption = str(tab.Caption)
    job = job_path(caption)

    debug(caption=caption, job=job, exists=os.path.exists(job))

    if not os.path.exists(job):
        status(tab, "задание не найдено (%s)" % job)
        return

    if WINDOWS:
        # call + exit повторяет поведение exec: выход из kubectl закрывает вкладку,
        # а не возвращает в cmd.exe, из которого уже некуда деться
        tab.Screen.Send('call "%s" & exit\r\n' % job)
    else:
        tab.Screen.Send("exec %s\n" % job)


try:
    main()
except Exception as error:
    debug(error=str(error))
    raise
