import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Definición de la función de detección
function detectarSistemaOperativo() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return "Android";
    if (/iPad|iPhone|iPod/.test(ua)) return "iOS";
    if (/Windows/i.test(ua)) return "Windows";
    if (/Macintosh/i.test(ua)) return "macOS";
    return "Otro";
}

// Bloqueo de Seguridad (EJECUTAR DE INMEDIATO)
const sistema = detectarSistemaOperativo();
if (sistema === "Windows" || sistema === "macOS" || sistema === "Otro") {
    document.body.innerHTML = `
        <div class="container text-center py-5" style="margin-top: 20vh;">
            <i class="bi bi-pc-display-horizontal text-danger" style="font-size: 5rem;"></i>
            <h2 class="fw-bold mt-4">Acceso Solo Móvil</h2>
            <p class="text-muted">VeriPhoto Pro requiere sensores físicos de integridad (GPS y Acelerómetro) presentes solo en dispositivos móviles.</p>
            <div class="alert alert-warning d-inline-block mt-3">
                <strong>Sistema detectado:</strong> ${sistema}
            </div>
            <p class="mt-4 small text-secondary">Escanea el código QR del servicio desde tu celular para continuar.</p>
        </div>
    `;
    throw new Error("Ejecución bloqueada: Se detectó un entorno de escritorio.");
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

let coordsActuales = null;
let mostrandoExito = false;
const statusTxt = document.getElementById("status");
const btnPrincipal = document.getElementById("btnPrincipal");

// --- GPS Y CONTROL DE BOTÓN ACTUALIZADO ---
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
                    statusTxt.innerHTML = `<i class="bi bi-geo-alt-fill text-success"></i> GPS Activo (±${Math.round(pos.coords.accuracy)}m)`;
                    statusTxt.className = "status-box bg-success-subtle text-success border border-success-subtle";
                    btnPrincipal.disabled = false;
                    btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
                }
            },
            () => {
                coordsActuales = null;
                // Esto sobreescribe cualquier mensaje de "Sellando" si el GPS se apaga
                statusTxt.innerHTML = `<i class="bi bi-geo-off text-danger"></i> Error: Activa tu ubicación`;
                statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";
                
                // Deshabilitamos el botón hasta que vuelva el GPS
                btnPrincipal.disabled = true;
                btnPrincipal.innerHTML = `Esperando GPS...`;
                mostrandoExito = false; // Resetear estado por si acaso
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }
}
activarGPS();

// --- 4. PROCESAMIENTO Y VALIDACIÓN (FECHA EXIF + GPS NAVEGADOR) ---
document.getElementById("cameraInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // BLOQUEO GPS NAVEGADOR: Verificamos señal activa (máximo 20s de antigüedad)
    const señalGpsReciente = coordsActuales && (Date.now() - coordsActuales.timestamp < 20000);

    if (!señalGpsReciente) {
        alert("❌ SEÑAL GPS DÉBIL: Asegúrate de que el recuadro verde indique 'GPS Activo' antes de capturar.");
        e.target.value = "";
        return; 
    }

    btnPrincipal.disabled = true;
    btnPrincipal.innerHTML = `<span class="spinner-border spinner-border-sm"></span> CERTIFICANDO...`;
    statusTxt.innerText = "Validando integridad temporal...";

    try {
        const exifData = await obtenerExif(file);
        const horaDispositivo = new Date();
        const horaFoto = exifData.DateTime ? parseExifDate(exifData.DateTime) : new Date(file.lastModified);

        // --- 1. CÁLCULO DE DIFERENCIA DE TIEMPO ---
        const desfaseTiempo = Math.abs((horaDispositivo - horaFoto) / 1000);
        
        // --- 2. VALIDACIÓN CRÍTICA ---
        // Si la foto se tomó hace más de 2 minutos respecto al reloj del sistema, se considera fraude.
        if (desfaseTiempo > 120) {
            throw new Error("FRAUDE DETECTADO: La hora de captura no coincide con la hora actual.");
        }

        // --- 3. PREPARACIÓN DE SEGURIDAD (OPTIMIZACIÓN Y LUEGO HASH) ---
        statusTxt.innerText = "Procesando imagen...";
        
        // PRIMERO: Comprimimos la imagen para obtener el archivo FINAL
        const fotoBase64 = await procesarImagen(file);

        // SEGUNDO: Preparamos la imagen comprimida para generar su Hash
        // Extraemos solo los datos base64 (quitando el encabezado data:image/jpeg;base64,)
        const base64Data = fotoBase64.split(',')[1];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        
        statusTxt.innerText = "Sellando evidencia...";
        
        // TERCERO: Generamos el Hash sobre los bytes de la imagen ya comprimida
        const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
        const hash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");

        // --- 4. SUBIDA A FIRESTORE ---
        const folio = "VP-" + Date.now();
        await addDoc(collection(db, "evidencias"), {
            folio: folio,
            hash: hash,
            foto: fotoBase64,
            
            // Ubicación REAL del navegador (Obligatoria)
            lat: coordsActuales.latitude,
            lon: coordsActuales.longitude,
            precision: coordsActuales.accuracy,
            
            // Validación de Tiempo
            exif_fecha: horaFoto.toISOString(),
            fecha_celular: horaDispositivo.toISOString(),
            fecha_servidor: serverTimestamp(),
            desfase_segundos: Math.round(desfaseTiempo),
            
            // Datos EXIF de ubicación (Se guardan como N/A para evitar errores de permisos)
            exif_lat: "NO_SOLICITADO",
            verificado: true
        });

        // --- 5. ÉXITO ---
        mostrandoExito = true;
        statusTxt.className = "status-box bg-success text-white px-2";
        statusTxt.innerHTML = `✅ CERTIFICADA <code class="d-block text-white">${folio}</code>`;
        btnPrincipal.disabled = false;
        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> NUEVA CAPTURA`;
        btnPrincipal.className = "btn btn-outline-primary w-100 mb-3";

    } catch (error) {
        // Si el error es por GPS, dejamos que activarGPS() maneje la interfaz
        // Pero si es otro error (como el desfase de tiempo), mostramos la alerta
        if (!coordsActuales) {
            statusTxt.innerHTML = `<i class="bi bi-geo-off text-danger"></i> Error: Ubicación perdida`;
            statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";
            btnPrincipal.disabled = true;
        } else {
            alert(`❌ ERROR DE CERTIFICACIÓN\n${error.message}`);
            statusTxt.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Reintente la captura`;
            btnPrincipal.disabled = false;
        }
        
        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> REINTENTAR`;
        e.target.value = "";
    }
});

// --- FUNCIONES TÉCNICAS OPTIMIZADAS ---
function obtenerExif(file) {
    return new Promise((resolve) => {
        EXIF.getData(file, function() {
            resolve(EXIF.getAllTags(this));
        });
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
