if (window.top !== window.self) {
document.body.innerHTML = "<h1>Acceso Bloqueado</h1><p>Esta aplicación no puede ejecutarse dentro de un marco externo por razones de seguridad.</p>";
throw new Error("Intento de ejecución en iframe detectado.");
}

function obtenerDeviceId() {
    let deviceId = localStorage.getItem("vp_device_id") 
        || sessionStorage.getItem("vp_device_id");

    if (!deviceId) {
        deviceId = crypto.randomUUID();
    }
    
    localStorage.setItem("vp_device_id", deviceId);
    sessionStorage.setItem("vp_device_id", deviceId);

    return deviceId;
}

const toastLive = document.getElementById('liveToast');
const toastMsg = document.getElementById('toastMsg');
const toastHeader = document.getElementById('toastHeader');
const bsToast = new bootstrap.Toast(toastLive, {
    autohide: false
});

function mostrarNotificacion(mensaje, tipo = 'danger') {
    bsToast.hide();
    setTimeout(() => {
        toastHeader.className = `toast-header bg-${tipo} text-white`;
        toastMsg.innerHTML = mensaje;
        bsToast.show();
    }, 300);
}

const esIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

function verificarCompatibilidadModelo() {
    const isIPhone = /iPhone/i.test(navigator.userAgent);
    const height = window.screen.height;
    const width = window.screen.width;
    const pr = window.devicePixelRatio;
    const esModeloLimitado = isIPhone && (height === 812 || width === 812) && pr === 3;
    if (esModeloLimitado) {
      mostrarNotificacion("ADVERTENCIA DE COMPATIBILIDAD:<br><br>Es posible que su dispositivo no sea totalmente compatible con los sistemas de verificación de VeriPhoto. Si experimenta errores, asegúrese de usar un iPhone 11 o superior.", "warning");
    }
}

verificarCompatibilidadModelo();

let coordsActuales = null;
let movActual = { x: 0, y: 0, z: 0 };
let sensorActivo = false;
let mostrandoExito = false;
let metricaFlatness = 0;
let metricaEnergia = 0;
let metricaVariacionG = 0;
let verificadoPorAgite = false;
let lecturasAccel = [];
let lecturasGyro = [];  
let ultimoRegistro = 0;
let analizando = false; 
let estadoUI = "inicial";
let tiempoLecturaConcluido = false;
let gpsEsReciente = false;
let watchId = null; 

const statusTxt = document.getElementById("status");
const btnPrincipal = document.getElementById("btnPrincipal");

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

if (estadoUI === "gps_debil") return; 

const acc = event.accelerationIncludingGravity;  
    const rot = event.rotationRate;  
    if (!acc || !rot || !coordsActuales) return;  
    sensorActivo = true;  
    const ahora = Date.now();  
    if (ahora - ultimoRegistro > 20) {  
        const ax = acc.x ?? 0; const ay = acc.y ?? 0; const az = acc.z ?? 0;  
        const rx = rot.alpha ?? 0; const ry = rot.beta ?? 0; const rz = rot.gamma ?? 0;  
        const fuerzaAcc = Math.sqrt(ax*ax + ay*ay + az*az);  
        const fuerzaRot = Math.sqrt(rx*rx + ry*ry + rz*rz);  
        lecturasAccel.push(fuerzaAcc);  
        lecturasGyro.push(fuerzaRot);  
        ultimoRegistro = ahora;  
        if (lecturasAccel.length > 64) {  
            lecturasAccel.shift();  
            lecturasGyro.shift();  
        } 
if (lecturasAccel.length < 64 && estadoUI !== "agitando" && !verificadoPorAgite) {
actualizarUI(
"agitando",
`<i class="bi bi-phone-vibrate text-primary"></i> Agite el teléfono 1s para continuar`,
"bg-primary-subtle text-primary border border-primary-subtle"
);
}
}
if (lecturasAccel.length === 64 && !analizando) {
analizando = true;
ejecutarValidacionPro();
}
});
}

function ejecutarValidacionPro() {
const variacionGyro = Math.max(...lecturasGyro) - Math.min(...lecturasGyro);
const sensorMuerto = lecturasGyro.every(v => v === 0);

if (sensorMuerto || variacionGyro < 0.01) {  
lecturasAccel = []; lecturasGyro = [];  
analizando = false;  
statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";  
statusTxt.innerHTML = `<i class="bi bi-robot"></i> Error: Sensores inactivos o emulados.`;  
return;  
}  
const EPS = 1e-6;  
const promedio = lecturasAccel.reduce((a, b) => a + b, 0) / lecturasAccel.length;  
const centradas = lecturasAccel.map(v => v - promedio);  

let energia = 0;  
for (let i = 1; i < centradas.length; i++) {  
    energia += Math.pow(centradas[i] - centradas[i - 1], 2);  
}  
energia /= centradas.length;  

const mediaArit = centradas.reduce((a, b) => a + Math.abs(b), 0) / centradas.length;  
const sumaLog = centradas.reduce((a, b) => a + Math.log(Math.abs(b) + EPS), 0);  
const mediaGeom = Math.exp(sumaLog / centradas.length);  
const flatness = mediaGeom / (mediaArit + EPS);  

let energiaG = 0;  
for (let i = 1; i < lecturasGyro.length; i++) {  
    energiaG += Math.pow(lecturasGyro[i] - lecturasGyro[i - 1], 2);  
}  
const resGyro = energiaG / lecturasGyro.length;

metricaFlatness = flatness;
metricaEnergia = energia;
metricaVariacionG = variacionGyro;

if (flatness > 0.5 && energia > 150 && resGyro > 0.8) {  
verificadoPorAgite = true;  
  
actualizarUI(  
    "verificado",  
    `<i class="bi bi-shield-check"></i> Identidad Física Confirmada`,  
    "bg-primary-subtle text-primary border border-primary-subtle"  
);  

setTimeout(() => {  
    tiempoLecturaConcluido = true;   
    console.log("Refrescando señal GPS...");  
}, 1000);

} else {
lecturasAccel = [];
lecturasGyro = [];
estadoUI = "inicial";
}
analizando = false;
}

function activarGPS() {
if ("geolocation" in navigator) {
watchId = navigator.geolocation.watchPosition(
(pos) => {
    const precision = pos.coords.accuracy;
    coordsActuales = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: precision,
        timestamp: Date.now()
    };

    // 1. SI LA PRECISIÓN ES MALA (> 30m)
    if (precision > 5) {
        gpsEsReciente = false;
        btnPrincipal.disabled = true; // Bloqueo de seguridad
        btnPrincipal.innerHTML = `<i class="bi bi-geo-fill"></i> BUSCANDO PRECISIÓN...`;
        
        actualizarUI(
            "gps_debil",
            `<i class="bi bi-exclamation-triangle-fill text-warning"></i> Señal débil (±${Math.round(precision)}m). <br>Se requiere menos de 30m.`,
            "bg-warning-subtle text-warning border border-warning-subtle"
        );

        if (!window.avisoGpsDebil) {
            window.avisoGpsDebil = true;
        }
        return; // Detenemos aquí: No dejamos que pase a los siguientes estados
    }

    // 2. SI LA PRECISIÓN ES BUENA (< 30m)
    window.avisoGpsDebil = false;
    
    if (!verificadoPorAgite) {
        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
        // Mantenemos btnPrincipal.disabled = true; porque falta el agite
    }

    // Lógica para Android y para el Paso Final de iPhone
    if (tiempoLecturaConcluido && !gpsEsReciente) {
        gpsEsReciente = true; 
        estadoUI = "gps";

        actualizarUI(  
            "gps",  
            `<i class="bi bi-geo-alt-fill text-success"></i> GPS Activo (±${Math.round(precision)}m)`,  
            "bg-success-subtle text-success border border-success-subtle"  
        );  
        
        btnPrincipal.disabled = false;  
        btnPrincipal.className = "btn btn-primary w-100 shadow";  
        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`; 
        btnPrincipal.onclick = () => document.getElementById('cameraInput').click(); 
    } else {
        // Mantenemos la UI actualizada con la precisión actual aunque no esté listo el agite
        actualizarUI(  
            "gps",  
            `<i class="bi bi-geo-alt-fill text-success"></i> GPS Activo (±${Math.round(precision)}m)`,  
            "bg-success-subtle text-success border border-success-subtle"  
        );
    }
}, (error) => {  
    coordsActuales = null;  
    actualizarUI(  
        "error",   
        `<i class="bi bi-geo-off"></i> Error: Activa tu ubicación`,   
        "bg-danger-subtle text-danger border border-danger-subtle"  
    );  
    btnPrincipal.disabled = true;  
    btnPrincipal.innerHTML = `<span class="spinner-border spinner-border-sm"></span> Esperando GPS...`;  
    
    console.warn("Error de Geolocalización:", error.message);

    // Lógica de reintento automático (Segura para Safari y Android)
    if (!window.reintentandoGPS) {
        window.reintentandoGPS = true;
        const intervaloReintento = setInterval(() => {
            // Intentamos una lectura rápida para ver si ya activaron el GPS
            navigator.geolocation.getCurrentPosition(
                () => {
                    // ¡Éxito! El GPS ya está encendido
                    clearInterval(intervaloReintento);
                    window.reintentandoGPS = false;
                    activarGPS(); // Reinicia el watchPosition normal
                },
                () => {
                    // Sigue apagado, no hacemos nada y esperamos al siguiente ciclo
                    console.log("GPS sigue desactivado...");
                },
                { enableHighAccuracy: true, timeout: 2000 }
            );
        }, 3000); // Reintenta cada 3 segundos
    }
},
{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
);
} else {
statusTxt.innerText = "GPS no soportado en este navegador";
}
}
async function checarIntegridadHardware() {
if (!verificadoPorAgite) {
throw new Error("ERROR DE SEGURIDAD: Prueba de movimiento no completada.");
}

if (!sensorActivo) {  
    throw new Error("HARDWARE NO DETECTADO: Sensores inactivos.");  
}  

if (coordsActuales && coordsActuales.accuracy < 0.5) {  
    throw new Error("GPS FALSO DETECTADO: Señal artificial.");  
}  
return true;
}

document.getElementById("cameraInput").addEventListener("change", async (e) => {
const file = e.target.files[0];
if (!file) return;

if (!coordsActuales) {  
    statusTxt.innerHTML = `<i class="bi bi-geo-off text-danger"></i> Error: Activa tu ubicación`;  
    statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";  
    btnPrincipal.disabled = true;  
    btnPrincipal.innerHTML = `Esperando GPS...`;  
    e.target.value = "";  
    return;  
}  

const señalGpsReciente = (Date.now() - coordsActuales.timestamp < 10000);

if (!señalGpsReciente) {
    mostrarNotificacion("SEÑAL GPS ANTIGUA.<br><br>Espera un momento a que se actualice.", "danger");
    e.target.value = "";  
    return;   
}  
btnPrincipal.disabled = true;  
btnPrincipal.innerHTML = `<span class="spinner-border spinner-border-sm"></span> VALIDANDO...`;  

try {
    btnPrincipal.disabled = true;
    mostrandoExito = true; 
    btnPrincipal.innerHTML = `<span class="spinner-border spinner-border-sm"></span> CERTIFICANDO...`;
    statusTxt.innerText = "Verificando sensores físicos...";
    statusTxt.className = "status-box bg-info-subtle text-info border border-info-subtle";
    await checarIntegridadHardware();
    const exifData = await obtenerExif(file);
    const horaDispositivo = new Date();
    const horaFoto = exifData.DateTime ? parseExifDate(exifData.DateTime) : new Date(file.lastModified);
    const desfaseTiempo = Math.abs((horaDispositivo - horaFoto) / 1000);

    if (desfaseTiempo > 10) {
        throw new Error("FRAUDE TEMPORAL: La foto no es reciente.");
    }
    statusTxt.innerText = "Sellando evidencia...";
    const fotoBase64 = await procesarImagen(file);

const challengeRes = await fetch("https://veriphoto-guardia.vercel.app/api/challenge");
const challengeData = await challengeRes.json();

const nonce = challengeData.nonce;
const timestamp = challengeData.timestamp;
const firma = challengeData.firma;

const base64Data = fotoBase64.split(',')[1];
const binaryString = atob(base64Data);
const bytes = new Uint8Array(binaryString.length);
for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
}
const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
const hash = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
    
const deviceId = obtenerDeviceId();

const validationUrl = "https://veriphoto-guardia.vercel.app/api/validate";

const response = await fetch(validationUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        nonce,
        timestamp,
        firma,
        hash,
        foto: fotoBase64,
        lat: coordsActuales.latitude,
        lon: coordsActuales.longitude,
        precision_gps: coordsActuales.accuracy,
        exif_fecha: horaFoto.toISOString(),
        fecha_celular: horaDispositivo.toISOString(),
        desfase_segundos: Math.round(desfaseTiempo),
        atestacion_hardware: {
            flatness_caos: metricaFlatness,
            energia_dinamica: metricaEnergia,
            variacion_giroscopio: metricaVariacionG,
            muestras_analizadas: 64,
            intervalo_ms: 20,
            deviceId,
        }
    })
});
// 1. LEEMOS EL JSON DE LA RESPUESTA (Solo una vez)
const result = await response.json();

// 2. SI EL SERVIDOR RESPONDIÓ CON ERROR (429 de límite, etc.)
if (!response.ok) {
    // IMPORTANTE: Lanzamos el objeto completo como texto para el catch
    throw new Error(JSON.stringify(result));
}
    console.log("✅ Éxito! Folio:", result.folio);
    
    detenerTodoElSistema();
    
    btnPrincipal.innerHTML = `<i class="bi bi-shield-check"></i> GUARDADO CON ÉXITO`;
    statusTxt.innerText = "Certificación completada correctamente";
    statusTxt.className = "status-box bg-success-subtle text-success border border-success-subtle";

    actualizarUI(
        "exito",
        `FOTO CERTIFICADA <br><div class="d-flex align-items-center justify-content-center gap-2">
            <code class="fs-5 text-white" id="folioDisplay">${result.folio}</code>
            <button id="btnCopiarFolio" class="btn btn-outline-light btn-sm" style="padding: 0.2rem 0.4rem; font-size: 0.75rem;" title="Copiar folio">
                <i class="bi bi-copy"></i>
            </button>
        </div>`,
        "bg-success text-white px-2 shadow-sm"
    );

    const btnCopiar = document.getElementById("btnCopiarFolio");
    if (btnCopiar) {
        btnCopiar.onclick = () => {
            navigator.clipboard.writeText(result.folio).then(() => {
                const icono = btnCopiar.querySelector("i");
                icono.classList.replace("bi-copy", "bi-check-lg");
                btnCopiar.classList.replace("btn-outline-light", "btn-success");
                setTimeout(() => {
                    icono.classList.replace("bi-check-lg", "bi-copy");
                    btnCopiar.classList.replace("btn-success", "btn-outline-light");
                }, 2000);
            }).catch(err => console.error('Error al copiar:', err));
        };
    }

    verificadoPorAgite = false;
    sensorActivo = false;
    lecturasAccel = [];
    lecturasGyro = [];
    ultimoRegistro = 0;
    analizando = false;
    metricaFlatness = 0;
    metricaEnergia = 0;
    metricaVariacionG = 0;

    btnPrincipal.disabled = false;
    btnPrincipal.style.backgroundColor = "#0d6efd";
    btnPrincipal.style.borderColor = "#0d6efd";
    btnPrincipal.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i> FINALIZAR`;
    btnPrincipal.onclick = () => { window.location.reload(); };

} catch (error) {
    console.error("Error:", error);

    let mensajeError = error.message;
    let segundosFaltantes = 60; // Por defecto si algo falla

    // Intentamos extraer los datos del JSON que enviamos en el throw
    try {
        const objetoError = JSON.parse(error.message);
        mensajeError = objetoError.error; // "Límite alcanzado"
        segundosFaltantes = objetoError.segundos; // El número exacto (ej. 24)
    } catch (e) {
        // Si no es un JSON, el mensaje se queda como estaba
    }

    if (mensajeError.includes("Límite") || mensajeError.includes("Actividad")) {
      
      mostrarNotificacion(`${mensajeError}<br><br>Reintenta en <b>${segundosFaltantes}s</b>.`, "warning");

        let restante = segundosFaltantes;
        btnPrincipal.disabled = true;

        const cuentaRegresiva = setInterval(() => {
            if (restante <= 0) {
                clearInterval(cuentaRegresiva);
                
                btnPrincipal.disabled = false;
                setTimeout(() => {
        btnPrincipal.blur();
        window.focus(); // Esto le quita el foco al botón y se lo da a la ventana
    }, 1000);
                btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
            } else {
                btnPrincipal.innerHTML = `<i class="bi bi-hourglass-split"></i> ESPERA ${restante}s...`;
                restante--;
            }
        }, 1000);

    // 2. CASO: SENSORES
    } else if (error.message.includes("Sensores inactivos")) {
        mostrarNotificacion("ERROR:<br><br>Se necesita acceso a los sensores de movimiento.", "danger");
        statusTxt.innerHTML = `<i class="bi bi-shield-slash text-danger"></i> Permiso denegado`;
        statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";
        prepararReintentoRapido();

    // 3. CASO: GPS
    } else if (!coordsActuales) {
        statusTxt.innerHTML = `<i class="bi bi-geo-off text-danger"></i> Error: Ubicación perdida`;
        statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";
        prepararReintentoRapido();

    // 4. OTROS ERRORES (Integridad, etc)
    } else {
        mostrarNotificacion(`ERROR DE SEGURIDAD:<br><br>${error.message}`, "danger");
        statusTxt.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Error de integridad`;
        statusTxt.className = "status-box bg-warning-subtle text-warning border border-warning-subtle";
        prepararReintentoRapido();
    }

    // Función auxiliar para no repetir código en errores comunes
    function prepararReintentoRapido() {
        btnPrincipal.disabled = true;
        btnPrincipal.innerHTML = `<i class="bi bi-arrow-clockwise"></i> Reiniciando...`;
        setTimeout(() => {
            btnPrincipal.disabled = false;
            btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
            mostrandoExito = false;
        }, 3000);
    }

    e.target.value = ""; // Limpiar el input de cámara
}
}); 

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

function actualizarUI(nuevoEstado, mensaje, clase) {
    // 1. Prioridad Máxima: Estados finales (No se tocan por nada)
    const estadosFinales = ["verificado", "procesando", "exito"];
    if (estadosFinales.includes(estadoUI) && !estadosFinales.includes(nuevoEstado)) {  
        return;   
    }

    // 2. Prioridad de Bloqueo: Si el GPS es malo, PROHIBIMOS cualquier otro mensaje
    // que no sea una actualización del propio GPS débil.
    if (estadoUI === "gps_debil" && nuevoEstado !== "gps_debil") {
        // Solo permitimos salir de aquí si el nuevo estado es "gps" (que significa precisión < 30m)
        if (nuevoEstado !== "gps") {
            return; 
        }
    }

    // 3. Prioridad de Instrucción: Si el GPS ya es bueno, pero falta el agite,
    // mantenemos el mensaje de agite y bloqueamos que el GPS lo sobrescriba.
    if (nuevoEstado === "gps" && !verificadoPorAgite && sensorActivo) {
        // Si ya estamos mostrando el mensaje de agite, no dejamos que el GPS lo quite
        if (estadoUI === "agitando") {
            return;
        }
    }

    // 4. Aplicar el cambio si pasó todos los filtros
    estadoUI = nuevoEstado;  
    statusTxt.className = `status-box ${clase}`;  
    statusTxt.innerHTML = mensaje;
}

function detenerTodoElSistema() {
    // 1. Detenemos el GPS
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    // 2. Detenemos los reintentos automáticos si existen
    if (window.reintentandoGPS) {
        clearInterval(window.reintentandoGPS);
        window.reintentandoGPS = false;
    }
    // 3. Los sensores ya tienen el 'if (mostrandoExito) return', así que están cubiertos.
}

window.activarSensores = activarSensores;

if (esIOS) {
    let pasoPermisos = 1;
    btnPrincipal.disabled = false;
    btnPrincipal.innerHTML = `<i class="bi bi-shield-lock"></i> PASO 1: SENSORES`;
    btnPrincipal.onclick = async () => {
        if (pasoPermisos === 1) {
            if (typeof DeviceMotionEvent.requestPermission === 'function') {
                try {
                    const permiso = await DeviceMotionEvent.requestPermission();
                    if (permiso === 'granted') {
                        iniciarEscuchaMovimiento(); 
                        pasoPermisos = 2;
                        btnPrincipal.innerHTML = `<i class="bi bi-geo-alt"></i> PASO 2: UBICACIÓN`;
                        statusTxt.innerHTML = `<i class="bi bi-check-circle text-success"></i> Sensores OK.`;
                    }
   } catch (e) { mostrarNotificacion("Error en sensores", "danger"); }
            }
        } else if (pasoPermisos === 2) {
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
            if (verificadoPorAgite) {
                pasoPermisos = 3;
                btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
                btnPrincipal.disabled = false;
                btnPrincipal.onclick = () => document.getElementById('cameraInput').click();
                statusTxt.innerHTML = `<i class="bi bi-shield-check text-success"></i> Listo para capturar`;
            } else {
                statusTxt.innerHTML = `<i class="bi bi-phone-vibrate text-primary"></i> Agite el teléfono 1s para continuar`;
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
            mostrarNotificacion("Safari bloqueó la solicitud. Por favor, intenta dar clic de nuevo o recarga la página.", "warning");
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
    activarGPS();
    activarSensores();
}