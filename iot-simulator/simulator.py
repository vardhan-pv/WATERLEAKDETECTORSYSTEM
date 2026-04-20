#!/usr/bin/env python3
"""
Smart Water Leak Detection - IoT Device Simulator
Simulates multiple pipeline sensor nodes publishing MQTT data to AWS IoT Core
"""

import json
import time
import random
import math
import ssl
import argparse
import logging
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Optional
import paho.mqtt.client as mqtt

# ─── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("WaterLeakSimulator")

# ─── AWS IoT Config ─────────────────────────────────────────────────────────
AWS_IOT_ENDPOINT = "a16525rk34u76s-ats.iot.us-east-1.amazonaws.com"
AWS_IOT_PORT     = 8883
MQTT_TOPIC_BASE  = "water/pipeline"

CERT_PATH = "./certs/device-certificate.pem.crt"
KEY_PATH  = "./certs/private.pem.key"
CA_PATH   = "./certs/AmazonRootCA1.pem"

# ─── Pipeline Node Definitions ───────────────────────────────────────────────
PIPELINE_NODES = [
  {"id":"N01", "name":"Central - Majestic Jnc",        "lat":12.9766, "lng":77.5713, "zone":"Central"},
  {"id":"N02", "name":"Central - Vidhana Soudha",      "lat":12.9796, "lng":77.5906, "zone":"Central"},
  {"id":"N03", "name":"Central - MG Road Pump",        "lat":12.9738, "lng":77.6080, "zone":"Central"},
  {"id":"N04", "name":"East - Indiranagar Dist",       "lat":12.9784, "lng":77.6408, "zone":"East"},
  {"id":"N05", "name":"East - Whitefield Resvr",       "lat":12.9698, "lng":77.7499, "zone":"East"},
  {"id":"N06", "name":"East - KR Puram Main",          "lat":13.0083, "lng":77.6953, "zone":"East"},
  {"id":"N07", "name":"East - Marathahalli Links",     "lat":12.9569, "lng":77.7011, "zone":"East"},
  {"id":"N08", "name":"SouthEast - Bellandur",         "lat":12.9304, "lng":77.6784, "zone":"SouthEast"},
  {"id":"N09", "name":"SouthEast - HSR Layout",        "lat":12.9121, "lng":77.6446, "zone":"SouthEast"},
  {"id":"N10", "name":"SouthEast - Koramangala",       "lat":12.9279, "lng":77.6271, "zone":"SouthEast"},
  {"id":"N11", "name":"South - BTM Layout",            "lat":12.9165, "lng":77.6101, "zone":"South"},
  {"id":"N12", "name":"South - Electronic City",       "lat":12.8452, "lng":77.6601, "zone":"South"},
  {"id":"N13", "name":"South - Bommanahalli",          "lat":12.9038, "lng":77.6221, "zone":"South"},
  {"id":"N14", "name":"South - Jayanagar",             "lat":12.9298, "lng":77.5801, "zone":"South"},
  {"id":"N15", "name":"South - JP Nagar Sub",          "lat":12.9063, "lng":77.5856, "zone":"South"},
  {"id":"N16", "name":"South - Banashankari",          "lat":12.9254, "lng":77.5467, "zone":"South"},
  {"id":"N17", "name":"South - Basavanagudi",          "lat":12.9406, "lng":77.5737, "zone":"South"},
  {"id":"N18", "name":"West - RR Nagar Dist",          "lat":12.9274, "lng":77.5155, "zone":"West"},
  {"id":"N19", "name":"West - Kengeri Grid",           "lat":12.9022, "lng":77.4851, "zone":"West"},
  {"id":"N20", "name":"West - Vijayanagar",            "lat":12.9719, "lng":77.5350, "zone":"West"},
  {"id":"N21", "name":"West - Rajajinagar",            "lat":12.9981, "lng":77.5504, "zone":"West"},
  {"id":"N22", "name":"NorthWest - Malleshwaram",      "lat":13.0031, "lng":77.5643, "zone":"NorthWest"},
  {"id":"N23", "name":"NorthWest - Yeshwanthpur",      "lat":13.0285, "lng":77.5401, "zone":"NorthWest"},
  {"id":"N24", "name":"NorthWest - Peenya Hub",        "lat":13.0329, "lng":77.5140, "zone":"NorthWest"},
  {"id":"N25", "name":"North - Hebbal Trunk",          "lat":13.0354, "lng":77.5988, "zone":"North"},
  {"id":"N26", "name":"North - Yelahanka",             "lat":13.1006, "lng":77.5963, "zone":"North"},
  {"id":"N27", "name":"NorthWest - Jalahalli",         "lat":13.0464, "lng":77.5483, "zone":"NorthWest"},
  {"id":"N28", "name":"NorthWest - Mathikere",         "lat":13.0334, "lng":77.5640, "zone":"NorthWest"},
  {"id":"N29", "name":"North - RT Nagar",              "lat":13.0232, "lng":77.5973, "zone":"North"},
  {"id":"N30", "name":"NorthEast - Hennur",            "lat":13.0258, "lng":77.6330, "zone":"NorthEast"},
  {"id":"N31", "name":"NorthEast - Banaswadi",         "lat":13.0141, "lng":77.6518, "zone":"NorthEast"},
  {"id":"N32", "name":"East - CV Raman Ngr",           "lat":12.9863, "lng":77.6631, "zone":"East"}
]

# ─── Thresholds ──────────────────────────────────────────────────────────────
PRESSURE_NORMAL_MIN  = 2.5   # bar
PRESSURE_NORMAL_MAX  = 4.5   # bar
PRESSURE_LEAK_DROP   = 1.2   # bar — sudden drop indicating leak
FLOW_NORMAL_MIN      = 10.0  # L/min
FLOW_NORMAL_MAX      = 50.0  # L/min
FLOW_SURGE_THRESHOLD = 65.0  # L/min — abnormal surge = leak


@dataclass
class SensorPayload:
    device_id:    str
    device_name:  str
    zone:         str
    timestamp:    str
    latitude:     float
    longitude:    float
    flow_rate:    float       # L/min
    pressure:     float       # bar
    temperature:  float       # °C (pipe temp)
    vibration:    float       # Hz (pipe vibration)
    humidity:     float       # % (surrounding)
    leak_status:  bool
    leak_severity: str        # NONE | LOW | MEDIUM | HIGH | CRITICAL
    anomaly_type: str         # NONE | PRESSURE_DROP | FLOW_SURGE | COMBINED
    battery_level: float      # %
    signal_strength: int      # dBm
    sequence_num: int


class PipelineNodeSimulator:
    """Simulates a single IoT sensor node on the water pipeline."""

    def __init__(self, node_config: dict):
        self.id           = node_config["id"]
        self.name         = node_config["name"]
        self.lat          = node_config["lat"]
        self.lng          = node_config["lng"]
        self.zone         = node_config["zone"]
        self.seq          = 0
        self.battery      = random.uniform(80, 100)
        self.base_pressure = random.uniform(PRESSURE_NORMAL_MIN + 0.3, PRESSURE_NORMAL_MAX - 0.3)
        self.base_flow    = random.uniform(FLOW_NORMAL_MIN + 5, FLOW_NORMAL_MAX - 10)

        # Leak scenario state
        self._scenario_active   = False
        self._scenario_type     = None
        self._scenario_ticks    = 0
        self._scenario_duration = 0
        self._scenario_cooldown = 0

    def _maybe_trigger_scenario(self):
        """Randomly trigger a leak/anomaly scenario."""
        if self._scenario_cooldown > 0:
            self._scenario_cooldown -= 1
            return

        if not self._scenario_active and random.random() < 0.008:  # 0.8% chance per tick (reduced)
            self._scenario_active   = True
            self._scenario_type     = random.choice(["PRESSURE_DROP", "FLOW_SURGE", "COMBINED"])
            self._scenario_duration = random.randint(8, 20)  # ticks
            self._scenario_ticks    = 0
            log.warning(f"[{self.id}] ⚠️  LEAK SCENARIO triggered: {self._scenario_type}")

    def _resolve_scenario(self):
        if self._scenario_active:
            self._scenario_ticks += 1
            if self._scenario_ticks >= self._scenario_duration:
                self._scenario_active   = False
                self._scenario_type     = None
                self._scenario_cooldown = random.randint(30, 60)
                log.info(f"[{self.id}] ✅  Scenario resolved. Cooldown active.")

    def _add_noise(self, value: float, pct: float = 0.03) -> float:
        """Add ±pct% gaussian noise."""
        return value + random.gauss(0, value * pct)

    def _simulate_pressure(self) -> float:
        t = time.time()
        diurnal = 0.3 * math.sin(2 * math.pi * t / 86400)  # daily cycle
        pressure = self._add_noise(self.base_pressure + diurnal)

        if self._scenario_active and self._scenario_type in ("PRESSURE_DROP", "COMBINED"):
            severity = min(self._scenario_ticks / 4, 1.0)
            pressure -= PRESSURE_LEAK_DROP * severity * random.uniform(0.8, 1.2)

        return round(max(0.1, pressure), 3)

    def _simulate_flow(self) -> float:
        t = time.time()
        diurnal = 8 * math.sin(2 * math.pi * t / 43200)  # 12h cycle
        flow = self._add_noise(self.base_flow + diurnal)

        if self._scenario_active and self._scenario_type in ("FLOW_SURGE", "COMBINED"):
            severity = min(self._scenario_ticks / 3, 1.0)
            flow += (FLOW_SURGE_THRESHOLD - self.base_flow) * severity * random.uniform(0.9, 1.3)

        return round(max(0, flow), 2)

    def _detect_leak(self, pressure: float, flow: float) -> tuple[bool, str, str]:
        pressure_drop = pressure < PRESSURE_NORMAL_MIN
        flow_surge    = flow > FLOW_SURGE_THRESHOLD

        if pressure_drop and flow_surge:
            return True, "CRITICAL", "COMBINED"
        elif pressure_drop and pressure < (PRESSURE_NORMAL_MIN - 0.8):
            return True, "HIGH", "PRESSURE_DROP"
        elif pressure_drop:
            return True, "MEDIUM", "PRESSURE_DROP"
        elif flow_surge and flow > (FLOW_SURGE_THRESHOLD + 15):
            return True, "HIGH", "FLOW_SURGE"
        elif flow_surge:
            return True, "LOW", "FLOW_SURGE"
        else:
            return False, "NONE", "NONE"

    def read(self) -> SensorPayload:
        self._maybe_trigger_scenario()

        pressure  = self._simulate_pressure()
        flow      = self._simulate_flow()
        is_leak, severity, anomaly = self._detect_leak(pressure, flow)

        # Slight GPS jitter to look real
        lat = self.lat + random.gauss(0, 0.00005)
        lng = self.lng + random.gauss(0, 0.00005)

        self.seq += 1
        self.battery = max(10, self.battery - random.uniform(0, 0.01))

        payload = SensorPayload(
            device_id       = self.id,
            device_name     = self.name,
            zone            = self.zone,
            timestamp       = datetime.now(timezone.utc).isoformat(),
            latitude        = round(lat, 6),
            longitude       = round(lng, 6),
            flow_rate       = flow,
            pressure        = pressure,
            temperature     = round(random.uniform(18, 28), 1),
            vibration       = round(random.uniform(0.5, 3.5) + (5 if is_leak else 0), 2),
            humidity        = round(random.uniform(40, 90), 1),
            leak_status     = is_leak,
            leak_severity   = severity,
            anomaly_type    = anomaly,
            battery_level   = round(self.battery, 1),
            signal_strength = random.randint(-85, -45),
            sequence_num    = self.seq,
        )

        self._resolve_scenario()
        return payload


# ─── MQTT Client ─────────────────────────────────────────────────────────────

class AWSIoTPublisher:
    def __init__(self, use_local: bool = False, local_host: str = "localhost", local_port: int = 1883):
        self.use_local   = use_local
        self.local_host  = local_host
        self.local_port  = local_port
        self.client      = mqtt.Client(client_id=f"water-leak-simulator-{int(time.time())}")
        self.connected   = False
        self._setup_callbacks()

    def _setup_callbacks(self):
        self.client.on_connect    = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_publish    = self._on_publish

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self.connected = True
            log.info("✅  MQTT connected successfully")
        else:
            log.error(f"❌  MQTT connection failed. RC={rc}")

    def _on_disconnect(self, client, userdata, rc):
        self.connected = False
        log.warning(f"⚠️  MQTT disconnected. RC={rc}")

    def _on_publish(self, client, userdata, mid):
        pass  # Silently acknowledge publishes

    def connect(self):
        if self.use_local:
            log.info(f"🔗 Connecting to LOCAL broker {self.local_host}:{self.local_port}")
            self.client.connect(self.local_host, self.local_port, keepalive=60)
        else:
            log.info(f"🔗 Connecting to AWS IoT Core: {AWS_IOT_ENDPOINT}")
            self.client.tls_set(
                ca_certs    = CA_PATH,
                certfile    = CERT_PATH,
                keyfile     = KEY_PATH,
                tls_version = ssl.PROTOCOL_TLSv1_2,
            )
            self.client.connect(AWS_IOT_ENDPOINT, AWS_IOT_PORT, keepalive=60)

        self.client.loop_start()
        time.sleep(2)

    def publish(self, topic: str, payload: dict) -> bool:
        msg   = json.dumps(payload, default=str)
        result = self.client.publish(topic, msg, qos=1)
        return result.rc == mqtt.MQTT_ERR_SUCCESS

    def disconnect(self):
        self.client.loop_stop()
        self.client.disconnect()


# ─── Main Simulation Loop ────────────────────────────────────────────────────

def run_simulation(interval: float = 3.0, use_local: bool = False,
                   local_host: str = "localhost", local_port: int = 1883):
    log.info("🚀 Starting Smart Water Leak Detection Simulator")
    log.info(f"   Nodes   : {len(PIPELINE_NODES)}")
    log.info(f"   Interval: {interval}s")
    log.info(f"   Target  : {'LOCAL broker' if use_local else 'AWS IoT Core'}")

    nodes     = [PipelineNodeSimulator(n) for n in PIPELINE_NODES]
    publisher = AWSIoTPublisher(use_local, local_host, local_port)

    try:
        publisher.connect()

        iteration = 0
        while True:
            iteration += 1
            log.info(f"\n{'═'*60}")
            log.info(f"📡 Iteration #{iteration} — {datetime.now().strftime('%H:%M:%S')}")

            for node in nodes:
                reading = node.read()
                payload = asdict(reading)

                # Topic: water/pipeline/{zone}/{device_id}
                topic = f"{MQTT_TOPIC_BASE}/{reading.zone.lower()}/{reading.device_id.lower()}"

                ok = publisher.publish(topic, payload)
                status = "✅" if ok else "❌"

                leak_info = (
                    f"🚨 LEAK! [{reading.leak_severity}] {reading.anomaly_type}"
                    if reading.leak_status
                    else "✅ Normal"
                )

                log.info(
                    f"  {status} {reading.device_id} | "
                    f"P={reading.pressure:.2f}bar | "
                    f"F={reading.flow_rate:.1f}L/min | "
                    f"{leak_info}"
                )

                # Also print sample JSON for first node on first iteration
                if iteration == 1 and node.id == "NODE-001":
                    log.info(f"\n📋 Sample JSON Payload:\n{json.dumps(payload, indent=2)}")

                time.sleep(0.2)  # stagger publishes slightly

            time.sleep(interval)

    except KeyboardInterrupt:
        log.info("\n⛔ Simulation stopped by user.")
    finally:
        publisher.disconnect()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Water Leak IoT Simulator")
    parser.add_argument("--interval",   type=float, default=3.0,        help="Publish interval in seconds")
    parser.add_argument("--local",      action="store_true",             help="Use local MQTT broker instead of AWS")
    parser.add_argument("--host",       type=str,   default="localhost", help="Local broker host")
    parser.add_argument("--port",       type=int,   default=1883,        help="Local broker port")
    args = parser.parse_args()

    run_simulation(
        interval   = args.interval,
        use_local  = args.local,
        local_host = args.host,
        local_port = args.port,
    )
