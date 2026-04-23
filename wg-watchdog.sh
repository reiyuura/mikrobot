# /opt/wg-watchdog.sh
#!/bin/bash
if ! ping -c 3 -W 5 10.10.10.2 > /dev/null 2>&1; then
    systemctl restart wg-quick@wg0
    sleep 5
    ping -c 3 10.10.10.2 > /dev/null 2>&1
fi
