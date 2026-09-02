#!/usr/bin/env python3
"""
Mini-O mDNS / Zeroconf Service Advertiser
Broadcasts `_mini-o._tcp.local` on the local network so mobile companions can auto-connect.
"""

import socket
import sys
import time

try:
    from zeroconf import IPVersion, ServiceInfo, Zeroconf
except ImportError:
    print("Zeroconf module not found. Install via: pip install zeroconf")
    sys.exit(1)

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

def advertise_service(port=3000, name="Mini-O Host"):
    local_ip = get_local_ip()
    hostname = socket.gethostname()
    service_name = f"{name} ({hostname})._mini-o._tcp.local."

    info = ServiceInfo(
        "_mini-o._tcp.local.",
        service_name,
        addresses=[socket.inet_aton(local_ip)],
        port=port,
        properties={'version': '1.0.0', 'host': hostname},
        server=f"{hostname}.local.",
    )

    zeroconf = Zeroconf(ip_version=IPVersion.V4)
    print(f"[mDNS] Advertising Mini-O service '{service_name}' on http://{local_ip}:{port}")
    zeroconf.register_service(info)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[mDNS] Stopping advertisement...")
        zeroconf.unregister_service(info)
        zeroconf.close()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    advertise_service(port=port)
