// ═══════════════════════════════════════════════════════════════════════════════
// AQUAWATCH PRO — Bengaluru Smart Water Grid Intelligence Platform
// Premium Real-Time Dashboard + Satellite Map + Leak Notification System
// ═══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate, useNavigate } from "react-router-dom";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, Popup, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// ─── Auth Context ────────────────────────────────────────────────────────────
const AuthContext = React.createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("aqua_user");
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error("Auth init error:", e);
      return null;
    }
  });
  const logout = () => { localStorage.removeItem("aqua_user"); setUser(null); };
  const login = (userData) => { localStorage.setItem("aqua_user", JSON.stringify(userData)); setUser(userData); };
  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => React.useContext(AuthContext);

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

// ─── Kaveri Infrastructure Data (KML Sampled) ───────────────────────────────
const KAVERI_INFRA = [
  [[12.942,77.506],[12.947,77.502],[12.950,77.500],[12.951,77.500],[12.955,77.502],[12.958,77.503],[12.960,77.505],[12.960,77.507]],
  [[12.961,77.509],[12.962,77.510],[12.963,77.511],[12.965,77.509],[12.966,77.509],[12.968,77.510],[12.971,77.511],[12.971,77.512]],
  [[12.972,77.514],[12.973,77.515],[12.974,77.514],[12.975,77.515],[12.976,77.515],[12.977,77.516],[12.978,77.516],[12.979,77.516]],
  [[12.936,77.518],[12.936,77.518],[12.936,77.518],[12.936,77.517],[12.936,77.516],[12.936,77.515],[12.936,77.515]],
  [[12.936,77.514],[12.935,77.513],[12.935,77.513],[12.936,77.512],[12.937,77.512],[12.937,77.511],[12.937,77.511]],
  [[12.979,77.516],[12.980,77.517],[12.982,77.517],[12.983,77.518],[12.984,77.518],[12.985,77.519],[12.986,77.519]],
  [[12.987,77.519],[12.987,77.519],[12.991,77.520],[12.997,77.523],[12.994,77.513],[12.998,77.511]],
  [[12.997,77.511],[12.997,77.509],[12.997,77.508],[12.998,77.507],[12.998,77.505],[12.999,77.504],[13.000,77.504]],
  [[13.020,77.516],[13.021,77.516],[13.021,77.516],[13.022,77.516],[13.022,77.516],[13.023,77.517],[13.024,77.519]],
  [[13.040,77.518],[13.040,77.518],[13.040,77.518],[13.040,77.518],[13.041,77.519],[13.041,77.519],[13.041,77.519]],
  [[12.915,77.513],[12.916,77.513],[12.919,77.513],[12.920,77.513],[12.921,77.514],[12.922,77.514],[12.922,77.514]],
  [[13.008,77.505],[13.008,77.505],[13.009,77.506],[13.009,77.506],[13.010,77.506],[13.011,77.506],[13.011,77.507]],
  [[13.082,77.540],[13.082,77.540],[13.081,77.540],[13.080,77.539],[13.079,77.538],[13.079,77.538],[13.078,77.538]]
];

const KAVERI_NODES = [
  {id:"KAV-01", name:"Kaveri Gateway Alpha", lat:12.947, lng:77.502, zone:"Kaveri Division", office:"BWSSB Kaveri Central"},
  {id:"KAV-02", name:"Kaveri Link Station", lat:12.966, lng:77.509, zone:"Kaveri Division", office:"BWSSB Kaveri Central"},
  {id:"KAV-03", name:"Kaveri Bypass Hub",     lat:12.976, lng:77.515, zone:"Kaveri Division", office:"BWSSB Kaveri Central"},
  {id:"KAV-04", name:"Kaveri Main Flow",      lat:12.936, lng:77.516, zone:"Kaveri Division", office:"BWSSB Kaveri South"},
  {id:"KAV-05", name:"Kaveri Pressure Link",  lat:12.985, lng:77.519, zone:"Kaveri Division", office:"BWSSB Kaveri North"},
  {id:"KAV-06", name:"Kaveri Grid Intake",    lat:12.998, lng:77.507, zone:"Kaveri Division", office:"BWSSB Kaveri West"},
  {id:"KAV-07", name:"Kaveri Station A1",     lat:13.041, lng:77.519, zone:"Kaveri Division", office:"BWSSB Kaveri North"},
  {id:"KAV-08", name:"Kaveri Section Z",      lat:12.922, lng:77.514, zone:"Kaveri Division", office:"BWSSB Kaveri West"},
  {id:"KAV-09", name:"Kaveri Gateway Beta",   lat:13.009, lng:77.506, zone:"Kaveri Division", office:"BWSSB Kaveri North"},
  {id:"KAV-10", name:"Kaveri Exit Control",   lat:13.079, lng:77.538, zone:"Kaveri Division", office:"BWSSB Kaveri North"}
];

// ─── Config ──────────────────────────────────────────────────────────────────
const WS_URL  = import.meta.env.VITE_WS_URL  || "ws://localhost:4000/ws";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// ─── Bengaluru Water Grid — 32 Real-World Zones ─────────────────────────────
const PIPELINE_NODES = [
  {id:"N01", name:"Majestic Junction",        lat:12.9766, lng:77.5713, zone:"Central",   office:"BWSSB Central Office, KG Road"},
  {id:"N02", name:"Vidhana Soudha",           lat:12.9796, lng:77.5906, zone:"Central",   office:"BWSSB Central Office, KG Road"},
  {id:"N03", name:"MG Road Pump Station",     lat:12.9738, lng:77.6080, zone:"Central",   office:"BWSSB East Division, MG Road"},
  {id:"N04", name:"Indiranagar Distribution",  lat:12.9784, lng:77.6408, zone:"East",      office:"BWSSB East Division, Indiranagar"},
  {id:"N05", name:"Whitefield Reservoir",      lat:12.9698, lng:77.7499, zone:"East",      office:"BWSSB East Division, Whitefield"},
  {id:"N06", name:"KR Puram Main Line",        lat:13.0083, lng:77.6953, zone:"East",      office:"BWSSB East Division, KR Puram"},
  {id:"N07", name:"Marathahalli Link",         lat:12.9569, lng:77.7011, zone:"East",      office:"BWSSB East Division, Marathahalli"},
  {id:"N08", name:"Bellandur Junction",        lat:12.9304, lng:77.6784, zone:"SouthEast", office:"BWSSB SE Division, Bellandur"},
  {id:"N09", name:"HSR Layout Grid",           lat:12.9121, lng:77.6446, zone:"SouthEast", office:"BWSSB SE Division, HSR Layout"},
  {id:"N10", name:"Koramangala Hub",           lat:12.9279, lng:77.6271, zone:"SouthEast", office:"BWSSB SE Division, Koramangala"},
  {id:"N11", name:"BTM Layout Station",        lat:12.9165, lng:77.6101, zone:"South",     office:"BWSSB South Division, BTM"},
  {id:"N12", name:"Electronic City",           lat:12.8452, lng:77.6601, zone:"South",     office:"BWSSB South Division, E-City"},
  {id:"N13", name:"Bommanahalli",              lat:12.9038, lng:77.6221, zone:"South",     office:"BWSSB South Division, Bommanahalli"},
  {id:"N14", name:"Jayanagar",                lat:12.9298, lng:77.5801, zone:"South",     office:"BWSSB South Division, Jayanagar"},
  {id:"N15", name:"JP Nagar Substation",       lat:12.9063, lng:77.5856, zone:"South",     office:"BWSSB South Division, JP Nagar"},
  {id:"N16", name:"Banashankari",              lat:12.9254, lng:77.5467, zone:"South",     office:"BWSSB South Division, BSK"},
  {id:"N17", name:"Basavanagudi",              lat:12.9406, lng:77.5737, zone:"South",     office:"BWSSB South Division, Basavanagudi"},
  {id:"N18", name:"RR Nagar Distribution",     lat:12.9274, lng:77.5155, zone:"West",      office:"BWSSB West Division, RR Nagar"},
  {id:"N19", name:"Kengeri Grid",              lat:12.9022, lng:77.4851, zone:"West",      office:"BWSSB West Division, Kengeri"},
  {id:"N20", name:"Vijayanagar",               lat:12.9719, lng:77.5350, zone:"West",      office:"BWSSB West Division, Vijayanagar"},
  {id:"N21", name:"Rajajinagar",               lat:12.9981, lng:77.5504, zone:"West",      office:"BWSSB West Division, Rajajinagar"},
  {id:"N22", name:"Malleshwaram",              lat:13.0031, lng:77.5643, zone:"NorthWest", office:"BWSSB NW Division, Malleshwaram"},
  {id:"N23", name:"Yeshwanthpur",              lat:13.0285, lng:77.5401, zone:"NorthWest", office:"BWSSB NW Division, Yeshwanthpur"},
  {id:"N24", name:"Peenya Industrial Hub",     lat:13.0329, lng:77.5140, zone:"NorthWest", office:"BWSSB NW Division, Peenya"},
  {id:"N25", name:"Hebbal Trunk Line",         lat:13.0354, lng:77.5988, zone:"North",     office:"BWSSB North Division, Hebbal"},
  {id:"N26", name:"Yelahanka",                lat:13.1006, lng:77.5963, zone:"North",     office:"BWSSB North Division, Yelahanka"},
  {id:"N27", name:"Jalahalli",                lat:13.0464, lng:77.5483, zone:"NorthWest", office:"BWSSB NW Division, Jalahalli"},
  {id:"N28", name:"Mathikere",                lat:13.0334, lng:77.5640, zone:"NorthWest", office:"BWSSB NW Division, Mathikere"},
  {id:"N29", name:"RT Nagar",                 lat:13.0232, lng:77.5973, zone:"North",     office:"BWSSB North Division, RT Nagar"},
  {id:"N30", name:"Hennur",                   lat:13.0258, lng:77.6330, zone:"NorthEast", office:"BWSSB NE Division, Hennur"},
  {id:"N31", name:"Banaswadi",                lat:13.0141, lng:77.6518, zone:"NorthEast", office:"BWSSB NE Division, Banaswadi"},
  {id:"N32", name:"CV Raman Nagar",           lat:12.9863, lng:77.6631, zone:"East",      office:"BWSSB East Division, CV Raman Nagar"},
  ...KAVERI_NODES
];

// Pipeline Connections (edges)
const PIPE_EDGES = [
  [0,1],[1,2],[2,16],[16,0],
  [2,3],[3,31],[31,5],[5,4],[4,6],[6,7],[7,8],
  [8,9],[9,10],[10,12],[12,11],[10,13],[13,16],[13,14],
  [16,15],[15,18],[15,14],[16,14],
  [0,19],[19,17],[17,18],[19,20],[20,21],[21,0],
  [21,23],[23,26],[26,22],[22,27],[27,21],[22,24],
  [24,28],[28,25],[24,1],[28,30],[30,29],[29,5],[30,31],
  [1,21],[2,9],[3,6],[7,4],[12,8],[10,11],[17,15],[19,2],[28,1]
];

// Zone colors for visual mapping
const ZONE_COLORS = {
  Central:"#00c8ff", East:"#a29bfe", SouthEast:"#00cec9", South:"#55efc4",
  West:"#fdcb6e", NorthWest:"#fd79a8", North:"#74b9ff", NorthEast:"#dfe6e9",
  "Kaveri Division":"#00d2ff"
};

const SEV_COLOR = {
  CRITICAL:"#ff4757", HIGH:"#ff6b7a", MEDIUM:"#ffa502", LOW:"#ffc266", NONE:"#00ff9d"
};

// ─── Valve status simulation ─────────────────────────────────────────────────
function getValveStatus(reading) {
  if (!reading) return { status: "OFFLINE", color: "#6b82a8" };
  if (reading.leak_status && reading.leak_severity === "CRITICAL") return { status: "SHUT OFF", color: "#ff4757" };
  if (reading.leak_status) return { status: "THROTTLED", color: "#ffa502" };
  return { status: "OPEN", color: "#00ff9d" };
}

function getWaterQuality(reading) {
  if (!reading) return { label: "Unknown", score: 0, color: "#6b82a8" };
  const p = reading.pressure || 0;
  const f = reading.flow_rate || 0;
  let score = 100;
  if (p < 2.5) score -= 30;
  if (p < 2.0) score -= 20;
  if (f > 65) score -= 25;
  if (f > 80) score -= 15;
  if (reading.leak_status) score -= 20;
  score = Math.max(0, Math.min(100, score));
  const color = score > 80 ? "#00ff9d" : score > 55 ? "#ffa502" : "#ff4757";
  const label = score > 80 ? "Excellent" : score > 55 ? "Fair" : "Poor";
  return { label, score, color };
}

// ─── Notification System ─────────────────────────────────────────────────────
const REGIONAL_STAFF = {
  Central: ["Rajesh Kumar — Senior Technician", "Arun Reddy — Pipeline Inspector"],
  East: ["Priya Sharma — Field Engineer", "Deepa Nair — Water Quality Analyst"],
  SouthEast: ["Meena Rao — Maintenance Lead", "Karthik M — Zone Supervisor"],
  South: ["Lakshmi Devi — Repair Coordinator", "Suresh Gowda — Emergency Response"],
  West: ["Vikram Singh — Senior Plumber", "Anjali Rao — Ops Tech"],
  NorthWest: ["Sanjay Patil — Lead Inspector", "Rina D — Field Tech"],
  North: ["Nitin Das — Grid Supervisor", "Zoya Khan — Maintenance"],
  NorthEast: ["Paul V — Repair Lead", "Simran B — Response Team"]
};

// ─── Design System & Icons ───────────────────────────────────────────────────
const ICONS = {
  PRESSURE: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      <circle cx="12" cy="12" r="4"/>
    </svg>
  ),
  FLOW: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
      <path d="M2 6c.6.5 1.2 1 2.5 1s2.5-1 4-1 2.5 1 4 1 2.5-1 4-1 2.5 1 4 1"/><path d="M2 12c.6.5 1.2 1 2.5 1s2.5-1 4-1 2.5 1 4 1 2.5-1 4-1 2.5 1 4 1"/><path d="M2 18c.6.5 1.2 1 2.5 1s2.5-1 4-1 2.5 1 4 1 2.5-1 4-1 2.5 1 4 1"/>
    </svg>
  ),
  TEMP: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
      <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>
    </svg>
  ),
  BATTERY: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{width:16,height:16}}>
      <rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2"/>
    </svg>
  ),
  DASHBOARD: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:18,height:18}}>
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  MAP: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:18,height:18}}>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
    </svg>
  ),
  ALERTS: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:18,height:18}}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  )
};

// ─── Sparkline Engine ────────────────────────────────────────────────────────
function Sparkline({ data, color, width = 80, height = 30 }) {
  if (!data || data.length < 2) return <div style={{width, height}} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} style={{overflow:"visible"}}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={points} style={{transition:"all 0.3s ease"}} />
      <circle cx={width} cy={height - ((data[data.length-1] - min) / range) * height} r="2" fill={color}/>
    </svg>
  );
}

function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const sentRef = useRef(new Set());

  const sendLeakNotification = useCallback((nodeId, severity, nodeName, office, lat, lng, anomalyType, eventId, initialRegion, initialStaff, initialStatus) => {
    setNotifications(prev => {
      const existingIdx = prev.findIndex(n => n.eventId === eventId);
      
      if (existingIdx !== -1) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          severity,
          anomalyType: anomalyType || updated[existingIdx].anomalyType,
          status: initialStatus || `ESCALATED TO ${severity}`,
          assignedTo: initialStaff || updated[existingIdx].assignedTo,
          assignedRegion: initialRegion || updated[existingIdx].assignedRegion,
          acknowledged: initialStatus === "RESOLVED" || updated[existingIdx].acknowledged
        };
        return updated;
      }

      const notification = {
        id: Date.now() + Math.random(),
        eventId: eventId,
        time: new Date().toLocaleTimeString(),
        timestamp: new Date().toISOString(),
        nodeId, severity, nodeName, office, lat, lng,
        anomalyType: anomalyType || "UNSPECIFIED ANOMALY",
        message: `LEAK ALERT: ${anomalyType} at ${nodeName}. GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        status: initialStatus || "UNASSIGNED",
        assignedTo: initialStaff || null,
        assignedRegion: initialRegion || null,
        acknowledged: initialStatus === "RESOLVED"
      };
      return [notification, ...prev].slice(0, 100);
    });
  }, []);

  const assignRegion = useCallback(async (id, region) => {
    const n = notifications.find(x => x.id === id);
    if (n?.eventId) {
      fetch(`${API_URL}/api/leaks/${encodeURIComponent(n.eventId)}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedRegion: region })
      }).catch(console.error);
    }
    setNotifications(p => p.map(n => n.id === id ? {...n, assignedRegion: region, status: `COORDINATING WITH ${region.toUpperCase()} OFFICE`} : n));
  }, [notifications]);

  const assignPerson = useCallback(async (id, person) => {
    const n = notifications.find(x => x.id === id);
    if (n?.eventId) {
      fetch(`${API_URL}/api/leaks/${encodeURIComponent(n.eventId)}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo: person })
      }).catch(console.error);
    }
    setNotifications(p => p.map(n => n.id === id ? {...n, assignedTo: person, status: `DISPATCHED → ${(person || "Technician").split("—")[0].trim()}`} : n));
  }, [notifications]);

  const acknowledgeNotification = useCallback(async (id) => {
    const n = notifications.find(x => x.id === id);
    if (!n) return;

    try {
      // Sync with backend
      if (n.eventId) {
        await fetch(`${API_URL}/api/leaks/${encodeURIComponent(n.eventId)}/resolve`, { method: "PATCH" });
      }

      setNotifications(p => p.map(x => {
        if (x.id === id) {
          return {
            ...x, 
            acknowledged: true, 
            status: "RESOLVED", 
            resolvedAt: new Date().toLocaleTimeString(),
            resolvedBy: x.assignedTo || "Central System"
          };
        }
        return x;
      }));
    } catch (e) {
      console.error("Resolution sync failed:", e);
      // Fallback: still update UI
      setNotifications(p => p.map(x => x.id === id ? { ...x, acknowledged: true, status: "RESOLVED" } : x));
    }
  }, [notifications]);

  const exportToWord = useCallback(() => {
    const date = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const unack = notifications.filter(n => !n.acknowledged);
    const resolved = notifications.filter(n => n.acknowledged);
    
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>AquaWatch Pro Daily Report</title>
      <style>
        body { font-family: 'Calibri', sans-serif; }
        h1 { color: #0070c0; border-bottom: 2px solid #0070c0; padding-bottom: 10px; }
        .summary-box { background: #f2f2f2; padding: 15px; border-radius: 5px; margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th { background: #0070c0; color: white; padding: 10px; border: 1px solid #ddd; }
        td { padding: 10px; border: 1px solid #ddd; font-size: 11pt; }
        .critical { color: #c00000; font-weight: bold; }
        .resolved { color: #00b050; font-weight: bold; }
      </style>
      </head>
      <body>
        <h1>💧 AquaWatch Pro — Daily Grid Activity Report</h1>
        <p><strong>Generated On:</strong> ${date}</p>
        <p><strong>Report Segment:</strong> BENGALURU SMART WATER GRID OPERATIONAL SUMMARY</p>
        
        <div class="summary-box">
          <h3>📊 Executive Summary</h3>
          <p>Total Incidents Reported: <b>${notifications.length}</b></p>
          <p>Successful Resolutions: <b style="color:#00b050">${resolved.length}</b></p>
          <p>Active Repairs Pending: <b style="color:#c00000">${unack.length}</b></p>
        </div>

        <h3>🚨 Incident Log Details</h3>
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Node / Location</th>
              <th>Severity</th>
              <th>Anomaly Type</th>
              <th>Status / Assigned To</th>
              <th>Resolution Detail</th>
            </tr>
          </thead>
          <tbody>
            ${notifications.map(n => `
              <tr>
                <td>${n.time}</td>
                <td>${n.nodeName} (${n.nodeId})</td>
                <td class="${n.severity === 'CRITICAL' ? 'critical' : ''}">${n.severity}</td>
                <td>${n.anomalyType.replace(/_/g, " ")}</td>
                <td>${n.assignedTo || 'Unassigned'}</td>
                <td class="${n.acknowledged ? 'resolved' : ''}">
                  ${n.acknowledged ? `RESOLVED BY ${n.resolvedBy} at ${n.resolvedAt}` : 'AWAITING REPAIR'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        
        <p style="font-size: 9pt; color: #888; margin-top: 50px;">
          <i>This report is an automated output from the AquaWatch Pro Intelligence Platform. 
          Confidential - Internal BWSSB Use Only.</i>
        </p>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `AquaWatch_Daily_Report_${new Date().toISOString().split('T')[0]}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [notifications]);

  return { notifications, sendLeakNotification, assignRegion, assignPerson, acknowledgeNotification, exportToWord };
}

// ─── WebSocket Hook ──────────────────────────────────────────────────────────
function useWaterSystem(sendLeakNotification) {
  const [connected, setConnected] = useState(false);
  const [sensors, setSensors]       = useState({}); // Map: device_id -> reading
  const [history, setHistory]       = useState({}); // Map: device_id -> { pressure: [], flow: [] }
  const [leaks, setLeaks]           = useState([]);
  const ws = useRef(null);

  useEffect(() => {
    const connect = () => {
      ws.current = new WebSocket(WS_URL);
      ws.current.onopen = () => setConnected(true);
      ws.current.onclose = () => { setConnected(false); setTimeout(connect, 3000); };
      ws.current.onmessage = (e) => {
        const { type, data } = JSON.parse(e.data);
        if (type === "INIT") {
          const m = {};
          (data.readings || []).forEach(r => { m[r.device_id] = r; });
          setSensors(m);
          
          const historicalLeaks = data.leaks || [];
          setLeaks(historicalLeaks);

          // Populate alerts center with historical leaks
          historicalLeaks.forEach(l => {
            const node = PIPELINE_NODES.find(n => n.id === l.device_id);
            if (node) {
              sendLeakNotification(node.id, l.leak_severity, node.name, node.office, l.latitude, l.longitude, l.anomaly_type, l.event_id, l.assignedRegion, l.assignedTo, l.resolved ? "RESOLVED" : null);
            }
          });
        } else if (type === "SENSOR_UPDATE") {
          setSensors(p => ({ ...p, [data.device_id]: data }));
          setHistory(p => {
            const h = p[data.device_id] || { pressure: [], flow: [] };
            return {
              ...p,
              [data.device_id]: {
                pressure: [...h.pressure, data.pressure || 0].slice(-20),
                flow: [...h.flow, data.flow_rate || 0].slice(-20)
              }
            };
          });
        } else if (type === "LEAK_ALERT") {
          // Handle deduplicated leak alert from backend
          const node = PIPELINE_NODES.find(n => n.id === data.device_id);
          if (node) {
            sendLeakNotification(node.id, data.leak_severity, node.name, node.office, data.latitude, data.longitude, data.anomaly_type, data.event_id);
          }
        }
      };
    };
    connect();
    return () => ws.current?.close();
  }, [sendLeakNotification]);

  return { connected, sensors: Object.values(sensors), history, leaks };
}

// ─── Animated CSS (injected once) ────────────────────────────────────────────
const INJECTED = { done: false };
function injectCSS() {
  if (INJECTED.done) return;
  INJECTED.done = true;
  const style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #060b14; overflow: hidden; }
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(0,200,255,0.15); border-radius: 6px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(0,200,255,0.3); }
    @keyframes pulse-glow { 0%,100%{box-shadow:0 0 5px rgba(0,200,255,0.3)} 50%{box-shadow:0 0 20px rgba(0,200,255,0.6)} }
    @keyframes slide-in { from{transform:translateX(100px);opacity:0} to{transform:translateX(0);opacity:1} }
    @keyframes fade-in { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.4} }
    @keyframes shimmer { 0%{background-position:-200px 0} 100%{background-position:200px 0} }
    .leaflet-container { background: #060b14 !important; }
    .leaflet-control-zoom { border: 1px solid rgba(0,200,255,0.2) !important; }
    .leaflet-control-zoom a { background: rgba(15,23,41,0.9) !important; color: #00c8ff !important; border-color: rgba(0,200,255,0.15) !important; }
  `;
  document.head.appendChild(style);
}

// ─── Shared Components ───────────────────────────────────────────────────────
function GlassCard({ children, style, glow, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: "linear-gradient(135deg, rgba(15,23,41,0.9), rgba(10,16,28,0.95))",
      border: "1px solid rgba(100,180,255,0.1)",
      borderRadius: 14,
      backdropFilter: "blur(12px)",
      boxShadow: glow ? "0 0 30px rgba(0,200,255,0.08), inset 0 1px 0 rgba(255,255,255,0.03)" : "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)",
      transition: "all 0.3s ease",
      ...style
    }}>
      {children}
    </div>
  );
}

// ─── Authentication Components ───────────────────────────────────────────────

function LandingPage() {
  return (
    <div style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:40, textAlign:"center", background:"radial-gradient(circle at center, #1a243a 0%, #060b14 100%)", height:"100vh"}}>
      <div style={{fontSize:64, fontWeight:900, color:"#fff", letterSpacing:"-0.02em", marginBottom:16}}>AQUA<span style={{color:"#00c8ff"}}>WATCH</span> PRO</div>
      <div style={{fontSize:18, color:"#6b82a8", maxWidth:600, lineHeight:1.6, marginBottom:40}}>
        Bengaluru's Intelligent Water Management Grid. Real-time leak detection, 
        satellite-tracked infrastructure, and autonomous incident response.
      </div>
      <div style={{display:"flex", gap:20}}>
        <Link to="/login" style={{padding:"14px 32px", background:"#00c8ff", color:"#000", borderRadius:12, fontWeight:700, textDecoration:"none", boxShadow:"0 8px 24px rgba(0,200,255,0.4)"}}>OPERATOR LOGIN</Link>
        <Link to="/register" style={{padding:"14px 32px", background:"rgba(255,255,255,0.05)", color:"#fff", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, fontWeight:700, textDecoration:"none", backdropFilter:"blur(10px)"}}>REQUEST ACCESS</Link>
      </div>
      <div style={{marginTop:80, display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:40, maxWidth:900}}>
        <div><div style={{fontSize:24, color:"#fff", marginBottom:8}}>🛰️</div><div style={{fontSize:12, color:"#6b82a8"}}>Satellite Monitoring</div></div>
        <div><div style={{fontSize:24, color:"#fff", marginBottom:8}}>🧠</div><div style={{fontSize:12, color:"#6b82a8"}}>AI Edge Detection</div></div>
        <div><div style={{fontSize:24, color:"#fff", marginBottom:8}}>💧</div><div style={{fontSize:12, color:"#6b82a8"}}>Zero Waste Initiative</div></div>
      </div>
    </div>
  );
}

function LoginPage() {
  const [form, setForm] = useState({ username: "", password: "" });
  const [err, setErr] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (data.success) { login(data.user); navigate("/dashboard"); }
      else setErr(data.message);
    } catch { setErr("Connection error"); }
  };

  return (
    <div style={{flex:1, display:"flex", alignItems:"center", justifyContent:"center", background:"#060b14", height:"100vh"}}>
      <GlassCard style={{padding:40, width:360, textAlign:"center"}}>
        <h2 style={{color:"#fff", marginBottom:8}}>Operator Login</h2>
        <p style={{fontSize:12, color:"#6b82a8", marginBottom:24}}>Authorized Grid Personnel Only</p>
        {err && <div style={{padding:10, background:"rgba(255,71,87,0.1)", color:"#ff4757", fontSize:12, borderRadius:8, marginBottom:16}}>{err}</div>}
        <form onSubmit={handleLogin} style={{display:"flex", flexDirection:"column", gap:16}}>
          <input type="text" placeholder="Username" style={{padding:12, borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#fff"}} value={form.username} onChange={e=>setForm({...form, username:e.target.value})} />
          <input type="password" placeholder="Password" style={{padding:12, borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#fff"}} value={form.password} onChange={e=>setForm({...form, password:e.target.value})} />
          <button style={{padding:12, background:"#00c8ff", color:"#000", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", marginTop:8}}>SIGN IN</button>
        </form>
        <p style={{marginTop:20, fontSize:12, color:"#6b82a8"}}>No account? <Link to="/register" style={{color:"#00c8ff"}}>Registration</Link></p>
      </GlassCard>
    </div>
  );
}

function RegisterPage() {
  const [form, setForm] = useState({ username: "", password: "", name: "", authorityCode: "" });
  const [err, setErr] = useState("");
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (data.success) navigate("/login");
      else setErr(data.message);
    } catch { setErr("Connection error"); }
  };

  return (
    <div style={{flex:1, display:"flex", alignItems:"center", justifyContent:"center", background:"#060b14", height:"100vh"}}>
      <GlassCard style={{padding:40, width:400, textAlign:"center"}}>
        <h2 style={{color:"#fff", marginBottom:8}}>Grid Registration</h2>
        <p style={{fontSize:12, color:"#6b82a8", marginBottom:24}}>Security Validation Required</p>
        {err && <div style={{padding:10, background:"rgba(255,71,87,0.1)", color:"#ff4757", fontSize:12, borderRadius:8, marginBottom:16}}>{err}</div>}
        <form onSubmit={handleRegister} style={{display:"flex", flexDirection:"column", gap:16}}>
          <input type="text" placeholder="Full Name" style={{padding:12, borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#fff"}} value={form.name} onChange={e=>setForm({...form, name:e.target.value})} />
          <input type="text" placeholder="Username" style={{padding:12, borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#fff"}} value={form.username} onChange={e=>setForm({...form, username:e.target.value})} />
          <input type="password" placeholder="Password" style={{padding:12, borderRadius:8, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#fff"}} value={form.password} onChange={e=>setForm({...form, password:e.target.value})} />
          <div style={{marginTop:8, textAlign:"left"}}>
            <label style={{fontSize:10, color:"#ff4757", fontWeight:700, marginLeft:4}}>AUTHORITY ACCESS CODE</label>
            <input type="text" placeholder="Enter Validation Code" style={{padding:12, borderRadius:8, background:"rgba(255,71,87,0.05)", border:"1px solid rgba(255,71,87,0.2)", color:"#fff", width:"100%", boxSizing:"border-box", marginTop:4}} value={form.authorityCode} onChange={e=>setForm({...form, authorityCode:e.target.value})} />
          </div>
          <button style={{padding:12, background:"#00c8ff", color:"#000", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer", marginTop:8}}>CREATE ACCOUNT</button>
        </form>
        <p style={{marginTop:20, fontSize:12, color:"#6b82a8"}}>Already registered? <Link to="/login" style={{color:"#00c8ff"}}>Login</Link></p>
      </GlassCard>
    </div>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────
function Layout({ connected, notifications, children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [time, setTime] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(i); }, []);
  injectCSS();

  const isAuthPage = ["/login", "/register", "/home", "/"].includes(location.pathname) && !user;
  if (isAuthPage) return children;

  const navItems = [
    { path: "/dashboard", label: "Dashboard", icon: ICONS.DASHBOARD },
    { path: "/map", label: "Live Map", icon: ICONS.MAP },
    { path: "/alerts", label: "Alerts", icon: ICONS.ALERTS, badge: notifications.filter(n => !n.acknowledged).length },
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:"#060b14",color:"#e8f0ff",fontFamily:"'Inter',sans-serif"}}>
      <header style={{
        background:"linear-gradient(180deg, rgba(10,16,28,0.98), rgba(10,16,28,0.92))",
        borderBottom:"1px solid rgba(0,200,255,0.08)", padding:"0 24px", height:56, flexShrink:0,
        display:"flex",alignItems:"center",justifyContent:"space-between",
        backdropFilter:"blur(12px)", zIndex:100,
      }}>
        <div style={{display:"flex",alignItems:"center",gap:24, flex:1, minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10, flexShrink:0}}>
            <div style={{
              width:32, height:32, borderRadius:8,
              background:"linear-gradient(135deg, #00c8ff, #0099ff)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:16, boxShadow:"0 0 15px rgba(0,200,255,0.3)"
            }}>💧</div>
            <div style={{whiteSpace:"nowrap"}}>
              <div style={{fontSize:14,fontWeight:700,letterSpacing:"0.08em",color:"#fff",lineHeight:1}}>AQUAWATCH<span style={{color:"#00c8ff"}}> PRO</span></div>
              <div style={{fontSize:9,color:"#6b82a8",letterSpacing:"0.1em",fontWeight:500,marginTop:2}}>BENGALURU WATER GRID</div>
            </div>
          </div>
          <nav style={{display:"flex",gap:4, minWidth:0}}>
            {navItems.map(item => {
              const active = location.pathname === item.path;
              return (
                <Link key={item.path} to={item.path} style={{
                  color: active?"#fff":"#6b82a8", textDecoration:"none", fontSize:11, fontWeight:600,
                  background: active ? "rgba(0,200,255,0.12)" : "transparent",
                  padding:"6px 14px", borderRadius:6, transition:"all 0.2s",
                  display:"flex",alignItems:"center",gap:6, position:"relative",
                  border: active ? "1px solid rgba(0,200,255,0.2)" : "1px solid transparent",
                  whiteSpace:"nowrap"
                }}>
                  <span>{item.icon(active ? "#00c8ff" : "#6b82a8")}</span> {item.label}
                  {item.badge > 0 && (
                    <span style={{
                      position:"absolute",top:-4,right:0,
                      background:"#ff4757",color:"#fff",fontSize:8,fontWeight:700,
                      width:16,height:16,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                      boxShadow:"0 0 8px rgba(255,71,87,0.5)", animation:"blink 1.5s infinite"
                    }}>{item.badge}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginRight:16,paddingRight:16,borderRight:"1px solid rgba(255,255,255,0.1)"}}>
             <div style={{width:28,height:28,borderRadius:"50%",background:"#00c8ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:"#000"}}>{user?.name?.[0]||"O"}</div>
             <div style={{fontSize:11,fontWeight:600,color:"#fff"}}>{user?.name || "Operator"}</div>
             <button onClick={logout} style={{background:"transparent",border:"none",color:"#ff4757",fontSize:10,fontWeight:700,cursor:"pointer",marginLeft:4}}>LOGOUT</button>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:"#e8f0ff",fontWeight:500}}>
              {time.toLocaleTimeString('en-IN',{hour12:false})}
            </div>
            <div style={{fontSize:9,color:"#6b82a8"}}>{time.toLocaleDateString('en-IN',{weekday:'short',year:'numeric',month:'short',day:'numeric'})}</div>
          </div>
          <div style={{
            display:"inline-flex",alignItems:"center",gap:6,
            padding:"5px 12px",borderRadius:20,fontSize:11,fontFamily:"'JetBrains Mono',monospace",
            border:`1px solid ${connected?"rgba(0,255,157,0.3)":"rgba(255,165,2,0.3)"}`,
            color: connected?"#00ff9d":"#ffa502",
            background: connected?"rgba(0,255,157,0.06)":"rgba(255,165,2,0.06)"
          }}>
            <span style={{width:7,height:7,borderRadius:"50%",background:"currentColor",animation:connected?"pulse-glow 2s infinite":"blink 1s infinite"}}/>
            {connected ? "CONNECTED" : "RECONNECTING"}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

// ─── Dashboard Components ─────────────────────────────────────────────────────
function StatCard({ icon, label, value, unit, sub, color }) {
  return (
    <GlassCard style={{padding:"14px 18px",position:"relative",overflow:"hidden"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{fontSize:9,color:"#6b82a8",textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700,marginBottom:4}}>{label}</div>
          <div style={{fontSize:24,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:"#fff"}}>
            {value}<span style={{fontSize:12,color:"#6b82a8",marginLeft:4,fontWeight:400}}>{unit}</span>
          </div>
        </div>
        <div style={{padding:8,borderRadius:8,background:`${color}10`,border:`1px solid ${color}20`}}>
          {typeof icon === "function" ? icon(color) : icon}
        </div>
      </div>
      <div style={{fontSize:9,color:"#515c6d",marginTop:8,display:"flex",alignItems:"center",gap:4}}>
        <span style={{width:4,height:4,borderRadius:"50%",background:color}}/> {sub}
      </div>
    </GlassCard>
  );
}

function NodeDetail({ node, reading, history }) {
  if (!node) return null;
  const q = getWaterQuality(reading);
  const v = getValveStatus(reading);
  const pData = history?.pressure || [];
  const fData = history?.flow || [];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <GlassCard style={{padding:24}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24,flexWrap:"wrap",gap:12}}>
          <div>
             <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:v.color,boxShadow:`0 0 10px ${v.color}`}}/>
                <span style={{fontSize:20,fontWeight:700,color:"#fff"}}>{node.name}</span>
             </div>
             <div style={{fontSize:11,color:"#6b82a8",fontFamily:"'JetBrains Mono',monospace"}}>{node.zone} Division · Grid Ref: {node.id}</div>
          </div>
          <div style={{padding:"6px 14px",borderRadius:20,background:`${v.color}15`,border:`1px solid ${v.color}30`,color:v.color,fontSize:10,fontWeight:700,letterSpacing:"0.1em"}}>
            VALVE {v.status}
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",gap:12}}>
           <div style={{background:"rgba(0,0,0,0.2)",borderRadius:12,padding:16,border:"1px solid rgba(255,255,255,0.03)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                 <div style={{fontSize:10,color:"#6b82a8",fontWeight:600}}>LIVE PRESSURE (BAR)</div>
                 {ICONS.PRESSURE("#00c8ff")}
              </div>
              <div style={{display:"flex",alignItems:"flex-end",gap:12}}>
                 <div style={{fontSize:28,fontWeight:700,color:"#fff",fontFamily:"'JetBrains Mono',monospace"}}>{reading?.pressure?.toFixed(2) || "0.00"}</div>
                 <div style={{flex:1,marginBottom:6,marginLeft:10}}>
                    <Sparkline data={pData} color="#00c8ff" width={120} height={30} />
                 </div>
              </div>
           </div>
           <div style={{background:"rgba(0,0,0,0.2)",borderRadius:12,padding:16,border:"1px solid rgba(255,255,255,0.03)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                 <div style={{fontSize:10,color:"#6b82a8",fontWeight:600}}>FLOW THROUGHPUT (L/M)</div>
                 {ICONS.FLOW("#55efc4")}
              </div>
              <div style={{display:"flex",alignItems:"flex-end",gap:12}}>
                 <div style={{fontSize:28,fontWeight:700,color:"#fff",fontFamily:"'JetBrains Mono',monospace"}}>{reading?.flow_rate?.toFixed(1) || "0.0"}</div>
                 <div style={{flex:1,marginBottom:6,marginLeft:10}}>
                    <Sparkline data={fData} color="#55efc4" width={120} height={30} />
                 </div>
              </div>
           </div>
        </div>
      </GlassCard>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:12}}>
         <GlassCard style={{padding:16,textAlign:"center"}}>
            <div style={{fontSize:9,color:"#6b82a8",marginBottom:8}}>QUALITY INDEX</div>
            <div style={{fontSize:18,fontWeight:700,color:q.color}}>{q.label}</div>
            <div style={{fontSize:10,color:"#515c6d",marginTop:4}}>{q.score}% Score</div>
         </GlassCard>
         <GlassCard style={{padding:16,textAlign:"center"}}>
            <div style={{fontSize:9,color:"#6b82a8",marginBottom:8,display:"flex",justifyContent:"center",gap:4}}>{ICONS.BATTERY("#74b9ff")} ENERGY</div>
            <div style={{fontSize:18,fontWeight:700,color:"#74b9ff"}}>{reading?.battery_level || 0}%</div>
            <div style={{fontSize:10,color:"#515c6d",marginTop:4}}>DC-Link Stable</div>
         </GlassCard>
         <GlassCard style={{padding:16,textAlign:"center"}}>
            <div style={{fontSize:9,color:"#6b82a8",marginBottom:8}}>INFRASTRUCTURE</div>
            <div style={{fontSize:18,fontWeight:700,color:"#a29bfe"}}>P04-HD</div>
            <div style={{fontSize:10,color:"#515c6d",marginTop:4}}>Cast Iron G-32</div>
         </GlassCard>
      </div>
    </div>
  );
}

// ─── Dashboard View ───────────────────────────────────────────────────────────
function DashboardView({ sensors, history, sensorMap, notifications }) {
  const [selectedNode, setSelectedNode] = useState(null);
  const [sidebarFilter, setSidebarFilter] = useState("ALL");

  // Merge 'Resolved' status from notifications into sensor readings for logical consistency
  const activeNodesInGrid = sensors.map(s => {
    const notification = notifications.find(n => n.nodeId === s.device_id && !n.acknowledged);
    if (!notification && s.leak_status) {
      // If sensor says leak but grid manager (notifications) says resolved/no-incident, show as healthy
      return { ...s, leak_status: false, leak_severity: "OK" };
    }
    return s;
  }).filter(s => PIPELINE_NODES.some(n => n.id === s.device_id));
  const onlineNodes = activeNodesInGrid.length;
  const leakCount = activeNodesInGrid.filter(s => s.leak_status).length;
  const avgP = activeNodesInGrid.length ? activeNodesInGrid.reduce((s,r)=>s+(r.pressure||0),0)/activeNodesInGrid.length : 0;
  const avgF = activeNodesInGrid.length ? activeNodesInGrid.reduce((s,r)=>s+(r.flow_rate||0),0)/activeNodesInGrid.length : 0;
  const totalFlow = activeNodesInGrid.reduce((s,r) => s + (r.flow_rate || 0), 0);
  const criticalCount = activeNodesInGrid.filter(s => s.leak_severity === "CRITICAL").length;

  const zones = ["Central", "East", "SouthEast", "South", "West", "NorthWest", "North", "NorthEast", "Kaveri Division"];
  const filteredNodes = sidebarFilter === "ALL" ? PIPELINE_NODES : 
    sidebarFilter === "LEAKING" ? PIPELINE_NODES.filter(n => sensorMap[n.id]?.leak_status) :
    PIPELINE_NODES.filter(n => n.zone === sidebarFilter);

  return (
    <div style={{display:"flex",flex:1,minHeight:0}}>
      {/* Sidebar */}
      <div style={{width:280,background:"#0a101c",borderRight:"1px solid rgba(255,255,255,0.05)",display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>
        <div style={{padding:"8px 12px", borderBottom:"1px solid rgba(255,255,255,0.05)", display:"flex", gap:6, overflowX:"auto", scrollbarWidth:"none"}}>
          {["ALL","LEAKING",...zones].map(f => (
            <button key={f} onClick={()=>setSidebarFilter(f)} style={{
              fontSize:9,padding:"5px 12px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontWeight:600,
              background: sidebarFilter===f?"rgba(0,200,255,0.1)":"transparent",
              color: sidebarFilter===f?"#00c8ff": f==="LEAKING"?"#ff4757":"#6b82a8",
              transition:"0.2s", whiteSpace:"nowrap"
            }}>{f}</button>
          ))}
        </div>

        <div style={{flex:1,overflowY:"auto",padding:8}}>
          {filteredNodes.map(node => {
            const r = sensorMap[node.id];
            const active = selectedNode === node.id;
            const h = history[node.id] || { pressure: [] };
            return (
              <div key={node.id} onClick={()=>setSelectedNode(node.id)} style={{
                padding:"10px 12px",borderRadius:8,cursor:"pointer",transition:"all 0.3s ease",marginBottom:4,
                background: active ? "rgba(0,200,255,0.08)" : "transparent",
                border: active ? "1px solid rgba(0,200,255,0.2)" : "1px solid transparent",
                display:"flex", justifyContent:"space-between", alignItems:"center"
              }}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:11,fontWeight:600,color:active?"#fff":"#e8f0ff",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{node.name}</div>
                  <div style={{fontSize:9,color:"#6b82a8",marginTop:2,display:"flex",gap:6}}>
                    <span style={{color:r?.leak_status?"#ff4757":"#00ff9d"}}>{r?.leak_status?"● ALERT":"● STABLE"}</span>
                    <span>{node.id}</span>
                  </div>
                </div>
                <div style={{opacity:active?1:0.6}}>
                   <Sparkline data={h.pressure} color={r?.leak_status?"#ff4757":"#00ff9d"} width={40} height={15} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"16px 24px",display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:12,flexShrink:0}}>
          <StatCard icon={ICONS.DASHBOARD} label="Active Nodes" value={onlineNodes} sub={`${onlineNodes}/32 Active`} color="#00c8ff"/>
          <StatCard icon={ICONS.FLOW} label="Total Flow" value={totalFlow.toFixed(0)} unit="L/m" sub="Net Output" color="#55efc4"/>
          <StatCard icon={ICONS.PRESSURE} label="Avg Pressure" value={avgP.toFixed(1)} unit="bar" color="#ffc266" sub="System Nominal"/>
          <StatCard icon={ICONS.ALERTS} label="Alerts" value={leakCount} color={leakCount>0?"#ff4757":"#00ff9d"} sub={criticalCount ? `${criticalCount} CRIT` : "Grid Secure"}/>
          <StatCard icon={ICONS.ALERTS} label="Dispatched" value={notifications.filter(n=>!n.acknowledged).length} color="#ffa502" sub="Response Active"/>
          <StatCard icon={ICONS.TEMP} label="Grid Health" value={100 - (leakCount*5)} unit="%" color="#74b9ff" sub="Integrity Score"/>
        </div>

        <div style={{flex:1,display:"grid",gridTemplateColumns: selectedNode ? "1.2fr 0.8fr" : "1fr",gap:16,padding:"0 24px 16px",minHeight:0,overflow:"hidden"}}>
          <div style={{display:"flex",flexDirection:"column",gap:16,overflowY:"auto",paddingRight:4}}>
            {selectedNode ? (
              <NodeDetail node={PIPELINE_NODES.find(n=>n.id===selectedNode)} reading={sensorMap[selectedNode]} history={history[selectedNode]} />
            ) : (
              <GlassCard style={{padding:60,textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center"}}>
                <div style={{width:80,height:80,borderRadius:"50%",background:"rgba(0,200,255,0.05)",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:20}}>
                   {ICONS.DASHBOARD("#00c8ff")}
                </div>
                <div style={{fontSize:18,fontWeight:600,color:"#fff",marginBottom:8}}>Command Center Overview</div>
                <div style={{fontSize:12,color:"#6b82a8",maxWidth:300}}>Select a node from the regional grid to access real-time telemetry and control systems.</div>
              </GlassCard>
            )}
          </div>

          <div style={{display:"flex",flexDirection:"column",overflow:"hidden"}}>
             <div style={{fontSize:10,fontWeight:700,color:"#6b82a8",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:12}}>Incident Control Stream</div>
             <GlassCard style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                <div style={{overflowY:"auto",flex:1}}>
                  {notifications.length === 0 ? (
                    <div style={{padding:40,textAlign:"center",color:"#6b82a8"}}>
                      <div style={{fontSize:32,marginBottom:8}}>✅</div>
                      <div style={{fontSize:12}}>System optimal — no leak incidents</div>
                    </div>
                  ) : notifications.map((n,i) => {
                    const c = SEV_COLOR[n.severity] || "#ffa502";
                    return (
                      <div key={i} style={{padding:"12px 16px",borderBottom:"1px solid rgba(0,200,255,0.04)",animation:i<3?"fade-in 0.5s ease":"none",display:"flex",flexDirection:"column",gap:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:10,fontSize:11}}>
                          <span style={{width:6,height:6,borderRadius:"50%",background:n.acknowledged?"#6b82a8":c,flexShrink:0}}/>
                          <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,fontFamily:"'JetBrains Mono',monospace",background:`${c}18`,color:c,flexShrink:0}}>{n.severity}</span>
                          <span style={{flex:1,color:"#e8f0ff",opacity:n.acknowledged?0.4:1}}>
                            <strong>{n.nodeName}</strong> — {n.anomalyType.replace("_"," ")}
                          </span>
                          <span style={{color:"#515c6d",fontFamily:"'JetBrains Mono',monospace",fontSize:10}}>{n.time}</span>
                        </div>
                        <div style={{marginLeft:16,fontSize:9,color:n.assignedTo?"#00c8ff":"#515c6d",fontFamily:"'Inter',sans-serif",fontWeight:500}}>
                          {n.status} {n.assignedTo && `(${(n.assignedTo || "").split("—")[0].trim()})`}
                        </div>
                      </div>
                    );
                  })}
                </div>
             </GlassCard>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Live Map View (Satellite + Labels) ──────────────────────────────────────
function StreetViewHandler({ active, onComplete }) {
  useMapEvents({
    click: (e) => {
      if (!active) return;
      const { lat, lng } = e.latlng;
      window.open(`https://maps.google.com/maps?q=&layer=c&cbll=${lat},${lng}`, "_blank");
      onComplete();
    }
  });
  return null;
}

function MapView({ sensorMap, selectedNode, setSelectedNode }) {
  const [probeActive, setProbeActive] = useState(false);

  return (
    <div style={{flex:1,position:"relative",display:"flex"}}>
      {/* 360 Probe Control */}
      <div style={{position:"absolute", top:12, right:12, zIndex:1000, display:"flex", flexDirection:"column", gap:10}}>
        <button 
          onClick={() => setProbeActive(!probeActive)}
          style={{
            padding: "10px 14px", borderRadius: 12, border: probeActive ? "2px solid #00c8ff" : "1px solid rgba(255,255,255,0.1)",
            background: probeActive ? "rgba(0,200,255,0.2)" : "rgba(10,16,28,0.9)",
            color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 12,
            backdropFilter: "blur(10px)", boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", gap: 8, transition: "0.2s"
          }}
        >
          {probeActive ? "⏳ SELECT LOCATION..." : "🔭 360° PROBE"}
        </button>
        {probeActive && (
          <div style={{
            background: "rgba(255,62,62,0.2)", color: "#ff4757", padding: "6px 12px", 
            borderRadius: 8, fontSize: 10, fontWeight: 700, textAlign: "center",
            backdropFilter: "blur(10px)", border: "1px solid rgba(255,62,62,0.3)"
          }}>
            CLICK ANYWHERE ON MAP
          </div>
        )}
      </div>

      <MapContainer center={[12.9716, 77.5946]} zoom={12} style={{width:"100%",height:"100%",background:"#060b14",zIndex:0, cursor: probeActive ? "crosshair" : "grab"}} zoomControl={true}>
        <StreetViewHandler active={probeActive} onComplete={() => setProbeActive(false)} />
        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Esri Satellite"/>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png" attribution="CARTO Labels" />
        
        {/* Kaveri Infrastructure Infrastructure Layer */}
        {KAVERI_INFRA.map((p, i) => (
          <Polyline key={`kv-infra-${i}`} positions={p} color="#00d2ff" weight={4} opacity={0.4} dashArray="10, 15" />
        ))}

        {PIPE_EDGES.map(([a,b],i) => {
          const nA = PIPELINE_NODES[a], nB = PIPELINE_NODES[b];
          const rA = sensorMap[nA.id], rB = sensorMap[nB.id];
          const hot = rA?.leak_status || rB?.leak_status;
          const path = [[nA.lat,nA.lng],[nB.lat,nB.lng]];
          return (
            <React.Fragment key={i}>
              {/* Outer Shell (Pipe Body) */}
              <Polyline positions={path} color="#2c3e50" weight={8} opacity={0.6}/>
              {/* Inner Highlight (Metallic Reflection/Core) */}
              <Polyline positions={path} color={hot?"#ff4757":"#00c8ff"} weight={3} opacity={1}/>
            </React.Fragment>
          );
        })}
        {PIPELINE_NODES.map(node => {
          const r = sensorMap[node.id];
          const color = SEV_COLOR[r?.leak_severity || "NONE"];
          const isSelectNode = selectedNode === node.id;
          const isKaveri = node.id.startsWith("KAV-");

          // Custom "Logo" rendering for Kaveri nodes
          if (isKaveri) {
            return (
              <CircleMarker key={node.id} center={[node.lat,node.lng]}
                radius={isSelectNode?14:10}
                pathOptions={{color:"#00d2ff", fillColor:"#00d2ff", fillOpacity:0.3, weight:2, dashArray:"3, 3"}}
                eventHandlers={{click:()=>setSelectedNode(node.id)}}
              >
                <div style={{pointerEvents:"none"}}>
                   <div style={{position:"absolute",transform:"translate(-50%,-50%)",fontSize:14}}>💧</div>
                </div>
                <Popup maxWidth={220}>
                   <div style={{textAlign:"center"}}>
                      <div style={{fontSize:10,fontWeight:700,color:"#00d2ff",marginBottom:4}}>KAVERI STRATEGIC NODE</div>
                      <strong style={{fontSize:14}}>{node.name}</strong>
                      <div style={{fontSize:10,color:"#666",marginTop:4}}>{node.office}</div>
                      <div style={{fontSize:11,marginTop:10,padding:8,background:"#f0f9ff",borderRadius:6}}>
                         Status: <strong style={{color:"#00d2ff"}}>{r?.leak_status ? "INCIDENT" : "STABLE"}</strong>
                      </div>
                   </div>
                </Popup>
              </CircleMarker>
            );
          }

          return (
            <CircleMarker key={node.id} center={[node.lat,node.lng]}
              radius={isSelectNode?11:r?.leak_status?9:7}
              pathOptions={{color:isSelectNode?"#fff":color, fillColor:color, fillOpacity:1, weight:isSelectNode?3:2}}
              eventHandlers={{click:()=>setSelectedNode(node.id)}}
            >
              <Popup maxWidth={250} minWidth={200}>
                <div style={{fontFamily:"'Inter',sans-serif",padding:"4px",background:"#fff",borderRadius:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <strong style={{color:"#111",fontSize:13}}>{node.name}</strong>
                    <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,fontWeight:700,background:r?.leak_status?`${color}20`:"#e8f8ef",color:r?.leak_status?color:"#27ae60"}}>{r?.leak_status ? r.leak_severity : "OK"}</span>
                  </div>
                  <div style={{fontSize:10,color:"#888",marginBottom:6,fontFamily:"monospace"}}>{node.id} · {node.zone} Zone</div>
                  <hr style={{border:"none",borderTop:"1px solid #eee",margin:"4px 0 8px"}}/>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 12px",fontSize:11, color:"#333"}}>
                    <div>Pressure: <strong>{r?.pressure?.toFixed(2) || "—"} bar</strong></div>
                    <div>Flow: <strong>{r?.flow_rate?.toFixed(1) || "—"} L/m</strong></div>
                  </div>
                  <div style={{marginTop:12}}>
                    <a 
                      href={`https://maps.google.com/maps?q=&layer=c&cbll=${node.lat},${node.lng}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="street-view-btn"
                      style={{
                        display:"block", textAlign:"center", padding:"10px",
                        background:"#00c8ff", color:"#fff", borderRadius:6,
                        fontSize:10, fontWeight:700, textDecoration:"none",
                        boxShadow:"0 4px 10px rgba(0,200,255,0.3)",
                        transition: "all 0.2s"
                      }}
                    >
                      🔭 VIEW 360° STREET PANORAMA
                    </a>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

// ─── Alerts / Notifications View ─────────────────────────────────────────────
function AlertsView({ notifications, assignRegion, assignPerson, acknowledgeNotification, exportToWord }) {
  const unack = notifications.filter(n => !n.acknowledged);
  const resolved = notifications.filter(n => n.acknowledged);
  const critical = notifications.filter(n => !n.acknowledged && n.severity === "CRITICAL");
  const zones = ["Central", "East", "SouthEast", "South", "West", "NorthWest", "North", "NorthEast", "Kaveri Division"];

  return (
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column",padding:24}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24, flexWrap:"wrap", gap:16}}>
        <div>
          <div style={{fontSize:20,fontWeight:600,color:"#fff"}}>🔔 Incident Control Center</div>
          <div style={{fontSize:12,color:"#6b82a8",marginTop:4}}>Attributed Grid Management & Emergency Dispatch</div>
        </div>
        
        <div style={{display:"flex", gap:12}}>
          <button 
            onClick={exportToWord}
            style={{
              padding:"8px 16px", borderRadius:12, background:"#2c3e50", color:"#fff", 
              fontSize:11, fontWeight:700, border:"1px solid rgba(255,255,255,0.1)",
              cursor:"pointer", display:"flex", alignItems:"center", gap:8, marginRight:10
            }}
          >
            📥 DOWNLOAD DAILY REPORT
          </button>
          <GlassCard style={{padding:"12px 20px", textAlign:"center", borderLeft:"4px solid #ff4757"}}>
            <div style={{fontSize:10, color:"#6b82a8", fontWeight:700}}>CRITICAL</div>
            <div style={{fontSize:18, fontWeight:700, color:"#ff4757"}}>{critical.length}</div>
          </GlassCard>
          <GlassCard style={{padding:"12px 20px", textAlign:"center", borderLeft:"4px solid #ffa502"}}>
            <div style={{fontSize:10, color:"#6b82a8", fontWeight:700}}>PENDING</div>
            <div style={{fontSize:18, fontWeight:700, color:"#ffa502"}}>{unack.length}</div>
          </GlassCard>
          <GlassCard style={{padding:"12px 20px", textAlign:"center", borderLeft:"4px solid #00ff9d"}}>
            <div style={{fontSize:10, color:"#6b82a8", fontWeight:700}}>RESOLVED</div>
            <div style={{fontSize:18, fontWeight:700, color:"#00ff9d"}}>{resolved.length}</div>
          </GlassCard>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:12}}>
        {notifications.map(n => {
          const c = SEV_COLOR[n.severity] || "#ffa502";
          return (
            <GlassCard key={n.id} style={{padding:"20px 24px"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:20}}>
                <div style={{width:48,height:48,borderRadius:12,background:`${c}12`,border:`2px solid ${c}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>
                  {n.acknowledged ? "✅" : "⚠️"}
                </div>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                    <span style={{fontSize:14,fontWeight:600,color:"#fff"}}>{n.nodeName}</span>
                    <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:`${c}18`,color:c,fontWeight:700}}>{n.severity} LEVEL</span>
                    {n.assignedTo && (
                      <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:"rgba(0,200,255,0.1)",color:"#00c8ff",fontWeight:700, border:"1px solid rgba(0,200,255,0.2)"}}>
                        ASSIGNED: {(n.assignedTo || "System").split("—")[0].trim()}
                      </span>
                    )}
                  </div>
                  <div style={{marginBottom:12,padding:"10px 14px",background:"rgba(0,0,0,0.2)",borderRadius:8,borderLeft:`3px solid ${c}`, opacity: n.acknowledged ? 0.6 : 1}}>
                    <div style={{fontSize:13,fontWeight:600,color:c,fontFamily:"'JetBrains Mono',monospace"}}>{n.anomalyType.replace(/_/g, " ")}</div>
                    {n.acknowledged && (
                      <div style={{fontSize:10, color:"#00ff9d", marginTop:6, fontWeight:600}}>
                         ✅ RESOLVED BY {(n.resolvedBy || "SYSTEM").split("—")[0].trim()} AT {n.resolvedAt || "—"}
                      </div>
                    )}
                  </div>
                  <div style={{fontSize:10,color:"#6b82a8"}}>📍 Node: {n.nodeId} · GPS: {n.lat.toFixed(4)}, {n.lng.toFixed(4)}</div>
                </div>
                <div style={{width:220}}>
                   {!n.acknowledged && (
                     <>
                       {!n.assignedRegion ? (
                          <select onChange={(e) => assignRegion(n.id, e.target.value)} style={{width:"100%",padding:8,background:"#1a243a",color:"#fff",borderRadius:8}}>
                            <option value="">Assign Region</option>
                            {zones.map(z => <option key={z} value={z}>{z}</option>)}
                          </select>
                       ) : !n.assignedTo ? (
                          <select onChange={(e) => assignPerson(n.id, e.target.value)} style={{width:"100%",padding:8,background:"#1a243a",color:"#fff",borderRadius:8, border:"1px solid #00c8ff"}}>
                            <option value="">Select Specialist</option>
                            {REGIONAL_STAFF[n.assignedRegion]?.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                       ) : (
                          <button onClick={()=>acknowledgeNotification(n.id)} style={{width:"100%",padding:12,background:"#00ff9d",color:"#000",borderRadius:8,fontWeight:700, border:"none", cursor:"pointer", boxShadow:"0 4px 12px rgba(0,255,157,0.3)"}}>FIX COMPLETED</button>
                       )}
                     </>
                   )}
                   {n.acknowledged && (
                     <div style={{textAlign:"center", color:"#00ff9d", fontSize:11, fontWeight:700}}>COMPLETED</div>
                   )}
                </div>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const { notifications, sendLeakNotification, assignRegion, assignPerson, acknowledgeNotification, exportToWord } = useNotifications();
  const { connected, sensors, history, leaks } = useWaterSystem(sendLeakNotification);
  const [selectedNode, setSelectedNode] = useState(null);

  const sensorMap = useMemo(() => {
    const m = {};
    sensors.forEach(s => { m[s.device_id] = s; });
    return m;
  }, [sensors]);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Layout connected={connected} notifications={notifications}>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/home" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {/* Private Grid Routes */}
            <Route path="/dashboard" element={<ProtectedRoute><DashboardView sensors={sensors} history={history} leaks={leaks} sensorMap={sensorMap} notifications={notifications} /></ProtectedRoute>} />
            <Route path="/map" element={<ProtectedRoute><MapView sensorMap={sensorMap} selectedNode={selectedNode} setSelectedNode={setSelectedNode} /></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute><AlertsView notifications={notifications} assignRegion={assignRegion} assignPerson={assignPerson} acknowledgeNotification={acknowledgeNotification} exportToWord={exportToWord} /></ProtectedRoute>} />
            
            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </AuthProvider>
  );
}
