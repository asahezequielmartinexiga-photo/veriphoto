import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// 1. CONFIGURACIÓN DE FIREBASE
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

let selectedFile;
let coordsActuales = null;
const statusTxt = document.getElementById("status");

// --- 2. BLOQUEO DE ESCRITORIO (Solo Celulares) ---
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (!isMobile) {
    document.body.innerHTML = "<h1>🚫 ACCESO DENEGADO</h1><p>VeriPhoto solo funciona en dispositivos móviles para garantizar la integridad del GPS.</p>";
    throw new Error("PWA bloqueada en PC");
}

// --- 3. ACTIVACIÓN ANTICIPADA DEL GPS ---
// Esto hace que el celular pida permiso apenas abras la app
function activarGPS() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            (pos) => {
                coordsActuales = pos.coords;
                statusTxt.innerText = `GPS Conectado (Precisión: ${Math.round(pos.coords.accuracy)}m) ✅`;
                statusTxt.style.color = "green";
            },
            (err) => {
                statusTxt.innerText = "⚠️ Error: Activa la ubicación en tu celular.";
                statusTxt.style.color = "red";
            },
            { enableHighAccuracy: true }
        );
    }
}
activarGPS();

// --- 4. VALIDACIÓN DE CAPTURA (CÁMARA EN VIVO) ---
document.getElementById("cameraInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    const ahora = Date.now();
    const tiempoArchivo = file.lastModified;
    const desfase = (ahora - tiempoArchivo) / 1000;

    // Si la foto tiene más de 120 segundos, se rechaza
    if (desfase > 120) {
        alert("❌ ERROR: La foto no es reciente. Debes capturarla en vivo.");
        e.target.value = "";
        selectedFile = null;
    } else {
        selectedFile = file;
        statusTxt.innerText = "Foto capturada y validada temporalmente.";
    }
});

// --- 5. OPTIMIZACIÓN Y COMPRESIÓN (1600x1200 @ 70%) ---
async function optimizarImagen(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 1600;
                let width = img.width;
                let height = img.height;
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
        };
    });
}

// --- 6. SUBIDA FINAL CON TRIPLE TIEMPO ---
window.subirEvidencia = async function() {
    if(!selectedFile) return alert("Primero captura una foto.");
    if(!coordsActuales) return alert("Esperando señal de GPS...");

    statusTxt.innerText = "Certificando evidencia...";

    try {
        const fotoBase64 = await optimizarImagen(selectedFile);
        
        // Generar Hash SHA-256 para integridad del archivo
        const buffer = await selectedFile.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
        
        const folio = "VP-" + Date.now();

        // Subida a Firestore
        await addDoc(collection(db, "evidencias"), {
            folio: folio,
            hash: hash,
            lat: coordsActuales.latitude,
            lon: coordsActuales.longitude,
            precision: coordsActuales.accuracy,
            foto: fotoBase64,
            fecha_celular: new Date().toISOString(),
            fecha_servidor: serverTimestamp(), // EL SELLO DE VERDAD
            verificado: true
        });

        statusTxt.innerText = "✅ ¡Éxito! Folio: " + folio;
        alert("Evidencia guardada correctamente con sello de tiempo.");
    } catch (error) {
        console.error(error);
        alert("Error al subir. Revisa tu conexión.");
    }
};
