import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

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
        if (event.accelerationIncludingGravity) {
            sensorActivo = true;
            movActual = {
                x: event.accelerationIncludingGravity.x,
                y: event.accelerationIncludingGravity.y,
                z: event.accelerationIncludingGravity.z
            };
        }
    });
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
                
                // Solo actualizamos la UI si no acabamos de tener un éxito
                if (!mostrandoExito) {
                    statusTxt.innerHTML = `<i class="bi bi-geo-alt-fill text-success"></i> GPS Activo (±${Math.round(pos.coords.accuracy)}m)`;
                    statusTxt.className = "status-box bg-success-subtle text-success border border-success-subtle";
                    btnPrincipal.disabled = false;
                    btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
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
    if (!sensorActivo) {
        throw new Error("HARDWARE NO DETECTADO: Sensores inactivos.");
    }
    if (movActual.x === 0 && movActual.y === 0 && movActual.z === 0) {
        throw new Error("ERROR DE SENSORES: No se detecta gravedad real.");
    }
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
    statusTxt.innerText = "Verificando sensores físicos...";
    await checarIntegridadHardware();

    const exifData = await obtenerExif(file);
    
    // EXTRACCIÓN DE PARÁMETROS FOTOGRÁFICOS
    const iso = exifData.ISOSpeedRatings || "N/A";
    const obturacion = exifData.ExposureTime ? 
        (exifData.ExposureTime < 1 ? `1/${Math.round(1/exifData.ExposureTime)}` : exifData.ExposureTime) : "N/A";
    const apertura = exifData.FNumber ? `f/${exifData.FNumber}` : "N/A";
    const modeloCamara = exifData.Model || "Desconocido";

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
        await addDoc(collection(db, "evidencias"), {
            folio: folio,
            hash: hash,
            foto: fotoBase64,
            lat: coordsActuales.latitude,
            lon: coordsActuales.longitude,
            precision: coordsActuales.accuracy,
            // Nuevos datos técnicos para el cliente
            foto_iso: iso,
            foto_velocidad: obturacion,
            foto_apertura: apertura,
            foto_modelo: modeloCamara,
            
            exif_fecha: horaFoto.toISOString(),
            fecha_celular: horaDispositivo.toISOString(),
            fecha_servidor: serverTimestamp(),
            desfase_segundos: Math.round(desfaseTiempo),
            sensor_mov_z: movActual.z, 
            hw_verificado: true
        });

        mostrandoExito = true;
        statusTxt.className = "status-box bg-success text-white px-2";
        statusTxt.innerHTML = `✅ CERTIFICADA <code class="d-block text-white">${folio}</code>`;
        btnPrincipal.disabled = false;
        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> NUEVA CAPTURA`;
        btnPrincipal.className = "btn btn-outline-primary w-100 mb-3";
} catch (error) {
        // Validación específica para el error de sensores (vital para iPhone)
        if (error.message.includes("Sensores inactivos")) {
            alert("❌ ERROR: Para certificar la foto, VeriPhoto necesita acceso a los sensores de movimiento. \n\nSi usas iOS, ve a Ajustes > Safari > Acceso a movimiento y orientación.");
            statusTxt.innerHTML = `<i class="bi bi-shield-slash text-danger"></i> Permiso denegado`;
            statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";
        } 
        // Validación de pérdida de GPS durante el proceso
        else if (!coordsActuales) {
            statusTxt.innerHTML = `<i class="bi bi-geo-off text-danger"></i> Error: Ubicación perdida`;
            statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";
            btnPrincipal.disabled = true;
            btnPrincipal.innerHTML = `Esperando GPS...`;
        } 
        // Otros errores de integridad (Fraude temporal, GPS falso, etc.)
        else {
            alert(`❌ ERROR DE SEGURIDAD:\n${error.message}`);
            statusTxt.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Error de integridad`;
            statusTxt.className = "status-box bg-warning-subtle text-warning border border-warning-subtle";
        }

        // Reseteo del botón y el input (Líneas 201-204 de tu captura)
        btnPrincipal.disabled = false;
        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> REINTENTAR`;
        e.target.value = "";
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
