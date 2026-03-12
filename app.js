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

let selectedFile;
const statusTxt = document.getElementById("status");

// --- 1. CAPA DE SEGURIDAD: BLOQUEO DE ESCRITORIO ---
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (!isMobile) {
    document.body.innerHTML = "<h1>🚫 ACCESO DENEGADO</h1><p>Esta PWA solo funciona en dispositivos móviles para garantizar la integridad del GPS y la Cámara.</p>";
    throw new Error("Aplicación bloqueada en PC");
}

// --- 2. CAPA DE SEGURIDAD: VALIDACIÓN DE CAPTURA EN VIVO ---
document.getElementById("cameraInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    const ahora = Date.now();
    const tiempoArchivo = file.lastModified;
    const desfase = (ahora - tiempoArchivo) / 1000; // Segundos

    if (desfase > 120) { // Máximo 2 minutos de antigüedad
        alert("⚠️ ERROR: La foto no es reciente. Debes capturarla en vivo desde la app.");
        e.target.value = "";
        selectedFile = null;
        statusTxt.innerText = "Error: Intento de subir foto vieja.";
    } else {
        selectedFile = file;
        statusTxt.innerText = "Foto capturada y validada temporalmente.";
    }
});

// --- 3. OPTIMIZACIÓN (1600x1200 @ 70%) ---
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

// --- 4. HASH Y SUBIDA FINAL ---
window.subirEvidencia = async function() {
    if(!selectedFile) return alert("Captura una foto primero.");
    
    statusTxt.innerText = "Verificando autenticidad...";

    navigator.geolocation.getCurrentPosition(async (pos) => {
        // Leemos metadatos EXIF
        EXIF.getData(selectedFile, async function() {
            const fechaExif = EXIF.getTag(this, "DateTimeOriginal") || "Captura Directa";
            
            try {
                const fotoBase64 = await optimizarImagen(selectedFile);
                const buffer = await selectedFile.arrayBuffer();
                const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
                const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
                
                const folio = "VP-" + Date.now();

                await addDoc(collection(db, "evidencias"), {
                    folio: folio,
                    hash: hash,
                    lat: pos.coords.latitude,
                    lon: pos.coords.longitude,
                    precision: pos.coords.accuracy,
                    foto: fotoBase64,
                    fecha_exif: fechaExif,
                    fecha_dispositivo: new Date().toISOString(),
                    fecha_servidor: serverTimestamp(),
                    seguridad: "Máxima (Bloqueo de PC + Cámara Viva)"
                });

                statusTxt.innerText = "✅ Certificado guardado: " + folio;
                alert("Éxito: Datos verificados y subidos.");
            } catch (error) {
                console.error(error);
                alert("Error al conectar con el servidor.");
            }
        });
    }, () => alert("Activa el GPS para certificar."), { enableHighAccuracy: true });
};
