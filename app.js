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

const _sensor_calibration_data = [
    "00af829c1b", "12de458f9a", "88bc321a5e", "44fe992b1d", "66aa773c2f",
    "33bb884d3e", "99cc115e4a", "55dd226f5b", "77ee337a6c", "11ff448b7d"
];
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
let intervaloGuardia = null; 

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
       
    if (estadoUI === "exito") return; 
    const precision = pos.coords.accuracy;
    coordsActuales = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: precision,
        timestamp: Date.now()
    };

    if (precision > 30) {
        gpsEsReciente = false;
        btnPrincipal.disabled = true; 
        btnPrincipal.innerHTML = `<i class="bi bi-geo-fill"></i> BUSCANDO PRECISIÓN...`;
        
        actualizarUI(
            "gps_debil",
            `<i class="bi bi-exclamation-triangle-fill text-warning"></i> Señal débil (±${Math.round(precision)}m). <br>Se requiere menos de 30m.`,
            "bg-warning-subtle text-warning border border-warning-subtle"
        );

        if (!window.avisoGpsDebil) {
            window.avisoGpsDebil = true;
        }
        return; 
    }

    window.avisoGpsDebil = false;
    
    if (!verificadoPorAgite) {
        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
    }

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
        `Ubicación desactivada. <br>Verifica tu conexión.`,
        "bg-danger-subtle text-danger border border-danger-subtle"  
    );  
    btnPrincipal.disabled = true;  
    btnPrincipal.innerHTML = `<i class="bi bi-geo-fill"></i> GPS REQUERIDO`;
    
    console.warn("Error de Geolocalización:", error.message);

    if (!window.reintentandoGPS) {
        window.reintentandoGPS = true;
        const intervaloReintento = setInterval(() => {
            navigator.geolocation.getCurrentPosition(
                () => {
                    clearInterval(intervaloReintento);
                    window.reintentandoGPS = false;
                    activarGPS(); 
                },
                () => {
                    console.log("GPS sigue desactivado...");
                },
                { enableHighAccuracy: true, timeout: 1500 }
            );
        }, 2000); 
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

mostrandoExito = true; 

if (!coordsActuales) {  
  statusTxt.innerHTML = `Ubicación desactivada. <br>Verifica tu conexión.`,
  statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";  
  btnPrincipal.disabled = true;  
  btnPrincipal.innerHTML = `<i class="bi bi-geo-fill"></i> GPS REQUERIDO`;  
  e.target.value = "";  
  mostrandoExito = false; 
  iniciarGuardiaGPS();
  return;  
}  

const señalGpsReciente = (Date.now() - coordsActuales.timestamp < 10000);

if (!señalGpsReciente) {
  mostrarNotificacion("SEÑAL GPS ANTIGUA.<br><br>Espera un momento a que se actualice.", "danger");
  e.target.value = "";  
  mostrandoExito = false;
  iniciarGuardiaGPS();
  return;   
}

if (coordsActuales.accuracy > 30) {
    mostrarNotificacion("PRECISIÓN DE GPS INSUFICIENTE.<br><br>La señal GPS es de ±" + Math.round(coordsActuales.accuracy) + "m. Se requiere menos de 30m para certificar.", "danger");
    
    e.target.value = ""; 
    mostrandoExito = false;
    btnPrincipal.disabled = false;
    btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
    
    iniciarGuardiaGPS();
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
    
actualizarUI("procesando", "Por favor espera", "bg-info-subtle text-info border border-info-subtle");

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

const _profile_idx = Math.floor(Math.random() * _sensor_calibration_data.length);
const _active_profile = _sensor_calibration_data[_profile_idx];

const _encoder = new TextEncoder();
const _meta_segment = _encoder.encode(_active_profile);

const _blob_stream = new Uint8Array(bytes.length + _meta_segment.length);
_blob_stream.set(bytes); 
_blob_stream.set(_meta_segment, bytes.length); 

const _check_buffer = await crypto.subtle.digest("SHA-256", _blob_stream);
const hash = Array.from(new Uint8Array(_check_buffer))
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
        pid: _profile_idx,
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

const result = await response.json();

if (!response.ok) {
    throw new Error(JSON.stringify(result));
}
    console.log("✅ Éxito! Folio:", result.folioHMAC);
    
    detenerTodoElSistema();

    actualizarUI(
        "exito",
        `FOTO CERTIFICADA <br><div class="d-flex align-items-center justify-content-center gap-2">
            <code class="fs-5 text-white" id="folioDisplay">${result.folioHMAC}</code>
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
    
    mostrandoExito = false; 
    estadoUI = "inicial"; 
    iniciarGuardiaGPS(); 

    let mensajeError = error.message;
    let segundosFaltantes = 60; 
    try {
        const objetoError = JSON.parse(error.message);
        mensajeError = objetoError.error; 
        segundosFaltantes = objetoError.segundos; 
    } catch (e) {

    }

    if (mensajeError.includes("Límite") || mensajeError.includes("Actividad")) {
      
      mostrarNotificacion(`${mensajeError}<br><br>Reintenta en <b>${segundosFaltantes}s</b>.`, "warning");

        let restante = segundosFaltantes;
        btnPrincipal.disabled = true;

        const cuentaRegresiva = setInterval(() => {
    if (restante <= 0) {
        clearInterval(cuentaRegresiva);
        
        if (coordsActuales && (Date.now() - coordsActuales.timestamp < 10000)) {
            btnPrincipal.disabled = false;
            btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
        }
    } else {
        btnPrincipal.innerHTML = `<i class="bi bi-hourglass-split"></i> ESPERA ${restante}s...`;
        restante--;
    }
}, 1000);

    } else if (error.message.includes("Sensores inactivos")) {
        mostrarNotificacion("ERROR:<br><br>Se necesita acceso a los sensores de movimiento.", "danger");
        statusTxt.innerHTML = `<i class="bi bi-shield-slash text-danger"></i> Permiso denegado`;
        statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";
        prepararReintentoRapido();

    } else if (!coordsActuales) {
        statusTxt.innerHTML = `Ubicación desactivada. <br>Verifica tu conexión.`,
        statusTxt.className = "status-box bg-danger-subtle text-danger border border-danger-subtle";
        prepararReintentoRapido();

    } else {
        mostrarNotificacion(`ERROR DE SEGURIDAD:<br><br>${error.message}`, "danger");
        statusTxt.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Error de integridad`;
        statusTxt.className = "status-box bg-warning-subtle text-warning border border-warning-subtle";
        prepararReintentoRapido();
    }

    function prepararReintentoRapido() {

    btnPrincipal.disabled = true;
    btnPrincipal.innerHTML = `<i class="bi bi-arrow-clockwise"></i> Reiniciando...`;

    setTimeout(() => {
        mostrandoExito = false; 
        
        iniciarGuardiaGPS();

        btnPrincipal.disabled = false;
        btnPrincipal.innerHTML = `<i class="bi bi-camera-fill"></i> CAPTURAR Y CERTIFICAR`;
    }, 3000);
}

    e.target.value = ""; 
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

    if (estadoUI === "exito" || (estadoUI === "procesando" && nuevoEstado !== "exito")) {
        return; 
    }

    const estadosFinales = ["verificado", "procesando", "exito"]; 
    if (estadosFinales.includes(estadoUI) && !estadosFinales.includes(nuevoEstado)) {  
        return;   
    }

    if (estadoUI === "gps_debil" && nuevoEstado !== "gps_debil") {
        if (nuevoEstado !== "gps") {
            return; 
        }
    }

    if (nuevoEstado === "gps" && !verificadoPorAgite && sensorActivo) {
        if (estadoUI === "agitando") {
            return;
        }
    }

    estadoUI = nuevoEstado;  
    statusTxt.className = `status-box ${clase}`;  
    statusTxt.innerHTML = mensaje;
}

function detenerTodoElSistema() {

    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    if (window.reintentandoGPS) {
        clearInterval(window.reintentandoGPS);
        window.reintentandoGPS = false;
    }
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
            iniciarGuardiaGPS();
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
    iniciarGuardiaGPS();
}

function iniciarGuardiaGPS() {
  
    if (intervaloGuardia) {
        clearInterval(intervaloGuardia);
    }

    intervaloGuardia = setInterval(() => {
        if (estadoUI === "exito") return;

        if (mostrandoExito) return; 

        const ahora = Date.now();

        if (!coordsActuales) {
            activarModoErrorGPS("Ubicación desactivada");
            return;
        }

        if (ahora - coordsActuales.timestamp > 10000) {
            activarModoErrorGPS("Señal GPS perdida o congelada");
            return;
        }
    }, 2000);
}

function activarModoErrorGPS(motivo) {
    gpsEsReciente = false;
    
    btnPrincipal.disabled = true;
    btnPrincipal.innerHTML = `<i class="bi bi-geo-fill"></i> GPS REQUERIDO`;

    actualizarUI(
        "gps_debil",
        `${motivo}. <br>Verifica tu conexión.`,
        "bg-danger-subtle text-danger border border-danger-subtle"
    );
}
