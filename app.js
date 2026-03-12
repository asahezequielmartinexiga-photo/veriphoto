import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Tu config de Firebase (se mantiene igual)
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

// Bloqueo de escritorio
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (!isMobile) {
    document.body.innerHTML = "<h1>🚫 ACCESO DENEGADO</h1><p>Usa tu celular para esta app.</p>";
    throw new Error("Bloqueado en PC");
}

// GPS (Ligado a window para el botón)
window.activarGPS = function() {
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

// Cámara
document.getElementById("cameraInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ahora = Date.now();
    const tiempoArchivo = file.lastModified;
    const desfase = (ahora - tiempoArchivo) / 1000;

    if (desfase > 120) {
        alert("❌ ERROR: La foto no es reciente.");
        e.target.value = "";
        selectedFile = null;
        document.getElementById("btnSubir").style.display = "none";
    } else {
        selectedFile = file;
        statusTxt.innerText = "Foto capturada y validada 📸";
        // HACER APARECER EL BOTÓN VERDE
        document.getElementById("btnSubir").style.display = "block";
    }
});

// Optimización (Se mantiene tu código exacto)
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

    // Cambiamos el texto para que el usuario sepa que está trabajando
    statusTxt.innerText = "⏳ Certificando y subiendo...";
    statusTxt.style.color = "orange";
    
    // Ocultamos el botón para evitar que le piquen dos veces por error
    document.getElementById("btnSubir").style.display = "none";

    try {
        const fotoBase64 = await optimizarImagen(selectedFile);
        
        // Generar Hash SHA-256
        const buffer = await selectedFile.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
        
        // Generamos el folio ANTES de subirlo para tenerlo listo
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
            fecha_servidor: serverTimestamp(),
            verificado: true
        });

        // --- AQUÍ ESTÁ EL CAMBIO PARA QUE SE VEA EL FOLIO ---
        // 1. Ponemos el texto de éxito
        statusTxt.innerHTML = `
            <div style="background: #d4edda; color: #155724; padding: 15px; border-radius: 10px; border: 1px solid #c3e6cb; margin-top: 10px;">
                <strong style="font-size: 1.2rem;">✅ ¡Subida Exitosa!</strong><br>
                <span style="font-size: 1rem;">Folio generado:</span><br>
                <code style="font-size: 1.1rem; background: white; padding: 2px 5px; border-radius: 4px; display: inline-block; margin-top: 5px;">${folio}</code>
            </div>
        `;
        
        // 2. Alert para asegurar que el usuario lo vea
        alert("✅ Evidencia certificada con éxito.\n\nFolio: " + folio);

        // 3. Limpiamos las variables para la siguiente foto
        selectedFile = null;
        document.getElementById("cameraInput").value = "";

    } catch (error) {
        console.error(error);
        statusTxt.innerText = "❌ Error al subir. Intenta de nuevo.";
        statusTxt.style.color = "red";
        // Si hay error, volvemos a mostrar el botón para que intente de nuevo
        document.getElementById("btnSubir").style.display = "block";
        alert("Error al conectar con la base de datos.");
    }
};
