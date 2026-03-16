import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// --- 0. SEGURIDAD DE PROTOCOLO ---
if (location.protocol !== "https:" && location.hostname !== "localhost") {
    alert("❌ CONEXIÓN INSEGURA: VeriPhoto requiere HTTPS para certificar evidencias.");
    location.replace(`https://${location.host}${location.pathname}`);
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

// --- VARIABLES GLOBALES ---
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
        if (verificadoPorAgite) return;

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

            // Feedback visual de progreso
            let porcentaje = Math.min(Math.round((lecturasAccel.length / 64) * 100), 100);
            statusTxt.innerHTML = `<div class="spinner-grow spinner-grow-sm text-primary"></div> Calibrando hardware... ${porcentaje}%`;
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
        statusTxt.innerHTML = `<i class="bi bi-robot text-danger"></i> Movimiento artificial detectado.`;
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
        statusTxt.innerHTML = `<i class="bi bi-shield-check text-primary"></i> Identidad Física Confirmada`;
        statusTxt.className = "status-box bg-primary-subtle text-primary border border-primary-subtle";
        btnPrincipal.disabled = false;
        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
    } else {
        // No pasó la prueba: Limpiamos y reintentamos
        lecturasAccel = []; lecturasGyro = [];
        statusTxt.innerHTML = `<i class="bi bi-phone-vibrate text-primary"></i> Agite insuficiente. Intente de nuevo.`;
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
                
                if (!mostrandoExito) {
                    if (!verificadoPorAgite) {
                        statusTxt.innerHTML = `<i class="bi bi-phone-vibrate text-primary"></i> Agita el teléfono 2s para activar cámara`;
                        statusTxt.className = "status-box bg-primary-subtle text-primary border border-primary-subtle";
                        btnPrincipal.disabled = true;
                        btnPrincipal.innerHTML = `Calibrando sensores...`;
                    } else {
                        statusTxt.innerHTML = `<i class="bi bi-geo-alt-fill text-success"></i> GPS Activo (±${Math.round(pos.coords.accuracy)}m)`;
                        statusTxt.className = "status-box bg-success-subtle text-success border border-success-subtle";
                        btnPrincipal.disabled = false;
                        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
                    }
                }
            },
            (error) => {
                coordsActuales = null;
                statusTxt.innerHTML = `<i class="bi bi-geo-off text-danger"></i> Error: Activa tu ubicación`;
                statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";
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

// Inicializar servicios
activarGPS();
activarSensores();

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
    
    // Tercero: Mostramos el folio
    statusTxt.className = "status-box bg-success text-white px-2";
    statusTxt.innerHTML = `✅ CERTIFICADA <code class="d-block text-white">${folio}</code>`;

    // Cuarto: El tiempo de espera para que el GPS retome el mando
    setTimeout(() => {
        mostrandoExito = false; // Aquí permitimos que activarGPS() vuelva a pedir agite
        e.target.value = "";    
        console.log("Sistema rearmado.");
    }, 3000); // Subimos a 3 segundos para dar tiempo a la UI
} catch (error) {
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
// Hacer la función accesible desde el HTML (necesario para módulos)
window.activarSensores = activarSensores;