 /**
  * WebSocket module – connects to SilverMoon backend,
  * handles send/receive, auto-reconnect.
  */
 
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
 const RECONNECT_DELAY_MS = 2000;
 const MAX_RECONNECT_DELAY_MS = 30000;
 
 let ws = null;
 let reconnectTimer = null;
 let reconnectAttempts = 0;
 
 let onMessage = null; // (data: object) => void
 let onConnectionChange = null; // (connected: boolean) => void
 
 export function setCallbacks({ onMsg, onConn }) {
   onMessage = onMsg;
   onConnectionChange = onConn;
 }
 
 export function connect() {
   if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
     return;
   }
 
   ws = new WebSocket(WS_URL);
 
   ws.onopen = () => {
     console.log("WebSocket connected");
     reconnectAttempts = 0;
     if (onConnectionChange) onConnectionChange(true);
   };
 
   ws.onmessage = (event) => {
     try {
       const data = JSON.parse(event.data);
       if (onMessage) onMessage(data);
     } catch (e) {
       console.warn("Invalid WS message:", event.data);
     }
   };
 
   ws.onclose = () => {
     console.log("WebSocket closed");
     if (onConnectionChange) onConnectionChange(false);
     scheduleReconnect();
   };
 
   ws.onerror = (e) => {
     console.warn("WebSocket error:", e);
   };
 }
 
 export function send(data) {
   if (ws && ws.readyState === WebSocket.OPEN) {
     ws.send(JSON.stringify(data));
   } else {
     console.warn("WebSocket not open, dropping message");
   }
 }
 
 export function disconnect() {
   if (reconnectTimer) {
     clearTimeout(reconnectTimer);
     reconnectTimer = null;
   }
   if (ws) {
     ws.onclose = null; // prevent reconnect
     ws.close();
     ws = null;
   }
 }
 
 function scheduleReconnect() {
   if (reconnectTimer) return;
   const delay = Math.min(
     RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
     MAX_RECONNECT_DELAY_MS,
   );
   reconnectAttempts++;
   console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
   reconnectTimer = setTimeout(() => {
     reconnectTimer = null;
     connect();
   }, delay);
 }
 
 export function isConnected() {
   return ws && ws.readyState === WebSocket.OPEN;
 }
