import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Bloqueo de IFrames (Anti-Clickjacking)
if (window.top !== window.self) {
document.body.innerHTML = "<h1>Acceso Bloqueado</h1><p>Esta aplicación no puede ejecutarse dentro de un marco externo por razones de seguridad.</p>";
throw new Error("Intento de ejecución en iframe detectado.");
}

const firebaseConfig = {
apiKey: "AIzaSyCDrXohcOJZcsMgqmvXakk4SJnaj7hgzDo",
authDomain: "veriphoto-2c95d.firebaseapp.com",
projectId: "veriphoto-2c95d",
storageBucket: "veriphoto-2c95d.firebasestorage.app",
messagingSenderId: "1005950289147",
appId: "1:1005950289147:web:a8fddbf7ab082f99335c5e"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const esIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
// --- VARIABLES GLOBALES ---

// --- 1. SEGURIDAD PERSISTENTE (Doble Defensa) ---
let intentosMemoria = JSON.parse(localStorage.getItem("vp_intentos")) || [];
let certificacionesMemoria = JSON.parse(localStorage.getItem("vp_certs")) || [];

function verificarCompatibilidadModelo() {
    const isIPhone = /iPhone/i.test(navigator.userAgent);
    const height = window.screen.height;
    const width = window.screen.width;
    const pr = window.devicePixelRatio;

    // Detecta iPhone X, XS, 11 Pro (Pequeño)
    const esModeloLimitado = isIPhone && (height === 812 || width === 812) && pr === 3;
    
    if (esModeloLimitado) {
        alert("ADVERTENCIA DE COMPATIBILIDAD:\n\nEs posible que su dispositivo no sea totalmente compatible con los sistemas de verificación de VeriPhoto. Si experimenta errores, asegúrese de usar un iPhone 11 o superior.");
    }
}

verificarCompatibilidadModelo();

function guardarDatos() {
localStorage.setItem("vp_intentos", JSON.stringify(intentosMemoria));
localStorage.setItem("vp_certs", JSON.stringify(certificacionesMemoria));
}

async function registrarLog(tipo) {
try {
await addDoc(collection(db, "logs_security"), {
tipo: tipo,
timestamp: serverTimestamp(),
userAgent: navigator.userAgent
});
} catch (e) { console.warn("Log omitido"); }
}
let coordsActuales = null;
let movActual = { x: 0, y: 0, z: 0 };
let sensorActivo = false;
let mostrandoExito = false;
let metricaFlatness = 0;
let metricaEnergia = 0;
let metricaVariacionG = 0;

//VARIABLES DE SEGURIDAD PRO (REEMPLAZADAS)
let verificadoPorAgite = false;
let lecturasAccel = [];   // Antes era lecturasAgite
let lecturasGyro = [];    // Nueva: para detectar rotación real
let ultimoRegistro = 0;
let analizando = false;   // Nueva: semáforo para evitar saturar el procesador
// --- CONTROLADOR DE INTERFAZ ---
let estadoUI = "inicial";
let tiempoLecturaConcluido = false;
let gpsEsReciente = false;

const statusTxt = document.getElementById("status");
const btnPrincipal = document.getElementById("btnPrincipal");

// --- 1. SENSORES DE MOVIMIENTO ---
async function activarSensores() {
if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
try {
const permiso = await DeviceMotionEvent.requestPermission();
if (permiso === 'granted') iniciarEscuchaMovimiento();
} catch (e) { console.error("Permiso de sensores denegado"); }
} else {
iniciarEscuchaMovimiento();
}
}

function iniciarEscuchaMovimiento() {
window.addEventListener('devicemotion', (event) => {
if (verificadoPorAgite || mostrandoExito) return;

const acc = event.accelerationIncludingGravity;  
    const rot = event.rotationRate;  
      
    // Protección: Si el sensor no responde o el GPS no está listo, ignoramos  
    if (!acc || !rot || !coordsActuales) return;  
    sensorActivo = true;  
    const ahora = Date.now();  
    if (ahora - ultimoRegistro > 20) {  
        // Extracción segura con protección contra nulos (?? 0)  
        const ax = acc.x ?? 0; const ay = acc.y ?? 0; const az = acc.z ?? 0;  
        const rx = rot.alpha ?? 0; const ry = rot.beta ?? 0; const rz = rot.gamma ?? 0;  

        const fuerzaAcc = Math.sqrt(ax*ax + ay*ay + az*az);  
        const fuerzaRot = Math.sqrt(rx*rx + ry*ry + rz*rz);  

        lecturasAccel.push(fuerzaAcc);  
        lecturasGyro.push(fuerzaRot);  
        ultimoRegistro = ahora;  

        // Ventana deslizante de 64 muestras (~1.28 segundos)  
        if (lecturasAccel.length > 64) {  
            lecturasAccel.shift();  
            lecturasGyro.shift();  
        }  
        // Si aún estamos recolectando muestras, pedimos el agite de forma estática  
        // Reemplaza tu bloque de "if (lecturasAccel.length < 64...)" por este:

if (lecturasAccel.length < 64 && estadoUI !== "agitando" && !verificadoPorAgite) {
actualizarUI(
"agitando",
`<i class="bi bi-phone-vibrate text-primary"></i> Agite el teléfono 1s para continuar`,
"bg-primary-subtle text-primary border border-primary-subtle"
);
}
}
// Ejecutar validación cuando el buffer esté lleno
if (lecturasAccel.length === 64 && !analizando) {
analizando = true;
ejecutarValidacionPro();
}
});
}

function ejecutarValidacionPro() {
// 1. Detectar fraude de sensores congelados o emulados
const variacionGyro = Math.max(...lecturasGyro) - Math.min(...lecturasGyro);
const sensorMuerto = lecturasGyro.every(v => v === 0);

if (sensorMuerto || variacionGyro < 0.01) {  
lecturasAccel = []; lecturasGyro = [];  
analizando = false;  
// Usamos el estilo de peligro (danger) para que el usuario note el error de hardware  
statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";  
statusTxt.innerHTML = `<i class="bi bi-robot"></i> Error: Sensores inactivos o emulados.`;  
return;  
}  

// 2. Cálculo de métricas avanzadas (Aceleración)  
const EPS = 1e-6;  
const promedio = lecturasAccel.reduce((a, b) => a + b, 0) / lecturasAccel.length;  
const centradas = lecturasAccel.map(v => v - promedio);  

// Energía Dinámica  
let energia = 0;  
for (let i = 1; i < centradas.length; i++) {  
    energia += Math.pow(centradas[i] - centradas[i - 1], 2);  
}  
energia /= centradas.length;  

// Flatness (Entropía)  
const mediaArit = centradas.reduce((a, b) => a + Math.abs(b), 0) / centradas.length;  
const sumaLog = centradas.reduce((a, b) => a + Math.log(Math.abs(b) + EPS), 0);  
const mediaGeom = Math.exp(sumaLog / centradas.length);  
const flatness = mediaGeom / (mediaArit + EPS);  

// Energía del Giroscopio  
let energiaG = 0;  
for (let i = 1; i < lecturasGyro.length; i++) {  
    energiaG += Math.pow(lecturasGyro[i] - lecturasGyro[i - 1], 2);  
}  
const resGyro = energiaG / lecturasGyro.length;

metricaFlatness = flatness;
metricaEnergia = energia;
metricaVariacionG = variacionGyro;

// 3. Umbrales de Seguridad  
if (flatness > 0.35 && energia > 1.2 && resGyro > 0.8) {  
verificadoPorAgite = true;  
  
// Bloqueamos la UI con el estado "verificado"  
actualizarUI(  
    "verificado",  
    `<i class="bi bi-shield-check"></i> Identidad Física Confirmada`,  
    "bg-primary-subtle text-primary border border-primary-subtle"  
);  

setTimeout(() => {  
  // Solo marcamos que el tiempo de lectura terminó.  
    // NO llamamos a activar interfaz aquí.  
    tiempoLecturaConcluido = true;   
    console.log("Refrescando señal GPS...");  
}, 1000);

} else {
// No pasó la prueba: Limpiamos buffers pero NO cambiamos el mensaje de la UI
// Esto mantiene el texto "Agite el teléfono 1s" de forma permanente
lecturasAccel = [];
lecturasGyro = [];

// Forzamos el estado a "inicial" para que el validador de iniciarEscuchaMovimiento   
// vuelva a escribir el mensaje original si es necesario  
estadoUI = "inicial";

}
analizando = false;
}

// --- 2. GPS ACTUALIZADO (FIJA EL ERROR DE CARGA) ---
function activarGPS() {
if ("geolocation" in navigator) {
navigator.geolocation.watchPosition(
(pos) => {
coordsActuales = {
latitude: pos.coords.latitude,
longitude: pos.coords.longitude,
accuracy: pos.coords.accuracy,
timestamp: Date.now()
};
if (tiempoLecturaConcluido && !gpsEsReciente) {
gpsEsReciente = true; // Bloqueamos para que solo ejecute esto una vez
estadoUI = "gps";

actualizarUI(  
            "gps",  
            `<i class="bi bi-geo-alt-fill text-success"></i> GPS Activo (±${Math.round(pos.coords.accuracy)}m)`,  
            "bg-success-subtle text-success border border-success-subtle"  
        );  
        // Activamos el botón en este preciso milisegundo  
        btnPrincipal.disabled = false;  
        btnPrincipal.className = "btn btn-primary w-100 shadow";  
        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`; 
        btnPrincipal.onclick = () => document.getElementById('cameraInput').click(); 
    }   
    // Si la app ya está en modo GPS normal, solo actualizamos el texto  
    else if (estadoUI === "gps" || (estadoUI === "inicial" && coordsActuales)) {  
        actualizarUI(  
            "gps",  
            `<i class="bi bi-geo-alt-fill text-success"></i> GPS Activo (±${Math.round(pos.coords.accuracy)}m)`,  
            "bg-success-subtle text-success border border-success-subtle"  
        );  
    }  
        }, (error) => {  
coordsActuales = null;  
// Usamos el estado "error" para que el controlador de UI sepa qué hacer  
actualizarUI(  
    "error",   
    `<i class="bi bi-geo-off"></i> Error: Activa tu ubicación`,   
    "bg-danger-subtle text-danger border border-danger-subtle"  
);  
btnPrincipal.disabled = true;  
btnPrincipal.innerHTML = `Esperando GPS...`;  
console.warn("Error de Geolocalización:", error.message);

},
{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
);
} else {
statusTxt.innerText = "GPS no soportado en este navegador";
}
}

// --- 3. VALIDACIÓN DE INTEGRIDAD ---
async function checarIntegridadHardware() {
// 1. Validar que pasó la prueba de agite pro
if (!verificadoPorAgite) {
throw new Error("ERROR DE SEGURIDAD: Prueba de movimiento no completada.");
}

// 2. Validar que los sensores están enviando datos  
if (!sensorActivo) {  
    throw new Error("HARDWARE NO DETECTADO: Sensores inactivos.");  
}  
  
// 3. Validar GPS (Ya no necesitamos checar movActual porque lecturasAccel lo hizo)  
if (coordsActuales && coordsActuales.accuracy < 0.5) {  
    throw new Error("GPS FALSO DETECTADO: Señal artificial.");  
}  
  
return true;

}

// --- 4. CAPTURA Y PROCESAMIENTO ---
document.getElementById("cameraInput").addEventListener("change", async (e) => {
const file = e.target.files[0];
if (!file) return;
// --- PASO A: MOVER LA DEFENSA 1 AQUÍ (Justo después de elegir el archivo) ---
try {
verificarLimiteIntentos();
// Esto registra el "intento" en Firestore de inmediato
} catch (error) {
alert(error.message);
e.target.value = "";
return;
}

// VALIDACIÓN INSTANTÁNEA  
if (!coordsActuales) {  
    statusTxt.innerHTML = `<i class="bi bi-geo-off text-danger"></i> Error: Activa tu ubicación`;  
    statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";  
    btnPrincipal.disabled = true;  
    btnPrincipal.innerHTML = `Esperando GPS...`;  
    e.target.value = "";  
    return;  
}  

// Definimos la señal reciente aquí adentro  
const señalGpsReciente = (Date.now() - coordsActuales.timestamp < 10000); // 10 segundos de margen  

if (!señalGpsReciente) {  
    alert("❌ SEÑAL GPS ANTIGUA: Espera un momento a que se actualice.");  
    e.target.value = "";  
    return;   
}  
btnPrincipal.disabled = true;  
btnPrincipal.innerHTML = `<span class="spinner-border spinner-border-sm"></span> VALIDANDO...`;  

// ... dentro del listener de cameraInput ...

try {
// 1. BLOQUEO ATÓMICO (Tu código actual)
btnPrincipal.disabled = true;
mostrandoExito = true;
// ... resto del proceso

// 1. BLOQUEO ATÓMICO: Nadie puede tocar el botón hasta que termine todo el ciclo  
btnPrincipal.disabled = true;  
mostrandoExito = true; // <--- AGREGAMOS ESTO AQUÍ para silenciar al GPS de inmediato  
btnPrincipal.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Certificando...`;  

statusTxt.innerText = "Verificando sensores físicos...";  
await checarIntegridadHardware();  
const exifData = await obtenerExif(file);  
// Extracción de parámetros  
const horaDispositivo = new Date();  
const horaFoto = exifData.DateTime ? parseExifDate(exifData.DateTime) : new Date(file.lastModified);  
const desfaseTiempo = Math.abs((horaDispositivo - horaFoto) / 1000);  
  
if (desfaseTiempo > 120) {  
    throw new Error("FRAUDE TEMPORAL: La foto no es reciente.");  
}  
statusTxt.innerText = "Sellando evidencia...";  
const fotoBase64 = await procesarImagen(file);  
  
const base64Data = fotoBase64.split(',')[1];  
const binaryString = atob(base64Data);  
const bytes = new Uint8Array(binaryString.length);  
for (let i = 0; i < binaryString.length; i++) { bytes[i] = binaryString.charCodeAt(i); }  
  
const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);  
const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");  
  
verificarLimiteCertificaciones();  
const folio = "VP-" + Date.now();  
// Guardar en Firestore con TODA la evidencia técnica

await addDoc(collection(db, "evidencias"), {
folio: folio,
hash: hash,
foto: fotoBase64,

// Datos Geográficos  
lat: coordsActuales.latitude,  
lon: coordsActuales.longitude,  
precision_gps: coordsActuales.accuracy,  
  
// Metadatos de la Cámara (EXIF)  
exif_fecha: horaFoto.toISOString(),  
  
// Pruebas de Integridad Temporal  
fecha_celular: horaDispositivo.toISOString(),  
fecha_servidor: serverTimestamp(),  
desfase_segundos: Math.round(desfaseTiempo),  
  
// --- NUEVOS: PRUEBAS DE INTEGRIDAD FÍSICA ---  
atestacion_hardware: {  
    flatness_caos: metricaFlatness,      // Prueba de agite humano (entropía)  
    energia_dinamica: metricaEnergia,    // Intensidad del movimiento  
    variacion_giroscopio: metricaVariacionG, // Prueba de rotación real  
    muestras_analizadas: 64,  
    intervalo_ms: 20  
},  
// Información del Dispositivo  
hw_verificado: true

});
// --- MANEJO DE ÉXITO Y RESET CONTROLADO ---
certificacionesMemoria.push(Date.now());
guardarDatos();
registrarLog("certificacion");
// Primero: Aseguramos que el botón sea INCLICABLE visualmente
btnPrincipal.disabled = true;
btnPrincipal.innerHTML = `<i class="bi bi-shield-check"></i> GUARDADO CON ÉXITO`;

// Segundo: Reseteamos seguridad interna (Limpieza Pro)  
verificadoPorAgite = false;  
sensorActivo = false;  
lecturasAccel = []; // Antes decía lecturasAgite  
lecturasGyro = [];  // Añadimos esta  
ultimoRegistro = 0;  
analizando = false; // Aseguramos que el semáforo se libere  
metricaFlatness = 0;  
metricaEnergia = 0;  
metricaVariacionG = 0;

// Al final del try en cameraInput:
actualizarUI(
"exito",
`FOTO CERTIFICADA <br><code class="fs-5 text-white">${folio}</code>`,
"bg-success text-white px-2 shadow-sm"
);

btnPrincipal.disabled = false;
btnPrincipal.style.backgroundColor = "#0d6efd"; // El azul original de tu botón
btnPrincipal.style.borderColor = "#0d6efd";
btnPrincipal.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i> FINALIZAR`;



// Cambiamos el comportamiento del botón para que reinicie la app
btnPrincipal.onclick = () => { window.location.reload(); };

} catch (error) {
if (error.message.includes("LÍMITE")) {
alert(error.message);
statusTxt.innerHTML = `<i class="bi bi-clock-history"></i> ${error.message}`;
statusTxt.className = "status-box bg-warning text-dark";
}
// Validación para iPhone
if (error.message.includes("Sensores inactivos")) {
alert("❌ ERROR: VeriPhoto necesita acceso a los sensores de movimiento.");
statusTxt.innerHTML = `<i class="bi bi-shield-slash text-danger"></i> Permiso denegado`;
statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";
}
// Validación de pérdida de GPS
else if (!coordsActuales) {
statusTxt.innerHTML = `<i class="bi bi-geo-off text-danger"></i> Error: Ubicación perdida`;
statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";
}
// Otros errores de integridad (como el agite no completado)
else {
alert(`❌ ERROR DE SEGURIDAD:\n${error.message}`);
statusTxt.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Error de integridad`;
statusTxt.className = "status-box bg-warning-subtle text-warning border border-warning-subtle";
}

// --- CORRECCIÓN CRÍTICA ---  
    btnPrincipal.disabled = true; // Mantener bloqueado por seguridad  
    btnPrincipal.innerHTML = `<i class="bi bi-arrow-clockwise"></i> Reiniciando...`;  
    e.target.value = "";   

    // Permitimos que el sistema se limpie y activarGPS() tome el mando en 1 segundo  
    setTimeout(() => {  
        mostrandoExito = false;  
    }, 1000);  
}

}); // Cierre correcto del event listener

// --- FUNCIONES AUXILIARES ---
function obtenerExif(file) {
return new Promise((resolve) => {
EXIF.getData(file, function() { resolve(EXIF.getAllTags(this)); });
});
}

function parseExifDate(dateStr) {
const parts = dateStr.split(/[: ]/);
return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
}

async function procesarImagen(file) {
return new Promise((resolve) => {
const reader = new FileReader();
reader.readAsDataURL(file);
reader.onload = (e) => {
const img = new Image();
img.src = e.target.result;
img.onload = () => {
const canvas = document.createElement('canvas');
const MAX = 1600;
let w = img.width, h = img.height;
if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }
else { if (h > MAX) { w *= MAX / h; h = MAX; } }
canvas.width = w; canvas.height = h;
const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0, w, h);
resolve(canvas.toDataURL('image/jpeg', 0.7));
};
};
});
}

function verificarLimiteIntentos() {
const ahora = Date.now();
// Limpieza de memoria (solo lo ocurrido en el último minuto)
intentosMemoria = intentosMemoria.filter(t => ahora - t < 60000);

if (intentosMemoria.length >= 10) {  
    const espera = Math.round((60000 - (ahora - intentosMemoria[0])) / 1000);  
    throw new Error(`LÍMITE DE INTENTOS: Espera ${espera}s`);  
}  
// Registrar el intento de inmediato  
intentosMemoria.push(ahora);  
guardarDatos();  
registrarLog("intento");

}

function verificarLimiteCertificaciones() {
const ahora = Date.now();
certificacionesMemoria = certificacionesMemoria.filter(t => ahora - t < 60000);

if (certificacionesMemoria.length >= 5) {  
    const espera = Math.round((60000 - (ahora - certificacionesMemoria[0])) / 1000);  
    throw new Error(`LÍMITE DE CERTIFICACIONES: Espera ${espera}s`);  
}

}
function actualizarUI(nuevoEstado, mensaje, clase) {
// Si estamos en un estado crítico (Verificado, Procesando o Éxito),
// no permitimos que el GPS o los sensores normales cambien el texto.
const estadosPrioritarios = ["verificado", "procesando", "exito"];

if (estadosPrioritarios.includes(estadoUI) && !estadosPrioritarios.includes(nuevoEstado)) {  
    return;   
}  

estadoUI = nuevoEstado;  
statusTxt.className = `status-box ${clase}`;  
statusTxt.innerHTML = mensaje;

}
// Hacer la función accesible desde el HTML (necesario para módulos)
window.activarSensores = activarSensores;

// --- INICIALIZACIÓN UNIFICADA Y SEGURA (2 CLICS PARA iOS) ---
if (esIOS) {
    let pasoPermisos = 1; // Control de flujo interno
    
    btnPrincipal.disabled = false;
    btnPrincipal.innerHTML = `<i class="bi bi-shield-lock"></i> PASO 1: SENSORES`;
    
    btnPrincipal.onclick = async () => {
        // --- PASO 1: SENSORES ---
        if (pasoPermisos === 1) {
            if (typeof DeviceMotionEvent.requestPermission === 'function') {
                try {
                    const permiso = await DeviceMotionEvent.requestPermission();
                    if (permiso === 'granted') {
                        iniciarEscuchaMovimiento(); // Activa acelerómetro/giroscopio
                        
                        // Preparamos la UI para el segundo clic obligatorio
                        pasoPermisos = 2;
                        btnPrincipal.innerHTML = `<i class="bi bi-geo-alt"></i> PASO 2: UBICACIÓN`;
                        statusTxt.innerHTML = `<i class="bi bi-check-circle text-success"></i> Sensores OK.`;
                    }
                } catch (e) { alert("Error en sensores"); }
            }
        } 
// --- PASO 2: UBICACIÓN (Versión Final Corregida) ---
else if (pasoPermisos === 2) {
    btnPrincipal.innerHTML = `<span class="spinner-border spinner-border-sm"></span> SOLICITANDO...`;

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            coordsActuales = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                timestamp: Date.now()
            };
            
            statusTxt.innerHTML = `<i class="bi bi-geo-alt-fill text-success"></i> GPS Conectado.`;
            activarGPS(); 
            
            // ← AGREGA ESTO: Verificar si el agite ya pasó
            if (verificadoPorAgite) {
                // Agite ya pasó antes del GPS, habilitar botón inmediatamente
                pasoPermisos = 3;
                btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
                btnPrincipal.disabled = false;
                btnPrincipal.onclick = () => document.getElementById('cameraInput').click();
                statusTxt.innerHTML = `<i class="bi bi-shield-check text-success"></i> Listo para capturar`;
            } else {
                // Agite no ha pasado, mostrar mensaje de espera
                statusTxt.innerHTML = `<i class="bi bi-phone-vibrate text-primary"></i> Agite el teléfono 1s para continuar`;
                
                // Verificar periódicamente si el agite ya pasó
                const verificarAgite = setInterval(() => {
                    if (verificadoPorAgite) {
                        clearInterval(verificarAgite);
                        pasoPermisos = 3;
                        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
                        btnPrincipal.disabled = false;
                        btnPrincipal.onclick = () => document.getElementById('cameraInput').click();
                        statusTxt.innerHTML = `<i class="bi bi-shield-check text-success"></i> Listo para capturar`;
                    }
                }, 100);
            }
        },
        (err) => {
            console.error("Error código:", err.code, err.message);
            alert("Safari bloqueó la solicitud. Por favor, intenta dar clic de nuevo o recarga la página.");
            btnPrincipal.innerHTML = `<i class="bi bi-geo-alt"></i> REINTENTAR PASO 2`;
        },
        { 
            enableHighAccuracy: true, 
            timeout: 15000, 
            maximumAge: 0 
        }
    );
}
    };
} else {
    // ANDROID: Sin restricciones, activamos todo de golpe
    activarGPS();
    activarSensores();
}