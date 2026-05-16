# vnc_server.py — Годжи TightVNC Launcher
# Запуск: python vnc_server.py

import subprocess
import sys
import json
import os
import traceback
import tempfile
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

# ==============================
# НАСТРОЙКИ
# ==============================
PC_LIST = {
    "01": "192.168.1.201",
    "02": "192.168.1.202",
    "03": "192.168.1.203",
    "04": "192.168.1.204",
    "05": "192.168.1.205",
    "06": "192.168.1.206",
    "07": "192.168.1.207",
    "08": "192.168.1.208",
    "09": "192.168.1.209",
    "10": "192.168.1.210",
    "11": "192.168.1.211",
    "12": "192.168.1.212",
    "13": "192.168.1.213",
    "14": "192.168.1.214",
    "15": "192.168.1.215",
    "16": "192.168.1.216",
    "17": "192.168.1.217",
    "18": "192.168.1.218",
    "19": "192.168.1.219",
    "20": "192.168.1.220",
    "21": "192.168.1.221",
    "22": "192.168.1.222",
    "23": "192.168.1.223",
    "24": "192.168.1.224",
    "25": "192.168.1.225",
    "26": "192.168.1.226",
    "27": "192.168.1.227",
    "28": "192.168.1.228",
    "29": "192.168.1.229",
    "30": "192.168.1.230",
    "31": "192.168.1.231",
    "32": "192.168.1.232",
    "33": "192.168.1.233",
    "34": "192.168.1.234",
    "35": "192.168.1.235",
    "36": "192.168.1.236",
    "37": "192.168.1.237",
    "38": "192.168.1.238",
    "39": "192.168.1.239",
    "40": "192.168.1.240",
    "41": "192.168.1.241",
}

TVNVIEWER_PATH = r"C:\Program Files\TightVNC\tvnviewer.exe"
VNC_PORT       = 5900
HTTP_PORT      = 5800  # TightVNC Server встроенный веб-клиент (view-only)
VNC_PASSWORD   = ""       # пустой — без пароля
SERVER_PORT    = 6080
# ==============================


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors()
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        params = {}
        if '?' in self.path:
            for p in self.path.split('?')[1].split('&'):
                if '=' in p:
                    k, v = p.split('=', 1)
                    params[k] = v

        # Список всех ПК
        if path == '/status':
            result = {}
            for name, ip in PC_LIST.items():
                result[name] = {'ip': ip, 'name': 'ПК ' + name}
            self._json(result)

        # Подключиться к ПК
        elif path == '/connect':
            pc = params.get('pc')
            if not pc or pc not in PC_LIST:
                self._json({'error': 'ПК не найден: ' + str(pc)}, 404)
                return

            ip = PC_LIST[pc]

            if not os.path.exists(TVNVIEWER_PATH):
                self._json({'error': 'TightVNC Viewer не найден: ' + TVNVIEWER_PATH}, 500)
                return

            view_only = params.get('view') == '1'
            try:
                # Для view-only создаём временный .vnc файл с ViewOnly=1
                # TightVNC 2.x Windows не поддерживает -viewonly через CLI,
                # но принимает конфиг-файл с настройками
                if view_only:
                    cfg = (
                        f'host={ip}\n'
                        f'port={VNC_PORT}\n'
                        'ViewOnly=1\n'
                        'FullScreen=0\n'
                    )
                    if VNC_PASSWORD:
                        cfg += f'Password={VNC_PASSWORD}\n'
                    tmp = tempfile.NamedTemporaryFile(
                        mode='w', suffix='.vnc', delete=False, encoding='utf-8'
                    )
                    tmp.write(cfg); tmp.close()
                    cmd = [TVNVIEWER_PATH, tmp.name]
                    subprocess.Popen(cmd, shell=False)
                    # Удаляем файл через 5 сек после запуска
                    threading.Timer(5.0, lambda: os.unlink(tmp.name) if os.path.exists(tmp.name) else None).start()
                    print(f'[TightVNC] ПК {pc} ({ip}) — просмотр (ViewOnly)')
                    self._json({'success': True, 'pc': pc, 'ip': ip, 'view_only': True})
                else:
                    cmd = [TVNVIEWER_PATH, ip + ':' + str(VNC_PORT)]
                    if VNC_PASSWORD:
                        cmd += ['-password', VNC_PASSWORD]
                    subprocess.Popen(cmd, shell=False)
                    print(f'[TightVNC] ПК {pc} ({ip}) — управление')
                    self._json({'success': True, 'pc': pc, 'ip': ip, 'view_only': False})

            except Exception as e:
                print(f'[Ошибка] {e}')
                self._json({'error': str(e)}, 500)

        else:
            self._json({'error': 'Неизвестный путь'}, 404)

    def _json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_cors()
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    try:
        print('=== Годжи — TightVNC Launcher ===')
        print(f'TightVNC: {TVNVIEWER_PATH}')
        print(f'ПК: {list(PC_LIST.keys())}')
        print(f'Сервер: http://localhost:{SERVER_PORT}')

        if not os.path.exists(TVNVIEWER_PATH):
            print(f'\n⚠ TightVNC Viewer не найден!')
            print(f'Путь: {TVNVIEWER_PATH}')
            input('\nНажмите Enter для закрытия...')
            sys.exit(1)

        print('\nСервер запущен. Ctrl+C для остановки\n')
        HTTPServer(('localhost', SERVER_PORT), Handler).serve_forever()

    except KeyboardInterrupt:
        print('\nОстановлен.')
    except Exception:
        traceback.print_exc()
        input('\nНажмите Enter для закрытия...')
